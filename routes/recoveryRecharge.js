'use strict';
const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Recharge = require('../models/RecoveryRecharge');
const asaas = require('../services/asaas');
const { brlCentsForTs, confirmRecharge, rechargeSummary, validateAmount } = require('../services/recoveryRechargeService');
const router = express.Router();
const FRONTEND = (process.env.TRADESPORTS_FRONTEND_URL || 'https://www.tradesports.com.br').replace(/\/$/, '');
const enabled = () => ['sandbox','production'].includes(process.env.ASAAS_ENV) && Boolean(process.env.ASAAS_API_KEY);
const urlFor = id => (process.env.ASAAS_ENV === 'production' ? 'https://www.asaas.com' : 'https://sandbox.asaas.com') + '/checkoutSession/show/' + encodeURIComponent(id);
const isId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{8,120}$/.test(id);
const safeEq = (a,b) => Boolean(a && b && Buffer.byteLength(a) === Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)));
const serialize = r => r && ({id:String(r._id), quantidadeTs:r.quantidadeTs,valorReaisCentavos:r.valorReaisCentavos,valorReais:r.valorReaisCentavos/100,patrimonioSolicitacao:r.patrimonioSolicitacao,patrimonioConfirmacao:r.patrimonioConfirmacao,status:r.status,expiraEm:r.expiraEm,confirmadaEm:r.confirmadaEm,reembolsadaEm:r.reembolsadaEm,motivoFalha:r.motivoFalha,createdAt:r.createdAt,checkoutUrl:r.status==='PENDENTE' && r.provedor==='asaas' && isId(r.pagamentoId) && new Date(r.expiraEm)>new Date()?urlFor(r.pagamentoId):null});
function age(value){if(!value)return null;const d=new Date(value);if(!Number.isFinite(d.getTime()))return null;const n=new Date();return n.getFullYear()-d.getFullYear()-((n.getMonth()<d.getMonth()||(n.getMonth()===d.getMonth()&&n.getDate()<d.getDate()))?1:0);}
async function asaasRecoveryWebhook(req,res){
 if(!safeEq(process.env.ASAAS_WEBHOOK_TOKEN,req.get('asaas-access-token')))return res.sendStatus(401);
 const ev=req.body;
 if(typeof ev?.id!=='string'||typeof ev?.event!=='string')return res.sendStatus(400);
 if(!ev.event.startsWith('CHECKOUT_'))return res.sendStatus(200);
 const checkout=ev.checkout;
 if(!isId(checkout?.id))return res.sendStatus(400);
 try{
  const recharge=await Recharge.findOne({pagamentoId:checkout.id,provedor:'asaas'});
  if(!recharge){
   // The payment can arrive before the checkout ID is persisted; ask Asaas to retry.
   if(mongoose.isValidObjectId(checkout.externalReference) && await Recharge.exists({_id:checkout.externalReference,provedor:'asaas',status:'PENDENTE'}))return res.sendStatus(503);
   return res.sendStatus(200); // Other checkout, e.g. Premium
  }
  if(ev.event==='CHECKOUT_PAID'){
   // A webhook callback alone is insufficient: validate the authoritative event's order and price.
   if(checkout.status!=='PAID'||checkout.externalReference!==String(recharge._id)||!Array.isArray(checkout.items)||!checkout.chargeTypes?.includes('DETACHED')){
    console.error('[RECOVERY ASAAS] Checkout paid mismatch',String(recharge._id));return res.sendStatus(422);
   }
   const cents=Math.round(checkout.items.reduce((sum,item)=>sum+Number(item.value)*Number(item.quantity),0)*100);
   if(cents!==recharge.valorReaisCentavos){console.error('[RECOVERY ASAAS] Amount mismatch',String(recharge._id));return res.sendStatus(422);}
   if(recharge.status==='CONFIRMADA')return res.sendStatus(200);
   if(['REEMBOLSADA','CANCELADA','FALHA'].includes(recharge.status))return res.sendStatus(409);
   const result=await confirmRecharge(recharge._id,{paymentId:checkout.id});
   if(result?.status==='FALHA')console.error('[RECOVERY ASAAS] PAID BUT NOT CREDITED - manual refund required',String(recharge._id));
  }else if(['CHECKOUT_EXPIRED','CHECKOUT_CANCELED'].includes(ev.event)){
   await Recharge.updateOne({_id:recharge._id,status:'PENDENTE'},{$set:{status:ev.event==='CHECKOUT_EXPIRED'?'EXPIRADA':'CANCELADA',motivoFalha:ev.event==='CHECKOUT_EXPIRED'?'Checkout expirado.':'Checkout cancelado.'}});
  }
  return res.sendStatus(200);
 }catch(e){console.error('[RECOVERY ASAAS WEBHOOK]',e.message);return res.sendStatus(500);}
}
router.use(auth);
router.get('/resumo',async(req,res)=>{
 try{const user=await User.findById(req.usuario.id);if(!user)return res.sendStatus(404);const summary=await rechargeSummary(user);const maioridadeConfirmada=age(user.dataNascimento)!==null&&age(user.dataNascimento)>=18;const cpfConfirmado=/^\d{11}$/.test(String(user.cpf||'').replace(/\D/g,''));return res.json({ok:true,...summary,maioridadeConfirmada,cpfConfirmado,elegivel:summary.elegivel&&maioridadeConfirmada&&cpfConfirmado,motivoInelegibilidade:!maioridadeConfirmada?'A recarga está disponível apenas para maiores de 18 anos.':!cpfConfirmado?'Confirme um CPF válido no cadastro.':!summary.elegivel?'Seu patrimônio total precisa estar em T$ 900 ou menos.':null,provedorPagamento:'asaas',asaasConfigurado:enabled(),pixConfigurado:enabled(),stripePublishableKey:null});}catch(e){console.error('[RECOVERY SUMMARY]',e.message);return res.status(500).json({erro:'Não foi possível calcular o limite.'});}
});
router.post('/intencoes',async(req,res)=>{
 try{
  if(!enabled())return res.status(503).json({erro:'Asaas não configurado.'});
  const user=await User.findById(req.usuario.id);if(!user)return res.sendStatus(404);
  if(age(user.dataNascimento)===null||age(user.dataNascimento)<18)return res.status(403).json({erro:'A recarga exige idade confirmada de 18 anos ou mais.'});
  if(!/^\d{11}$/.test(String(user.cpf||'').replace(/\D/g,'')))return res.status(403).json({erro:'Confirme um CPF válido.'});
  const summary=await rechargeSummary(user);const amount=validateAmount(req.body?.quantidadeTs,summary.maximoTs);
  const raw=String(req.get('idempotency-key')||'').trim();if(raw.length>120)return res.sendStatus(400);
  const key=raw||'recovery_'+crypto.randomUUID();
  let recharge=await Recharge.findOne({idempotencyKey:key,usuarioId:user._id});
  if(recharge){if(recharge.quantidadeTs!==amount)return res.status(409).json({erro:'Chave de idempotência usada com outro valor.'});return res.json({ok:true,recarga:serialize(recharge),checkoutUrl:serialize(recharge).checkoutUrl,url:serialize(recharge).checkoutUrl});}
  recharge=await Recharge.create({usuarioId:user._id,temporadaId:summary.temporada?.id||null,quantidadeTs:amount,valorReaisCentavos:brlCentsForTs(amount),patrimonioSolicitacao:summary.patrimonio,idempotencyKey:key,provedor:'asaas',status:'PENDENTE',expiraEm:new Date(Date.now()+60*60000)});
  try{
   const payload={billingTypes:['PIX','CREDIT_CARD'],chargeTypes:['DETACHED'],minutesToExpire:60,externalReference:String(recharge._id),callback:{successUrl:FRONTEND+'/recuperacao?retorno=sucesso',cancelUrl:FRONTEND+'/recuperacao?retorno=cancelado',expiredUrl:FRONTEND+'/recuperacao?retorno=expirado'},items:[{name:'Recuperação TradeSports',description:'Recarga de T$ '+amount,quantity:1,value:recharge.valorReaisCentavos/100}]};
   const checkout=await asaas('post','/checkouts',payload);
   if(!isId(checkout?.id))throw new Error('Asaas retornou checkout inválido');
   recharge.pagamentoId=checkout.id;await recharge.save();
   return res.status(201).json({ok:true,recarga:serialize(recharge),checkoutUrl:urlFor(checkout.id),url:urlFor(checkout.id)});
  }catch(e){await Recharge.updateOne({_id:recharge._id,status:'PENDENTE'},{$set:{status:'FALHA',motivoFalha:'Não foi possível criar o checkout Asaas.'}});throw e;}
 }catch(e){console.error('[RECOVERY CHECKOUT]',e.response?.status||e.message);return res.status(e.status||502).json({erro:e.status?e.message:'Não foi possível iniciar o pagamento Asaas.',codigo:e.code||null});}
});
router.get('/intencoes/:id',async(req,res)=>{
 try{if(!mongoose.isValidObjectId(req.params.id))return res.sendStatus(400);const r=await Recharge.findOne({_id:req.params.id,usuarioId:req.usuario.id});if(!r)return res.sendStatus(404);return res.json({ok:true,recarga:serialize(r)});}catch(e){return res.sendStatus(500);}
});
router.get('/historico',async(req,res)=>{try{const list=await Recharge.find({usuarioId:req.usuario.id}).sort({createdAt:-1}).limit(50).lean();return res.json({ok:true,recargas:list.map(serialize)});}catch(e){return res.sendStatus(500);}});
module.exports={router,asaasRecoveryWebhook};
