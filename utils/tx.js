// backend/utils/tx.js
// CAMADA 7/8 — Transaction wrapper + snapshots + invariants
const fs = require('fs');
const path = require('path');
const storage = require('./storage');
const audit = require('./audit');

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function snapshotDirName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function makeSnapshot(files, dataDir) {
  const snapRoot = path.join(dataDir, '_snapshots', snapshotDirName());
  ensureDir(snapRoot);
  for (const f of files) {
    const dest = path.join(snapRoot, path.basename(f));
    try {
      if (fs.existsSync(f)) fs.copyFileSync(f, dest);
      else fs.writeFileSync(dest, '[]', 'utf8');
    } catch (e) {
      audit.logEvent({ kind: 'TX', action: 'SNAPSHOT_FAIL', file: f, error: String(e) });
    }
  }
  return snapRoot;
}

function restoreSnapshot(snapRoot, files) {
  for (const f of files) {
    const src = path.join(snapRoot, path.basename(f));
    if (fs.existsSync(src)) {
      try { fs.copyFileSync(src, f); } catch (_) {}
    }
  }
}

function validateInvariants(state) {
  const usuarios = state.usuarios || [];
  const ordens = state.ordens || [];
  for (const u of usuarios) {
    if (Number(u.saldo || 0) < 0) return { ok: false, reason: 'SALDO_NEGATIVO', userId: u.id, saldo: u.saldo };
    if (Array.isArray(u.carteira)) {
      for (const a of u.carteira) {
        if (Number(a.quantidade || 0) < 0) return { ok: false, reason: 'CARTEIRA_QTD_NEGATIVA', userId: u.id, clubeId: a.clubeId, quantidade: a.quantidade };
        if (Number(a.totalInvestido || 0) < 0) return { ok: false, reason: 'CARTEIRA_INV_NEGATIVO', userId: u.id, clubeId: a.clubeId, totalInvestido: a.totalInvestido };
      }
    }
  }
  for (const o of ordens) {
    if (Number(o.quantidade || 0) < 0) return { ok: false, reason: 'ORDEM_QTD_NEGATIVA', ordemId: o.id };
    if (Number(o.restante || 0) < 0) return { ok: false, reason: 'ORDEM_RESTANTE_NEGATIVO', ordemId: o.id };
  }
  return { ok: true };
}

async function runTx({ files, fallbacks, mutate, dataDir, action, meta }) {
  const uniqueFiles = Array.from(new Set(files));
  const state = {};

  for (const f of uniqueFiles) {
    const key = path.basename(f, '.json');
    state[key] = storage.readJSON(f, (fallbacks && fallbacks[key]) ?? []);
  }

  let next;
  try {
    next = await mutate(state);
  } catch (e) {
    audit.logEvent({ kind: 'TX', action: 'MUTATE_FAIL', txAction: action, error: String(e), meta });
    throw e;
  }

  const inv = validateInvariants(next || state);
  if (!inv.ok) {
    audit.logEvent({ kind: 'TX', action: 'INVARIANT_FAIL', txAction: action, inv, meta });
    const err = new Error(`Invariante falhou: ${inv.reason}`);
    err.code = 'INVARIANT_FAIL';
    err.inv = inv;
    throw err;
  }

  const snap = makeSnapshot(uniqueFiles, dataDir);
  audit.logEvent({ kind: 'TX', action: 'SNAPSHOT_OK', txAction: action, snapshot: snap, meta });

  try {
    for (const f of uniqueFiles) {
      const key = path.basename(f, '.json');
      await storage.writeJSON(f, (next || state)[key]);
    }
    audit.logEvent({ kind: 'TX', action: 'COMMIT_OK', txAction: action, meta });
    return next || state;
  } catch (e) {
    audit.logEvent({ kind: 'TX', action: 'COMMIT_FAIL', txAction: action, error: String(e), snapshot: snap, meta });
    restoreSnapshot(snap, uniqueFiles);
    audit.logEvent({ kind: 'TX', action: 'ROLLBACK_DONE', txAction: action, snapshot: snap, meta });
    throw e;
  }
}

module.exports = { runTx, validateInvariants };
