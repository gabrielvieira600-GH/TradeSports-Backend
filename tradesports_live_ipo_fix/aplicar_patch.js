'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');
const patch=require('./patches');
const args=process.argv.slice(2);const findArg=k=>{const i=args.indexOf(k);return i<0?null:args[i+1];};
const root=process.cwd();const backend=path.resolve(findArg('--backend')||'.');const frontend=path.resolve(findArg('--frontend')||'./frontend');
const apply=args.includes('--apply');
if(!apply&&!args.includes('--check')) { console.error('Use --check primeiro, depois --apply.');process.exit(2); }
const normalized=s=>s.replace(/\r\n/g,'\n');const sha=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,12);
const changes=[];
try {
 for(const [key,fn] of Object.entries(patch)) {
  const file=path.join(key.startsWith('backend/')?backend:frontend,key.replace(/^(backend|frontend)\//,''));
  if(!fs.existsSync(file))throw Error(`Arquivo ausente: ${file}`);
  const old=fs.readFileSync(file,'utf8');
  const eol=old.includes('\r\n')?'\r\n':'\n';
  const transformed=fn(normalized(old)).replace(/\n/g,eol);
  if(transformed===old)throw Error(`Nenhuma alteração gerada: ${key}`);
  changes.push({key,file,old,next:transformed});
  console.log(`OK ${key} ${sha(old)} -> ${sha(transformed)}`);
 }
 const file=path.join(backend,'services','liveFootballTable.js');
 if(fs.existsSync(file)) throw Error('services/liveFootballTable.js já existe. Não sobrescreva sem revisar.');
 const content=fs.readFileSync(path.join(__dirname,'files','services','liveFootballTable.js'),'utf8');
 changes.push({key:'backend/services/liveFootballTable.js',file,old:null,next:content});
 console.log('NOVO backend/services/liveFootballTable.js');
 const checkFile=path.join(backend,'scripts','check_live_config.js');
 if(fs.existsSync(checkFile))throw Error('scripts/check_live_config.js já existe. Não sobrescreva.');
 changes.push({key:'backend/scripts/check_live_config.js',file:checkFile,old:null,next:fs.readFileSync(path.join(__dirname,'scripts','check_live_config.js'),'utf8')});
 console.log('NOVO backend/scripts/check_live_config.js');
 if(!apply){console.log(`CHECK APROVADO: ${changes.length} arquivo(s). Nenhum arquivo alterado.`);process.exit(0);}
 const backup=path.join(backend,`_backup_live_ipo_${new Date().toISOString().replace(/[:.]/g,'-')}`);
 fs.mkdirSync(backup,{recursive:true});
 for(const x of changes){if(x.old!==null){const dest=path.join(backup,x.key);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,x.old,'utf8');}}
 const done=[];
 try{
  for(const x of changes){fs.mkdirSync(path.dirname(x.file),{recursive:true});fs.writeFileSync(x.file,x.next,'utf8');done.push(x);}
 }catch(e){for(const x of done.reverse()){if(x.old==null)fs.unlinkSync(x.file);else fs.writeFileSync(x.file,x.old,'utf8');}throw e;}
 console.log(`APLICAÇÃO CONCLUÍDA: ${changes.length} arquivos. Backup: ${backup}`);
 console.log('ATENÇÃO: não publicar antes dos testes, configuração da temporada e validação da API de partidas.');
}catch(e){console.error('ERRO:',e.message,'Nenhuma alteração parcial deve ser publicada.');process.exit(1);}
