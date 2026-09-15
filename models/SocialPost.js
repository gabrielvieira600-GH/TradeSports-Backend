const mongoose = require('mongoose');
const SocialPostSchema = new mongoose.Schema({
  autorId:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true,index:true},
  texto:{type:String,default:'',trim:true,maxlength:500},
  visibilidade:{type:String,enum:['publico','seguidores','privado'],default:'publico',index:true},
  anexo:{type:mongoose.Schema.Types.Mixed,default:null},
  imagem:{dataUrl:{type:String,default:''},mime:{type:String,default:''},nome:{type:String,default:''}},
  mencoes:[{type:mongoose.Schema.Types.ObjectId,ref:'User'}],
  status:{type:String,enum:['ativo','removido','moderado'],default:'ativo',index:true},
  contadores:{curtidas:{type:Number,default:0},comentarios:{type:Number,default:0},reposts:{type:Number,default:0},denuncias:{type:Number,default:0}}
},{timestamps:true,collection:'social_posts'});
SocialPostSchema.index({status:1,visibilidade:1,createdAt:-1});
module.exports=mongoose.models.SocialPost||mongoose.model('SocialPost',SocialPostSchema);
