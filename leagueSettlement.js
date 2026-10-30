'use strict';
const mongoose = require('mongoose');
const Club = require('../models/Club');
const User = require('../models/User');
const Order = require('../models/Order');
const Investment = require('../models/Investment');
const Liquidacao = require('../models/Liquidacao');
const MarketControl = require('../models/MarketControl');
const sportsMarkets = require('../config/sportsMarkets');
const { liquidarBrasileirao } = require('../middleware/checkLiquidacao');
const { calcularPrecoPorPosicao } = require('../middleware/checkLiquidacao');
const { round2 } = require('../utils/tx');
const LOCKS = 'league_settlement_locks';
const CYCLES = 'league_settlement_cycles';
const active = new Set();
function fail(message,status=409){const e=new Error(message);e.status=status;return e;}
async function context(ligaId, temporada){
 const market=sportsMarkets[ligaId];if(!market)throw fail('Liga desconhecida.',404);
 const control=await MarketControl.findOne({ligaId}).lean();
 const clubs=await Club.find({'metadata.ligaId':ligaId}).lean();
 if(!clubs.length)throw fail('Nenhum clube encontrado.',409);
 const total=Number(market.participantes||clubs.length);
 const season=Number(temporada);
 if(!Number.isSafeInteger(season)||season<2000||season>2100)throw fail('Informe a temporada de liquidação.',400);
 const ids=clubs.map(c=>c._id), legacy=new Set(clubs.map(c=>Number(c.legacyId)));
 const users=await User.find({'carteira.clubeId':{$in:[...legacy]}}).lean();
 const positions=clubs.map(c=>({id:c.legacyId,nome:c.nome,posicao:c.posicao,precoLiquidacao:calcularPrecoPorPosicao(c.posicao,total)}));
 const valid=positions.every(x=>Number.isInteger(x.posicao)&&x.posicao>=1&&x.posicao<=total)&&new Set(positions.map(x=>x.posicao)).size===clubs.length&&clubs.length===total;
 const orders=await Order.countDocuments({clubeId:{$in:ids},status:{$in:['aberta','parcial']}});
 let totalCotas=0,totalPrevisto=0,usuarios=0;
 for(const u of users){if(u.metadata?.accountType==='INSTITUTIONAL')continue;let has=false;for(const a of u.carteira||[]){if(!legacy.has(Number(a.clubeId))||Number(a.quantidade)<=0)continue;const c=clubs.find(c=>Number(c.legacyId)===Number(a.clubeId));const base=calcularPrecoPorPosicao(c.posicao,total);const factor=Number(c.splitFactorCumulativo||1);const amount=round2(Number(a.quantidade)*round2(base/factor));totalPrevisto=round2(totalPrevisto+amount);totalCotas+=Number(a.quantidade);has=true;}if(has)usuarios++;}
 const cycle=await mongoose.connection.db.collection(CYCLES).findOne({ligaId,temporada:season});
 return {ligaId,temporada:season,market,control,clubs,ids,positions,valid,orders,usuarios,totalCotas,totalPrevisto,cycle};
}
async function preview(ligaId,temporada){const x=await context(ligaId,temporada);return {ligaId,temporada:x.temporada,nome:x.market.nome,fechado:x.control?.fechado===true,clubes:x.clubs.length,posicoesValidas:x.valid,posicoes:x.positions,ordensAbertas:x.orders,usuarios:x.usuarios,cotas:x.totalCotas,totalPrevisto:x.totalPrevisto,jaLiquidada:!!x.cycle,executavel:x.control?.fechado===true&&x.valid&&!x.cycle};}
async function execute(ligaId,temporada,confirmation,actor){
 const key=`${ligaId}:${temporada}`;if(confirmation!==`LIQUIDAR_${ligaId}_${temporada}`)throw fail('Confirmação incorreta.',400);
 if(active.has(key))throw fail('Liquidação já em andamento.');active.add(key);
 const db=mongoose.connection.db;
 try{
  const x=await context(ligaId,temporada);
  if(x.control?.fechado!==true)throw fail('Feche o mercado antes da liquidação.');
  if(!x.valid)throw fail('Classificação incompleta, duplicada ou com quantidade incorreta de clubes.');
  if(x.cycle)throw fail('Temporada já liquidada.');
  // A reserva atômica impede execução concorrente entre instâncias.
  try{await db.collection(LOCKS).insertOne({_id:key,status:'IN_PROGRESS',actor,startedAt:new Date()});}catch(e){if(e.code===11000)throw fail('Existe uma liquidação anterior ou em andamento. Não repita antes de verificar.');throw e;}
  try{
   // Ordens são canceladas antes de creditar as cotas. O modelo atual não reserva saldo na criação da ordem.
   const canceled=await Order.updateMany({clubeId:{$in:x.ids},status:{$in:['aberta','parcial']}},{$set:{status:'cancelada',restante:0,canceladoEm:new Date(),'metadata.cancelamentoPorLiquidacao':key}});
   const result=await liquidarBrasileirao({ligaId,campeonato:x.market.nome,temporada:x.temporada,totalParticipantes:x.clubs.length});
   // Verifica que nenhum usuário humano permaneceu com cotas da liga.
   const remaining=await User.countDocuments({'metadata.accountType':{$ne:'INSTITUTIONAL'},'carteira.clubeId':{$in:x.clubs.map(c=>Number(c.legacyId))}});
   if(remaining)throw fail(`Liquidação parcial: ${remaining} usuários ainda possuem cotas. Mercado permanece bloqueado.`);
   const now=new Date();
   await Club.updateMany({_id:{$in:x.ids}},{$set:{cotasDisponiveis:1000,cotasEmitidas:0,ipoEncerrado:false,splitFactorCumulativo:1,splits:[],travadoAte:0,'metadata.ultimaTemporadaLiquidada':x.temporada,'metadata.precificacaoLiberadaEm':now}});
   // Remove posições institucionais sem crédito, pois são contas técnicas.
   await User.updateMany({'metadata.accountType':'INSTITUTIONAL'},{$pull:{carteira:{clubeId:{$in:x.clubs.map(c=>Number(c.legacyId))}}}});
   const state=await db.listCollections({name:'institutional_liquidity'},{nameOnly:true}).toArray();
   if(state.length)await db.collection('institutional_liquidity').updateMany({clubId:{$in:x.ids}},{$set:{issuedShares:0,updatedAt:now}});
   await db.collection(CYCLES).insertOne({_id:key,ligaId,temporada:x.temporada,actor,completedAt:now,summary:{totalPrevisto:x.totalPrevisto,usuarios:x.usuarios,ordensCanceladas:canceled.modifiedCount,resultado:result}});
   await db.collection(LOCKS).updateOne({_id:key},{$set:{status:'COMPLETE',completedAt:now}});
   return {ok:true,ligaId,temporada:x.temporada,usuarios:x.usuarios,ordensCanceladas:canceled.modifiedCount,valorLiquidado:result.totalGeral,clubesReiniciados:x.clubs.length};
  }catch(err){await db.collection(LOCKS).updateOne({_id:key},{$set:{status:'FAILED_REQUIRES_RECONCILIATION',error:String(err.message),failedAt:new Date()}});throw err;}
 }finally{active.delete(key);}
}
module.exports={preview,execute};
