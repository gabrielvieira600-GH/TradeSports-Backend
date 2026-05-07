const crypto = require('crypto');

const mongoose = require('mongoose');

const audit = require('./audit');

const LedgerEntrySchema = new mongoose.Schema(

  {

    id: { type: String, unique: true, index: true },

    at: { type: Date, default: Date.now, index: true },

    action: { type: String, required: true, index: true },

    lines: [

      {

        account: { type: String, required: true },

        debit: { type: Number, default: 0 },

        credit: { type: Number, default: 0 },

      },

    ],

    meta: { type: mongoose.Schema.Types.Mixed, default: {} },

  },

  {

    collection: 'ledger_entries',

    versionKey: false,

  }

);

const LedgerIdemSchema = new mongoose.Schema(

  {

    key: { type: String, unique: true, index: true },

    scope: { type: String, default: 'ledger', index: true },

    userId: { type: String, default: null, index: true },

    entryId: { type: String, default: null },

    at: { type: Date, default: Date.now },

    action: { type: String, default: null },

    status: { type: Number, default: null },

    body: { type: mongoose.Schema.Types.Mixed, default: null },

    expiresAt: { type: Date, default: null, index: true },

  },

  {

    collection: 'ledger_idempotency',

    versionKey: false,

  }

);

LedgerIdemSchema.index(

  { expiresAt: 1 },

  { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } }

);

const FinancialTransactionSchema = new mongoose.Schema(

  {

    id: { type: String, unique: true, index: true },

    tipo: { type: String, required: true, index: true },

    usuarioId: { type: String, required: true, index: true },

    valorBruto: { type: Number, required: true },

    taxa: { type: Number, default: 0 },

    valorLiquido: { type: Number, required: true },

    status: { type: String, default: 'PENDENTE', index: true },

    gateway: { type: String, default: 'manual', index: true },

    gatewayReference: { type: String, default: null, index: true },

    reconciliacaoStatus: { type: String, default: 'PENDENTE', index: true },

    reconciliadoEm: { type: Date, default: null },

    divergenceReason: { type: String, default: null },

    ledgerEntryIds: { type: [String], default: [] },

    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    createdAt: { type: Date, default: Date.now, index: true },

    updatedAt: { type: Date, default: Date.now },

  },

  {

    collection: 'financial_transactions',

    versionKey: false,

  }

);

const LedgerEntry =

  mongoose.models.LedgerEntry || mongoose.model('LedgerEntry', LedgerEntrySchema);

const LedgerIdem =

  mongoose.models.LedgerIdem || mongoose.model('LedgerIdem', LedgerIdemSchema);

const FinancialTransaction =

  mongoose.models.FinancialTransaction ||

  mongoose.model('FinancialTransaction', FinancialTransactionSchema);

function nowIso() {

  return new Date().toISOString();

}

function genId(prefix = 'je') {

  const rand = crypto.randomBytes(6).toString('hex');

  return `${prefix}_${Date.now()}_${rand}`;

}

function round2(n) {

  return Math.round(Number(n || 0) * 100) / 100;

}

function normalizeLine(line) {

  const account = String(line.account || '').trim();

  const debit = Number(line.debit || 0);

  const credit = Number(line.credit || 0);

  if (!account) {

    throw Object.assign(new Error('Linha sem account'), { code: 'LEDGER_BAD_LINE' });

  }

  if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {

    throw Object.assign(new Error('Linha deve ter debit OU credit'), {

      code: 'LEDGER_BAD_LINE',

    });

  }

  if (debit < 0 || credit < 0) {

    throw Object.assign(new Error('Valores negativos não permitidos'), {

      code: 'LEDGER_BAD_LINE',

    });

  }

  return { account, debit, credit };

}

function sumLines(lines) {

  let deb = 0;

  let cred = 0;

  for (const l of lines) {

    deb += Number(l.debit || 0);

    cred += Number(l.credit || 0);

  }

  return { deb: round2(deb), cred: round2(cred) };

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

    deltas[userId] = round2((deltas[userId] || 0) + delta);

  }

  return deltas;

}

async function getHttpIdempotency({ key, userId, session = null }) {

  if (!key || !userId) return null;

  return LedgerIdem.findOne({

    key: String(key),

    scope: 'http',

    userId: String(userId),

  }).session(session || null);

}

async function saveHttpIdempotency({

  key,

  userId,

  status,

  body,

  ttlMs = 10 * 60 * 1000,

  session = null,

}) {

  if (!key || !userId) return null;

  const expiresAt = new Date(Date.now() + ttlMs);

  return LedgerIdem.findOneAndUpdate(

    { key: String(key), scope: 'http', userId: String(userId) },

    {

      $set: {

        key: String(key),

        scope: 'http',

        userId: String(userId),

        status: Number(status),

        body,

        expiresAt,

        at: new Date(),

      },

    },

    { upsert: true, new: true, session }

  );

}

