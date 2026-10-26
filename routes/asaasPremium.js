'use strict';
const express=require('express');
const crypto=require('crypto');
const auth=require('../middleware/auth');
const User=require('../models/User');
const Sub=require('../models/AsaasSubscription');
const Event=require('../models/AsaasEvent');
const Intent=require('../models/AsaasCheckoutIntent');
const asaas=require('../services/asaas');
const {validCpf}=require('../utils/cpf');
const {PRICE,usable}=require('../services/premiumLifecycle');
const {sync,fromPayment,resolve}=require('../services/asaasPremiumSync');
const router=express.Router();
const enabled=()=>process.env.ASAAS_PREMIUM_ENABLED==='true'&&['sandbox','production'].includes(process.env.ASAAS_ENV);
const same=(a,b)=>Boolean(a&&b&&Buffer.byteLength(a)===Buffer.byteLength(b)&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b)));
const latest=id=>Sub.findOne({userId:id}).sort({createdAt:-1});
const pub=s=>s?{status:s.status,billingType:s.billingType,paidUntil:s.paidUntil,cancelledAt:s.cancelledAt,active:usable(s),price:PRICE}:null;
const fail=(res,e)=>{console.error('[ASAAS PREMIUM]',e.response?.status||e.message);return res.status(502).json({erro:'Serviço de pagamentos indisponível.'});};
async function cancel(sub){
 if(sub.cancelledAt)return sub;
 sub=await sync(sub);
 await asaas('delete','/subscriptions/'+encodeURIComponent(sub.subscriptionId));
 await Sub.updateOne({_id:sub._id,cancelledAt:null},{$set:{cancelledAt:new Date(),status:'CANCELLED'}});
 return sync(await Sub.findById(sub._id));
}
router.get('/status',auth,async(req,res)=>{try{const s=await latest(req.usuario.id);return res.json({subscription:pub(s)});}catch(e){return fail(res,e);}});
router.post('/refresh',auth,async(req,res)=>{try{const s=await latest(req.usuario.id);return res.json({subscription:pub(s?await sync(s):null)});}catch(e){return fail(res,e);}});
router.post('/checkout',auth,async(req,res)=>{
 try{
  if(!enabled())return res.status(503).json({erro:'Contratação indisponível.'});
  if(req.body?.billingType!=='PIX')return res.status(400).json({erro:'Selecione Pix.'});
  const user=await User.findById(req.usuario.id);if(!user)return res.sendStatus(401);
  const cpf=String(user.cpf||'').replace(/\D/g,'');if(!validCpf(cpf))return res.status(422).json({erro:'Cadastre um CPF válido.'});
  const current=await latest(user._id);
  if(current&&usable(current))return res.status(409).json({erro:'Período Premium vigente.'});
  if(current&&!current.cancelledAt&&['ACTIVE','PENDING'].includes(current.status)){
   if(current.status==='PENDING'&&current.billingType==='PIX')return res.json({subscriptionId:current.subscriptionId,status:current.status});
   return res.status(409).json({erro:'Já existe assinatura em andamento.'});
  }
  const ref=String(user._id);
  const found=await asaas('get','/customers?externalReference='+encodeURIComponent(ref)+'&limit=100');
  let customer=found.data?.find(x=>x.externalReference===ref);
  if(!customer)customer=await asaas('post','/customers',{name:[user.nome,user.sobrenome].filter(Boolean).join(' ')||user.nomeUsuario,email:user.email,cpfCnpj:cpf,externalReference:ref,notificationDisabled:true});
  const created=await asaas('post','/subscriptions',{customer:customer.id,billingType:'PIX',value:PRICE,nextDueDate:new Date().toISOString().slice(0,10),cycle:'MONTHLY',description:'TradeSports Premium',externalReference:ref});
  await Sub.create({userId:user._id,customerId:customer.id,subscriptionId:created.id,billingType:'PIX',status:'PENDING'});
  return res.status(201).json({subscriptionId:created.id,status:'PENDING'});
 }catch(e){if(e.code===11000)return res.status(409).json({erro:'Assinatura já registrada.'});return fail(res,e);}
});
router.post('/change-method',auth,async(req,res)=>{
 try{
  if(!enabled())return res.sendStatus(503);
  if(!['PIX','CREDIT_CARD'].includes(req.body?.billingType))return res.sendStatus(400);
  const s=await latest(req.usuario.id);
  if(!s||s.cancelledAt)return res.json({ok:true,subscription:pub(s)});
  if(s.billingType===req.body.billingType||s.status!=='PENDING')return res.status(409).json({erro:'Troca indisponível.'});
  const checked=await sync(s);
  if(usable(checked)||checked.status!=='PENDING')return res.status(409).json({erro:'Pagamento identificado; atualize sua assinatura.'});
  const done=await cancel(checked);return res.json({ok:true,subscription:pub(done)});
 }catch(e){return fail(res,e);}
});
router.get('/payment',auth,async(req,res)=>{
 try{const s=await latest(req.usuario.id);if(!s?.subscriptionId)return res.status(404).json({erro:'Assinatura não encontrada.'});
  if(s.cancelledAt||s.billingType!=='PIX')return res.json({status:s.status,payment:null});
  const result=await asaas('get','/subscriptions/'+encodeURIComponent(s.subscriptionId)+'/payments?limit=30');
  const p=(result.data||[]).filter(x=>['PENDING','OVERDUE'].includes(x.status)).sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate)))[0];
  if(!p)return res.json({status:s.status,payment:null});
  const qr=await asaas('get','/payments/'+encodeURIComponent(p.id)+'/pixQrCode');
  return res.json({status:s.status,payment:{id:p.id,value:p.value,dueDate:p.dueDate,payload:qr.payload,encodedImage:qr.encodedImage}});
 }catch(e){return fail(res,e);}
});
router.get('/history',auth,async(req,res)=>{
 try{const s=await latest(req.usuario.id);if(!s?.subscriptionId)return res.json({payments:[]});
  const result=await asaas('get','/subscriptions/'+encodeURIComponent(s.subscriptionId)+'/payments?limit=100');
  return res.json({payments:(result.data||[]).map(p=>({id:p.id,value:p.value,dueDate:p.dueDate,status:p.status,paymentDate:p.paymentDate||p.confirmedDate||null}))});
 }catch(e){return fail(res,e);}
});
router.post('/cancel',auth,async(req,res)=>{try{const s=await latest(req.usuario.id);if(!s?.subscriptionId)return res.status(404).json({erro:'Assinatura não encontrada.'});return res.json({subscription:pub(await cancel(s))});}catch(e){return fail(res,e);}});
router.post('/webhook',async(req,res)=>{
 if(!same(process.env.ASAAS_WEBHOOK_TOKEN,req.get('asaas-access-token')))return res.sendStatus(401);
 const ev=req.body;if(typeof ev?.id!=='string'||typeof ev?.event!=='string')return res.sendStatus(400);
 try{
  if(await Event.exists({eventId:ev.id}))return res.sendStatus(200);
  let sub=null;
  if(ev.payment?.subscription)sub=await fromPayment(ev.payment);
  else if(ev.subscription?.id){
   const sid=ev.subscription.id;
   sub=await Sub.findOne({subscriptionId:sid})||await resolve(sid,ev.subscription.customer,ev.subscription.externalReference);
   if(sub)await sync(sub);
  }
  // Unmatched payment must be retried; never acknowledge a paid event without association.
  if(ev.payment?.subscription&&!sub&&['PAYMENT_CONFIRMED','PAYMENT_RECEIVED','PAYMENT_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED'].includes(ev.event)){
   console.error('[ASAAS WEBHOOK UNMATCHED]',ev.event,ev.id);
   return res.sendStatus(503);
  }
  await Event.create({eventId:ev.id});return res.sendStatus(200);
 }catch(e){if(e.code===11000)return res.sendStatus(200);console.error('[ASAAS WEBHOOK]',ev.event,e.response?.status||e.message);return res.sendStatus(500);}
});
module.exports=router;
