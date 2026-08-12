const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BACKED_UP_COLLECTIONS,
  CLEARED_COLLECTIONS,
  INITIAL_BALANCE,
  RESET_CONFIRMATION,
  RESTORE_CONFIRMATION,
  backupCollectionName,
  backupIdFor,
  humanUserFilter,
  institutionalUserFilter,
  resetTestEnvironment,
  restoreTestEnvironment,
} = require('../services/testEnvironmentReset');

test('o saldo inicial do reset é T$ 1.000', () => {
  assert.equal(INITIAL_BALANCE, 1000);
});

test('reset e restauração exigem frases diferentes', () => {
  assert.equal(RESET_CONFIRMATION, 'RESETAR_AMBIENTE_DE_TESTES');
  assert.equal(RESTORE_CONFIRMATION, 'RESTAURAR_BACKUP_DE_TESTES');
  assert.notEqual(RESET_CONFIRMATION, RESTORE_CONFIRMATION);
});

test('contas humanas e institucionais usam filtros separados', () => {
  assert.deepEqual(humanUserFilter(), {
    'metadata.accountType': { $ne: 'INSTITUTIONAL' },
  });
  assert.deepEqual(institutionalUserFilter(), {
    'metadata.accountType': 'INSTITUTIONAL',
  });
});

test('toda coleção apagada também é incluída no backup', () => {
  for (const collectionName of CLEARED_COLLECTIONS) {
    assert.ok(BACKED_UP_COLLECTIONS.includes(collectionName));
  }
});

test('identificadores e coleções de backup permanecem isolados', () => {
  const id = backupIdFor(new Date('2026-08-12T14:05:06.123Z'));
  assert.match(id, /^20260812140506123-[a-f0-9]{6}$/);
  assert.equal(
    backupCollectionName(id, 'users'),
    `test_reset_backup_${id}__users`
  );
});

test('o reset rejeita confirmação incorreta antes de acessar o banco', async () => {
  await assert.rejects(
    resetTestEnvironment({}, { confirmation: 'RESETAR' }),
    (error) => error.status === 400 && error.code === 'INVALID_RESET_CONFIRMATION'
  );
});

test('a restauração rejeita confirmação incorreta antes de acessar o banco', async () => {
  await assert.rejects(
    restoreTestEnvironment({}, { backupId: 'qualquer', confirmation: 'RESTAURAR' }),
    (error) => error.status === 400 && error.code === 'INVALID_RESTORE_CONFIRMATION'
  );
});