async function postJournal({

  action,

  lines,

  meta = {},

  idemKey = null,

  session = null,

}) {

  if (!action) {

    throw Object.assign(new Error('action obrigatório'), { code: 'LEDGER_NO_ACTION' });

  }

  const normalized = (lines || []).map(normalizeLine);

  ensureBalanced(normalized);

  if (idemKey) {

    const hit = await LedgerIdem.findOne({

      key: String(idemKey),

      scope: 'ledger',

    }).session(session || null);

    if (hit) {

      return {

        idemHit: true,

        entry: {

          id: hit.entryId,

          at: hit.at,

          action: hit.action,

        },

      };

    }

  }

  const entryId = genId('je');

  const entry = {

    id: entryId,

    at: new Date(),

    action: String(action),

    lines: normalized,

    meta,

  };

  if (session) {

    await LedgerEntry.create([entry], { session });

  } else {

    await LedgerEntry.create(entry);

  }

  if (idemKey) {

    await LedgerIdem.findOneAndUpdate(

      { key: String(idemKey), scope: 'ledger' },

      {

        $set: {

          key: String(idemKey),

          scope: 'ledger',

          entryId,

          at: entry.at,

          action: entry.action,

        },

      },

      { upsert: true, new: true, session }

    );

  }

  await audit.logEvent(

    {

      kind: 'LEDGER',

      action: 'POST_JOURNAL',

      meta: { action, idemKey, entryId, linesCount: normalized.length },

    },

    session

  );

  return { idemHit: false, entry };

}

