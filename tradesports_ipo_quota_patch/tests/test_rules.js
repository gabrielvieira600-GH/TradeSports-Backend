'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {makePatches} = require('../patches');
const patches = makePatches();
const controller = patches.find(x=>x.file==='controllers/InvestimentoController.js');
const quota = patches.find(x=>x.file==='utils/tradingQuota.js');
const modal = patches.find(x=>x.file==='components/NegociacaoModal.js');
const all=(f)=>f.replacements.map(p=>p.after).join('\n');
test('consumo IPO: apenas na compra e dentro da transação',()=>{
 const c=all(controller);
 assert.match(c,/session, limiteLite/);
 assert.match(c,/consumirOrdemQuotaSemanal/);
 assert.match(c,/quotaLiteContabilizada/);
 assert.match(c,/TEMPORADA_NAO_ATIVA/);
 assert.match(c,/LIMITE_ORDENS_ATINGIDO/);
});
test('reconciliação soma ordens secundárias e compras IPO e ignora devoluções',()=>{
 const q=all(quota);
 assert.match(q,/tipo: 'IPO'/);
 assert.doesNotMatch(q,/tipo: 'IPO_RETURN'/);
 assert.match(q,/ordensSecundario \|\| 0\) \+ Number\(comprasIPO \|\| 0/);
});
test('frontend mostra card para compras IPO e mantém vendas IPO liberadas do bloqueio',()=>{
 const m=all(modal);
 assert.match(m,/ipoEncerrado \|\| modo === 'compra'/);
 assert.match(m,/\{\(ipoEncerrado \|\| modo === 'compra'\) && usuario/);
 assert.doesNotMatch(m,/\(ipoEncerrado \|\| modo === 'venda'\)/);
});
