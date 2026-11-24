'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process'),assert=require('assert');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tradesports-cors-'));
const b=path.join(root,'backend'), f=path.join(root,'frontend');
fs.mkdirSync(path.join(b),{recursive:true});fs.mkdirSync(path.join(f,'pages'),{recursive:true});
const server=`const allowedOrigins = [\n  process.env.FRONTEND_ORIGIN,\n  "https://www.tradesports.com.br",\n  "https://tradesports.com.br",\n  "https://trade-sports-frontend-ok.vercel.app",\n  "https://trade-sports-frontend-ok-om3a.vercel.app",\n  "http://localhost:3000",\n].filter(Boolean);\nconst corsOptions = {\n  origin: (origin, callback) => {\n    if (!origin) return callback(null, true);\n    if (allowedOrigins.includes(origin)) return callback(null, true);\n    return callback(new Error('CORS bloqueado'));\n  },\n  allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],\n};\n`;
const page='      const resTabela = await axios.get(`${API_BASE}${mercado.endpoint}`, {headers:{"Cache-Control":"no-cache"}});\n';
const serverfile=path.join(b,'server.js'), pagefile=path.join(f,'pages','brasileirao-a.js');
fs.writeFileSync(serverfile,server);fs.writeFileSync(pagefile,page);
const script=path.resolve(__dirname,'..','aplicar_correcao_cors.js');
function run(mode){return cp.spawnSync(process.execPath,[script,'--backend',b,'--frontend',f,mode],{encoding:'utf8'});}
const check=run('--check');assert.strictEqual(check.status,0,check.stderr);assert.strictEqual(fs.readFileSync(serverfile,'utf8'),server);assert.strictEqual(fs.readFileSync(pagefile,'utf8'),page);
const apply=run('--apply');assert.strictEqual(apply.status,0,apply.stderr);let s=fs.readFileSync(serverfile,'utf8'),p=fs.readFileSync(pagefile,'utf8');
assert(s.includes('"Cache-Control"'));assert(s.includes('trade-sports-frontend-ok-om3a-oxgoka2s7.vercel.app'));assert(s.includes('trade-sports-frontend-aycvhdwne-gabrielvieira600-ghs-projects.vercel.app'));assert(!p.includes('headers:{"Cache-Control":"no-cache"}'));assert(p.includes('axios.get(`${API_BASE}${mercado.endpoint}`)'));
assert.strictEqual(run('--apply').status,1,'second apply must be rejected');
const backups=fs.readdirSync(b).filter(x=>x.startsWith('_backup_fix_cors_'));assert.strictEqual(backups.length,1);
assert.strictEqual(fs.readFileSync(path.join(b,backups[0],'backend/server.js'),'utf8'),server);
assert.strictEqual(fs.readFileSync(path.join(b,backups[0],'frontend/pages/brasileirao-a.js'),'utf8'),page);
fs.rmSync(root,{recursive:true,force:true});console.log('7 TESTES OK: check, no-write, apply, headers, origins, idempotency protection, backups.');
