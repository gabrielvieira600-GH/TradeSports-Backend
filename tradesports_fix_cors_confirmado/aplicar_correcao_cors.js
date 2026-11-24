'use strict';
/** TradeSports CORS hotfix: targeted exact-text patches; no dependencies. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
function option(key, def) {
  const i = args.indexOf(key);
  return i >= 0 ? args[i + 1] : def;
}
const doApply = args.includes('--apply');
const doCheck = args.includes('--check');
if (doApply === doCheck || args.includes('--help')) {
  console.log('Uso: node aplicar_correcao_cors.js --backend . --frontend ./frontend --check|--apply');
  process.exit(args.includes('--help') ? 0 : 2);
}
const backend = path.resolve(option('--backend', '.'));
const frontend = path.resolve(option('--frontend', './frontend'));
const exact = (s, old, expected) => {
  const count = s.split(old).length - 1;
  if (count !== 1) throw new Error(`${expected}: ancora encontrada ${count} vez(es), esperado 1. Nada alterado.`);
  return s.replace(old, expected);
};
const rules = [
  {
    name: 'frontend/pages/brasileirao-a.js',
    filename: path.join(frontend, 'pages', 'brasileirao-a.js'),
    changes: [
      ['      const resTabela = await axios.get(`${API_BASE}${mercado.endpoint}`, {headers:{"Cache-Control":"no-cache"}});',
       '      const resTabela = await axios.get(`${API_BASE}${mercado.endpoint}`);'],
    ],
  },
  {
    name: 'backend/server.js',
    filename: path.join(backend, 'server.js'),
    changes: [
      [
        '  "https://trade-sports-frontend-ok-om3a.vercel.app",\n  "http://localhost:3000",',
        '  "https://trade-sports-frontend-ok-om3a.vercel.app",\n  // URLs de preview especificas confirmadas nos logs do Render em 24/11/2026.\n  "https://trade-sports-frontend-ok-om3a-oxgoka2s7.vercel.app",\n  "https://trade-sports-frontend-aycvhdwne-gabrielvieira600-ghs-projects.vercel.app",\n  "http://localhost:3000",'
      ],
      [
        '  allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],',
        '  // Defesa em profundidade: aceitar Cache-Control mesmo se um cliente antigo o enviar.\n  allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "Cache-Control"],'
      ],
    ],
  },
];

function patch(content, changes, file) {
  const crlf = content.includes('\r\n');
  let result = content.replace(/\r\n/g, '\n');
  for (const [before, after] of changes) {
    const matchesBefore = result.split(before).length - 1;
    const matchesAfter = result.split(after).length - 1;
    if (matchesBefore === 1 && matchesAfter === 0) result = result.replace(before, after);
    else if (matchesBefore === 0 && matchesAfter === 1) {
      throw new Error(`${file}: este trecho ja foi corrigido. Nao aplique novamente.`);
    } else {
      throw new Error(`${file}: ancora inesperada (original=${matchesBefore}, corrigida=${matchesAfter}). Nao alterado.`);
    }
  }
  return crlf ? result.replace(/\n/g, '\r\n') : result;
}
function hash(content) { return crypto.createHash('sha256').update(content).digest('hex').slice(0,12); }
try {
  // Verify ALL files in memory before any write.
  const prepared = rules.map(({name, filename, changes}) => {
    if (!fs.existsSync(filename)) throw new Error(`${name}: arquivo inexistente em ${filename}`);
    const original = fs.readFileSync(filename, 'utf8');
    const revised = patch(original, changes, name);
    if (original === revised) throw new Error(`${name}: sem mudancas detectadas`);
    console.log(`OK ${name}: ${hash(original)} => ${hash(revised)}`);
    return {name, filename, original, revised};
  });
  if (doCheck) {
    console.log('CHECK APROVADO: 2 arquivos; nenhuma alteracao gravada.');
    process.exit(0);
  }
  const backupDir = path.join(backend, `_backup_fix_cors_${new Date().toISOString().replace(/[:.]/g,'-')}`);
  fs.mkdirSync(backupDir, {recursive:true});
  for (const p of prepared) {
    const backup = path.join(backupDir, p.name);
    fs.mkdirSync(path.dirname(backup), {recursive:true});
    fs.writeFileSync(backup, p.original, 'utf8');
  }
  try {
    for (const p of prepared) fs.writeFileSync(p.filename, p.revised, 'utf8');
  } catch (e) {
    for (const p of prepared) fs.writeFileSync(p.filename, p.original, 'utf8');
    throw new Error(`Falha na gravacao; restaurados originais: ${e.message}`);
  }
  console.log(`APLICACAO CONCLUIDA: 2 arquivos. Backup: ${backupDir}`);
  console.log('PROXIMOS PASSOS: publicar frontend Vercel E backend Render; verificar OPTIONS /api/tabela-brasileirao.');
} catch (err) {
  console.error('ERRO:', err.message);
  process.exit(1);
}
