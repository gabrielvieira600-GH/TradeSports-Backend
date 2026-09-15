const mongoose=require('mongoose');
const SocialCommentSchema=new mongoose.Schema({postId:{type:mongoose.Schema.Types.ObjectId,ref:'SocialPost',required:true,index:true},autorId:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true,index:true},parentId:{type:mongoose.Schema.Types.ObjectId,ref:'SocialComment',default:null,index:true},texto:{type:String,required:true,trim:true,maxlength:500},mencoes:[{type:mongoose.Schema.Types.ObjectId,ref:'User'}],status:{type:String,enum:['ativo','removido'],default:'ativo',index:true}},{timestamps:true,collection:'social_comments'});
SocialCommentSchema.index({postId:1,status:1,createdAt:1});
module.exports=mongoose.models.SocialComment||mongoose.model('SocialComment',SocialCommentSchema);
