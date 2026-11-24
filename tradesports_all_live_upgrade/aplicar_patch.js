'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');
const args=process.argv.slice(2);
function arg(flag,alt){const i=args.indexOf(flag);return i<0?alt:args[i+1];}
const backend=path.resolve(arg('--backend','.'));
const frontend=path.resolve(arg('--frontend','./frontend'));
const apply=args.includes('--apply');const check=args.includes('--check');
if((apply?1:0)+(check?1:0)!==1){console.error('Use --check OU --apply');process.exit(2);}
const sha=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,12);
function replaceOnce(s,oldText,newText,name){const c=s.split(oldText).length-1;if(c!==1)throw Error(`${name}: âncora encontrada ${c} vez(es), esperado 1`);return s.replace(oldText,newText);}
function sourceFile(base,name){const p=path.join(base,...name.split('/'));if(!fs.existsSync(p))throw Error('Arquivo ausente: '+p);return p;}
function normalizeEol(s){return s.replace(/\r\n/g,'\n');}
function changeMarkets(s){
 s=replaceOnce(s,'const anoAtual = new Date().getFullYear();',`const agora = new Date();\nconst anoAtual = agora.getFullYear();\nconst temporadaEuropeia = agora.getMonth() >= 6 ? anoAtual : anoAtual - 1;\nconst temporadaNBA = agora.getMonth() >= 8 ? anoAtual : anoAtual - 1;\nconst temporadaNFL = agora.getMonth() >= 7 ? anoAtual : anoAtual - 1;`,'temporadas');
 const re=[[/API_FOOTBALL_SEASON \|\| 2024/g,'API_FOOTBALL_SEASON || anoAtual'],[/API_FOOTBALL_SEASON_BR_B \|\| 2024/g,'API_FOOTBALL_SEASON_BR_B || anoAtual'],[/API_FOOTBALL_SEASON_PREMIER \|\| 2023/g,'API_FOOTBALL_SEASON_PREMIER || temporadaEuropeia'],[/API_FOOTBALL_SEASON_UCL \|\| 2026/g,'API_FOOTBALL_SEASON_UCL || temporadaEuropeia'],[/API_FOOTBALL_SEASON_LALIGA \|\| 2023/g,'API_FOOTBALL_SEASON_LALIGA || temporadaEuropeia'],[/API_FOOTBALL_SEASON_BUNDESLIGA \|\| 2023/g,'API_FOOTBALL_SEASON_BUNDESLIGA || temporadaEuropeia'],[/API_FOOTBALL_SEASON_LIGUE1 \|\| 2023/g,'API_FOOTBALL_SEASON_LIGUE1 || temporadaEuropeia'],[/API_FOOTBALL_SEASON_SERIEA \|\| 2023/g,'API_FOOTBALL_SEASON_SERIEA || temporadaEuropeia'],[/API_FOOTBALL_SEASON_EREDIVISIE \|\| 2023/g,'API_FOOTBALL_SEASON_EREDIVISIE || temporadaEuropeia'],[/API_NBA_SEASON \|\| 2023/g,'API_NBA_SEASON || temporadaNBA'],[/API_NFL_SEASON \|\| 2023/g,'API_NFL_SEASON || temporadaNFL']];
 for(const [rx,rep] of re){if(!rx.test(s))throw Error('config/sportsMarkets.js: padrão de temporada ausente '+rx);s=s.replace(rx,rep);}return s;
}
function changeFootball(s){
 const old=`function enabled(marketId) {
  // Por segurança, começa pela Champions. Outras ligas precisam estar com a
  // temporada corrente correta em config/sportsMarkets.js e API validada.
  const env = process.env.LIVE_FOOTBALL_MARKETS || 'champions-league';
  return env.split(',').map(s => s.trim()).includes(String(marketId));
}`;
 const newer=`function enabled(marketId) {
  // Todos os mercados de futebol configurados passam a usar partidas.
  // A rotina recusa cotações se temporada/identidade/partidas não conferirem.
  const mercado = require('../config/sportsMarkets')[String(marketId)];
  return Boolean(mercado && mercado.esporte === 'football');
}`;
 s=replaceOnce(s,old,newer,'liveFootballTable.enabled');
 s=replaceOnce(s,`  const clubs=await Club.find({'metadata.ligaId':config.id}).lean();`,`  const clubs=await Club.find({'metadata.ligaId':config.id}).lean();
  if(clubs.some(c=>String(c.metadata?.temporada)!==String(config.season))) {
    throw error('TEMPORADA_MONGODB_DIVERGENTE_'+config.id+':'+config.season);
  }`,'liveFootballTable.guarda');
 return s;
}
function changeSportsRoute(s){
 s=replaceOnce(s,"const liveFootball = require('../services/liveFootballTable');","const liveSports = require('../services/liveSportsTable');",'sportsStandings.import');
 s=replaceOnce(s,"if (configBase.esporte === 'football' && liveFootball.enabled(configBase.id)) {","if (liveSports.enabled(configBase.id)) {",'sportsStandings.modos');
 s=replaceOnce(s,'await liveFootball.refreshCompetition(configBase)','await liveSports.refreshCompetition(configBase)','sportsStandings.refresh');
 s=replaceOnce(s,`        atualizadoEm: new Date(status.at).toISOString(), live: status.live,`,`        atualizadoEm: new Date(status.at).toISOString(), live: status.live,\n        classificacaoProvisoria: Boolean(status.provisional),`,'sportsStandings.projecao');
 return s;
}
function changeBrazil(s){
 s=replaceOnce(s,"const liveFootball = require('../services/liveFootballTable');","const liveSports = require('../services/liveSportsTable');",'brasileirao.import');
 s=replaceOnce(s,"liveFootball.enabled('brasileirao-a')","liveSports.enabled('brasileirao-a')",'brasileirao.modo');
 s=replaceOnce(s,"liveFootball.refreshCompetition(sportsMarkets['brasileirao-a'])","liveSports.refreshCompetition(sportsMarkets['brasileirao-a'])",'brasileirao.refresh');
 return s;
}
function changeImport(s,name){return replaceOnce(s,"require('../services/liveFootballTable')","require('../services/liveSportsTable')",name);}
const scripts=[
 ['backend','config/sportsMarkets.js',changeMarkets],
 ['backend','services/liveFootballTable.js',changeFootball],
 ['backend','routes/sportsStandings.js',changeSportsRoute],
 ['backend','routes/classificacao.js',changeBrazil],
 ['backend','controllers/InvestimentoController.js',s=>changeImport(s,'IPO.preflight')],
 ['backend','routes/mercado.js',s=>changeImport(s,'secondary.preflight')],
];
const additions=[
 ['backend','services/liveSportsTable.js','files/services/liveSportsTable.js'],
 ['backend','services/liveAmericanTable.js','files/services/liveAmericanTable.js'],
 ['backend','scripts/check_live_all_markets.js','files/scripts/check_live_all_markets.js'],
];
const plan=[];
try{
for(const [scope,relative,fn] of scripts){
 const p=sourceFile(scope==='backend'?backend:frontend,relative);
 const original=fs.readFileSync(p,'utf8');const crlf=original.includes('\r\n');
 let transformed=fn(normalizeEol(original));
 if(transformed===normalizeEol(original))throw Error('Nenhuma mudança '+relative);
 if(crlf)transformed=transformed.replace(/\n/g,'\r\n');
 plan.push({p,old:original,newText:transformed,relative});
}
for(const [scope,relative,source] of additions){
 const p=path.join(scope==='backend'?backend:frontend,relative);
 if(fs.existsSync(p))throw Error('Arquivo novo já existe: '+p+'. Não substituir automaticamente.');
 plan.push({p,old:null,newText:fs.readFileSync(path.join(__dirname,source),'utf8'),relative});
}
console.log('FRONTS: a atualização de 20s já está no pacote anterior; sem modificação extra.');
for(const p of plan)console.log(`${p.old===null?'NOVO':'OK  '} ${p.relative} ${p.old===null?'':sha(p.old)+' -> '+sha(p.newText)}`);
if(check){console.log(`CHECK APROVADO: ${plan.length} arquivos. Nenhuma alteração gravada.`);process.exit(0);}
const stamp=new Date().toISOString().replace(/[:.]/g,'-');const backup=path.join(backend,'_backup_all_live_'+stamp);fs.mkdirSync(backup,{recursive:true});
for(const p of plan){if(p.old!==null){const dest=path.join(backup,p.relative);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,p.old);}}
for(const p of plan){fs.mkdirSync(path.dirname(p.p),{recursive:true});fs.writeFileSync(p.p,p.newText);}
console.log('APLICADO: '+plan.length+' arquivo(s). Backup: '+backup);
console.log('ATENÇÃO: execute node scripts/check_live_all_markets.js e valide temporadas + IDs no MongoDB ANTES do deploy.');
} catch(e){console.error('PATCH BLOQUEADO, sem mudanças: '+e.message);process.exit(1);}
