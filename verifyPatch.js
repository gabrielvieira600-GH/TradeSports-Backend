#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const [backend, frontend] = process.argv.slice(2);
if (!backend || !frontend) {
  console.error('Uso: node tests/verifyPatch.js /repo/TradeSports-Backend /repo/TradeSports-Frontend-OK');
  process.exit(2);
}
function file(root,relative){return fs.readFileSync(path.join(root,relative),'utf8')}
const backendFiles = [
  'controllers/InvestimentoController.js','routes/clube.js','routes/mercado.js',
  'routes/dashboard.js','routes/classificacao.js','routes/performance.js',
  'routes/usuario.js','routes/sportsStandings.js','services/sportsTableCache.js',
  'utils/portfolioValuation.js','server.js'
];
for(const relative of backendFiles){
  const output = spawnSync('node',['--check',path.join(backend,relative)],{encoding:'utf8'});
  assert.equal(output.status,0,`Erro de sintaxe ${relative}: ${output.stderr}`);
}
const controller=file(backend,'controllers/InvestimentoController.js');
assert.match(controller,/function getPrecoClube\(clube\)[\s\S]*calcularPrecoPorPosicao\(posicao, total\)/);
assert.match(controller,/validarEstadoIpo/);
assert.match(controller,/liquidityState\.issuedShares = Number\(clube\.cotasEmitidas\)/);
assert.match(controller,/IPO_ESTOQUE_INCONSISTENTE/);
const routes=file(backend,'routes/mercado.js');
assert.match(routes,/isUnifiedLiquidity\(\) \|\| Boolean\(clube\.ipoEncerrado\)/);
const modal=file(frontend,'components/NegociacaoModal.js');
assert.match(modal,/clubeInfo\.precoIPO/);
assert.match(modal,/Vender ao sistema/);
const { calcularPrecoPorPosicao } = require(path.join(backend,'utils/liquidationPrice.js'));
assert.equal(calcularPrecoPorPosicao(20),5.00);
assert.equal(calcularPrecoPorPosicao(6),9.90);
assert.equal(calcularPrecoPorPosicao(5),10.35);
assert.equal(calcularPrecoPorPosicao(4),10.90);
for(let position=1;position<20;position++) {
  assert(calcularPrecoPorPosicao(position)>calcularPrecoPorPosicao(position+1));
}
console.log('PASS: sintaxe de 11 arquivos backend + âncoras do frontend + tabela de preços.');
console.log('ATENÇÃO: isso não substitui integração com MongoDB/ledger, teste de build Next.js e fluxos ponta a ponta.');
