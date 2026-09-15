const mongoose=require('mongoose');
const SocialReactionSchema=new mongoose.Schema({postId:{type:mongoose.Schema.Types.ObjectId,ref:'SocialPost',required:true,index:true},usuarioId:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true,index:true},tipo:{type:String,enum:['LIKE','FIRE'],default:'LIKE'}},{timestamps:true,collection:'social_reactions'});
SocialReactionSchema.index({postId:1,usuarioId:1},{unique:true});
module.exports=mongoose.models.SocialReaction||mongoose.model('SocialReaction',SocialReactionSchema);
