// TradeSports: rotas administrativas de clubes. Injetado após router.use(isAdmin).
const clubManagementRouter = require('express').Router();
const ClubManagementClub = require('../../models/Club');
const ClubManagementMarkets = require('../../config/sportsMarkets');
const ClubManagementControl = require('../../models/MarketControl');
const ClubManagementOrder = require('../../models/Order');
const ClubManagementInvestment = require('../../models/Investment');
const cleanName = x => String(x || '').trim().replace(/\s+/g, ' ');
const norm = x => cleanName(x).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const fail = (status,message) => {const e = new Error(message);e.status=status;throw e};
const validSeason = n => Number.isInteger(n) && n >= 2000 && n <= 2100;
async function ensureClosed(id){const control=await ClubManagementControl.findOne({ligaId:id}).lean();if(!control || control.fechado!==true) fail(409,'Feche o mercado antes de cadastrar ou editar clubes.');}
function parseFields(body, creating){
 const nome=cleanName(body.nome), nomeApi=cleanName(body.nomeApi || body.nome);
 const providerTeamId=Number(body.providerTeamId), temporada=Number(body.temporada), posicao=Number(body.posicao);
 if(!nome || nome.length>120 || !nomeApi || nomeApi.length>120)fail(400,'Nome do clube inválido.');
 if(!Number.isSafeInteger(providerTeamId)||providerTeamId<=0)fail(400,'Informe o ID numérico positivo do clube na API esportiva.');
 if(!validSeason(temporada))fail(400,'Temporada inválida.');
 if(!Number.isInteger(posicao)||posicao<1||posicao>100)fail(400,'Posição inválida.');
 const escudo=String(body.escudo||'').trim();if(escudo && (!/^https:\/\//i.test(escudo)||escudo.length>1500))fail(400,'Escudo deve ser uma URL HTTPS.');
 return {nome,nomeApi,providerTeamId,temporada,posicao,escudo};
}
async function checkConflicts(ligaId,fields,exclude){
 const all=await ClubManagementClub.find({'metadata.ligaId':ligaId}).lean();
 const dup=all.find(c=>String(c._id)!==String(exclude||'') && (norm(c.nome)===norm(fields.nome)||norm(c.nomeApi)===norm(fields.nomeApi)||Number(c.metadata?.providerTeamId)===fields.providerTeamId));
 if(dup)fail(409,`Clube duplicado na liga: ${dup.nome} (ID ${dup.legacyId}).`);
 const config=ClubManagementMarkets[ligaId];const legacyId=config.namespace+fields.providerTeamId;
 const legacy=await ClubManagementClub.findOne({legacyId}).lean();
 if(legacy && String(legacy._id)!==String(exclude||''))fail(409,`Identificador ${legacyId} já utilizado por ${legacy.nome}.`);
 const pos=all.find(c=>String(c._id)!==String(exclude||'') && Number(c.posicao)===fields.posicao);
 if(pos)fail(409,`Posição ${fields.posicao} já utilizada por ${pos.nome}.`);
 return legacyId;
}
async function hasActivity(c){
 if(Number(c.cotasEmitidas)>0||Number(c.cotasDisponiveis)!==1000||c.ipoEncerrado)return true;
 const id=c.legacyId;
 const [orders,investments]=await Promise.all([
  ClubManagementOrder.exists({$or:[{clubeId:id},{clubId:id},{clube:id}]}),
  ClubManagementInvestment.exists({$or:[{clubeId:id},{clubId:id},{clube:id}]})
 ]);
 return Boolean(orders||investments);
}
clubManagementRouter.get('/markets',async(_req,res)=>{try{const controls=await ClubManagementControl.find({}).lean();const byId=new Map(controls.map(c=>[c.ligaId,c]));res.json({mercados:Object.values(ClubManagementMarkets).map(m=>({id:m.id,nome:m.nome,temporada:m.season,participantes:m.participantes,fechado:byId.get(m.id)?.fechado===true}))})}catch(e){res.status(500).json({erro:'Falha ao consultar ligas.'})}});
clubManagementRouter.get('/:ligaId',async(req,res)=>{try{const config=ClubManagementMarkets[req.params.ligaId];if(!config)fail(404,'Liga não encontrada.');const clubes=await ClubManagementClub.find({'metadata.ligaId':config.id}).sort({posicao:1,nome:1}).lean();res.json({liga:config.id,temporada:config.season,participantes:config.participantes,total:clubes.length,clubes:clubes.map(c=>({id:String(c._id),legacyId:c.legacyId,nome:c.nome,nomeApi:c.nomeApi,escudo:c.escudo,posicao:c.posicao,preco:c.preco,cotasEmitidas:c.cotasEmitidas,cotasDisponiveis:c.cotasDisponiveis,providerTeamId:c.metadata?.providerTeamId,temporada:c.metadata?.temporada}))})}catch(e){res.status(e.status||500).json({erro:e.status?e.message:'Falha ao consultar clubes.'})}});
clubManagementRouter.post('/:ligaId',async(req,res)=>{try{
 const config=ClubManagementMarkets[req.params.ligaId];if(!config)fail(404,'Liga não encontrada.');await ensureClosed(config.id);
 const f=parseFields(req.body,true);if(f.posicao>config.participantes)fail(400,'Posição excede o número de participantes da liga.');
 if(f.temporada!==Number(config.season))fail(409,`Temporada da liga é ${config.season}. Atualize a configuração da API antes do cadastro.`);
 const legacyId=await checkConflicts(config.id,f);
 const count=await ClubManagementClub.countDocuments({'metadata.ligaId':config.id});if(count>=config.participantes)fail(409,'A liga já possui a quantidade máxima de clubes.');
 const club=await ClubManagementClub.create({legacyId,nome:f.nome,nomeApi:f.nomeApi,escudo:f.escudo,posicao:f.posicao,preco:0,precoAtual:0,cotasDisponiveis:1000,cotasEmitidas:0,ipoEncerrado:false,metadata:{ligaId:config.id,ligaNome:config.nome,esporte:config.esporte,providerTeamId:f.providerTeamId,temporada:f.temporada,totalParticipantes:config.participantes,cadastroManual:true}});
 res.status(201).json({ok:true,clube:{id:String(club._id),legacyId:club.legacyId,nome:club.nome}});
 }catch(e){res.status(e.code===11000?409:e.status||500).json({erro:e.code===11000?'Identificador já cadastrado.':e.status?e.message:'Falha ao cadastrar clube.'})}});
clubManagementRouter.put('/:ligaId/:id',async(req,res)=>{try{
 const config=ClubManagementMarkets[req.params.ligaId];if(!config)fail(404,'Liga não encontrada.');await ensureClosed(config.id);
 const club=await ClubManagementClub.findById(req.params.id);if(!club||club.metadata?.ligaId!==config.id)fail(404,'Clube não encontrado nesta liga.');
 const f=parseFields(req.body,false);if(f.posicao>config.participantes)fail(400,'Posição excede o número de participantes da liga.');
 if(f.temporada!==Number(config.season))fail(409,`Temporada da liga é ${config.season}.`);
 if(f.providerTeamId!==Number(club.metadata?.providerTeamId)&&await hasActivity(club))fail(409,'Não é possível alterar o ID de um clube com operações ou cotas emitidas.');
 const legacyId=await checkConflicts(config.id,f,club._id);
 club.nome=f.nome;club.nomeApi=f.nomeApi;club.escudo=f.escudo;club.posicao=f.posicao;club.legacyId=legacyId;
 club.metadata={...club.metadata,ligaId:config.id,ligaNome:config.nome,providerTeamId:f.providerTeamId,temporada:f.temporada,totalParticipantes:config.participantes};
 await club.save();res.json({ok:true,clube:{id:String(club._id),legacyId:club.legacyId,nome:club.nome}});
 }catch(e){res.status(e.code===11000?409:e.status||500).json({erro:e.code===11000?'Identificador duplicado.':e.status?e.message:'Falha ao editar clube.'})}});
module.exports=clubManagementRouter;
