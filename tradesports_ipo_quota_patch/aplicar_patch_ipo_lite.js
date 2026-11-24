#!/usr/bin/env node
'use strict';
/** TradeSports IPO Lite weekly quota — patch Node.js conservador, sem dependências */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { makePatches } = require('./patches');

function parseArgs(argv) {
  const opts = { backend: '.', frontend: './frontend', check: false, apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--backend' || a === '--frontend') { if (!argv[i+1]) throw new Error('Falta caminho para ' + a); opts[a.slice(2)] = argv[++i]; }
    else if (a === '--check') opts.check = true;
    else if (a === '--apply') opts.apply = true;
    else if (a === '--help' || a === '-h') { opts.help = true; }
    else throw new Error('Argumento desconhecido: ' + a);
  }
  if (!opts.check && !opts.apply && !opts.help) throw new Error('Informe --check ou --apply.');
  if (opts.check && opts.apply) throw new Error('Use somente --check OU --apply.');
  return opts;
}
function sha(s) { return crypto.createHash('sha256').update(s).digest('hex').slice(0,12); }
function preserveEol(before, after) { return before.includes('\r\n') ? after.replace(/\n/g,'\r\n') : after; }
function normalizeEol(s) { return s.replace(/\r\n/g,'\n'); }
function validateRoot(root, file) {
  const abs = path.resolve(root, file);
  if (!abs.startsWith(path.resolve(root) + path.sep)) throw new Error('Caminho inválido: ' + file);
  if (!fs.existsSync(abs)) throw new Error('Arquivo não encontrado: ' + abs);
  return abs;
}
function run(opts) {
  const files = makePatches();
  const staged = [];
  // Valida TODAS as âncoras primeiro. Nenhuma gravação antes dessa etapa.
  for (const f of files) {
    const root = f.repo === 'backend' ? opts.backend : opts.frontend;
    const abs = validateRoot(root, f.file);
    const original = fs.readFileSync(abs, 'utf8');
    let revised = normalizeEol(original);
    for (const p of f.replacements) {
      const occur = revised.split(p.before).length-1;
      if (occur !== 1) {
        throw new Error(`${f.repo}/${f.file} [${p.label}]: âncora encontrada ${occur} vez(es), esperado 1. Nenhuma alteração aplicada.`);
      }
      revised = revised.replace(p.before, p.after);
    }
    const result = preserveEol(original, revised);
    staged.push({abs, original, result, label: f.repo+'/'+f.file});
    process.stdout.write(`OK ${f.repo}/${f.file} | ${f.replacements.length} alterações | ${sha(original)} -> ${sha(result)}\n`);
  }
  if (opts.check) { console.log('CHECK APROVADO: '+staged.length+' arquivos; nenhuma alteração gravada.'); return; }
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  const backupRoot = path.join(path.resolve(opts.backend),`_backup_ipo_lite_${stamp}`);
  fs.mkdirSync(backupRoot, {recursive:true});
  for (const f of staged) {
    const isFrontend = f.label.startsWith('frontend/');
    const backup = path.join(backupRoot, f.label);
    fs.mkdirSync(path.dirname(backup), {recursive:true});
    fs.copyFileSync(f.abs, backup);
    const temp = f.abs + '.ipo-lite-tmp';
    fs.writeFileSync(temp,f.result,'utf8');
    fs.renameSync(temp,f.abs);
  }
  console.log('PATCH APLICADO. Backups: '+backupRoot);
  console.log('Não publice antes de executar os testes e conferir a integração MongoDB.');
}
if (require.main === module) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if(opts.help) { console.log('node aplicar_patch_ipo_lite.js --backend . --frontend ./frontend --check|--apply'); }
    else run(opts);
  } catch(e) { console.error('ERRO: '+e.message); process.exitCode = 1; }
}
module.exports = {run,parseArgs};
