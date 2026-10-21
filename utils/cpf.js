function onlyDigits(value){return String(value || '').replace(/\D/g,'');}
function validCpf(value){
 const cpf=onlyDigits(value);
 if(!/^\d{11}$/.test(cpf)||/^(\d)\1{10}$/.test(cpf))return false;
 for(let size=9;size<=10;size++){
  let sum=0;
  for(let i=0;i<size;i++)sum+=Number(cpf[i])*(size+1-i);
  const digit=(sum*10)%11%10;
  if(digit!==Number(cpf[size]))return false;
 }
 return true;
}
function maskCpf(value){
 const cpf=onlyDigits(value);
 return cpf.length===11 ? `***.***.${cpf.slice(6,9)}-${cpf.slice(9)}` : null;
}
module.exports={onlyDigits,validCpf,maskCpf};
