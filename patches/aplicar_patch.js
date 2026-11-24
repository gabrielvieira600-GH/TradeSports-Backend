#!/usr/bin/env node
'use strict';
/**
 * Aplica o mesmo conjunto de substituições do apply.py original, usando somente Node.js.
 * Exemplos:
 *   node patches/aplicar_patch.js --backend ../TradeSports-Backend --frontend ../TradeSports-Frontend-OK --check
 *   node patches/aplicar_patch.js --backend ../TradeSports-Backend --frontend ../TradeSports-Frontend-OK
 * Requer Node 18+, sem dependências npm; nunca acessa produção ou MongoDB.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const manifest = require('./patchManifest.json');

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Uso: node patches/aplicar_patch.js --backend CAMINHO --frontend CAMINHO [--check]');
    return;
  }
  const flag = (key) => {
    const i = args.indexOf(key);
    if (i < 0 || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Informe ${key} CAMINHO`);
    return path.resolve(args[i + 1]);
  };
  const roots = { backend: flag('--backend'), frontend: flag('--frontend') };
  const checkOnly = args.includes('--check');
  const plan = [];
  let current = null;
  for (const step of manifest.operations) {
    if (step.op === 'file') {
      if (current) throw new Error('Manifesto inválido: faltou finalizar o arquivo anterior.');
      const root = roots[step.root];
      if (!root) throw new Error(`Repositório inválido: ${step.root}`);
      const file = path.resolve(root, step.path);
      if (!file.startsWith(root + path.sep)) throw new Error(`Caminho inválido: ${step.path}`);
      if (!fs.existsSync(file)) throw new Error(`Arquivo não encontrado: ${file}`);
      const original = fs.readFileSync(file, 'utf8');
      // Âncoras do manifesto foram produzidas com LF. Em Windows, arquivos
      // existentes podem usar CRLF; normalizamos somente para comparar.
      const newline = (original.match(/\r\n/g) || []).length >
        (original.match(/(?<!\r)\n/g) || []).length ? '\r\n' : '\n';
      const normalized = original.replace(/\r\n?/g, '\n');
      current = { root, repo: step.root, relative: step.path, file, original, newline, updated: normalized };
      continue;
    }
    if (!current) throw new Error('Manifesto inválido: operação sem arquivo.');
    if (step.op === 'replace') {
      if (!step.old) throw new Error(`Âncora vazia em ${step.label}`);
      const found = current.updated.split(step.old).length - 1;
      if (found !== step.count) {
        const localNotice = current.relative === 'server.js'
          ? ' O server.js local pode ter diferenças em relação à branch main; se persistir, envie o trecho entre connectDB() e a reconciliação institucional.'
          : ' O arquivo local pode ter diferenças em relação à branch main.';
        throw new Error(`${current.repo}/${current.relative} [${step.label}]: âncora encontrada ${found} vez(es), esperado ${step.count}. Nenhuma alteração aplicada.${localNotice}`);
      }
      current.updated = current.updated.split(step.old).join(step.new);
      continue;
    }
    if (step.op === 'between') {
      const startCount = current.updated.split(step.start).length - 1;
      const endCount = current.updated.split(step.end).length - 1;
      if (startCount !== 1 || endCount !== 1) {
        throw new Error(`${current.repo}/${current.relative}: delimitadores de função encontrados ${startCount}/${endCount} (esperado 1/1). Nenhuma alteração aplicada.`);
      }
      const from = current.updated.indexOf(step.start);
      const to = current.updated.indexOf(step.end, from + step.start.length);
      if (to < 0) throw new Error(`Fim da função não localizado: ${current.relative}`);
      current.updated = current.updated.slice(0, from) + step.content + current.updated.slice(to);
      continue;
    }
    if (step.op === 'end') {
      if (current.original.replace(/\r\n?/g, '\n') === current.updated) {
        throw new Error(`Nenhuma alteração em ${current.relative}`);
      }
      // Preserva o padrão de final de linha do arquivo original.
      current.updated = current.newline === '\r\n'
        ? current.updated.replace(/\n/g, '\r\n')
        : current.updated;
      plan.push(current);
      current = null;
      continue;
    }
    throw new Error(`Operação desconhecida: ${step.op}`);
  }
  if (current) throw new Error('Manifesto incompleto.');
  const sha = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
  for (const item of plan) console.log(`${checkOnly ? 'OK' : 'VALIDADO'} ${item.repo}/${item.relative} ${sha(item.original)} => ${sha(item.updated)}`);
  if (checkOnly) {
    console.log(`Validação concluída: ${plan.length} arquivos. Nenhuma alteração gravada.`);
    return;
  }
  // Todas as âncoras já foram validadas. Primeiro salvamos backups de TODOS os arquivos.
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const backupName = `.tradesports-ipo-backup-${stamp}`;
  for (const item of plan) {
    const dest = path.join(item.root, backupName, item.relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, item.original, 'utf8');
  }
  // Se uma gravação falhar, tenta restaurar os arquivos que já tinham sido alterados.
  const written = [];
  try {
    for (const item of plan) {
      fs.writeFileSync(item.file, item.updated, 'utf8');
      written.push(item);
      console.log(`ALTERADO ${item.repo}/${item.relative}`);
    }
  } catch (error) {
    console.error('Falha de gravação; tentando restaurar arquivos já escritos.');
    for (const item of written.reverse()) {
      try { fs.writeFileSync(item.file, item.original, 'utf8'); }
      catch (restoreError) { console.error(`RESTORE MANUAL NECESSÁRIO: ${item.file}`, restoreError.message); }
    }
    throw error;
  }
  console.log(`Backups locais: ${backupName} em cada repositório.`);
  console.log('NÃO publique antes do diagnóstico MongoDB, testes e revisão de MARKET_MODE=IPO.');
}

try { main(); } catch (e) { console.error('ERRO:', e.message); process.exitCode = 1; }
