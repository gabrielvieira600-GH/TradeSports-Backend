'use strict';
// Somente leitura: checa cobertura cadastrada e temporadas, sem consultar API e sem gravar.
require('dotenv').config();
const mongoose=require('mongoose');
const Club=require('../models/Club');
const markets=require('../config/sportsMarkets');
const {connectDB}=require('../config/db');
const {assertCurrentRoster}=require('../utils/currentSeasonScope');
(async()=>{
 let errors=0;
 for(const m of Object.values(markets)){
  const key=m.esporte==='football'?'API_FOOTBALL_KEY':m.esporte==='nba'?'API_NBA_KEY':'API_NFL_KEY';
  const present=Boolean(process.env[key]);
  const status=present?'CHAVE_OK':'SEM_CHAVE';
  console.log(`${m.id.padEnd(19)}  ${m.esporte.padEnd(9)}  temporada=${m.season}  participantes=${m.participantes}  ${status}`);
  if(!present)errors++;
 }
 try{
  await connectDB();
  for(const m of Object.values(markets)){
   const docs=await Club.find({'metadata.ligaId':m.id}).select('legacyId nome posicao metadata.temporada metadata.providerTeamId cotasEmitidas').lean();
   const current=docs.filter(x=>String(x.metadata?.temporada)===String(m.season));
   const historical=docs.filter(x=>String(x.metadata?.temporada)!==String(m.season));
   let valid=false; let reason='';
   try {assertCurrentRoster(current,m);valid=true;}catch(e){reason=e.message;}
   const status=valid?'OK':'PRECISA_AJUSTE';
   if(status!=='OK' && m.esporte==='football') errors++;
   console.log(`${status.padEnd(15)} ${m.id.padEnd(19)} TEMPORADA ATUAL ${current.length}/${m.participantes} | históricos preservados ${historical.length}${reason?' | '+reason:''}`);
   if(historical.length)console.log('  Registros de temporadas anteriores preservados; não entram na cotação atual.');
  }
 }catch(e){console.error('Diagnóstico DB indisponível:',e.message);errors++;}
 finally{await mongoose.disconnect().catch(()=>{});}
 if(errors){console.error(`BLOQUEIOS: ${errors}. Não abra mercados sem corrigir temporadas, IDs e credenciais.`);process.exitCode=2;}
 else console.log('CONFIGURAÇÃO COERENTE. Falta testar respostas reais das APIs antes do deploy.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
