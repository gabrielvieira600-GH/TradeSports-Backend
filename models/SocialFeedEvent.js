const mongoose=require('mongoose');
const TIPOS=[
'FOLLOW_USER','PRIVATE_RANKING_CREATED','PRIVATE_RANKING_JOINED','PRIVATE_RANKING_INVITE_ACCEPTED',
'RANKING_TOP_ACHIEVED','RANKING_LEADER','RANKING_POSITION_CHANGED','RANKING_POSITION_GAIN','PRIVATE_RANKING_LEADER',
'MILESTONE_RENTABILITY','TROPHY_EARNED','FIRST_TRADE','PORTFOLIO_MILESTONE','FOLLOWERS_MILESTONE',
'SEASON_FINISH_POSITION','DIVIDEND_MILESTONE','WINNING_STREAK','TRADE_EXECUTED','SYSTEM_MARKET_EVENT','SYSTEM'
];
const S=new mongoose.Schema({tipo:{type:String,required:true,index:true,enum:TIPOS},usuarioId:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true,index:true},usuarioAlvoId:{type:mongoose.Schema.Types.ObjectId,ref:'User',default:null,index:true},rankingPrivadoId:{type:mongoose.Schema.Types.ObjectId,ref:'PrivateRanking',default:null,index:true},clubeId:{type:Number,default:null,index:true},titulo:{type:String,default:'',trim:true,maxlength:140},mensagem:{type:String,default:'',trim:true,maxlength:500},targetUrl:{type:String,default:'',trim:true,maxlength:300},visibilidade:{type:String,enum:['publico','seguidores','privado'],default:'publico',index:true},status:{type:String,enum:['ativo','oculto','removido'],default:'ativo',index:true},relevancia:{type:Number,default:0,index:true},metadata:{type:mongoose.Schema.Types.Mixed,default:{}}},{timestamps:true,collection:'social_feed_events'});
S.index({status:1,visibilidade:1,createdAt:-1});S.index({usuarioId:1,createdAt:-1});S.index({usuarioAlvoId:1,createdAt:-1});S.index({tipo:1,createdAt:-1});S.index({relevancia:-1,createdAt:-1});
module.exports=mongoose.models.SocialFeedEvent||mongoose.model('SocialFeedEvent',S);
module.exports.TIPOS_SOCIAL_FEED=TIPOS;
