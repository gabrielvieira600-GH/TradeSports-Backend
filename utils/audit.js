// backend/utils/audit.js
// CAMADA 6/8 — Auditoria operacional (JSON rotativo)
const fs = require('fs');
const path = require('path');

const auditPath = path.join(__dirname, '../data/audit_logs.json');

function safeReadJSON(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8') || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function safeWriteJSON(p, data) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
  fs.renameSync(tmp, p);
}

function logEvent(evt) {
  const logs = safeReadJSON(auditPath, []);
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ts: new Date().toISOString(),
    ...evt,
  };
  logs.push(entry);
  const MAX = 5000;
  if (logs.length > MAX) logs.splice(0, logs.length - MAX);
  safeWriteJSON(auditPath, logs);
  return entry;
}

function readRecent(limit = 50) {
  const logs = safeReadJSON(auditPath, []);
  return logs.slice(-Math.max(1, Number(limit) || 50)).reverse();
}

module.exports = { logEvent, readRecent, auditPath };
