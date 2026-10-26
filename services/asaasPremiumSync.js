'use strict';
const asaas=require('./asaas');
const User=require('../models/User');
const Sub=require('../models/AsaasSubscription');
const Intent=require('../models/AsaasCheckoutIntent');
const PRICE=9.90;
const PAID=new Set(['RECEIVED','CONFIRMED']);
const REVERSED=new Set(['REFUNDED','REFUND_REQUESTED','CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE','AWAITING_CHARGEBACK_REVERSAL']);
const isId=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{4,120}$/.test(x);
const moneyOk=p=>Math.abs(Number(p.value)-PRICE)<0.001;
const addMonth=date=>{const d=new Date(date);const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d;};
async function resolve(subId,customerId,externalReference){
 let sub=await Sub.findOne({subscriptionId:subId});
 if(sub)return sub;
 // Do not trust a webhook-supplied customer or email to determine ownership.
 // Verify the subscription and its reference directly with Asaas.
 const remote=await asaas('get','/subscriptions/'+encodeURIComponent(subId));
 if(!remote||remote.id!==subId||remote.billingType!=='CREDIT_CARD'||!moneyOk(remote)||remote.cycle!=='MONTHLY')return null;
 const ref=String(remote.externalReference||externalReference||'');
 let intent=await Intent.findOne({orderId:ref});
 if(!intent&&isId(remote.checkoutSession))intent=await Intent.findOne({checkoutId:remote.checkoutSession});
 if(!intent)return null;
 if(intent.subscriptionId&&intent.subscriptionId!==subId)throw new Error('Checkout já vinculado a outra assinatura');
 if(intent.customerId&&intent.customerId!==remote.customer)throw new Error('Cliente Asaas diverge da intenção');
 const old=await Sub.findOne({userId:intent.userId,cancelledAt:null,status:{$in:['PENDING','ACTIVE']}});
 if(old&&old.subscriptionId!==subId)throw new Error('Usuário já possui assinatura não cancelada');
 sub=await Sub.findOneAndUpdate({subscriptionId:subId},{$setOnInsert:{userId:intent.userId,customerId:remote.customer,subscriptionId:subId,billingType:'CREDIT_CARD',status:'PENDING',checkoutOrderId:intent.orderId}},{upsert:true,new:true,setDefaultsOnInsert:true});
 if(String(sub.userId)!==String(intent.userId))throw new Error('Conflito de titularidade');
 await Intent.updateOne({_id:intent._id,$or:[{subscriptionId:null},{subscriptionId:subId}]},{$set:{subscriptionId:subId,customerId:remote.customer,status:'PAID'}});
 return sub;
}
async function sync(sub){
 if(!sub?.subscriptionId)return sub;
 const remote=await asaas('get','/subscriptions/'+encodeURIComponent(sub.subscriptionId));
 if(!remote||remote.id!==sub.subscriptionId||remote.customer!==sub.customerId||remote.billingType!==sub.billingType||!moneyOk(remote)||remote.cycle!=='MONTHLY')throw new Error('Assinatura remota inconsistente');
 const result=await asaas('get','/subscriptions/'+encodeURIComponent(sub.subscriptionId)+'/payments?limit=100');
 const payments=(result.data||[]).filter(p=>p.subscription===sub.subscriptionId&&p.customer===sub.customerId&&moneyOk(p)).sort((a,b)=>String(a.paymentDate||a.confirmedDate||a.dueDate).localeCompare(String(b.paymentDate||b.confirmedDate||b.dueDate)));
 // Atomic per-payment claims avoid granting multiple months for duplicate webhooks.
 for(const p of payments){
  if(!isId(p.id))continue;
  if(REVERSED.has(p.status)){
   await Sub.updateOne({_id:sub._id},{$addToSet:{reversedPayments:p.id}});
  }else if(PAID.has(p.status)){
   const claimed=await Sub.findOneAndUpdate({_id:sub._id,processedPayments:{$ne:p.id},cancelledAt:null},{$addToSet:{processedPayments:p.id}},{new:false});
   if(claimed){
    // Grant from the later of now and existing expiry. Atomic increment is not
    // available for calendar months; serialize updates by per-user process lock.
    const fresh=await Sub.findById(sub._id);
    const base=fresh.paidUntil&&fresh.paidUntil>new Date()?fresh.paidUntil:new Date();
    await Sub.updateOne({_id:sub._id},{$max:{paidUntil:addMonth(base)},$set:{lastPaidAt:new Date(),lastPaymentId:p.id}});
   }
  }
 }
 sub=await Sub.findById(sub._id);
 const revoked=sub.processedPayments.some(id=>sub.reversedPayments.includes(id));
 const now=new Date();
 const status=revoked?'REVOKED':sub.cancelledAt?'CANCELLED':sub.paidUntil>now?'ACTIVE':sub.paidUntil?'EXPIRED':'PENDING';
 await Sub.updateOne({_id:sub._id},{$set:{status}});
 const all=await Sub.find({userId:sub.userId,paidUntil:{$gt:now},status:{$nin:['REVOKED']}}).sort({paidUntil:-1}).limit(1);
 if(all.length){await User.updateOne({_id:sub.userId},{$set:{plano:'premium',premiumAtivo:true,premiumFim:all[0].paidUntil}});}
 else {await User.updateOne({_id:sub.userId,premiumFim:{$lte:now}},{$set:{plano:'lite',premiumAtivo:false}});}
 return Sub.findById(sub._id);
}
async function fromPayment(p){
 if(!p?.subscription||!isId(p.subscription))return null;
 let sub=await Sub.findOne({subscriptionId:p.subscription});
 if(!sub)sub=await resolve(p.subscription,p.customer,p.externalReference);
 if(!sub)return null;
 return sync(sub);
}
module.exports={resolve,sync,fromPayment};
