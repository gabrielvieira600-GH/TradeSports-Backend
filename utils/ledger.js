const crypto = require('crypto');
const path = require('path');

const storage = require('./storage');
const audit = require('./audit');

const DATA_DIR = path.join(__dirname, '..', 'data');
const JOURNAL_PATH = path.join(DATA_DIR, 'ledger_journal.json');
const IDEM_PATH = path.join(DATA_DIR, 'ledger_idem.json');
const FIN_TX_PATH = path.join(DATA_DIR, 'financeiro_transacoes.json');

function nowIso() { return new Date().toISOString(); }
function genId(prefix = 'je') {
  const rand = crypto.randomBytes(6).toString('hex');
  return `${prefix}_${Date.now()}_${rand}`;
}
function normalizeLine(line) {
  const account = String(line.account || '').trim();
  const debit = Number(line.debit || 0);
  const credit = Number(line.credit || 0);
  if (!account) throw Object.assign(new Error('Linha sem account'), { code: 'LEDGER_BAD_LINE' });
  if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) throw Object.assign(new Error('Linha deve ter debit OU credit'), { code: 'LEDGER_BAD_LINE' });
  if (debit < 0 || credit < 0) throw Object.assign(new Error('Valores negativos não permitidos'), { code: 'LEDGER_BAD_LINE' });
  return { account, debit, credit };
}
function sumLines(lines) {
  let deb = 0, cred = 0;
  for (const l of lines) { deb += Number(l.debit || 0); cred += Number(l.credit || 0); }
  deb = Math.round(deb * 100) / 100; cred = Math.round(cred * 100) / 100;
  return { deb, cred };
}
function ensureBalanced(lines) {
  const { deb, cred } = sumLines(lines);
  if (deb !== cred) {
    const e = new Error(`Lançamento desbalanceado: deb=${deb} cred=${cred}`);
    e.code = 'LEDGER_UNBALANCED';
    e.meta = { deb, cred };
    throw e;
  }
}
function computeUserDeltas(lines) {
  const deltas = {};
  for (const l of lines) {
    const m = /^user:(.+)$/.exec(l.account);
    if (!m) continue;
    const userId = String(m[1]);
    const delta = Number(l.debit || 0) - Number(l.credit || 0);
    deltas[userId] = (deltas[userId] || 0) + delta;
  }
  for (const k of Object.keys(deltas)) deltas[k] = Math.round(deltas[k] * 100) / 100;
  return deltas;
}
async function postJournal({ action, lines, meta = {}, idemKey = null, applyToUsuarios = null }) {
  if (!action) throw Object.assign(new Error('action obrigatório'), { code: 'LEDGER_NO_ACTION' });
  const normalized = (lines || []).map(normalizeLine);
  ensureBalanced(normalized);
  const journal = storage.readJSON(JOURNAL_PATH, []);
  const idem = storage.readJSON(IDEM_PATH, {});
  if (idemKey) {
    const hit = idem[String(idemKey)];
    if (hit) return { idemHit: true, entry: hit };
  }
  const entryId = genId('je');
  const entry = { id: entryId, at: nowIso(), action: String(action), lines: normalized, meta };
  journal.push(entry);
  await storage.writeJSON(JOURNAL_PATH, journal);
  if (idemKey) {
    idem[String(idemKey)] = { entryId, at: entry.at, action: entry.action };
    await storage.writeJSON(IDEM_PATH, idem);
  }
  if (applyToUsuarios?.usuariosPath) {
    const usuarios = storage.readJSON(applyToUsuarios.usuariosPath, []);
    const deltas = computeUserDeltas(entry.lines);
    for (const [userId, delta] of Object.entries(deltas)) {
      const ix = usuarios.findIndex((u) => String(u.id) === String(userId));
      if (ix >= 0) {
        const before = Number(usuarios[ix].saldo || 0);
        const after = Math.round((before + Number(delta || 0)) * 100) / 100;
        usuarios[ix].saldo = after;
        if (!Array.isArray(usuarios[ix].ledgerMirror)) usuarios[ix].ledgerMirror = [];
        usuarios[ix].ledgerMirror.push({ at: entry.at, entryId, action: entry.action, delta, saldoAntes: before, saldoDepois: after });
        if (usuarios[ix].ledgerMirror.length > 200) usuarios[ix].ledgerMirror = usuarios[ix].ledgerMirror.slice(-200);
      }
    }
    await storage.writeJSON(applyToUsuarios.usuariosPath, usuarios);
  }
  audit.logEvent({ kind: 'LEDGER', action: 'POST_JOURNAL', meta: { action, idemKey, entryId, linesCount: normalized.length } });
  return { idemHit: false, entry };
}
function buildTradeEntry({ buyerId, sellerId, clubeId, qty, price, buyerFee = 0, sellerFee = 0, buyerRole = null, sellerRole = null, makerFeePct = null, takerFeePct = null }) {
  const total = Math.round(Number(qty) * Number(price) * 100) / 100;
  const bf = Math.round(Number(buyerFee || 0) * 100) / 100;
  const sf = Math.round(Number(sellerFee || 0) * 100) / 100;
  const lines = [
    { account: `user:${buyerId}`, credit: total + bf },
    { account: `user:${sellerId}`, debit: Math.round((total - sf) * 100) / 100 }
  ];
  if (bf > 0) {
    lines.push(
      { account: 'platform:revenue:fees', debit: bf },
      { account: 'platform:equity', credit: bf }
    );
  }
  if (sf > 0) {
    lines.push(
      { account: 'platform:revenue:fees', debit: sf },
      { account: 'platform:equity', credit: sf }
    );
  }
  ensureBalanced(lines);
  return { action: 'TRADE_EXEC', lines, meta: { buyerId, sellerId, clubeId: Number(clubeId), qty: Number(qty), price: Number(price), total, buyerFee: bf, sellerFee: sf, buyerRole, sellerRole, makerFeePct, takerFeePct } };
}
function buildDepositPendingEntry({ userId, amount, provider = 'manual', txId }) {
  const v = Math.round(Number(amount || 0) * 100) / 100;
  const lines = [{ account: 'platform:deposits:pending', debit: v }, { account: 'platform:equity', credit: v }];
  ensureBalanced(lines);
  return { action: 'DEPOSIT_PENDING', lines, meta: { userId, amount: v, provider, txId } };
}
function buildDepositConfirmEntry({ userId, amount, provider = 'manual', txId, gatewayReference = null }) {
  const v = Math.round(Number(amount || 0) * 100) / 100;
  const lines = [
    { account: 'platform:cash', debit: v },
    { account: `user:${userId}`, debit: v },
    { account: 'platform:deposits:pending', credit: v },
    { account: 'platform:liability:users', credit: v }
  ];
  ensureBalanced(lines);
  return { action: 'DEPOSIT_CONFIRMED', lines, meta: { userId, amount: v, provider, txId, gatewayReference } };
}
function buildDepositReversalEntry({ userId, amount, provider = 'manual', txId, gatewayReference = null }) {
  const v = Math.round(Number(amount || 0) * 100) / 100;
  const lines = [
    { account: 'platform:equity', debit: v },
    { account: 'platform:deposits:pending', credit: v }
  ];
  ensureBalanced(lines);
  return { action: 'DEPOSIT_REVERSED', lines, meta: { userId, amount: v, provider, txId, gatewayReference } };
}
function buildWithdrawPendingEntry({ userId, amount, fee = 0, provider = 'manual', txId }) {
  const v = Math.round(Number(amount || 0) * 100) / 100;
  const f = Math.round(Number(fee || 0) * 100) / 100;
  const lines = [
    { account: 'platform:withdrawals:pending', debit: v },
    { account: `user:${userId}`, credit: v + f },
    { account: 'platform:liability:users', debit: v + f },
    { account: 'platform:equity', credit: v }
  ];
  if (f > 0) lines.push({ account: 'platform:revenue:fees', debit: f });
  ensureBalanced(lines);
  return { action: 'WITHDRAW_PENDING', lines, meta: { userId, amount: v, fee: f, provider, txId } };
}
function buildWithdrawConfirmEntry({ userId, amount, fee = 0, provider = 'manual', txId, gatewayReference = null }) {
  const v = Math.round(Number(amount || 0) * 100) / 100;
  const f = Math.round(Number(fee || 0) * 100) / 100;
  const lines = [
    { account: 'platform:equity', debit: v },
    { account: 'platform:cash', credit: v },
    { account: 'platform:withdrawals:pending', credit: v }
  ];
  if (f > 0) lines.push({ account: 'platform:equity', debit: f }, { account: 'platform:cash', credit: f });
  ensureBalanced(lines);
  return { action: 'WITHDRAW_CONFIRMED', lines, meta: { userId, amount: v, fee: f, provider, txId, gatewayReference } };
}
function buildWithdrawCancelEntry({ userId, amount, fee = 0, provider = 'manual', txId, gatewayReference = null }) {
  const v = Math.round(Number(amount || 0) * 100) / 100;
  const f = Math.round(Number(fee || 0) * 100) / 100;
  const lines = [
    { account: `user:${userId}`, debit: v + f },
    { account: 'platform:withdrawals:pending', credit: v },
    { account: 'platform:liability:users', credit: v + f },
    { account: 'platform:equity', debit: v }
  ];
  if (f > 0) lines.push({ account: 'platform:revenue:fees', credit: f });
  ensureBalanced(lines);
  return { action: 'WITHDRAW_CANCELLED', lines, meta: { userId, amount: v, fee: f, provider, txId, gatewayReference } };
}
function genFinancialTxId() { return genId('ftx'); }
function readFinancialTx() { return storage.readJSON(FIN_TX_PATH, []); }
async function writeFinancialTx(list) { return storage.writeJSON(FIN_TX_PATH, Array.isArray(list) ? list : []); }
function createFinancialTx({ tipo, usuarioId, valorBruto, taxa = 0, gateway = 'manual', gatewayReference = null, status = 'PENDENTE', metadata = {} }) {
  const valor = Math.round(Number(valorBruto || 0) * 100) / 100;
  const taxaNum = Math.round(Number(taxa || 0) * 100) / 100;
  const valorLiquido = Math.round((valor - taxaNum) * 100) / 100;
  const now = nowIso();
  return { id: genFinancialTxId(), tipo: String(tipo), usuarioId: String(usuarioId), valorBruto: valor, taxa: taxaNum, valorLiquido, status, gateway, gatewayReference, reconciliacaoStatus: 'PENDENTE', reconciliadoEm: null, divergenceReason: null, ledgerEntryIds: [], metadata, createdAt: now, updatedAt: now };
}
function findFinancialTxByGatewayReference(gatewayReference) {
  if (!gatewayReference) return null;
  const txs = readFinancialTx();
  return txs.find(tx => String(tx.gatewayReference || '') === String(gatewayReference)) || null;
}
async function updateFinancialTx(transacaoId, updater) {
  const txs = readFinancialTx();
  const ix = txs.findIndex(t => String(t.id) === String(transacaoId));
  if (ix < 0) return null;
  const next = typeof updater === 'function' ? updater(txs[ix]) : { ...txs[ix], ...updater };
  txs[ix] = { ...next, updatedAt: nowIso() };
  await writeFinancialTx(txs);
  return txs[ix];
}
function reconcileFinancialTx(finTx, journal = []) {
  const ids = Array.isArray(finTx.ledgerEntryIds) ? finTx.ledgerEntryIds : [];
  const found = ids.filter(id => journal.some(j => String(j.id) === String(id)));
  if ((finTx.status === 'CONFIRMADO' || finTx.status === 'ESTORNADO' || finTx.status === 'CANCELADO' || finTx.status === 'FALHOU') && found.length === 0) return { status: 'DIVERGENTE', reason: 'Transação final sem ledger' };
  if ((finTx.status === 'PENDENTE' || finTx.status === 'PROCESSANDO') && found.length > 2) return { status: 'DIVERGENTE', reason: 'Pendência com lançamentos excessivos' };
  return { status: 'RECONCILIADO', reason: null };
}
function registrarSplit({ clubeId, ratio }) {
  registrarNoLedger({
    tipo: 'STOCK_SPLIT_EXEC',
    clubeId,
    ratio,
    descricao: `Split ${ratio}:1 aplicado no clube ${clubeId}`
  });
}
module.exports = {
  postJournal,
  buildTradeEntry,
  buildDepositPendingEntry,
  buildDepositConfirmEntry,
  buildDepositReversalEntry,
  buildWithdrawPendingEntry,
  buildWithdrawConfirmEntry,
  buildWithdrawCancelEntry,
  genFinancialTxId,
  readFinancialTx,
  writeFinancialTx,
  createFinancialTx,
  findFinancialTxByGatewayReference,
  updateFinancialTx,
  reconcileFinancialTx,
  registrarSplit,
  paths: { JOURNAL_PATH, IDEM_PATH, FIN_TX_PATH },
  _internals: { normalizeLine, ensureBalanced, computeUserDeltas },
};