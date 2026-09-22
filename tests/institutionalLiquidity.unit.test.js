const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pricesFor,
  positionReferenceForClub,
  userOrderPriceBand,
  isUserOrderPriceAllowed,
  canReachInstitutionAfterUserOrders,
} = require('../utils/institutionalPricing');

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

test('preço institucional acompanha a posição esportiva e não o último negócio', () => {
  const club = {
    posicao: 6,
    preco: 10.45,
    precoAtual: 7.75,
    metadata: { totalParticipantes: 20 },
  };

  assert.equal(positionReferenceForClub(club), 9.9);
});

test('ordens de usuários respeitam faixa simétrica de 10% da referência', () => {
  const state = { userOrderBandPct: 0.10 };
  const referencePrice = 11.45;

  assert.deepEqual(userOrderPriceBand(state, referencePrice), {
    bandPct: 0.10,
    min: 10.35,
    max: 12.55,
  });
  assert.equal(isUserOrderPriceAllowed(11.8, state, referencePrice), true);
  assert.equal(isUserOrderPriceAllowed(12.6, state, referencePrice), false);
  assert.equal(isUserOrderPriceAllowed(10.3, state, referencePrice), false);
});

test('instituição só é alcançada depois de todas as vendas de usuários', () => {
  const userOrders = [
    { usuarioId: 'seller-a', preco: 11.8, restante: 10 },
    { usuarioId: 'seller-b', preco: 11.9, restante: 5 },
  ];

  assert.equal(canReachInstitutionAfterUserOrders({
    incomingType: 'compra', incomingPrice: 11.9, incomingQuantity: 20,
    incomingUserId: 'buyer', userOrders,
  }), true);
  assert.equal(canReachInstitutionAfterUserOrders({
    incomingType: 'compra', incomingPrice: 11.85, incomingQuantity: 20,
    incomingUserId: 'buyer', userOrders,
  }), false);
  assert.equal(canReachInstitutionAfterUserOrders({
    incomingType: 'compra', incomingPrice: 11.9, incomingQuantity: 14,
    incomingUserId: 'buyer', userOrders,
  }), false);
});

test('prioridade dos usuários também vale para ordens de compra', () => {
  const userOrders = [
    { usuarioId: 'buyer-a', preco: 9.5, restante: 4 },
    { usuarioId: 'buyer-b', preco: 9.4, restante: 3 },
  ];

  assert.equal(canReachInstitutionAfterUserOrders({
    incomingType: 'venda', incomingPrice: 9.4, incomingQuantity: 8,
    incomingUserId: 'seller', userOrders,
  }), true);
  assert.equal(canReachInstitutionAfterUserOrders({
    incomingType: 'venda', incomingPrice: 9.45, incomingQuantity: 8,
    incomingUserId: 'seller', userOrders,
  }), false);
});
