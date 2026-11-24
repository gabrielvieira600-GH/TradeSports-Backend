#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const args = process.argv.slice(2);
const check = args.includes('--check');
const apply = args.includes('--apply');
if (check === apply) {console.error('Use exclusivamente --check OU --apply');process.exit(2);}
const at = args.indexOf('--backend');
const backend = path.resolve(at >= 0 && args[at+1] ? args[at+1] : '.');
const sha = value => crypto.createHash('sha256').update(value).digest('hex').slice(0,12);
const replace = (s, from, to, label) => {
  const count=s.split(from).length-1;
  if(count!==1)throw new Error(`${label}: ancora encontrada ${count} vez(es), esperado 1. Nada aplicado.`);
  return s.replace(from,to);
};
const next = [];
function change(relative,fn) {
  const target = path.join(backend,relative);
  if(!fs.existsSync(target))throw new Error('Arquivo não encontrado: '+target);
  const prev = fs.readFileSync(target,'utf8');
  const crlf=prev.includes('\r\n');
  let out=fn(prev.replace(/\r\n/g,'\n'));
  if(out===prev.replace(/\r\n/g,'\n'))throw new Error('Nenhuma modificação: '+relative);
  if(crlf)out=out.replace(/\n/g,'\r\n');
  next.push({relative,target,prev,out});
}
function addition(relative,source) {
  const target=path.join(backend,relative);
  if(fs.existsSync(target))throw new Error('Já existe arquivo: '+relative+' (não sobrescrever automaticamente)');
  next.push({relative,target,prev:null,out:fs.readFileSync(path.resolve(__dirname,'../files',source),'utf8')});
}
function live(s){
  s=replace(s,"const { getMarketMode } = require('../config/marketMode');",
    "const { getMarketMode } = require('../config/marketMode');\nconst { currentSeasonFilter, assertCurrentRoster } = require('../utils/currentSeasonScope');",'live import');
  const old=`  const clubs=await Club.find({'metadata.ligaId':config.id}).lean();
  if(clubs.some(c=>String(c.metadata?.temporada)!==String(config.season))) {
    throw error('TEMPORADA_MONGODB_DIVERGENTE_'+config.id+':'+config.season);
  }`;
  const replacement=`  // Histórico permanece em MongoDB, mas não participa da cotação atual.
  const clubs=await Club.find(currentSeasonFilter(config)).lean();
  // Nunca completa participantes usando dados históricos nem cria cotas.
  assertCurrentRoster(clubs, config);`;
  return replace(s,old,replacement,'live somente temporada atual');
}
function cached(s){
  s=replace(s,"const { calcularPrecoPorPosicao } = require('../utils/liquidationPrice');",
    "const { calcularPrecoPorPosicao } = require('../utils/liquidationPrice');\nconst markets = require('../config/sportsMarkets');\nconst {currentSeasonFilter,assertCurrentRoster} = require('../utils/currentSeasonScope');",'cache import');
  s=replace(s,`  const clubs = await ClubModel.find(marketFilter(marketId))
    .sort({ posicao: 1, nome: 1 })
    .lean();`,`  const market = markets[marketId];
  if (!market) throw new Error('MERCADO_DESCONHECIDO');
  // Não incluir clubes de 2023/2024 que ainda possuem histórico no banco.
  const clubs = await ClubModel.find({$and:[marketFilter(marketId),currentSeasonFilter(market)]})
    .sort({ posicao: 1, nome: 1 })
    .lean();
  assertCurrentRoster(clubs,market);`,'cache scope');
  return s;
}
function sports(s){
  s=replace(s,"const { getMarketMode } = require('../config/marketMode');",
    "const { getMarketMode } = require('../config/marketMode');\nconst { currentSeasonFilter, assertCurrentRoster } = require('../utils/currentSeasonScope');",'standings import');
  s=replace(s,"  const existentes = await Club.find({ 'metadata.ligaId': config.id });",
    "  const existentes = await Club.find(currentSeasonFilter(config));\n  assertCurrentRoster(existentes,config);",'standings existing');
  s=replace(s,`    if (config.id === 'champions-league') clube = await Club.findOne({ legacyId });
    else if (!clube) clube = await Club.findOne({ legacyId });`,`    if (config.id === 'champions-league') clube = existentes.find(c => Number(c.legacyId) === Number(legacyId));
    else if (!clube) clube = existentes.find(c => Number(c.legacyId) === Number(legacyId));
    if (!clube) throw new Error('CLUBE_NAO_CADASTRADO_NA_TEMPORADA_ATUAL_'+config.id+':'+item.nome);`,'standings current club');
  s=replace(s,"    clube = await Club.findOneAndUpdate({ legacyId }, { $set: update }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();",
    "    clube = await Club.findOneAndUpdate({_id:clube._id, ...currentSeasonFilter(config)}, { $set: update }, { upsert: false, new: true }).lean();\n    if(!clube) throw new Error('CLUBE_ATUAL_MUDOU_DURANTE_SINCRONIZACAO');",'standings no accidental overwrite');
  return s;
}
function clubModel(s){
  return replace(s, 'ClubSchema.index({ nomeApi: 1 });\n','', 'índice nomeApi duplicado');
}
function diagnostics(s){
  // Change only the Mongo roster verification section, leave credential diagnostics untouched.
  const old=`   const docs=await Club.find({'metadata.ligaId':m.id}).select('legacyId nome posicao metadata.temporada metadata.providerTeamId cotasEmitidas').lean();
   const ids=new Set(docs.map(x=>Number(x.metadata?.providerTeamId)));
   const wrong=docs.filter(x=>String(x.metadata?.temporada)!==String(m.season));
   const status=docs.length===m.participantes&&ids.size===docs.length&&wrong.length===0?'OK':'PRECISA_AJUSTE';
   if(status!=='OK') errors++;
   console.log(\`\${status.padEnd(15)} \${m.id.padEnd(19)} MongoDB \${docs.length}/\${m.participantes} | IDs únicos \${ids.size} | temporadas divergentes \${wrong.length}\`);
   if(wrong.length) console.log('  Exemplo de clube divergente:',wrong.slice(0,2).map(x=>({nome:x.nome,temporada:x.metadata?.temporada,cotas:x.cotasEmitidas})));`;
  const replacement=`   const docs=await Club.find({'metadata.ligaId':m.id}).select('legacyId nome posicao metadata.temporada metadata.providerTeamId cotasEmitidas').lean();
   const current=docs.filter(x=>String(x.metadata?.temporada)===String(m.season));
   const historical=docs.filter(x=>String(x.metadata?.temporada)!==String(m.season));
   let valid=false; let reason='';
   try {assertCurrentRoster(current,m);valid=true;}catch(e){reason=e.message;}
   const status=valid?'OK':'PRECISA_AJUSTE';
   if(status!=='OK' && m.esporte==='football') errors++;
   console.log(\`\${status.padEnd(15)} \${m.id.padEnd(19)} TEMPORADA ATUAL \${current.length}/\${m.participantes} | históricos preservados \${historical.length}\${reason?' | '+reason:''}\`);
   if(historical.length)console.log('  Registros de temporadas anteriores preservados; não entram na cotação atual.');`;
  s=replace(s,"const {connectDB}=require('../config/db');", "const {connectDB}=require('../config/db');\nconst {assertCurrentRoster}=require('../utils/currentSeasonScope');",'diagnostico import');
  return replace(s,old,replacement,'diagnostico contagem');
}
try{
 change('services/liveFootballTable.js', live);
 change('services/sportsTableCache.js', cached);
 change('routes/sportsStandings.js', sports);
 change('models/Club.js', clubModel);
 change('scripts/check_live_all_markets.js', diagnostics);
 addition('utils/currentSeasonScope.js','utils/currentSeasonScope.js');
 for(const p of next)console.log(`${p.prev===null?'NOVO':'OK  '} ${p.relative} ${p.prev===null?'':sha(p.prev)+' -> '+sha(p.out)}`);
 if(check){console.log(`CHECK APROVADO: ${next.length} arquivos. Nada alterado.`);process.exit(0);}
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 const backup=path.join(backend,'_backup_football_scope_'+stamp);
 fs.mkdirSync(backup,{recursive:true});
 for(const p of next)if(p.prev!==null){const target=path.join(backup,p.relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,p.prev);}
 for(const p of next){fs.mkdirSync(path.dirname(p.target),{recursive:true});fs.writeFileSync(p.target,p.out);}
 console.log('APLICADO:',next.length,'arquivos. Backup:',backup);
 console.log('MongoDB não foi alterado diretamente pelo aplicador. Validar APIs/temporadas antes de publicar.');
}catch(e){console.error('PATCH BLOQUEADO:',e.message);process.exitCode=1;}
