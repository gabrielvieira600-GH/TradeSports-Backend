const mongoose=require('mongoose');
const SocialRepostSchema=new mongoose.Schema({postId:{type:mongoose.Schema.Types.ObjectId,ref:'SocialPost',required:true,index:true},usuarioId:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true,index:true},comentario:{type:String,trim:true,maxlength:280,default:''}},{timestamps:true,collection:'social_reposts'});
SocialRepostSchema.index({postId:1,usuarioId:1},{unique:true});
module.exports=mongoose.models.SocialRepost||mongoose.model('SocialRepost',SocialRepostSchema);
