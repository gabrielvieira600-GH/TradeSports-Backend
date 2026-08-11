const test = require('node:test');
const assert = require('node:assert/strict');
const { pricesFor } = require('../utils/institutionalPricing');

test('distribuição primária usa o valor oficial no tick de T$ 0,05', () => {
  const result = pricesFor({ sellMarginPct: 0.02, buyDiscountPct: 0.04 }, 10.39);
  assert.deepEqual(result, {
    officialPrice: 10.4,
    primaryAsk: 10.4,
    resaleAsk: 10.65,
    bid: 9.95,
  });
});

test('margem existe somente na revenda e recompra continua com deságio', () => {
  const result = pricesFor({ sellMarginPct: 0.02, buyDiscountPct: 0.04 }, 8.98);
  assert.equal(result.officialPrice, 9);
  assert.equal(result.primaryAsk, 9);
  assert.equal(result.resaleAsk, 9.2);
  assert.equal(result.bid, 8.6);
});
