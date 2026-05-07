// backend/utils/antifraude.js
const mongoose = require('mongoose');

const AntifraudeLogSchema = new mongoose.Schema(

  {

    id: { type: String, unique: true, index: true },

    ts: { type: Date, default: Date.now, index: true },

    userId: { type: String, default: null, index: true },

    ip: { type: String, default: null, index: true },

    action: { type: String, required: true, index: true },

    decision: { type: String, default: 'ALLOW', index: true },

    clubeId: { type: String, default: null, index: true },

    ordemId: { type: String, default: null },

    reason: { type: String, default: null },

    cooldownMs: { type: Number, default: null },

    creates: { type: Number, default: null },

    cancels: { type: Number, default: null },

    ratio: { type: Number, default: null },

    scoreUser: { type: Number, default: null },

    scoreIp: { type: Number, default: null },

    meta: { type: mongoose.Schema.Types.Mixed, default: {} },

  },

  {

    collection: 'antifraude_logs',

    versionKey: false,

  }

);

const AntifraudeStateSchema = new mongoose.Schema(

  {

    key: { type: String, unique: true, index: true }, // global

    users: { type: mongoose.Schema.Types.Mixed, default: {} },

    ips: { type: mongoose.Schema.Types.Mixed, default: {} },

    clubes: { type: mongoose.Schema.Types.Mixed, default: {} },

    pairs: { type: mongoose.Schema.Types.Mixed, default: {} },

  },

  {

    collection: 'antifraude_state',

    timestamps: true,

    versionKey: false,

  }

);

const AntifraudeLog =

  mongoose.models.AntifraudeLog ||

  mongoose.model('AntifraudeLog', AntifraudeLogSchema);

const AntifraudeState =

  mongoose.models.AntifraudeState ||

  mongoose.model('AntifraudeState', AntifraudeStateSchema);

function now() {

  return Date.now();

}

function genId() {

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;

}

function getClientIp(req) {

  const xff = req?.headers?.['x-forwarded-for'];

  if (xff) return String(xff).split(',')[0].trim();

  return req?.ip || req?.connection?.remoteAddress || 'unknown';

}

async function loadState() {

  let doc = await AntifraudeState.findOne({ key: 'global' });

  if (!doc) {

    doc = await AntifraudeState.create({

      key: 'global',

      users: {},

      ips: {},

      clubes: {},

      pairs: {},

    });

  }

  return doc;

}

async function saveState(stateDoc) {

  await stateDoc.save();

}

function ensureUser(state, userId) {

  const key = String(userId);

  if (!state.users[key]) {

    state.users[key] = {

      score: 0,

      cooldownUntil: 0,

      frozenUntil: 0,

      last: {},

      stats: { orderCreate: [], orderCancel: [], trades: [] },

    };

  }

  const u = state.users[key];

  if (!u.stats) u.stats = { orderCreate: [], orderCancel: [], trades: [] };

  if (u.frozenUntil == null) u.frozenUntil = 0;

  if (u.cooldownUntil == null) u.cooldownUntil = 0;

  return u;

}

function ensureIp(state, ip) {

  const key = String(ip);

  if (!state.ips[key]) {

    state.ips[key] = { score: 0, cooldownUntil: 0, last: {} };

  }

  return state.ips[key];

}

function ensureClube(state, clubeId) {

  const key = String(clubeId);

  if (!state.clubes[key]) {

    state.clubes[key] = {

      frozenUntil: 0,

      last: {},

      stats: { trades: [], cancels: [], creates: [], priceMoves: [] },

    };

  }

  const c = state.clubes[key];

  if (!c.stats) c.stats = { trades: [], cancels: [], creates: [], priceMoves: [] };

  if (c.frozenUntil == null) c.frozenUntil = 0;

  return c;

}

function ensurePair(state, buyerId, sellerId, clubeId) {

  const pairKey =

    [String(buyerId), String(sellerId)].sort().join('::') + `::${String(clubeId)}`;

  if (!state.pairs[pairKey]) {

    state.pairs[pairKey] = { trades: [], volume: 0, last: {} };

  }

  return { key: pairKey, pair: state.pairs[pairKey] };

}

function addScore(entity, delta, reason) {

  entity.score = Math.max(0, Math.min(100, Number(entity.score || 0) + Number(delta || 0)));

  entity.last.lastReason = reason || '';

  entity.last.lastScoreAt = now();

}