function buildTradeEntry({

  buyerId,

  sellerId,

  clubeId,

  qty,

  price,

  buyerFee = 0,

  sellerFee = 0,

  buyerRole = null,

  sellerRole = null,

  makerFeePct = null,

  takerFeePct = null,

}) {

  const total = round2(Number(qty) * Number(price));

  const bf = round2(buyerFee || 0);

  const sf = round2(sellerFee || 0);

  const lines = [

    { account: `user:${buyerId}`, credit: total + bf },

    { account: `user:${sellerId}`, debit: round2(total - sf) },

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

  return {

    action: 'TRADE_EXEC',

    lines,

    meta: {

      buyerId,

      sellerId,

      clubeId: Number(clubeId),

      qty: Number(qty),

      price: Number(price),

      total,

      buyerFee: bf,

      sellerFee: sf,

      buyerRole,

      sellerRole,

      makerFeePct,

      takerFeePct,

    },

  };

}

function buildDepositPendingEntry({ userId, amount, provider = 'manual', txId }) {

  const v = round2(amount);

  const lines = [

    { account: 'platform:deposits:pending', debit: v },

    { account: 'platform:equity', credit: v },

  ];

  ensureBalanced(lines);

  return { action: 'DEPOSIT_PENDING', lines, meta: { userId, amount: v, provider, txId } };

}

function buildDepositConfirmEntry({

  userId,

  amount,

  provider = 'manual',

  txId,

  gatewayReference = null,

}) {

  const v = round2(amount);

  const lines = [

    { account: 'platform:cash', debit: v },

    { account: `user:${userId}`, debit: v },

    { account: 'platform:deposits:pending', credit: v },

    { account: 'platform:liability:users', credit: v },

  ];

  ensureBalanced(lines);

  return {

    action: 'DEPOSIT_CONFIRMED',

    lines,

    meta: { userId, amount: v, provider, txId, gatewayReference },

  };

}

function buildDepositReversalEntry({

  userId,

  amount,

  provider = 'manual',

  txId,

  gatewayReference = null,

}) {

  const v = round2(amount);

  const lines = [

    { account: 'platform:equity', debit: v },

    { account: 'platform:deposits:pending', credit: v },

  ];

  ensureBalanced(lines);

  return {

    action: 'DEPOSIT_REVERSED',

    lines,

    meta: { userId, amount: v, provider, txId, gatewayReference },

  };

}

function buildWithdrawPendingEntry({

  userId,

  amount,

  fee = 0,

  provider = 'manual',

  txId,

}) {

  const v = round2(amount);

  const f = round2(fee);

  const lines = [

    { account: 'platform:withdrawals:pending', debit: v },

    { account: `user:${userId}`, credit: round2(v + f) },

    { account: 'platform:liability:users', debit: round2(v + f) },

    { account: 'platform:equity', credit: v },

  ];

  if (f > 0) lines.push({ account: 'platform:revenue:fees', debit: f });

  ensureBalanced(lines);

  return { action: 'WITHDRAW_PENDING', lines, meta: { userId, amount: v, fee: f, provider, txId } };

}

function buildWithdrawConfirmEntry({

  userId,

  amount,

  fee = 0,

  provider = 'manual',

  txId,

  gatewayReference = null,

}) {

  const v = round2(amount);

  const f = round2(fee);

  const lines = [

    { account: 'platform:equity', debit: v },

    { account: 'platform:cash', credit: v },

    { account: 'platform:withdrawals:pending', credit: v },

  ];

  if (f > 0) {

    lines.push(

      { account: 'platform:equity', debit: f },

      { account: 'platform:cash', credit: f }

    );

  }

  ensureBalanced(lines);

  return {

    action: 'WITHDRAW_CONFIRMED',

    lines,

    meta: { userId, amount: v, fee: f, provider, txId, gatewayReference },

  };

}

function buildWithdrawCancelEntry({

  userId,

  amount,

  fee = 0,

  provider = 'manual',

  txId,

  gatewayReference = null,

}) {

  const v = round2(amount);

  const f = round2(fee);

  const lines = [

    { account: `user:${userId}`, debit: round2(v + f) },

    { account: 'platform:withdrawals:pending', credit: v },

    { account: 'platform:liability:users', credit: round2(v + f) },

    { account: 'platform:equity', debit: v },

  ];

  if (f > 0) lines.push({ account: 'platform:revenue:fees', credit: f });

  ensureBalanced(lines);

  return {

    action: 'WITHDRAW_CANCELLED',

    lines,

    meta: { userId, amount: v, fee: f, provider, txId, gatewayReference },

  };

}

function genFinancialTxId() {

  return genId('ftx');

}

async function readFinancialTx(filter = {}) {

  return FinancialTransaction.find(filter).sort({ createdAt: -1 }).lean();

}

async function createFinancialTx({

  tipo,

  usuarioId,

  valorBruto,

  taxa = 0,

  gateway = 'manual',

  gatewayReference = null,

  status = 'PENDENTE',

  metadata = {},

  session = null,

}) {

  const valor = round2(valorBruto);

  const taxaNum = round2(taxa);

  const valorLiquido = round2(valor - taxaNum);

  const doc = {

    id: genFinancialTxId(),

    tipo: String(tipo),

    usuarioId: String(usuarioId),

    valorBruto: valor,

    taxa: taxaNum,

    valorLiquido,

    status,

    gateway,

    gatewayReference,

    reconciliacaoStatus: 'PENDENTE',

    reconciliadoEm: null,

    divergenceReason: null,

    ledgerEntryIds: [],

    metadata,

    createdAt: new Date(),

    updatedAt: new Date(),

  };

  if (session) {

    const docs = await FinancialTransaction.create([doc], { session });

    return docs[0].toObject();

  }

  const created = await FinancialTransaction.create(doc);

  return created.toObject();

}

async function findFinancialTxByGatewayReference(gatewayReference, session = null) {

  if (!gatewayReference) return null;

  return FinancialTransaction.findOne({

    gatewayReference: String(gatewayReference),

  }).session(session || null);

}

async function findFinancialTxById(id, session = null) {

  return FinancialTransaction.findOne({ id: String(id) }).session(session || null);

}

async function updateFinancialTx(transacaoId, updater, session = null) {

  const current = await FinancialTransaction.findOne({

    id: String(transacaoId),

  }).session(session || null);

  if (!current) return null;

  const next =

    typeof updater === 'function'

      ? updater(current.toObject())

      : { ...current.toObject(), ...updater };

  next.updatedAt = new Date();

  await FinancialTransaction.updateOne(

    { id: String(transacaoId) },

    { $set: next },

    { session: session || undefined }

  );

  return FinancialTransaction.findOne({ id: String(transacaoId) }).session(session || null);

}

async function reconcileFinancialTx(finTx, session = null) {

  const ids = Array.isArray(finTx?.ledgerEntryIds) ? finTx.ledgerEntryIds : [];

  const found = await LedgerEntry.find({ id: { $in: ids } })

    .session(session || null)

    .lean();

  if (

    ['CONFIRMADO', 'ESTORNADO', 'CANCELADO', 'FALHOU'].includes(String(finTx.status)) &&

    found.length === 0

  ) {

    return { status: 'DIVERGENTE', reason: 'Transação final sem ledger' };

  }

  if (

    ['PENDENTE', 'PROCESSANDO'].includes(String(finTx.status)) &&

    found.length > 2

  ) {

    return { status: 'DIVERGENTE', reason: 'Pendência com lançamentos excessivos' };

  }

  return { status: 'RECONCILIADO', reason: null };

}

module.exports = {

  LedgerEntry,

  LedgerIdem,

  FinancialTransaction,

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

  createFinancialTx,

  findFinancialTxByGatewayReference,

  findFinancialTxById,

  updateFinancialTx,

  reconcileFinancialTx,

  getHttpIdempotency,

  saveHttpIdempotency,

  _internals: { normalizeLine, ensureBalanced, computeUserDeltas },

};