const fs=require('fs'),path=require('path');
const root=process.cwd(),route=path.join(root,'routes','api','admin.js'),service=path.join(root,'services','leagueSettlement.js');
if(!fs.existsSync(route))throw Error('Execute na raiz do backend (routes/api/admin.js não encontrado).');
const original=fs.readFileSync(route,'utf8');const marker='// TRADE SPORTS LEAGUE SETTLEMENT V1';
if(original.includes(marker)){console.log('Patch já aplicado.');process.exit(0)}
const anchor='router.use(isAdmin);';if(!original.includes(anchor))throw Error('Ponto de inserção não encontrado; nada alterado.');
const insert=`\n${marker}\nconst leagueSettlement = require('../../services/leagueSettlement');\nrouter.get('/league-settlement/markets', async (_req,res)=>{try{const controls=await MarketControl.find({}).lean();const byId=new Map(controls.map(c=>[c.ligaId,c]));res.json({mercados:Object.values(sportsMarkets).map(m=>({id:m.id,nome:m.nome,fechado:byId.get(m.id)?.fechado===true}))});}catch(e){res.status(500).json({erro:e.message})}});\nrouter.get('/league-settlement/preview/:ligaId',async(req,res)=>{try{res.json(await leagueSettlement.preview(req.params.ligaId,req.query.temporada))}catch(e){res.status(e.status||500).json({erro:e.message})}});\nrouter.post('/league-settlement/execute/:ligaId',async(req,res)=>{try{res.json(await leagueSettlement.execute(req.params.ligaId,Number(req.body?.temporada),req.body?.confirmation,req.usuario?.id))}catch(e){console.error('[LEAGUE SETTLEMENT]',e);res.status(e.status||500).json({erro:e.message})}});\n`;
let next=original.replace(anchor,anchor+'\n'+insert);
// A liquidação encerrada libera preços sem apagar histórico de ordens e investimentos.
const oldEligibility="editavel: c.cotasEmitidas === 0 && c.cotasDisponiveis === 1000 && !c.ipoEncerrado && !blocked.has(String(c._id))";
const newEligibility="editavel: c.cotasEmitidas === 0 && c.cotasDisponiveis === 1000 && !c.ipoEncerrado && (c.metadata?.precificacaoLiberadaEm ? !recentBlocked.has(String(c._id)) : !blocked.has(String(c._id)))";
if(!next.includes(oldEligibility))throw Error('Validação de edição não encontrada; nada alterado.');
next=next.replace(oldEligibility,newEligibility);
const oldBlock="const blocked = new Set(orders.map(String));";
const newBlock="const blocked = new Set(orders.map(String)); const recentOrders = await Order.find({ clubeId: { $in: ids } }, { clubeId: 1, criadoEm: 1 }).lean(); const recentInvestments = await Investment.find({ clubeId: { $in: ids } }, { clubeId: 1, data: 1 }).lean(); const recentBlocked = new Set(clubs.filter(c => c.metadata?.precificacaoLiberadaEm && (recentOrders.some(o => String(o.clubeId) === String(c._id) && new Date(o.criadoEm) > new Date(c.metadata.precificacaoLiberadaEm)) || recentInvestments.some(i => String(i.clubeId) === String(c._id) && new Date(i.data) > new Date(c.metadata.precificacaoLiberadaEm)))).map(c => String(c._id)));";
if(!next.includes(oldBlock))throw Error('Bloco de ordens não encontrado.');
next=next.replace(oldBlock,newBlock);
const oldGuard="if (orders || investments || c.cotasEmitidas !== 0 || c.cotasDisponiveis !== 1000 || c.ipoEncerrado || (c.splits || []).length)";
const newGuard="if ((c.metadata?.precificacaoLiberadaEm ? (await Order.exists({ clubeId: c._id, criadoEm: { $gt: new Date(c.metadata.precificacaoLiberadaEm) } }) || await Investment.exists({ clubeId: c._id, data: { $gt: new Date(c.metadata.precificacaoLiberadaEm) } })) : (orders || investments)) || c.cotasEmitidas !== 0 || c.cotasDisponiveis !== 1000 || c.ipoEncerrado || (c.splits || []).length)";
if(!next.includes(oldGuard))throw Error('Validação de salvamento não encontrada; nada alterado.');
next=next.replace(oldGuard,newGuard);const source=path.join(__dirname,'leagueSettlement.js');if(!fs.existsSync(source))throw Error('leagueSettlement.js não encontrado ao lado do script.');
fs.copyFileSync(route,route+'.bak-league-settlement');fs.mkdirSync(path.dirname(service),{recursive:true});fs.copyFileSync(source,service);fs.writeFileSync(route,next);console.log('Backend atualizado. Backup:',route+'.bak-league-settlement');