function setCooldown(entity, ms, reason) {

  const until = now() + Number(ms || 0);

  entity.cooldownUntil = Math.max(Number(entity.cooldownUntil || 0), until);

  entity.last.cooldownReason = reason || '';

  entity.last.cooldownSetAt = now();

}

async function logEvent(evt) {

  const entry = {

    id: evt.id || genId(),

    ts: evt.ts ? new Date(evt.ts) : new Date(),

    ...evt,

  };

  await AntifraudeLog.create(entry);

  return entry;

}

function isFrozenUser(state, userId) {

  const u = state?.users?.[String(userId)];

  return !!(u && Number(u.frozenUntil || 0) > now());

}

function freezeUser(state, userId, ms, reason) {

  const u = ensureUser(state, userId);

  u.frozenUntil = now() + Number(ms || 0);

  u.last.freezeReason = reason || 'freeze';

  u.last.freezeAt = now();

}

function unfreezeUser(state, userId) {

  const u = ensureUser(state, userId);

  u.frozenUntil = 0;

}

function isFrozenClube(state, clubeId) {

  const c = state?.clubes?.[String(clubeId)];

  return !!(c && Number(c.frozenUntil || 0) > now());

}

function freezeClube(state, clubeId, ms, reason) {

  const c = ensureClube(state, clubeId);

  c.frozenUntil = now() + Number(ms || 0);

  c.last.freezeReason = reason || 'freeze clube';

  c.last.freezeAt = now();

}

function unfreezeClube(state, clubeId) {

  const c = ensureClube(state, clubeId);

  c.frozenUntil = 0;

}

function _pushTs(arr, ts, windowMs) {

  const out = Array.isArray(arr) ? arr.slice() : [];

  out.push(ts);

  const cutoff = ts - windowMs;

  return out.filter((x) => x >= cutoff);

}

const memCounters = new Map();

function checkVelocity({ key, action, limit, windowMs }) {

  const bucket = Math.floor(now() / windowMs);

  const memKey = `${key}:${action}:${bucket}`;

  const count = (memCounters.get(memKey) || 0) + 1;

  memCounters.set(memKey, count);

  if (count > limit) {

    const retryAfterMs = (bucket + 1) * windowMs - now();

    return { ok: false, retryAfterMs: Math.max(250, retryAfterMs) };

  }

  return { ok: true };

}

async function evaluateCooldown({ req, userId }) {

  const ip = getClientIp(req);

  const stateDoc = await loadState();

  const state = stateDoc.toObject();

  const u = userId ? ensureUser(state, userId) : null;

  const i = ensureIp(state, ip);

  const uUntil = u ? Number(u.cooldownUntil || 0) : 0;

  const iUntil = Number(i.cooldownUntil || 0);

  const until = Math.max(uUntil, iUntil);

  if (until > now()) {

    const ms = until - now();

    await logEvent({

      userId: userId ? String(userId) : null,

      ip,

      action: 'COOLDOWN_BLOCK',

      decision: 'BLOCK',

      cooldownMs: ms,

      reason: u?.last?.cooldownReason || i?.last?.cooldownReason || 'cooldown ativo',

    });

    return {

      ok: false,

      status: 429,

      body: {

        error: 'BLOQUEADO_ANTIFRAUDE',

        motivo: 'cooldown ativo',

        cooldownMs: ms,

      },

    };

  }

  return { ok: true };

}

async function recordOrderCreate({ req, userId, clubeId, windowMs = 10 * 60 * 1000 }) {

  const ip = getClientIp(req);

  const stateDoc = await loadState();

  const state = stateDoc.toObject();

  const u = ensureUser(state, userId);

  const c = ensureClube(state, clubeId);

  const ts = now();

  u.stats.orderCreate = _pushTs(u.stats.orderCreate, ts, windowMs);

  c.stats.creates = _pushTs(c.stats.creates, ts, windowMs);

  stateDoc.users = state.users;

  stateDoc.clubes = state.clubes;

  await saveState(stateDoc);

  await logEvent({

    userId: String(userId),

    ip,

    action: 'ORDER_CREATE_STAT',

    decision: 'ALLOW',

    clubeId: String(clubeId),

  });

}

