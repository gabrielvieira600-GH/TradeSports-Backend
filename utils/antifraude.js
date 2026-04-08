// backend/utils/antifraude.js
const fs = require('fs');
const path = require('path');

const antifraudeLogsPath = path.join(__dirname, '../data/antifraude_logs.json');
const antifraudeStatePath = path.join(__dirname, '../data/antifraude_state.json');

function lerJSON(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function salvarJSON(p, data) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

function now() { return Date.now(); }

function getClientIp(req) {
  const xff = req?.headers?.['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req?.ip || req?.connection?.remoteAddress || 'unknown';
}

function loadState() {
  return lerJSON(antifraudeStatePath, { users: {}, ips: {}, clubes: {}, pairs: {} });
}

function saveState(state) {
  if (!state.pairs) state.pairs = {};
  salvarJSON(antifraudeStatePath, state);
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
  if (!state.ips[key]) state.ips[key] = { score: 0, cooldownUntil: 0, last: {} };
  return state.ips[key];
}

function ensureClube(state, clubeId) {
  const key = String(clubeId);
  if (!state.clubes) state.clubes = {};
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
  const pairKey = [String(buyerId), String(sellerId)].sort().join('::') + `::${String(clubeId)}`;
  if (!state.pairs) state.pairs = {};
  if (!state.pairs[pairKey]) state.pairs[pairKey] = { trades: [], volume: 0, last: {} };
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

function logEvent(evt) {
  const logs = lerJSON(antifraudeLogsPath, []);
  logs.push({ id: `${now()}-${Math.random().toString(36).slice(2)}`, ts: new Date().toISOString(), ...evt });
  if (logs.length > 5000) logs.splice(0, logs.length - 5000);
  salvarJSON(antifraudeLogsPath, logs);
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
  const u = ensureUser(state, userId); u.frozenUntil = 0;
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
  const c = ensureClube(state, clubeId); c.frozenUntil = 0;
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

function evaluateCooldown({ req, userId }) {
  const ip = getClientIp(req);
  const state = loadState();

  const u = userId ? ensureUser(state, userId) : null;
  const i = ensureIp(state, ip);

  const uUntil = u ? Number(u.cooldownUntil || 0) : 0;
  const iUntil = Number(i.cooldownUntil || 0);
  const until = Math.max(uUntil, iUntil);

  if (until > now()) {
    const ms = until - now();

    logEvent({
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

function recordOrderCreate({ req, userId, clubeId, windowMs = 10 * 60 * 1000 }) {
  const ip = getClientIp(req);
  const state = loadState();
  const u = ensureUser(state, userId);
  const c = ensureClube(state, clubeId);
  const ts = now();
  u.stats.orderCreate = _pushTs(u.stats.orderCreate, ts, windowMs);
  c.stats.creates = _pushTs(c.stats.creates, ts, windowMs);
  saveState(state);
  logEvent({ userId: String(userId), ip, action: 'ORDER_CREATE_STAT', decision: 'ALLOW', clubeId: String(clubeId) });
}

function recordOrderCancel({ req, userId, clubeId, windowMs = 10 * 60 * 1000 }) {
  const ip = getClientIp(req);
  const state = loadState();
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
    logEvent({ userId: String(userId), ip, action: 'CANCEL_RATIO_SIGNAL', decision: 'ALLOW', clubeId: String(clubeId), creates, cancels, ratio, scoreUser: u.score });
  }
  saveState(state);
  return { creates, cancels, ratio, scoreUser: u.score };
}

function recordTrade({ req, buyerId, sellerId, clubeId, quantidade, preco, windowMs = 5 * 60 * 1000 }) {
  const ip = getClientIp(req);
  const state = loadState();
  const c = ensureClube(state, clubeId);
  const ts = now();
  c.stats.trades = _pushTs(c.stats.trades, ts, windowMs);
  if (c.stats.trades.length >= 60) {
    freezeClube(state, clubeId, 3 * 60 * 1000, 'volume anormal de trades');
    logEvent({ userId: buyerId ? String(buyerId) : null, ip, action: 'CLUBE_VOLUME_SPIKE', decision: 'ALLOW', clubeId: String(clubeId), trades5m: c.stats.trades.length, buyerId: buyerId ? String(buyerId) : null, sellerId: sellerId ? String(sellerId) : null, quantidade: Number(quantidade || 0), preco: Number(preco || 0) });
  }
  saveState(state);
}

function signalWashTrading({ req, userId = null, buyerId = null, sellerId = null, clubeId, quantidade = 0, preco = 0, windowMs = 10 * 60 * 1000 }) {
  const ip = getClientIp(req);
  const state = loadState();
  const ts = now();

  if (userId && !buyerId && !sellerId) {
    const u = ensureUser(state, userId);
    addScore(u, 20, 'wash trading suspeito');
    if (u.score >= 60) freezeUser(state, userId, 10 * 60 * 1000, 'wash trading');
    saveState(state);
    logEvent({ userId: String(userId), ip, action: 'WASH_TRADING_SIGNAL', decision: 'ALLOW', clubeId: String(clubeId), scoreUser: u.score });
    return { suspicious: true, scoreUser: u.score };
  }

  if (!buyerId || !sellerId) return { suspicious: false };

  const { key, pair } = ensurePair(state, buyerId, sellerId, clubeId);
  pair.trades = _pushTs(pair.trades, ts, windowMs);
  pair.volume = Math.round((Number(pair.volume || 0) + (Number(quantidade || 0) * Number(preco || 0))) * 100) / 100;
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
    if (uBuyer.score >= 80) { freezeUser(state, buyerId, 20 * 60 * 1000, 'wash trading'); frozen = true; }
    if (uSeller.score >= 80) { freezeUser(state, sellerId, 20 * 60 * 1000, 'wash trading'); frozen = true; }
    logEvent({ userId: String(buyerId), ip, action: 'WASH_TRADING_PAIR_SIGNAL', decision: frozen ? 'BLOCK' : 'ALLOW', clubeId: String(clubeId), buyerId: String(buyerId), sellerId: String(sellerId), pairKey: key, suspiciousCount, pairVolume: pair.volume, buyerScore: uBuyer.score, sellerScore: uSeller.score });
  }
  saveState(state);
  return { suspicious: suspiciousCount >= 4, suspiciousCount, frozen };
}

function punishSpoofing({ req, userId, clubeId, ordem, seconds }) {
  const ip = getClientIp(req);
  const state = loadState();
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
  saveState(state);
  logEvent({ userId: userId ? String(userId) : null, ip, action: 'SPOOFING_SIGNAL', decision: u && Number(u.frozenUntil || 0) > now() ? 'BLOCK' : 'ALLOW', clubeId: String(clubeId), ordemId: String(ordem?.id || ''), seconds, notional, scoreUser: u?.score ?? null, scoreIp: i.score });
}

function blockSelfTrade({ req, userId, clubeId, ordemPassivaId, makerUserId }) {
  const ip = getClientIp(req);
  const state = loadState();
  const u = userId ? ensureUser(state, userId) : null;
  const i = ensureIp(state, ip);
  const msg = 'self-trade bloqueado (mesmo usuário em ambos os lados)';
  if (u) addScore(u, 15, msg);
  addScore(i, 5, msg);
  if (u && u.score >= 35) setCooldown(u, 20_000, 'self-trade');
  saveState(state);
  logEvent({ userId: userId ? String(userId) : null, ip, action: 'SELF_TRADE_BLOCK', decision: 'BLOCK', clubeId: String(clubeId), ordemPassivaId: String(ordemPassivaId || ''), makerUserId: String(makerUserId || '') });
}

function recordPriceMove({ req, clubeId, oldPrice, newPrice, maxPct = 15, windowMs = 5 * 60 * 1000 }) {
  const ip = getClientIp(req);
  const state = loadState();
  const c = ensureClube(state, clubeId);
  const o = Number(oldPrice || 0);
  const n = Number(newPrice || 0);
  if (!o || !n) return { tripped: false, pct: 0 };
  const pct = Math.abs((n - o) / o) * 100;
  const ts = now();
  c.stats.priceMoves = Array.isArray(c.stats.priceMoves) ? c.stats.priceMoves : [];
  c.stats.priceMoves.push({ ts, pct, oldPrice: o, newPrice: n });
  const cutoff = ts - windowMs;
  c.stats.priceMoves = c.stats.priceMoves.filter(m => Number(m.ts || 0) >= cutoff);
  let tripped = false;
  if (pct >= maxPct || c.stats.priceMoves.filter(m => Number(m.pct || 0) >= maxPct * 0.6).length >= 3) {
    freezeClube(state, clubeId, 3 * 60 * 1000, 'circuit breaker');
    tripped = true;
    logEvent({ userId: null, ip, action: 'CIRCUIT_BREAKER_TRIP', decision: 'BLOCK', clubeId: String(clubeId), oldPrice: o, newPrice: n, pct, recentMoves: c.stats.priceMoves.length });
  }
  saveState(state);
  return { tripped, pct };
}

function shouldTripCircuitBreaker({ oldPrice, newPrice, maxPct }) {
  const o = Number(oldPrice || 0);
  const n = Number(newPrice || 0);
  if (!o || !n) return false;
  return Math.abs((n - o) / o) * 100 >= maxPct;
}

function getAntifraudeStatus() {
  const state = loadState();
  const logs = lerJSON(antifraudeLogsPath, []);
  const nowTs = now();
  const frozenUsers = Object.entries(state.users || {}).filter(([_, u]) => Number(u.frozenUntil || 0) > nowTs).map(([userId, u]) => ({ userId, frozenUntil: u.frozenUntil, score: u.score || 0 }));
  const frozenClubes = Object.entries(state.clubes || {}).filter(([_, c]) => Number(c.frozenUntil || 0) > nowTs).map(([clubeId, c]) => ({ clubeId, frozenUntil: c.frozenUntil, reason: c.last?.freezeReason || '' }));
  return { frozenUsers, frozenClubes, recentLogs: logs.slice(-50).reverse(), pairsTracked: Object.keys(state.pairs || {}).length };
}

module.exports = {
  getClientIp,
  checkVelocity,
  evaluateCooldown,
  punishSpoofing,
  blockSelfTrade,
  logEvent,
  shouldTripCircuitBreaker,
  loadState,
  saveState,
  isFrozenUser,
  freezeUser,
  unfreezeUser,
  isFrozenClube,
  freezeClube,
  unfreezeClube,
  signalWashTrading,
  recordOrderCreate,
  recordOrderCancel,
  recordTrade,
  recordPriceMove,
  getAntifraudeStatus,
};
