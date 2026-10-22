const mongoose=require('mongoose');
const schema=new mongoose.Schema({
 userId:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true,index:true},
 checkoutId:{type:String,required:true,unique:true},
 orderId:{type:String,required:true,unique:true},
 status:{type:String,enum:['ACTIVE','PAID','CANCELED','EXPIRED'],default:'ACTIVE'},
 expiresAt:{type:Date,required:true},
 customerId:{type:String,default:null},
 subscriptionId:{type:String,default:null}
},{timestamps:true});
schema.index({userId:1,status:1,createdAt:-1});
module.exports=mongoose.models.AsaasCheckoutIntent||mongoose.model('AsaasCheckoutIntent',schema);