async function recordOrderCancel({ req, userId, clubeId, windowMs = 10 * 60 * 1000 }) {

  const ip = getClientIp(req);

  const stateDoc = await loadState();

  const state = stateDoc.toObject();

  const u = ensureUser(state, userId);

  const c = ensureClube(state, clubeId);

  const ts = now();

  u.stats.orderCancel = _pushTs(u.stats.orderCancel, ts, windowMs);

  c.stats.cancels = _pushTs(c.stats.cancels, ts, windowMs);

  const creates = Array.isArray(u.stats.orderCreate) ? u.stats.orderCreate.length : 0;

  const cancels = Array.isArray(u.stats.orderCancel) ? u.stats.orderCancel.length : 0;

  const ratio = creates > 0 ? cancels / creates : 0;

  if (creates >= 10 && ratio >= 0.7) {

    addScore(u, 15, 'cancel ratio alto (possível spoofing)');

    setCooldown(u, 2 * 60 * 1000, 'cancel ratio alto');

    if (u.score >= 70) freezeUser(state, userId, 10 * 60 * 1000, 'cancel ratio muito alto');

    await logEvent({

      userId: String(userId),

      ip,

      action: 'CANCEL_RATIO_SIGNAL',

      decision: 'ALLOW',

      clubeId: String(clubeId),

      creates,

      cancels,

      ratio,

      scoreUser: u.score,

    });

  }

  stateDoc.users = state.users;

  stateDoc.clubes = state.clubes;

  await saveState(stateDoc);

  return { creates, cancels, ratio, scoreUser: u.score };

}

async function signalWashTrading({

  req,

  userId = null,

  buyerId = null,

  sellerId = null,

  clubeId,

  quantidade = 0,

  preco = 0,

  windowMs = 10 * 60 * 1000,

}) {

  const ip = getClientIp(req);

  const stateDoc = await loadState();

  const state = stateDoc.toObject();

  const ts = now();

  if (userId && !buyerId && !sellerId) {

    const u = ensureUser(state, userId);

    addScore(u, 20, 'wash trading suspeito');

    if (u.score >= 60) freezeUser(state, userId, 10 * 60 * 1000, 'wash trading');

    stateDoc.users = state.users;

    await saveState(stateDoc);

    await logEvent({

      userId: String(userId),

      ip,

      action: 'WASH_TRADING_SIGNAL',

      decision: 'ALLOW',

      clubeId: String(clubeId),

      scoreUser: u.score,

    });

    return { suspicious: true, scoreUser: u.score };

  }

  if (!buyerId || !sellerId) return { suspicious: false };

  const { key, pair } = ensurePair(state, buyerId, sellerId, clubeId);

  pair.trades = _pushTs(pair.trades, ts, windowMs);

  pair.volume = Math.round(

    (Number(pair.volume || 0) + Number(quantidade || 0) * Number(preco || 0)) * 100

  ) / 100;

  pair.last = { buyerId, sellerId, clubeId, quantidade, preco, at: ts };

  const uBuyer = ensureUser(state, buyerId);

  const uSeller = ensureUser(state, sellerId);

  const suspiciousCount = pair.trades.length;

  let frozen = false;

  if (suspiciousCount >= 4) {

    addScore(uBuyer, 25, 'wash trading por repetição de contraparte');

    addScore(uSeller, 25, 'wash trading por repetição de contraparte');

    setCooldown(uBuyer, 5 * 60 * 1000, 'wash trading suspeito');

    setCooldown(uSeller, 5 * 60 * 1000, 'wash trading suspeito');

    if (uBuyer.score >= 80) {

      freezeUser(state, buyerId, 20 * 60 * 1000, 'wash trading');

      frozen = true;

    }

    if (uSeller.score >= 80) {

      freezeUser(state, sellerId, 20 * 60 * 1000, 'wash trading');

      frozen = true;

    }

    await logEvent({

      userId: String(buyerId),

      ip,

      action: 'WASH_TRADING_PAIR_SIGNAL',

      decision: frozen ? 'BLOCK' : 'ALLOW',

      clubeId: String(clubeId),

      buyerId: String(buyerId),

      sellerId: String(sellerId),

      pairKey: key,

      suspiciousCount,

      pairVolume: pair.volume,

      buyerScore: uBuyer.score,

      sellerScore: uSeller.score,

    });

  }

  stateDoc.users = state.users;

  stateDoc.pairs = state.pairs;

  await saveState(stateDoc);

  return { suspicious: suspiciousCount >= 4, suspiciousCount, frozen };

}

