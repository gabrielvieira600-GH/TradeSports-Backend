'use strict';
const Sub=require('../models/AsaasSubscription');
const asaas=require('./asaas');
const done=s=>['DELETED','CANCELLED','EXPIRED','INACTIVE'].includes(String(s?.status||'').toUpperCase())||s?.deleted===true;
async function cancelAll(userId){
 const subs=await Sub.find({userId,cancelledAt:null});
 for(const sub of subs){
  if(!sub.subscriptionId)throw Error('Assinatura sem identificador. Contate o suporte.');
  const url='/subscriptions/'+encodeURIComponent(sub.subscriptionId);
  const remote=await asaas('get',url);
  if(!remote||remote.id!==sub.subscriptionId||remote.customer!==sub.customerId)throw Error('Assinatura divergente. Contate o suporte.');
  if(!done(remote)){
   await asaas('delete',url);
   const confirmed=await asaas('get',url);
   if(!confirmed||confirmed.id!==sub.subscriptionId||!done(confirmed))throw Error('Cancelamento ainda não confirmado pelo Asaas.');
  }
  await Sub.updateOne({_id:sub._id},{$set:{cancelledAt:new Date(),status:'CANCELLED',cancellationReason:'ACCOUNT_DELETION'}});
 }
}
module.exports={cancelAll};
