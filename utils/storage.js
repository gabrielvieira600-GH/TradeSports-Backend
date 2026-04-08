// backend/utils/storage.js
// CAMADA 8: I/O consistente para JSON
// - Leitura com fallback
// - Escrita atômica (temp + rename)
// - Mutex em memória por caminho (mesmo processo)
// Obs: para MVP, isso é suficiente; snapshots/rollback são feitos via utils/tx.js

const fs = require('fs');
const path = require('path');

const locks = new Map();

function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.catch(() => {}));
  return next;
}

function readJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSONAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  // Windows não sobrescreve rename: remove destino antes
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
  fs.renameSync(tmp, filePath);
}

async function updateJSON(filePath, fallback, updater) {
  return withLock(filePath, async () => {
    const current = readJSON(filePath, fallback);
    const updated = await updater(current);
    writeJSONAtomic(filePath, updated);
    return updated;
  });
}

async function writeJSON(filePath, data) {
  return withLock(filePath, async () => {
    writeJSONAtomic(filePath, data);
    return true;
  });
}

module.exports = { readJSON, writeJSON, updateJSON };
