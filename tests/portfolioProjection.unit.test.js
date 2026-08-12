'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  movementDirection,
  portfoliosEqual,
  projectPortfolioFromMovements,
} = require('../services/portfolioProjection');

test('uma única compra continua sendo uma única posição em leituras repetidas', () => {
  const movements = [
    {
      _id: 'execucao-1',
      tipo: 'COMPRA',
      clubeLegacyId: 127,
      clubeNome: 'Flamengo',
      quantidade: 7,
      precoUnitario: 10.9,
      totalPago: 76.68,
    },
  ];

  const firstRead = projectPortfolioFromMovements(movements);
  const secondRead = projectPortfolioFromMovements(movements);

  assert.deepEqual(firstRead, secondRead);
  assert.deepEqual(firstRead, [
    {
      clubeId: 127,
      nomeClube: 'Flamengo',
      quantidade: 7,
      precoMedio: 10.9,
      totalInvestido: 76.3,
    },
  ]);
});

test('a projeção ignora a carteira persistida corrompida e usa somente execuções', () => {
  const corruptedPortfolio = [
    {
      clubeId: 127,
      nomeClube: 'Flamengo',
      quantidade: 42,
      precoMedio: 10.95,
      totalInvestido: 459.9,
    },
  ];
  const canonical = projectPortfolioFromMovements([
    {
      tipo: 'COMPRA',
      clubeLegacyId: 127,
      clubeNome: 'Flamengo',
      quantidade: 7,
      precoUnitario: 10.9,
    },
  ]);

  assert.equal(portfoliosEqual(corruptedPortfolio, canonical), false);
  assert.equal(canonical[0].quantidade, 7);
});

test('compras e vendas recompõem quantidade e preço médio sem incluir taxas', () => {
  const canonical = projectPortfolioFromMovements([
    {
      tipo: 'IPO',
      clubeLegacyId: 127,
      clubeNome: 'Flamengo',
      quantidade: 5,
      precoUnitario: 10,
    },
    {
      tipo: 'COMPRA_SECUNDARIO',
      clubeLegacyId: 127,
      clubeNome: 'Flamengo',
      quantidade: 5,
      precoUnitario: 12,
      totalPago: 60.3,
    },
    {
      tipo: 'VENDA',
      clubeLegacyId: 127,
      clubeNome: 'Flamengo',
      quantidade: 3,
      precoUnitario: 13,
    },
  ]);

  assert.deepEqual(canonical, [
    {
      clubeId: 127,
      nomeClube: 'Flamengo',
      quantidade: 7,
      precoMedio: 11,
      totalInvestido: 77,
    },
  ]);
});

test('movimentos financeiros não criam posições e liquidação zera a posição', () => {
  const canonical = projectPortfolioFromMovements([
    { tipo: 'DEPOSITO', quantidade: 1000, precoUnitario: 1 },
    {
      tipo: 'IPO',
      clubeLegacyId: 127,
      clubeNome: 'Flamengo',
      quantidade: 7,
      precoUnitario: 10.9,
    },
    {
      tipo: 'LIQUIDAÇÃO',
      clubeLegacyId: 127,
      clubeNome: 'Flamengo',
      quantidade: 7,
      precoUnitario: 15,
    },
  ]);

  assert.deepEqual(canonical, []);
  assert.equal(movementDirection('DIVIDENDO'), null);
});

test('resolve o legacyId pelo ObjectId do clube quando necessário', () => {
  const clubMongoId = '66aabbccddeeff0011223344';
  const canonical = projectPortfolioFromMovements(
    [
      {
        tipo: 'IPO',
        clubeId: clubMongoId,
        clubeNome: 'Flamengo',
        quantidade: 7,
        precoUnitario: 10.9,
      },
    ],
    {
      clubLegacyIdByMongoId: new Map([[clubMongoId, 127]]),
    },
  );

  assert.equal(canonical[0].clubeId, 127);
  assert.equal(canonical[0].quantidade, 7);
});
