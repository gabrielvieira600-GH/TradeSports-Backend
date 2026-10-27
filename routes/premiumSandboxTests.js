'use strict';
const express=require('express');
const auth=require('../middleware/auth');
const User=require('../models/User');
const Sub=require('../models/AsaasSubscription');
const {sync}=require('../services/asaasPremiumSync');
const {expirePremium}=require('../services/premiumExpiryJob');
const router=express.Router();
router.use(auth);
router.use(async(req,res,next)=>{
 if(process.env.ASAAS_ENV!=='sandbox'||process.env.ASAAS_PREMIUM_ENABLED!=='true')return res.sendStatus(404);
 const actor=await User.findById(req.usuario.id).select('role admin');
 if(!actor||(actor.role!=='admin'&&actor.admin!==true))return res.sendStatus(403);
 next();
});
// Dry-run only: virtual time is never persisted to the database.
router.post('/simulate-expiry',async(req,res)=>{
 try{
  const id=String(req.body?.userId||'');
  if(!/^[a-f\d]{24}$/i.test(id))return res.status(400).json({erro:'ID inválido'});
  const user=await User.findById(id).select('plano premiumAtivo premiumFim');
  if(!user)return res.sendStatus(404);
  const at=new Date(req.body?.at);
  if(!Number.isFinite(at.getTime()))return res.status(400).json({erro:'Data inválida'});
  const subs=await Sub.find({userId:id}).select('paidUntil status').lean();
  const eligible=subs.some(s=>s.paidUntil&&new Date(s.paidUntil)>at&&s.status!=='REVOKED');
  return res.json({simulatedAt:at,actual:{plano:user.plano,premiumAtivo:user.premiumAtivo,premiumFim:user.premiumFim},expected:{plano:eligible?'premium':'lite',premiumAtivo:eligible},persisted:false});
 }catch(e){return res.status(500).json({erro:'Simulação indisponível'});}
});
router.post('/reconcile',async(req,res)=>{
 try{
  const id=String(req.body?.userId||'');if(!/^[a-f\d]{24}$/i.test(id))return res.sendStatus(400);
  const sub=await Sub.findOne({userId:id}).sort({createdAt:-1});
  if(!sub)return res.sendStatus(404);
  const result=await sync(sub);
  return res.json({status:result.status,paidUntil:result.paidUntil,processedPayments:result.processedPayments.length,reversedPayments:result.reversedPayments.length});
 }catch(e){console.error('[PREMIUM SANDBOX RECONCILE]',e.message);return res.sendStatus(502);}
});
router.post('/expire-due',async(req,res)=>{try{return res.json(await expirePremium());}catch(e){return res.sendStatus(500);}});
module.exports=router;
