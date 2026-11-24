#!/usr/bin/env node
'use strict';
/** Diagnóstico --check; alteração --apply. Preserva backup e não toca MongoDB. */
const fs=require('fs'); const path=require('path');
const root=path.resolve(process.cwd());
const apply=process.argv.includes('--apply');
const check=process.argv.includes('--check');
if (apply===check) {console.error('Use exatamente --check OU --apply.');process.exit(2)}
const targetSeed=path.join(root,'scripts','seedChampions2026.js');
const targetApi=path.join(root,'config','uclApiResponse.js');
const targetStandings=path.join(root,'routes','sportsStandings.js');
const payload=path.resolve(__dirname,'..','payload');
for(const f of [targetSeed,targetStandings]) if(!fs.existsSync(f))throw Error('Arquivo esperado ausente: '+f);
for(const f of ['seedChampions2026.js','uclApiResponse.js']) if(!fs.existsSync(path.join(payload,f)))throw Error('Pacote incompleto: '+f);
const content=fs.readFileSync(targetStandings,'utf8');
const bad="if (config.id === 'champions-league' && Number(data?.response?.[0]?.league?.season) !== 2026) throw new Error('Champions: API retornou temporada diferente de 2026.');";
const good="if (config.id === 'champions-league') { const league = data?.response?.[0]?.league; if (!league || Number(league.id) !== 2 || (league.season != null && String(league.season).trim() !== '' && Number(league.season) !== 2026)) throw new Error('Champions: API sem classificação válida da liga 2/2026.'); }";
const count=content.split(bad).length-1;
const already=content.includes(good);
if(count!==1 && !already)throw Error('routes/sportsStandings.js não contém a âncora esperada; nenhuma modificação feita.');
const existingSeed=fs.readFileSync(targetSeed,'utf8');
if(!existingSeed.includes('loadStandings') || !existingSeed.includes('validateStandings'))throw Error('Script de cadastro desconhecido; nenhuma modificação feita.');
console.log('OK scripts/seedChampions2026.js -> tratamento de resposta vazia/temporada');
console.log('OK config/uclApiResponse.js -> novo validador de resposta API');
console.log('OK routes/sportsStandings.js -> validação da temporada com proteção');
if(check){console.log('CHECK aprovado; nenhuma alteração aplicada.');process.exit(0)}
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const backupDir=path.join(root,'_backup_ucl_api_'+stamp); fs.mkdirSync(backupDir,{recursive:true});
for (const f of [targetSeed,targetApi,targetStandings]){
 if(fs.existsSync(f)){const name=path.relative(root,f);const out=path.join(backupDir,name);fs.mkdirSync(path.dirname(out),{recursive:true});fs.copyFileSync(f,out)}
}
fs.copyFileSync(path.join(payload,'seedChampions2026.js'),targetSeed);
fs.mkdirSync(path.dirname(targetApi),{recursive:true});
fs.copyFileSync(path.join(payload,'uclApiResponse.js'),targetApi);
if(count===1)fs.writeFileSync(targetStandings,content.replace(bad,good),'utf8');
console.log('Correção aplicada. Backup:',backupDir);
console.log('Agora: node scripts/seedChampions2026.js --check');
