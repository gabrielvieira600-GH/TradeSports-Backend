'use strict';
// EXECUTE NA RAIZ DO BACKEND. Apenas leitura. Não modifica documentos.
require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('./config/db');
const Club = require('./models/Club');
const User = require('./models/User');
const Order = require('./models/Order');
const InstitutionalLiquidity = require('./models/InstitutionalLiquidity');

(async()=>{
  await connectDB();
  const [clubs, users, states, orders] = await Promise.all([
    Club.find({}).lean(),
    User.find({}).select('_id nomeUsuario carteira metadata').lean(),
    InstitutionalLiquidity.find({}).lean(),
    Order.find({status:{$in:['aberta','parcial']},restante:{$gt:0}}).select('clubeId isInstitutional tipo restante usuarioId').lean(),
  ]);
  const report=[];
  let blockers=0;
  for(const club of clubs){
    const state=states.find(x=>String(x.clubId)===String(club._id));
    const byUsers=users.reduce((sum,u)=>{
      if(u.metadata?.accountType==='INSTITUTIONAL') return sum;
      return sum + (u.carteira||[]).filter(a=>Number(a.clubeId)===Number(club.legacyId)).reduce((n,a)=>n+Number(a.quantidade||0),0);
    },0);
    const institutionalWallet=users.filter(u=>u.metadata?.accountType==='INSTITUTIONAL')
      .reduce((n,u)=>n+(u.carteira||[]).filter(a=>Number(a.clubeId)===Number(club.legacyId)).reduce((v,a)=>v+Number(a.quantidade||0),0),0);
    const openOrders=orders.filter(o=>String(o.clubeId)===String(club._id));
    const issues=[];
    const total=Number(state?.maxShares||1000);
    if(!Number.isInteger(byUsers)||byUsers<0||byUsers>total) issues.push('QUANTIDADE_USUARIOS_INVALIDA');
    if(institutionalWallet || Number(state?.institutionHeldIssuedShares||0)) issues.push('INSTITUICAO_DETEM_COTAS');
    if(openOrders.length) issues.push('ORDENS_ABERTAS_EXISTENTES');
    if(!Number.isInteger(Number(club.posicao))||Number(club.posicao)<1||Number(club.posicao)>Number(club.metadata?.totalParticipantes||20)) issues.push('CLASSIFICACAO_INVALIDA');
    if(Number(club.cotasEmitidas||0)!==byUsers) issues.push('COTAS_EMITIDAS_DIFEREM_DA_CARTEIRA');
    if(Number(club.cotasDisponiveis||0)+byUsers!==total) issues.push('ESTOQUE_DIFERE_DA_CARTEIRA');
    if(state && Number(state.issuedShares||0)!==byUsers) issues.push('LIQUIDEZ_EMITIDA_DIFERE_DA_CARTEIRA');
    if(Boolean(club.ipoEncerrado) !== (byUsers===total)) issues.push('FASE_IPO_NAO_CORRESPONDE_A_DISTRIBUICAO');
    if(issues.length) blockers++;
    report.push({clube:club.nome,id:club.legacyId,limite:total,usuarios:byUsers,institucional:institutionalWallet,ipoEncerrado:club.ipoEncerrado,emitidas:club.cotasEmitidas,disponiveis:club.cotasDisponiveis,emitidasEstado:state?.issuedShares||0,ordensAbertas:openOrders.length,issues});
  }
  console.log(JSON.stringify({ok:blockers===0,totalClubes:clubs.length,clubesComBloqueios:blockers,report},null,2));
  process.exitCode=blockers?2:0;
})().catch(e=>{console.error('PREFLIGHT ERRO:',e.message);process.exitCode=1}).finally(async()=>{await mongoose.disconnect()});
