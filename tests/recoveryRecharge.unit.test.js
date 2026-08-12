const test = require('node:test');
const assert = require('node:assert/strict');
const {
  brlCentsForTs,
  maxRechargeForPatrimony,
  validateAmount,
} = require('../services/recoveryRechargeService');
const {
  performanceForPatrimony,
  stateAfterContribution,
} = require('../utils/rankingPerformance');

test('conversão é linear: T$ 100 custam R$ 5 e T$ 1.000 custam R$ 50', () => {
  assert.equal(brlCentsForTs(100), 500);
  assert.equal(brlCentsForTs(1000), 5000);
});

test('limite dinâmico usa a diferença até T$ 1.000 e respeita passos de T$ 10', () => {
  assert.equal(maxRechargeForPatrimony(630), 370);
  assert.equal(maxRechargeForPatrimony(633.25), 360);
  assert.equal(maxRechargeForPatrimony(900), 100);
  assert.equal(maxRechargeForPatrimony(900.01), 90);
});

test('quantidade mínima é T$ 100 e não pode ultrapassar o limite atual', () => {
  assert.equal(validateAmount(250, 370), 250);
  assert.throws(() => validateAmount(90, 370), /T\$ 100/);
  assert.throws(() => validateAmount(380, 370), /limite atual/);
});

test('recarga preserva a rentabilidade imediatamente após o aporte', () => {
  const user = {
    capitalInicial: 1000,
    temporadaRanking: '2026',
    rankingPerformance: {
      temporadaChave: '2026',
      fatorFechado: 1,
      patrimonioReferencia: 1000,
      aportesExternosTotal: 0,
    },
  };
  assert.equal(performanceForPatrimony(user, 300, '2026').rentabilidade, -70);
  user.rankingPerformance = stateAfterContribution({
    user,
    patrimonyBefore: 300,
    amount: 700,
    season: '2026',
  });
  assert.equal(performanceForPatrimony(user, 1000, '2026').rentabilidade, -70);
});

test('exemplo aprovado: perda de 70% seguida de ganho de 20% resulta em -64%', () => {
  const user = {
    capitalInicial: 1000,
    temporadaRanking: '2026',
    rankingPerformance: {
      temporadaChave: '2026',
      fatorFechado: 0.3,
      patrimonioReferencia: 1000,
      aportesExternosTotal: 700,
    },
  };
  const performance = performanceForPatrimony(user, 1200, '2026');
  assert.equal(performance.rentabilidade, -64);
  assert.equal(performance.resultado, -500);
});
