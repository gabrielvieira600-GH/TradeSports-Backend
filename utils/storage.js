// utils/storage.js
// Storage JSON descontinuado após migração para Mongo.
// Se algum código chamar readJSON/writeJSON/updateJSON, ainda existe trecho legado a migrar.

function legacyJsonStorageError(method) {
  const err = new Error(
    `[storage.${method}] foi chamado, mas o storage JSON foi descontinuado. ` +
      'Migre este fluxo para Mongo antes de usar em produção.'
  );

  err.code = 'LEGACY_JSON_STORAGE_DISABLED';
  throw err;
}

function readJSON() {
  return legacyJsonStorageError('readJSON');
}

async function writeJSON() {
  return legacyJsonStorageError('writeJSON');
}

async function updateJSON() {
  return legacyJsonStorageError('updateJSON');
}

module.exports = {
  readJSON,
  writeJSON,
  updateJSON,
};