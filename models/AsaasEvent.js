const mongoose=require('mongoose');
const schema=new mongoose.Schema({eventId:{type:String,unique:true,required:true},receivedAt:{type:Date,default:Date.now}});
module.exports=mongoose.models.AsaasEvent||mongoose.model('AsaasEvent',schema);
