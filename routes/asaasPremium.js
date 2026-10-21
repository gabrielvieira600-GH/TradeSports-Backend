const express=require('express');
const crypto=require('crypto');
const auth=require('../middleware/auth');
const User=require('../models/User');
const Sub=require('../models/AsaasSubscription');
const Event=require('../models/AsaasEvent');
const asaas=require('../services/asaas');
const { validCpf } = require('../utils/cpf');
const {PRICE,reconcile,latest,usable}=require('../services/premiumLifecycle');
const router=express.Router();
const fail=(res,e)=>{console.error('[ASAAS PREMIUM]',e.response?.status||e.code||e.message);return res.status(502).json({erro:'Não foi possível consultar o serviço de pagamentos.'});};
const valid=(a,b)=>Boolean(a&&b&&Buffer.byteLength(a)===Buffer.byteLength(b)&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b)));
const publicSub=sub=>sub?{status:sub.status,billingType:sub.billingType,paidUntil:sub.paidUntil,cancelledAt:sub.cancelledAt,active:usable(sub),price:PRICE}:null;
router.get('/status',auth,async(req,res)=>{
 try{let sub=await latest(req.usuario.id);if(sub)sub=await reconcile(sub,{remote:false});return res.json({subscription:publicSub(sub)});}catch(e){return fail(res,e);}
});
router.post('/checkout',auth,async(req,res)=>{
 try{
  if(process.env.ASAAS_PREMIUM_ENABLED!=='true'||process.env.ASAAS_ENV!=='sandbox')return res.status(503).json({erro:'Contratação disponível apenas no Sandbox nesta etapa.'});
  if(req.body?.billingType!=='PIX')return res.status(400).json({erro:'Selecione Pix.'});
  const user=await User.findById(req.usuario.id);if(!user)return res.sendStatus(404);
  const cpf=String(user.cpf||'').replace(/\D/g,'');if (!validCpf(cpf))return res.status(422).json({erro:'Cadastre um CPF válido.'});
  let sub=await latest(user._id);
  if(sub&&sub.subscriptionId&&['PENDING','ACTIVE'].includes(sub.status))return res.json({subscriptionId:sub.subscriptionId,status:sub.status});
  if(sub&&usable(sub))return res.status(409).json({erro:'Seu período Premium ainda está vigente.'});
  const ref=String(user._id);
  const found=await asaas('get','/customers?externalReference='+encodeURIComponent(ref)+'&limit=100');
  let customer=found.data?.find(c=>c.externalReference===ref);
  if(!customer)customer=await asaas('post','/customers',{name:[user.nome,user.sobrenome].filter(Boolean).join(' ')||user.nomeUsuario,email:user.email,cpfCnpj:cpf,externalReference:ref,notificationDisabled:true});
  const today=new Date().toISOString().slice(0,10);
  const created=await asaas('post','/subscriptions',{customer:customer.id,billingType:'PIX',value:PRICE,nextDueDate:today,cycle:'MONTHLY',description:'TradeSports Premium - R$ 9,90/mês',externalReference:ref});
  sub=await Sub.create({userId:user._id,customerId:customer.id,subscriptionId:created.id,billingType:'PIX',status:'PENDING'});
  return res.status(201).json({subscriptionId:sub.subscriptionId,status:sub.status});
 }catch(e){if(e.code===11000)return res.status(409).json({erro:'Assinatura já existente. Atualize a página.'});return fail(res,e);}
});
router.get('/payment',auth,async(req,res)=>{
 try{
  const sub=await latest(req.usuario.id);if(!sub?.subscriptionId)return res.status(404).json({erro:'Assinatura não encontrada.'});
  if(sub.cancelledAt)return res.json({status:sub.status,payment:null});
  const payments=await asaas('get',`/subscriptions/${encodeURIComponent(sub.subscriptionId)}/payments?limit=30`);
  const pending=(payments.data||[]).filter(p=>['PENDING','OVERDUE'].includes(p.status)).sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate)))[0];
  if(!pending)return res.json({status:sub.status,payment:null});
  const qr=await asaas('get',`/payments/${encodeURIComponent(pending.id)}/pixQrCode`);
  return res.json({status:sub.status,payment:{id:pending.id,value:pending.value,dueDate:pending.dueDate,payload:qr.payload,encodedImage:qr.encodedImage}});
 }catch(e){return fail(res,e);}
});
router.get('/history',auth,async(req,res)=>{
 try{
  const sub=await latest(req.usuario.id);if(!sub?.subscriptionId)return res.json({payments:[]});
  const data=await asaas('get',`/subscriptions/${encodeURIComponent(sub.subscriptionId)}/payments?limit=100`);
  return res.json({payments:(data.data||[]).map(p=>({id:p.id,value:p.value,dueDate:p.dueDate,status:p.status,paymentDate:p.paymentDate||p.confirmedDate||null}))});
 }catch(e){return fail(res,e);}
});
router.post('/refresh',auth,async(req,res)=>{
 try{const sub=await latest(req.usuario.id);if(!sub)return res.json({subscription:null});await reconcile(sub);return res.json({subscription:publicSub(sub)});}catch(e){return fail(res,e);}
});
router.post('/cancel',auth,async(req,res)=>{
 try{
  const sub=await latest(req.usuario.id);if(!sub?.subscriptionId)return res.status(404).json({erro:'Assinatura não encontrada.'});
  if(sub.cancelledAt)return res.json({subscription:publicSub(sub)});
  // Remote cancellation first. Never claim cancellation before Asaas confirms it.
  await asaas('delete',`/subscriptions/${encodeURIComponent(sub.subscriptionId)}`);
  sub.cancelledAt=new Date();sub.status='CANCELLED';await sub.save();await reconcile(sub,{remote:false});
  return res.json({subscription:publicSub(sub)});
 }catch(e){return fail(res,e);}
});
router.post('/webhook',async(req,res)=>{
 if(!valid(process.env.ASAAS_WEBHOOK_TOKEN,req.get('asaas-access-token')))return res.sendStatus(401);
 const ev=req.body;if(!ev||typeof ev.id!=='string'||typeof ev.event!=='string')return res.sendStatus(400);
 try{
  if(await Event.exists({eventId:ev.id}))return res.sendStatus(200);
  const p=ev.payment||{};
  if(p.subscription){const sub=await Sub.findOne({subscriptionId:p.subscription});if(sub)await reconcile(sub);}
  await Event.create({eventId:ev.id});return res.sendStatus(200);
 }catch(e){if(e.code===11000)return res.sendStatus(200);console.error('[ASAAS WEBHOOK]',e.response?.status||e.message);return res.sendStatus(500);}
});
module.exports=router;
