'use strict';
const User=require('../models/User');
const Sub=require('../models/AsaasSubscription');
let running=false;
async function expirePremium(){
 if(running)return {skipped:true};
 running=true;
 try{
  const now=new Date();
  // Only downgrade subscriptions whose entitlement has actually elapsed.
  const users=await User.find({premiumAtivo:true,premiumFim:{$lte:now}}).select('_id premiumFim').lean();
  let expired=0;
  for(const user of users){
   const valid=await Sub.exists({userId:user._id,paidUntil:{$gt:now},status:{$ne:'REVOKED'}});
   if(valid)continue;
   const result=await User.updateOne({_id:user._id,premiumFim:{$lte:now},premiumAtivo:true},{$set:{plano:'lite',premiumAtivo:false}});
   expired+=result.modifiedCount||0;
   await Sub.updateMany({userId:user._id,paidUntil:{$lte:now},status:'ACTIVE'},{$set:{status:'EXPIRED'}});
  }
  return {checked:users.length,expired};
 }finally{running=false;}
}
function startPremiumExpiryJob(){
 if(process.env.ASAAS_PREMIUM_ENABLED!=='true')return;
 const run=()=>expirePremium().catch(e=>console.error('[PREMIUM EXPIRY]',e.message));
 setTimeout(run,15000).unref?.();
 setInterval(run,5*60*1000).unref?.();
}
module.exports={expirePremium,startPremiumExpiryJob};
