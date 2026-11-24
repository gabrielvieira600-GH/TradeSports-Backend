'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { makePatches } = require('../patches');
const { run } = require('../aplicar_patch_ipo_lite');
function fixture(){
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'tradesports-ipo-lite-'));
  const backend=path.join(root,'backend'), frontend=path.join(root,'frontend');
  fs.mkdirSync(backend,{recursive:true});fs.mkdirSync(frontend,{recursive:true});
  for(const f of makePatches()){
    const file=path.join(f.repo==='backend'?backend:frontend,f.file);
    fs.mkdirSync(path.dirname(file),{recursive:true});
    // Os trechos do upstream são fragmentos independentes e únicos neste teste.
    fs.writeFileSync(file,f.replacements.map(x=>x.before).join('\n//---\n'),'utf8');
  }
  return {root,backend,frontend};
}
test('check sem escrever dados',()=>{
  const d=fixture(); const f=path.join(d.backend,'controllers/InvestimentoController.js');
  const original=fs.readFileSync(f,'utf8');run({...d,check:true,apply:false});
  assert.equal(fs.readFileSync(f,'utf8'),original);
});
test('apply altera os 3 arquivos e gera backups',()=>{
  const d=fixture();run({...d,check:false,apply:true});
  const c=fs.readFileSync(path.join(d.backend,'controllers/InvestimentoController.js'),'utf8');
  const q=fs.readFileSync(path.join(d.backend,'utils/tradingQuota.js'),'utf8');
  const ui=fs.readFileSync(path.join(d.frontend,'components/NegociacaoModal.js'),'utf8');
  assert.match(c,/consumirOrdemQuotaSemanal\(/);
  assert.match(c,/quotaLitePeriodo: periodoQuotaIPO/);
  assert.match(c,/LIMITE_ORDENS_ATINGIDO/);
  assert.match(q,/Investment\.countDocuments/);
  assert.match(q,/Number\(ordensSecundario \|\| 0\) \+ Number\(comprasIPO \|\| 0\)/);
  assert.match(ui,/ipoEncerrado \|\| modo === 'compra'/);
  assert.match(ui,/vendas ao sistema não consomem/);
  assert.equal(fs.readdirSync(d.backend).filter(x=>x.startsWith('_backup_ipo_lite_')).length,1);
});
test('falha de âncora não modifica nenhum arquivo',()=>{
  const d=fixture(); const f=path.join(d.backend,'utils/tradingQuota.js');
  fs.appendFileSync(f,'\nconst Order = require(\'../models/Order\');');
  const before=fs.readFileSync(f,'utf8');
  assert.throws(()=>run({...d,check:false,apply:true}),/âncora encontrada 2 vez/);
  assert.equal(fs.readFileSync(f,'utf8'),before);
  assert.equal(fs.readdirSync(d.backend).filter(x=>x.startsWith('_backup_ipo_lite_')).length,0);
});
test('preserva CRLF',()=>{
  const d=fixture();
  for(const f of makePatches()){
    const file=path.join(f.repo==='backend'?d.backend:d.frontend,f.file);
    fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/\n/g,'\r\n'));
  }
  run({...d,check:false,apply:true});
  const s=fs.readFileSync(path.join(d.backend,'utils/tradingQuota.js'),'utf8');
  assert.equal((s.match(/(?<!\r)\n/g)||[]).length,0);
});
