const User=require('../models/User');
const Sub=require('../models/AsaasSubscription');
const asaas=require('./asaas');
const PRICE=9.90;
const addMonth=date=>{const d=new Date(date);const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,end));return d;};
const paidStatuses=new Set(['RECEIVED','CONFIRMED']);
const reversedStatuses=new Set(['REFUNDED','REFUND_REQUESTED','CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE','AWAITING_CHARGEBACK_REVERSAL']);
const usable=sub=>Boolean(sub&&sub.paidUntil&&new Date(sub.paidUntil)>new Date()&&sub.status!=='REVOKED');
async function syncUser(sub){
 if(!sub)return;
 const active=usable(sub);
 // Avoid overwriting independently granted premium: only revoke when user was on this subscription.
 if(active){await User.updateOne({_id:sub.userId},{$set:{plano:'premium',premiumAtivo:true,premiumFim:sub.paidUntil}});}
 else {await User.updateOne({_id:sub.userId,$or:[{premiumFim:{$lte:new Date()}},{premiumFim:sub.paidUntil}]},{$set:{plano:'lite',premiumAtivo:false}});}
}
async function reconcile(sub,{remote=true}={}){
 if(!sub)return null;
 if(remote&&sub.subscriptionId){
  const result=await asaas('get',`/subscriptions/${encodeURIComponent(sub.subscriptionId)}/payments?limit=100`);
  const payments=(result.data||[]).sort((a,b)=>String(a.paymentDate||a.confirmedDate||a.dueDate).localeCompare(String(b.paymentDate||b.confirmedDate||b.dueDate)));
  let changed=false;
  if(sub.lastPaymentId&&!sub.processedPayments.includes(sub.lastPaymentId)){sub.processedPayments.push(sub.lastPaymentId);changed=true;}
  for(const payment of payments){
   if(!payment.id)continue;
   if(reversedStatuses.has(payment.status)){
    if(!sub.reversedPayments.includes(payment.id)){sub.reversedPayments.push(payment.id);changed=true;}
    continue;
   }
   if(paidStatuses.has(payment.status)&&!sub.cancelledAt&&Math.abs(Number(payment.value)-PRICE)<0.001&&!sub.processedPayments.includes(payment.id)){
    sub.processedPayments.push(payment.id);
    const base=sub.paidUntil&&sub.paidUntil>new Date()?sub.paidUntil:new Date();
    sub.paidUntil=addMonth(base);sub.lastPaidAt=new Date();sub.lastPaymentId=payment.id;changed=true;
   }
  }
  // If the last credited payment is reversed, suspend pending manual review.
  if(sub.lastPaymentId&&sub.reversedPayments.includes(sub.lastPaymentId)){
   sub.status='REVOKED';changed=true;
  }else if(sub.cancelledAt){sub.status='CANCELLED';changed=true;}
  else if(sub.paidUntil&&sub.paidUntil>new Date()){sub.status='ACTIVE';changed=true;}
  else if(sub.paidUntil){sub.status='EXPIRED';changed=true;}
  if(changed)await sub.save();
 }
 if(sub.paidUntil&&sub.paidUntil<=new Date()&&!['CANCELLED','REVOKED','EXPIRED'].includes(sub.status)){sub.status='EXPIRED';await sub.save();}
 await syncUser(sub);
 return sub;
}
async function latest(userId){return Sub.findOne({userId}).sort({createdAt:-1});}
module.exports={PRICE,reconcile,latest,usable,syncUser};
