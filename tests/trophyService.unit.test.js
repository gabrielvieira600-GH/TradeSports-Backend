const test = require('node:test');
const assert = require('node:assert/strict');

const {
  chaveSemana,
  chaveMes,
  chavePeriodoAnterior,
  labelPeriodo,
  intervaloPeriodo,
} = require('../services/trophyService');

test('gera chaves semanais ISO no fuso de São Paulo', () => {
  assert.equal(chaveSemana(new Date('2026-08-11T15:00:00.000Z')), '2026-W33');
  assert.equal(chaveSemana(new Date('2026-01-01T15:00:00.000Z')), '2026-W01');
});

test('gera chave e label mensal em português', () => {
  const data = new Date('2026-08-11T15:00:00.000Z');
  assert.equal(chaveMes(data), '2026-08');
  assert.equal(labelPeriodo('mes', '2026-08'), 'agosto de 2026');
});

test('identifica os períodos imediatamente anteriores', () => {
  const data = new Date('2026-08-11T15:00:00.000Z');
  assert.equal(chavePeriodoAnterior('semana', data), '2026-W32');
  assert.equal(chavePeriodoAnterior('mes', data), '2026-07');
});

test('formata semana e temporada para a descrição do troféu', () => {
  assert.equal(labelPeriodo('semana', '2026-W33'), 'Semana 33 de 2026');
  assert.equal(
    labelPeriodo('temporada', 'br-2026', { nome: 'Temporada 2026' }),
    'Temporada 2026'
  );
});

test('calcula os limites de semana e mês no fuso da aplicação', () => {
  const semana = intervaloPeriodo('semana', '2026-W33');
  assert.equal(semana.inicio.toISOString(), '2026-08-10T03:00:00.000Z');
  assert.equal(semana.fimExclusivo.toISOString(), '2026-08-17T03:00:00.000Z');

  const mes = intervaloPeriodo('mes', '2026-08');
  assert.equal(mes.inicio.toISOString(), '2026-08-01T03:00:00.000Z');
  assert.equal(mes.fimExclusivo.toISOString(), '2026-09-01T03:00:00.000Z');
});
