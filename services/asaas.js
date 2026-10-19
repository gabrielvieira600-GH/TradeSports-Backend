const axios=require('axios');
const base=process.env.ASAAS_ENV==='production'?'https://api.asaas.com/v3':'https://api-sandbox.asaas.com/v3';
async function asaas(method,path,data){
 if(!process.env.ASAAS_API_KEY)throw new Error('ASAAS_API_KEY ausente');
 const {data:body}=await axios({method,url:base+path,data,timeout:15000,headers:{access_token:process.env.ASAAS_API_KEY,'Content-Type':'application/json'}});
 return body;
}
module.exports=asaas;
