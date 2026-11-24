'use strict';
// Execute from package directory using Node.js; --check does not change files.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const args=process.argv.slice(2),root=path.resolve(__dirname,'..');
const arg=(k,d)=>{const i=args.indexOf(k);return i<0?d:args[i+1]};
const apply=args.includes('--apply');
const dirs={backend:path.resolve(arg('--backend','../backend')),frontend:path.resolve(arg('--frontend','../frontend'))};
const edits=new Map(),newFiles=[];
function patch(kind,rel,oldText,newText,label){
 const p=path.join(dirs[kind],rel);
 if(!fs.existsSync(p))throw Error(`Arquivo não encontrado: ${p}`);
 const raw=fs.readFileSync(p,'utf8');
 const obj=edits.get(p)||{original:raw,text:raw.replace(/\r\n/g,'\n'),eol:raw.includes('\r\n')?'\r\n':'\n',labels:[]};
 if(obj.text.split(oldText).length!==2)throw Error(`${kind}/${rel}: âncora '${label}' não encontrada exatamente uma vez. Nenhuma alteração gravada.`);
 obj.text=obj.text.replace(oldText,newText);obj.labels.push(label);edits.set(p,obj);
}
function add(kind,rel,source){
 const target=path.join(dirs[kind],rel);
 if(fs.existsSync(target))throw Error(`Já existe o novo arquivo ${target}; o aplicador não sobrescreve arquivos.`);
 newFiles.push({target,source:path.join(root,source)});
}
function run(){
 patch('backend','config/sportsMarkets.js',"  'la-liga': { id: 'la-liga'", "  'champions-league': { id: 'champions-league', nome: 'UEFA Champions League — Fase de Liga', esporte: 'football', league: 2, season: Number(process.env.API_FOOTBALL_SEASON_UCL || 2026), participantes: 36, namespace: 220000000, fase: 'league', rodadas: 8 },\n  'la-liga': { id: 'la-liga'",'liga backend');
 patch('frontend','Data/mercados.js',"  'la-liga': { id: 'la-liga'", "  'champions-league': { id: 'champions-league', nome: 'UEFA Champions League', badge: 'champions-league', rota: '/champions-league', endpoint: '/api/tabelas/champions-league', participantes: 36, entidade: 'clube' },\n  'la-liga': { id: 'la-liga'",'liga frontend');
 patch('frontend','components/Sidebar.js',"  {\n    href: '/laliga-a',", "  {\n    href: '/champions-league',\n    nome: 'UEFA Champions League',\n    badge: 'champions-league',\n  },\n  {\n    href: '/laliga-a',",'menu lateral');
 patch('backend','routes/sportsStandings.js',"const mercados = require('../config/sportsMarkets');", "const mercados = require('../config/sportsMarkets');\nconst ucl2026 = require('../config/ucl2026');",'catálogo UCL');
 patch('backend','routes/sportsStandings.js',"  const lista = data?.response?.[0]?.league?.standings?.[0];", "  if (config.id === 'champions-league' && Number(data?.response?.[0]?.league?.season) !== 2026) throw new Error('Champions: API retornou temporada diferente de 2026.');\n  const lista = config.id === 'champions-league' ? ucl2026.selectStandings(data?.response?.[0]?.league?.standings) : data?.response?.[0]?.league?.standings?.[0];",'36 participantes');
 patch('backend','routes/sportsStandings.js',"      posicao: item.posicao, preco: clube?.preco ?? precoInicial, precoAtual: clube?.precoAtual ?? precoInicial,", "      posicao: item.posicao, preco: clube?.preco ?? precoInicial, precoAtual: getMarketMode() === 'IPO' && !Boolean(clube?.ipoEncerrado) ? precoInicial : (clube?.precoAtual ?? precoInicial),",'atualizar preço do IPO no MongoDB');
 patch('backend','routes/sportsStandings.js',"    const legacyId = config.namespace + item.apiId;", "    const uclClub = config.id === 'champions-league' ? ucl2026.identify(item.nome) : null;\n    if (config.id === 'champions-league' && !uclClub) throw new Error(`Clube desconhecido na UCL: ${item.nome}`);\n    const legacyId = uclClub ? ucl2026.toLegacyId(uclClub) : config.namespace + item.apiId;",'ID estável UCL');
 patch('backend','routes/sportsStandings.js',"    if (!clube) clube = await Club.findOne({ legacyId });", "    if (config.id === 'champions-league') clube = await Club.findOne({ legacyId });\n    else if (!clube) clube = await Club.findOne({ legacyId });",'identidade estável');
 patch('backend','routes/sportsStandings.js',"    if (!classificacao.length && Number.isInteger(temporadaNumerica)) {", "    if (!classificacao.length && Number.isInteger(temporadaNumerica) && configBase.id !== 'champions-league') {",'não recuar para temporada anterior');
 patch('backend','routes/sportsStandings.js',"  if (classificacao.length) {\n    try {\n      const data = await sincronizar(configBase, classificacao);", "  if (classificacao.length) {\n    try {\n      if (configBase.id === 'champions-league') {\n        if (Number(configBase.season) !== 2026) throw new Error('Temporada UCL incorreta.');\n        ucl2026.validateStandings(classificacao);\n      }\n      const data = await sincronizar(configBase, classificacao);",'validação antes da gravação');
 patch('frontend','pages/brasileirao-a.js','<ClubBadge clube={clube.nome} escudo={clube.escudo} size={28} />','<ClubBadge clube={clube.nome} liga={LIGA_ID} escudo={clube.escudo} size={28} />','badge lista');
 patch('frontend','pages/brasileirao-a.js','<ClubBadge clube={clube.nome} escudo={clube.escudo} size={25} />','<ClubBadge clube={clube.nome} liga={LIGA_ID} escudo={clube.escudo} size={25} />','badge lista compacta');
 const badges = `// Champions League 2026/27. Badges novos, inspirados nas cores dos escudos
// oficiais; clubes já cadastrados em ligas nacionais preservam seu badge.
AUTHORIAL_CLUB_BADGES.push(
  ['aekathens','AEK','#f6c500','#111111','#111111','vertical-stripes','shield',['aek','aekathensfc']],
  ['bodoglimt','BOG','#f1ce18','#121212','#121212','horizontal-stripes','circle',['bodglimt','bodoeglimt']],
  ['clubbrugge','BRU','#1756a8','#111111','#ffffff','vertical-stripes','shield',['clubbruggekv']],
  ['como','COM','#1762a3','#f8fafc','#ffffff','waves','shield',['como1907']],
  ['fenerbahce','FEN','#122c65','#f2c900','#f2c900','horizontal-stripes','circle',['fenerbahcesk','fenerbahceistanbul']],
  ['galatasaray','GAL','#bf2132','#e7a824','#ffffff','quarters','shield',['galatasarayistanbul','galatasaraysk']],
  ['lask','LASK','#111111','#ffffff','#ffffff','vertical-stripes-clean','shield',['lasklinz','linzerask']],
  ['porto','FCP','#135da0','#ffffff','#ffffff','vertical-stripes','shield',['fcporto']],
  ['sabah','SAB','#165ca8','#ffffff','#ffffff','half-horizontal','circle',['sabahfc','sabahmasazir']],
  ['shakhtardonetsk','SHA','#f18b1b','#111111','#111111','horizontal-stripes','shield',['shakhtar','fcshakhtardonetsk']],
  ['slaviapraha','SLA','#e2e8f0','#c92b3c','#c92b3c','quarters','circle',['slaviaprague','skslaviapraha']],
  ['slovanbratislava','SLO','#4f9bc8','#ffffff','#ffffff','rings','shield',['skslovanbratislava']],
  ['sportingcp','SCP','#12834c','#ffffff','#ffffff','horizontal-stripes','shield',['sportinglisbon','sportingclubedeportugal']],
  ['viking','VIK','#b61930','#f8fafc','#ffffff','horizontal-stripes','circle',['vikingfk','vikingstavanger']]
);

`;
 patch('frontend','components/ClubBadge.js',"function compactClubKey(value = '') {",badges+"function compactClubKey(value = '') {",'14 badges novos');
 patch('frontend','components/ClubBadge.js',"  const hasAuthorialBadge = Boolean(CLUB_STYLES[key]);", "  const hasAuthorialBadge = Boolean(CLUB_STYLES[key]);\n  // Clubes que estreiam na TradeSports: borda autoral + escudo oficial fornecido pela API.\n  const uclNovos = new Set(['aekathens','bodoglimt','clubbrugge','como','fenerbahce','galatasaray','lask','porto','sabah','shakhtardonetsk','slaviapraha','slovanbratislava','sportingcp','viking']);",'badge novo sobre escudo oficial');
 patch('frontend','components/ClubBadge.js',"{escudo && !hasAuthorialBadge && !logoFalhou ? (", "{escudo && (!hasAuthorialBadge || uclNovos.has(key)) && !logoFalhou ? (",'usar escudo oficial nos badges novos');
 patch('frontend','components/ClubBadge.js',"const LEAGUE_STYLES = {", "const LEAGUE_STYLES = {\n  championsleague: {outer:'#06164b', glow:'#a9c2ff', pattern:'radial-burst', colors:['#06164b','#416bc4','#f8fafc']},",'badge liga');
 const starIcon = `      <Inner $bg={bg}>
        {key === 'championsleague' && (
          <span aria-hidden="true" style={{fontSize: Math.max(14, size*.56), color:'#fff', textShadow:'0 0 8px #a9c2ff', lineHeight:1}}>✦</span>
        )}
        {style.pattern === 'flag-brazil-premium' && (`;
 patch('frontend','components/ClubBadge.js',"      <Inner $bg={bg}>\n        {style.pattern === 'flag-brazil-premium' && (",starIcon,'estrela autoral da liga');
 add('backend','config/ucl2026.js','scripts/ucl2026.js');
 add('backend','data/participantes-2026-27.json','data/participantes-2026-27.json');
 add('backend','scripts/seedChampions2026.js','scripts/seedChampions2026.js');
 add('frontend','pages/champions-league.js','scripts/champions-league.js');
 const changed=[...edits.entries()];
 for(const [p,x] of changed){console.log('OK',p,`${x.labels.length} operações`)}
 for(const x of newFiles){console.log('NOVO',x.target)}
 if(!apply){console.log(`VALIDAÇÃO CONCLUÍDA: ${changed.length} arquivos modificáveis + ${newFiles.length} arquivos novos; nenhuma alteração gravada.`);return}
 for(const x of newFiles){if(!fs.existsSync(x.source))throw Error(`Falta no pacote: ${x.source}`)}
 const bdir=path.join(dirs.backend,'_backup_champions_'+new Date().toISOString().replace(/[:.]/g,'-'));
 fs.mkdirSync(bdir,{recursive:true});
 for(const [p,x] of changed){fs.writeFileSync(path.join(bdir,crypto.createHash('sha256').update(p).digest('hex')+'_'+path.basename(p)),x.original)}
 for(const [p,x] of changed){if(fs.readFileSync(p,'utf8')!==x.original)throw Error('Arquivo foi alterado durante aplicação: '+p)}
 for(const [p,x] of changed){fs.writeFileSync(p,x.text.replace(/\n/g,x.eol),'utf8')}
 for(const x of newFiles){fs.mkdirSync(path.dirname(x.target),{recursive:true});fs.copyFileSync(x.source,x.target)}
 console.log('PATCH APLICADO. Backups:',bdir,'; MongoDB não alterado.');
}
try{run()}catch(e){console.error('ERRO:',e.message);process.exitCode=1}
