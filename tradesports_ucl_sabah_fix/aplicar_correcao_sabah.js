#!/usr/bin/env node
'use strict';
// Executar na raiz do backend: node corrigir_sabah/aplicar_correcao_sabah.js --check / --apply
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cwd = process.cwd();
const changes = [];
const backend = path.resolve(process.argv.includes('--backend') ? process.argv[process.argv.indexOf('--backend')+1] : '.');
const apply = process.argv.includes('--apply');
if (!apply && !process.argv.includes('--check')) { console.error('Informe --check ou --apply.'); process.exit(2); }
function replace(rel, oldText, newText, why) {
  const file = path.join(backend, rel);
  if(!fs.existsSync(file)) throw Error(`Não encontrado: ${file}. Rode na raiz do backend.`);
  const original = fs.readFileSync(file, 'utf8');
  const eol = original.includes('\r\n')?'\r\n':'\n';
  const text = original.replace(/\r\n/g, '\n');
  if (text.includes(newText)) { console.log(`JÁ APLICADO: ${rel} (${why})`); return; }
  const count = text.split(oldText).length-1;
  if(count !== 1) throw Error(`${rel}: âncora para '${why}' encontrada ${count} vez(es); esperado 1. Nada será gravado.`);
  changes.push({file,original,patched:text.replace(oldText,newText).replace(/\n/g,eol),why});
}
function run() {
  replace('data/participantes-2026-27.json', '"Sabah FC","Sabah Masazir","Sabah FK"', '"Sabah FC","Sabah Masazir","Sabah FK","Sabah FA"', 'nome da API controlado por validação de identidade');
  replace('scripts/seedChampions2026.js', 'async function main() {\n  const standings = ucl.validateStandings(await loadStandings());', `async function verificarSabahFA(items) {
  const suspeitos = (Array.isArray(items) ? items : []).filter(x => ucl.normalize(x?.nome || x?.team?.name) === 'sabahfa');
  if (!suspeitos.length) return;
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('Sabah FA é um nome ambíguo. Informe API_FOOTBALL_KEY para verificar o país do clube.');
  for (const item of suspeitos) {
    const id = Number(item?.apiId ?? item?.team?.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error('Sabah FA: ID inválido da API.');
    const response = await fetch('https://v3.football.api-sports.io/teams?id=' + id, {
      headers: {'x-apisports-key': key, Accept:'application/json'}, signal:AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('Sabah FA: falha na verificação do país, HTTP ' + response.status);
    const body = await response.json();
    const apiErrors = body?.errors && typeof body.errors === 'object' ? Object.values(body.errors).filter(Boolean) : [];
    if (apiErrors.length) throw new Error('Sabah FA: API recusou verificação de identidade: ' + apiErrors.join('; '));
    const detalhe = body?.response?.[0]?.team;
    const country = String(detalhe?.country || '');
    const normalizedCountry = ucl.normalize(country);
    console.log('[UCL] Conferência de identidade Sabah FA: ID=' + id + ', país=' + (country || '(ausente)'));
    if (!['azerbaijan','azerbaijao','azerbaycan'].includes(normalizedCountry)) {
      throw new Error('BLOQUEADO: Sabah FA retornou país ' + (country || '(não informado)') + ', mas a Champions exige o Sabah do Azerbaijão. Não registrar ID possivelmente pertencente ao clube da Malásia.');
    }
  }
}
async function main() {
  const rawStandings = await loadStandings();
  await verificarSabahFA(rawStandings);
  const standings = ucl.validateStandings(rawStandings);`, 'verificação país/ID Sabah antes do cadastro');
  replace('routes/sportsStandings.js', `        ucl2026.validateStandings(classificacao);
      }
      const data = await sincronizar(configBase, classificacao);`, `        const validados = ucl2026.validateStandings(classificacao);
        // A classificação pública não deve cadastrar cotas automaticamente antes do seed auditado.
        const existentesUcl = await Club.find({'metadata.ligaId': 'champions-league'})
          .select('legacyId metadata.providerTeamId').lean();
        if (existentesUcl.length !== 36) throw new Error('Champions ainda não possui 36 clubes auditados no MongoDB. Execute o seed primeiro.');
        const porLegacy = new Map(existentesUcl.map(c => [Number(c.legacyId), Number(c.metadata?.providerTeamId)]));
        for (const item of validados) {
          const id = ucl2026.toLegacyId(item);
          if (porLegacy.get(id) !== Number(item.apiId)) {
            throw new Error('Identidade de clube mudou na API: ' + item.nome + '. Bloqueando atualização para evitar cruzamento de cotas.');
          }
        }
      }
      const data = await sincronizar(configBase, classificacao);`, 'bloquear sync da Champions antes do seed e checar IDs');
  console.log('Validação:',changes.length,'arquivo(s) prontos.');
  if (!apply) { console.log('CHECK OK — nenhuma alteração gravada.'); return; }
  // Validar todas as âncoras ANTES de fazer qualquer gravação.
  const backupDir = path.join(backend, '_backup_ucl_sabah_'+new Date().toISOString().replace(/[:.]/g,'-'));
  fs.mkdirSync(backupDir,{recursive:true});
  for (const c of changes) fs.writeFileSync(path.join(backupDir,crypto.createHash('sha256').update(c.file).digest('hex')+'_'+path.basename(c.file)),c.original);
  for (const c of changes) if(fs.readFileSync(c.file,'utf8')!==c.original) throw Error('Arquivo alterado durante patch: '+c.file);
  for (const c of changes) { fs.writeFileSync(c.file,c.patched); console.log('ALTERADO:',c.file); }
  console.log('CORREÇÃO APLICADA. Backup:',backupDir);
}
try { run(); } catch(e) { console.error('ERRO:', e.message); process.exitCode=1; }
