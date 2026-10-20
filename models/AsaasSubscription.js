const mongoose = require('mongoose');
const schema = new mongoose.Schema({
 userId:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true,index:true},
 customerId:{type:String,required:true},
 subscriptionId:{type:String,unique:true,sparse:true},
 billingType:{type:String,enum:['CREDIT_CARD','PIX'],required:true},
 status:{type:String,default:'PENDING'},
 lastPaymentId:String,lastPaidAt:Date,paidUntil:Date,
 cancelledAt:Date,cancellationReason:String,
 processedPayments:{type:[String],default:[]},
 reversedPayments:{type:[String],default:[]},
 createdAt:{type:Date,default:Date.now}
},{timestamps:true});
module.exports=mongoose.models.AsaasSubscription||mongoose.model('AsaasSubscription',schema);
