const test = require('node:test');
const assert = require('node:assert/strict');
const { pricesFor } = require('../utils/institutionalPricing');

test('preço institucional usa margem, deságio e tick de T$ 0,05', () => {
  const result = pricesFor({ sellMarginPct: 0.02, buyDiscountPct: 0.04 }, 10.39);
  assert.deepEqual(result, { ask: 10.6, bid: 9.95 });
});

test('arredondamento protege a venda para cima e a recompra para baixo', () => {
  const result = pricesFor({ sellMarginPct: 0.02, buyDiscountPct: 0.04 }, 8.98);
  assert.equal(result.ask, 9.2);
  assert.equal(result.bid, 8.6);
});
