const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadCachedTable,
  marketFilter,
  toCachedTableItem,
} = require('../services/sportsTableCache');

test('converte clube salvo em item compatível com a tabela de mercado', () => {
  const item = toCachedTableItem({
    legacyId: 10,
    nome: 'Clube Teste',
    escudo: 'escudo.svg',
    posicao: 3,
    preco: 10.5,
    precoAtual: 11,
    cotasDisponiveis: 1000,
    cotasEmitidas: 0,
    ipoEncerrado: false,
    metadata: {
      classificacao: {
        pontos: 30,
        jogos: 15,
        vitorias: 9,
        empates: 3,
        derrotas: 3,
        saldo: 12,
      },
    },
  });

  assert.deepEqual(item, {
    id: 10,
    legacyId: 10,
    nome: 'Clube Teste',
    escudo: 'escudo.svg',
    posicao: 3,
    pontos: 30,
    jogos: 15,
    vitorias: 9,
    empates: 3,
    derrotas: 3,
    saldo: 12,
    saldoGols: 12,
    grupo: '',
    preco: 10.5,
    precoAtual: 11,
    cotasDisponiveis: 1000,
    cotasEmitidas: 0,
    ipoEncerrado: false,
  });
});

test('mercados adicionais são isolados pelo identificador da liga', () => {
  assert.deepEqual(marketFilter('premier-league'), {
    'metadata.ligaId': 'premier-league',
  });
});

test('Brasileirão aceita os clubes legados que ainda não possuem ligaId', () => {
  const filter = marketFilter('brasileirao-a');
  assert.ok(Array.isArray(filter.$or));
  assert.equal(filter.$or[0]['metadata.ligaId'], 'brasileirao-a');
  assert.equal(filter.$or[2].$and[1].legacyId.$lt, 1000000);
});

test('cache inclui clube legado sem posição no fim da tabela', async () => {
  const docs = [
    { legacyId: 1, nome: 'Primeiro', posicao: 1, preco: 10 },
    { legacyId: 2, nome: 'Sem posição', posicao: null, preco: 5 },
  ];
  const ClubModel = {
    find() {
      return {
        sort() {
          return { lean: async () => docs };
        },
      };
    },
  };

  const table = await loadCachedTable(ClubModel, 'brasileirao-a');
  assert.equal(table.length, 2);
  assert.equal(table[1].posicao, 2);
});
