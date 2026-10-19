const express = require('express');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Sub = require('../models/AsaasSubscription');
const Event = require('../models/AsaasEvent');
const asaas = require('../services/asaas');
const router = express.Router();
const PRICE = 9.90;
const validToken = (a,b) => Boolean(a && b && Buffer.byteLength(a)===Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b)));
const error = (res,e) => { console.error('[ASAAS]', e.response?.status || e.message); return res.status(502).json({erro:'Falha de comunicação com o Asaas.'}); };
const date = d => new Date(`${d}T12:00:00Z`);
router.get('/status',auth,async(req,res)=>{
 try {const sub=await Sub.findOne({userId:req.usuario.id}).sort({createdAt:-1}).lean();return res.json({subscription:sub?{status:sub.status,billingType:sub.billingType,paidUntil:sub.paidUntil}:null});}
 catch(e){return error(res,e);}
});
router.post('/checkout',auth,async(req,res)=>{
 try {
  if(process.env.ASAAS_PREMIUM_ENABLED!=='true')return res.status(503).json({erro:'Assinaturas indisponíveis no momento.'});
  if(process.env.ASAAS_ENV!=='sandbox')return res.status(503).json({erro:'Esta versão está liberada somente para Sandbox.'});
  if(req.body?.billingType!=='PIX')return res.status(400).json({erro:'Nesta etapa, selecione Pix.'});
  const user=await User.findById(req.usuario.id);
  if(!user?.emailVerificado)return res.status(403).json({erro:'Confirme seu e-mail antes de contratar.'});
  const cpf=String(user.cpf||'').replace(/\D/g,'');
  if(!/^\d{11}$/.test(cpf))return res.status(422).json({erro:'Cadastre um CPF válido em sua conta.'});
  let sub=await Sub.findOne({userId:user._id,status:{$in:['ACTIVE','PENDING']}}).sort({createdAt:-1});
  if(sub?.subscriptionId)return res.json({subscriptionId:sub.subscriptionId,status:sub.status});
  const ref=String(user._id);
  const found=await asaas('get','/customers?externalReference='+encodeURIComponent(ref)+'&limit=100');
  let customer=found.data?.find(c=>c.externalReference===ref);
  if(!customer)customer=await asaas('post','/customers',{name:[user.nome,user.sobrenome].filter(Boolean).join(' ')||user.nomeUsuario,email:user.email,cpfCnpj:cpf,externalReference:ref,notificationDisabled:true});
  // Asaas subscription with PIX issues a new payment every month. It is NOT automatic debit.
  const today=new Date().toISOString().slice(0,10);
  const created=await asaas('post','/subscriptions',{customer:customer.id,billingType:'PIX',value:PRICE,nextDueDate:today,cycle:'MONTHLY',description:'TradeSports Premium - R$ 9,90/mês',externalReference:ref});
  sub=await Sub.create({userId:user._id,customerId:customer.id,subscriptionId:created.id,billingType:'PIX',status:'PENDING'});
  return res.status(201).json({subscriptionId:sub.subscriptionId,status:'PENDING'});
 }catch(e){if(e.code===11000)return res.status(409).json({erro:'Assinatura já existente. Atualize a página.'});return error(res,e);}
});
router.get('/payment',auth,async(req,res)=>{
 try {
  const sub=await Sub.findOne({userId:req.usuario.id,status:{$in:['PENDING','ACTIVE']}}).sort({createdAt:-1});
  if(!sub?.subscriptionId)return res.status(404).json({erro:'Assinatura não encontrada.'});
  const payments=await asaas('get','/subscriptions/'+encodeURIComponent(sub.subscriptionId)+'/payments?limit=30');
  const pending=(payments.data||[]).filter(p=>['PENDING','OVERDUE'].includes(p.status)).sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate)))[0];
  if(!pending)return res.json({status:sub.status,payment:null});
  const qr=await asaas('get','/payments/'+encodeURIComponent(pending.id)+'/pixQrCode');
  return res.json({status:sub.status,payment:{id:pending.id,value:pending.value,dueDate:pending.dueDate,payload:qr.payload,encodedImage:qr.encodedImage}});
 }catch(e){return error(res,e);}
});
router.post('/webhook',async(req,res)=>{
 if(!validToken(process.env.ASAAS_WEBHOOK_TOKEN,req.get('asaas-access-token')))return res.sendStatus(401);
 const ev=req.body;
 if(!ev||typeof ev.id!=='string'||typeof ev.event!=='string')return res.sendStatus(400);
 try {
  if(await Event.exists({eventId:ev.id}))return res.sendStatus(200);
  const p=ev.payment||{};
  const sub=p.subscription?await Sub.findOne({subscriptionId:p.subscription}):null;
  if(sub && ['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(ev.event) && p.id){
   const paid=await asaas('get','/payments/'+encodeURIComponent(p.id));
   if(['RECEIVED','CONFIRMED'].includes(paid.status)&&paid.subscription===sub.subscriptionId&&Math.abs(Number(paid.value)-PRICE)<0.001 && sub.lastPaymentId!==p.id){
    const now=new Date();const base=sub.paidUntil>now?sub.paidUntil:now;
    const until=new Date(base);until.setUTCMonth(until.getUTCMonth()+1);
    sub.status='ACTIVE';sub.lastPaymentId=p.id;sub.lastPaidAt=now;sub.paidUntil=until;
    await sub.save();
    await User.updateOne({_id:sub.userId},{$set:{plano:'premium',premiumAtivo:true,premiumInicio:now,premiumFim:until}});
   }
  }
  await Event.create({eventId:ev.id});return res.sendStatus(200);
 }catch(e){if(e.code===11000)return res.sendStatus(200);console.error('[ASAAS WEBHOOK]',e.message);return res.sendStatus(500);}
});
module.exports=router;