async function punishSpoofing({ req, userId, clubeId, ordem, seconds }) {

  const ip = getClientIp(req);

  const stateDoc = await loadState();

  const state = stateDoc.toObject();

  const u = userId ? ensureUser(state, userId) : null;

  const i = ensureIp(state, ip);

  const msg = `cancelamento rápido em ${seconds}s (possível spoofing)`;

  const notional = Math.round(Number(ordem?.preco || 0) * Number(ordem?.quantidade || 0));

  let userDelta = 10;

  if (notional >= 500) userDelta = 18;

  if (notional >= 1000) userDelta = 25;

  if (u) {

    addScore(u, userDelta, msg);

    if (u.score >= 35) setCooldown(u, 30_000, 'cancelamento rápido');

    if (u.score >= 75) freezeUser(state, userId, 15 * 60 * 1000, 'spoofing recorrente');

  }

  addScore(i, 5, msg);

  if (i.score >= 60) setCooldown(i, 60_000, 'muito cancelamento rápido (IP)');

  stateDoc.users = state.users;

  stateDoc.ips = state.ips;

  await saveState(stateDoc);

  await logEvent({

    userId: userId ? String(userId) : null,

    ip,

    action: 'SPOOFING_SIGNAL',

    decision: u && Number(u.frozenUntil || 0) > now() ? 'BLOCK' : 'ALLOW',

    clubeId: String(clubeId),

    ordemId: String(ordem?.id || ''),

    seconds,

    notional,

    scoreUser: u?.score ?? null,

    scoreIp: i.score,

  });

}

async function blockSelfTrade({ req, userId, clubeId, ordemPassivaId, makerUserId }) {

  const ip = getClientIp(req);

  const stateDoc = await loadState();

  const state = stateDoc.toObject();

  const u = userId ? ensureUser(state, userId) : null;

  const i = ensureIp(state, ip);

  const msg = 'self-trade bloqueado (mesmo usuário em ambos os lados)';

  if (u) addScore(u, 15, msg);

  addScore(i, 5, msg);

  if (u && u.score >= 35) setCooldown(u, 20_000, 'self-trade');

  stateDoc.users = state.users;

  stateDoc.ips = state.ips;

  await saveState(stateDoc);

  await logEvent({

    userId: userId ? String(userId) : null,

    ip,

    action: 'SELF_TRADE_BLOCK',

    decision: 'BLOCK',

    clubeId: String(clubeId),

    ordemPassivaId: String(ordemPassivaId || ''),

    makerUserId: String(makerUserId || ''),

  });

}

async function recordPriceMove({ req, clubeId, oldPrice, newPrice, maxPct = 15, windowMs = 5 * 60 * 1000 }) {

  const ip = getClientIp(req);

  const stateDoc = await loadState();

  const state = stateDoc.toObject();

  const c = ensureClube(state, clubeId);

  const o = Number(oldPrice || 0);

  const n = Number(newPrice || 0);

  if (!o || !n) return { tripped: false, pct: 0 };

  const pct = Math.abs((n - o) / o) * 100;

  const ts = now();

  c.stats.priceMoves = Array.isArray(c.stats.priceMoves) ? c.stats.priceMoves : [];

  c.stats.priceMoves.push({ ts, pct, oldPrice: o, newPrice: n });

  const cutoff = ts - windowMs;

  c.stats.priceMoves = c.stats.priceMoves.filter((m) => Number(m.ts || 0) >= cutoff);

  let tripped = false;

  if (

    pct >= maxPct ||

    c.stats.priceMoves.filter((m) => Number(m.pct || 0) >= maxPct * 0.6).length >= 3

  ) {

    freezeClube(state, clubeId, 3 * 60 * 1000, 'circuit breaker');

    tripped = true;

    await logEvent({

      userId: null,

      ip,

      action: 'CIRCUIT_BREAKER',

      decision: 'BLOCK',

      clubeId: String(clubeId),

      oldPrice: o,

      newPrice: n,

      pct,

    });

  }

  stateDoc.clubes = state.clubes;

  await saveState(stateDoc);

  return { tripped, pct };

}

module.exports = {

  AntifraudeLog,

  AntifraudeState,

  getClientIp,

  loadState,

  saveState,

  ensureUser,

  ensureIp,

  ensureClube,

  ensurePair,

  addScore,

  setCooldown,

  logEvent,

  isFrozenUser,

  freezeUser,

  unfreezeUser,

  isFrozenClube,

  freezeClube,

  unfreezeClube,

  checkVelocity,

  evaluateCooldown,

  recordOrderCreate,

  recordOrderCancel,

  signalWashTrading,

  punishSpoofing,

  blockSelfTrade,

  recordPriceMove,

};