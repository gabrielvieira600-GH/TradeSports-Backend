#!/usr/bin/env node
'use strict';
// Auditoria READ-ONLY: não altera clubes, carteiras, ordens ou mercados.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { connectDB } = require('./config/db');
const mongoose = require('mongoose');
const markets = require('./config/sportsMarkets');
const Club = require('./models/Club');
const Order = require('./models/Order');
const User = require('./models/User');
const Investment = require('./models/Investment');
const InstitutionalLiquidity = require('./models/InstitutionalLiquidity');

function seasonText(v){return String(v == null ? '' : v).trim();}
function clamp(v){return Number.isFinite(Number(v)) ? Number(v):0;}
function limited(s){return String(s||'').slice(0,130);}
async function refs(club){
  const id = club._id; const legacyId = Number(club.legacyId);
  const [positionUsers, orders, investmentHistory, institutionState] = await Promise.all([
    User.countDocuments({'carteira.clubeId': legacyId, 'carteira.quantidade': {$gt:0}}),
    Order.countDocuments({$or:[{clubeId:id},{clubeLegacyId:legacyId}]}),
    Investment.countDocuments({$or:[{clubeId:id},{clubeLegacyId:legacyId}]}),
    InstitutionalLiquidity.countDocuments({$or:[{clubId:id},{clubLegacyId:legacyId}]})
  ]);
  return {positionUsers,orders,investmentHistory,institutionState};
}
async function main(){
  if (process.argv.includes('--apply') || process.argv.includes('--delete') || process.argv.includes('--archive')) {
    throw new Error('Modo de escrita não disponível: auditoria somente leitura. Nenhum documento será alterado.');
  }
  await connectDB();
  const result={generatedAt:new Date().toISOString(),mode:'READ_ONLY',markets:[],globalWarnings:[]};
  for(const m of Object.values(markets)){
    const docs=await Club.find({'metadata.ligaId':m.id}).select('legacyId nome nomeApi posicao cotasEmitidas cotasDisponiveis ipoEncerrado metadata').lean();
    const current=docs.filter(d=>seasonText(d.metadata?.temporada)===seasonText(m.season));
    const stale=docs.filter(d=>seasonText(d.metadata?.temporada)!==seasonText(m.season));
    const providerMap=new Map();
    for(const d of current){const id=seasonText(d.metadata?.providerTeamId);if(id){providerMap.set(id,(providerMap.get(id)||0)+1);}}
    const duplicateProviders=[...providerMap.entries()].filter(([k,v])=>v>1).map(([providerId,qty])=>({providerId,qty}));
    const seenLegacy=new Set();const duplicateLegacy=[];
    for(const d of current){if(seenLegacy.has(d.legacyId))duplicateLegacy.push(d.legacyId);seenLegacy.add(d.legacyId);}
    const candidates=[];
    for(const d of stale){
      const linked=await refs(d);
      const held=clamp(d.cotasEmitidas), inventory=clamp(d.cotasDisponiveis);
      const suspicious=linked.positionUsers>0||linked.orders>0||linked.investmentHistory>0||linked.institutionState>0||held>0||d.ipoEncerrado||inventory!==1000;
      candidates.push({nome:limited(d.nome),_id:String(d._id),legacyId:d.legacyId,season:seasonText(d.metadata?.temporada),cotasEmitidas:held,cotasDisponiveis:inventory,refs:linked,classification:suspicious?'PRESERVAR_E_INVESTIGAR':'SEM_VINCULOS_NAS_COLECOES_VERIFICADAS'});
    }
    const expected=Number(m.participantes);
    const status=current.length===expected&&duplicateProviders.length===0&&duplicateLegacy.length===0&&stale.length===0?'OK':'REVISAR';
    const keyVar=m.esporte==='football'?'API_FOOTBALL_KEY':m.esporte==='nba'?'API_NBA_KEY':'API_NFL_KEY';
    const keyConfigured=Boolean(process.env[keyVar]);
    result.markets.push({id:m.id,name:m.nome,sport:m.esporte,season:seasonText(m.season),expected,records:docs.length,current:current.length,stale:stale.length,duplicateProviders,duplicateLegacy,credential:{variable:keyVar,present:keyConfigured},status,staleRecords:candidates});
    console.log(`${status.padEnd(7)} ${m.id.padEnd(20)} atual=${String(current.length).padStart(2)}/${expected} antigo=${stale.length} duplicadosAPI=${duplicateProviders.length} ${keyConfigured?'CHAVE':'SEM_CHAVE '+keyVar}`);
  }
  const outDir=path.resolve(process.cwd(),'relatorios_trade');fs.mkdirSync(outDir,{recursive:true});
  const outFile=path.join(outDir,'auditoria_mercados_2026.json');
  fs.writeFileSync(outFile,JSON.stringify(result,null,2)+'\n');
  console.log(`\nRelatório gerado: ${outFile}`);
  console.log('Nenhum documento MongoDB foi modificado.');
}
main().catch(err=>{console.error('FALHA:',err.message);process.exitCode=1;}).finally(async()=>{await mongoose.disconnect().catch(()=>{});});
