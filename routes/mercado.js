// routes/mercado.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const auth = require('../middleware/auth');
const antifraude = require('../utils/antifraude');
const storage = require('../utils/storage');
const ledger = require('../utils/ledger');

const ordensPath        = path.join(__dirname, '../data/ordens.json');
const clubesPath        = path.join(__dirname, '../data/clubes.json');
const usuariosPath      = path.join(__dirname, '../data/usuarios.json');
const ledgerJournalPath = path.join(__dirname, '../data/ledger_journal.json');
const ledgerIdemPath    = path.join(__dirname, '../data/ledger_idem.json');
const idempotencyPath   = path.join(__dirname, '../data/idempotency.json');
const investimentosPath = path.join(__dirname, '../data/investimentos.json');

function ledgerNormalizeLine(line) {
  const account = String(line.account || '').trim();
  const debit = Number(line.debit || 0);
  const credit = Number(line.credit || 0);
  if (!account) throw Object.assign(new Error('Ledger: linha sem account'), { code: 'LEDGER_BAD_LINE' });
  if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
    throw Object.assign(new Error('Ledger: linha deve ter debit OU credit'), { code: 'LEDGER_BAD_LINE' });
  }
  if (debit < 0 || credit < 0) throw Object.assign(new Error('Ledger: valores negativos'), { code: 'LEDGER_BAD_LINE' });
  return { account, debit, credit };
}
function ledgerEnsureBalanced(lines) {
  let deb = 0, cred = 0;
  for (const l of lines) { deb += Number(l.debit || 0); cred += Number(l.credit || 0); }
  deb = Math.round(deb * 100) / 100; cred = Math.round(cred * 100) / 100;
  if (deb !== cred) {
    const e = new Error(`Ledger desbalanceado deb=${deb} cred=${cred}`);
    e.code = 'LEDGER_UNBALANCED';
    e.meta = { deb, cred };
    throw e;
  }
}
async function ledgerAppend({ action, lines, meta = {}, idemKey = null }) {
  const journal = storage.readJSON(ledgerJournalPath, []);
  const idem = storage.readJSON(ledgerIdemPath, {});
  if (idemKey && idem[String(idemKey)]) return { idemHit: true, existing: idem[String(idemKey)] };

  const entryId = `je_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const normalized = (lines || []).map(ledgerNormalizeLine);
  ledgerEnsureBalanced(normalized);
  const entry = { id: entryId, at: new Date().toISOString(), action: String(action), lines: normalized, meta };
  journal.push(entry);
  await storage.writeJSON(ledgerJournalPath, journal);
  if (idemKey) {
    idem[String(idemKey)] = { entryId, at: entry.at, action: entry.action };
    await storage.writeJSON(ledgerIdemPath, idem);
  }
  return { idemHit: false, entry };
}

function lerJSON(p, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function salvarJSON(p, data) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

function getIdempotencyKey(req) {
  return (
    req.headers['idempotency-key'] ||
    req.headers['Idempotency-Key'] ||
    (req.body && (req.body.idempotencyKey || req.body.idempotency_key)) ||
    null
  );
}

async function readIdempotency() {
  return storage.readJSON(idempotencyPath, []);
}
async function writeIdempotency(list) {
  return storage.writeJSON(idempotencyPath, list);
}
function pruneIdempotency(list, ttlMs = 5 * 60 * 1000) {
  const cutoff = Date.now() - ttlMs;
  return (Array.isArray(list) ? list : []).filter(x => Number(x.ts || 0) >= cutoff);
}
async function findCachedResponse(key, usuarioId) {
  const list = pruneIdempotency(await readIdempotency());
  return list.find(x => x.key === key && String(x.usuarioId) === String(usuarioId)) || null;
}
async function saveCachedResponse(key, usuarioId, status, body) {
  let list = pruneIdempotency(await readIdempotency());
  list.push({ key, usuarioId, ts: Date.now(), status, body });
  if (list.length > 2000) list = list.slice(list.length - 2000);
  await writeIdempotency(list);
}

function ipoEncerrado(clubeId) {
  const clubes = lerJSON(clubesPath, []);
  const clube = clubes.find(c => String(c.id) === String(clubeId));
  return !!(clube && (clube.ipoEncerrado || Number(clube.cotasDisponiveis) === 0));
}

router.get('/livro', auth, (req, res) => {
  const { clubeId } = req.query;
  if (!clubeId) return res.status(400).json({ erro: 'clubeId é obrigatório' });

  const ordens = lerJSON(ordensPath, []);

  const compras = ordens
    .filter(o => String(o.clubeId) === String(clubeId) && o.tipo === 'compra' && Number(o.restante || 0) > 0)
    .sort((a, b) => Number(b.preco) - Number(a.preco) || Number(a.criadoEm) - Number(b.criadoEm));

  const vendas = ordens
    .filter(o => String(o.clubeId) === String(clubeId) && o.tipo === 'venda' && Number(o.restante || 0) > 0)
    .sort((a, b) => Number(a.preco) - Number(b.preco) || Number(a.criadoEm) - Number(b.criadoEm));

  return res.json({ compras, vendas });
});

router.get('/ofertas', auth, (req, res) => {
  const { clubeId } = req.query;
  if (!clubeId) return res.status(400).json({ erro: 'clubeId é obrigatório' });

  const ordens = lerJSON(ordensPath, [])
    .filter(o => String(o.clubeId) === String(clubeId) && o.tipo === 'venda' && Number(o.restante || 0) > 0)
    .sort((a, b) => Number(a.preco) - Number(b.preco) || Number(a.criadoEm) - Number(b.criadoEm));

  return res.json(ordens);
});

router.post('/ordem', auth, async (req, res) => {
  try {
    const { tipo, clubeId, quantidade, preco } = req.body;
    const usuario = req.usuario;

    const state = antifraude.loadState() || null;
    if (state && antifraude.isFrozenUser(state, usuario.id)) {
      return res.status(403).json({ error: 'USUARIO_CONGELADO' });
    }

    const idemKey = getIdempotencyKey(req);
    if (idemKey) {
      const cached = await findCachedResponse(String(idemKey), usuario.id);
      if (cached) return res.status(cached.status).json(cached.body);
    }

    if (!ipoEncerrado(clubeId)) {
      return res.status(400).json({ erro: 'Mercado secundário indisponível enquanto o IPO não terminou.' });
    }

    const ip = antifraude.getClientIp(req);

    const vUser = antifraude.checkVelocity({ key: `uid:${usuario.id}`, action: 'ORDER_CREATE', limit: 20, windowMs: 60_000 });
    if (!vUser.ok) {
      antifraude.logEvent({ userId: String(usuario.id), ip, action: 'ORDER_CREATE', decision: 'BLOCK', reason: 'rate limit user', retryAfterMs: vUser.retryAfterMs });
      return res.status(429).json({ error: 'BLOQUEADO_ANTIFRAUDE', motivo: 'muitas ordens em pouco tempo', cooldownMs: vUser.retryAfterMs });
    }

    const vIp = antifraude.checkVelocity({ key: `ip:${ip}`, action: 'ORDER_CREATE', limit: 60, windowMs: 60_000 });
    if (!vIp.ok) {
      antifraude.logEvent({ userId: String(usuario.id), ip, action: 'ORDER_CREATE', decision: 'BLOCK', reason: 'rate limit ip', retryAfterMs: vIp.retryAfterMs });
      return res.status(429).json({ error: 'BLOQUEADO_ANTIFRAUDE', motivo: 'muitas ordens (IP) em pouco tempo', cooldownMs: vIp.retryAfterMs });
    }

    const clubesTmp = lerJSON(clubesPath, []);
    const clubeTmp = clubesTmp.find(c => String(c.id) === String(clubeId));
    if (clubeTmp && Number(clubeTmp.travadoAte || 0) > Date.now()) {
      const ms = Number(clubeTmp.travadoAte) - Date.now();
      antifraude.logEvent({ userId: String(usuario.id), ip, action: 'CIRCUIT_BREAKER_BLOCK', decision: 'BLOCK', clubeId: String(clubeId), cooldownMs: ms });
      return res.status(429).json({ error: 'BLOQUEADO_ANTIFRAUDE', motivo: 'clube temporariamente travado (circuit breaker)', cooldownMs: ms });
    }

    if (!['compra', 'venda'].includes(tipo)) {
      return res.status(400).json({ erro: 'tipo inválido' });
    }

    const qtd = Number(quantidade);
    const p = Number(preco);
    if (!qtd || qtd <= 0 || !p || p <= 0) {
      return res.status(400).json({ erro: 'quantidade/preço inválidos' });
    }

    const usuarios = lerJSON(usuariosPath, []);
    const idxUsuario = usuarios.findIndex(u => String(u.id) === String(usuario.id));

    const MAX_ORDER_NOTIONAL = Number(process.env.MAX_ORDER_NOTIONAL || 0);
    const orderNotional = Math.round(qtd * p * 100) / 100;
    if (MAX_ORDER_NOTIONAL > 0 && orderNotional > MAX_ORDER_NOTIONAL) {
      return res.status(400).json({ erro: `Valor máximo por ordem excedido. Limite atual: R$ ${MAX_ORDER_NOTIONAL.toFixed(2)}.` });
    }

    const MAX_USER_BALANCE_BETA = Number(process.env.MAX_USER_BALANCE_BETA || 0);
    if (idxUsuario < 0) return res.status(404).json({ erro: 'Usuário não encontrado' });

    const MAX_PCT_COTAS_CLUBE = 0.20;
    const MAX_EXPOSICAO_CLUBE = 0.30;
    const TOTAL_COTAS_CLUBE = 1000;

    const carteiraUser = Array.isArray(usuarios[idxUsuario].carteira) ? usuarios[idxUsuario].carteira : [];
    const pos = carteiraUser.find(a => String(a.clubeId) === String(clubeId));
    const qtdAtual = Number(pos?.quantidade || 0);
    const qtdApos = tipo === 'compra' ? (qtdAtual + qtd) : qtdAtual;

    if (tipo === 'compra') {
      if (qtdApos > TOTAL_COTAS_CLUBE * MAX_PCT_COTAS_CLUBE) {
        antifraude.logEvent({ userId: String(usuario.id), ip, action: 'ECON_CAP_HOLDING', decision: 'BLOCK', clubeId: String(clubeId), qtdApos });
        return res.status(400).json({ erro: 'Limite de concentração atingido para este clube.' });
      }

      const saldo = Number(usuarios[idxUsuario].saldo || 0);
      const patrimonio = saldo + carteiraUser.reduce((s, a) => s + Number(a.totalInvestido || 0), 0);
      if (MAX_USER_BALANCE_BETA > 0 && patrimonio > MAX_USER_BALANCE_BETA) {
        return res.status(400).json({ erro: 'Limite patrimonial beta excedido para este usuário.' });
      }
      const exposicaoAtual = Number(pos?.totalInvestido || 0);
      const exposicaoApos = exposicaoAtual + (p * qtd);

      if (patrimonio > 0 && (exposicaoApos / patrimonio) > MAX_EXPOSICAO_CLUBE) {
        antifraude.logEvent({ userId: String(usuario.id), ip, action: 'ECON_CAP_EXPOSURE', decision: 'BLOCK', clubeId: String(clubeId), exposicaoApos, patrimonio });
        return res.status(400).json({ erro: 'Limite de exposição ao clube atingido (risco).' });
      }
    }

    if (tipo === 'venda') {
      const ativo = (usuarios[idxUsuario].carteira || []).find(a => String(a.clubeId) === String(clubeId));
      if (!ativo || Number(ativo.quantidade || 0) < qtd) {
        return res.status(400).json({ erro: 'Quantidade insuficiente para vender' });
      }
    } else {
      const total = p * qtd;
      if (Number(usuarios[idxUsuario].saldo || 0) < total) {
        return res.status(400).json({ erro: 'Saldo insuficiente para comprar' });
      }
    }

    antifraude.recordOrderCreate({ req, userId: usuario.id, clubeId });

    const agora = Date.now();
    const novaOrdem = {
      id: `${agora}-${Math.random().toString(36).slice(2)}`,
      usuarioId: usuario.id,
      tipo,
      clubeId: Number(clubeId),
      preco: p,
      quantidade: qtd,
      restante: qtd,
      criadoEm: agora,
    };

    const ordens = lerJSON(ordensPath, []);
    ordens.push(novaOrdem);

    let houveNegocio = false;
    let ultimoPrecoNegociado = null;

    const investimentos = lerJSON(investimentosPath, []);
    const clubes = lerJSON(clubesPath, []);
    const clubeInfo = clubes.find(c => String(c.id) === String(clubeId));
    const clubeNome = clubeInfo?.nome || '';

    const oposto = tipo === 'compra' ? 'venda' : 'compra';
    const bookOposto = ordens
      .filter(o => o.tipo === oposto && String(o.clubeId) === String(clubeId) && Number(o.restante || 0) > 0)
      .sort((a, b) =>
        oposto === 'venda'
          ? Number(a.preco) - Number(b.preco) || Number(a.criadoEm) - Number(b.criadoEm)
          : Number(b.preco) - Number(a.preco) || Number(a.criadoEm) - Number(b.criadoEm)
      );

    for (const o of bookOposto) {
      if (novaOrdem.restante <= 0) break;

      const condOK = tipo === 'compra' ? (novaOrdem.preco >= o.preco) : (novaOrdem.preco <= o.preco);
      if (!condOK) break;

      const exec = Math.min(novaOrdem.restante, Number(o.restante || 0));
      if (exec <= 0) continue;

      const users = lerJSON(usuariosPath, []);

      const buyerId = tipo === 'compra' ? usuario.id : o.usuarioId;
      const sellerId = tipo === 'venda' ? usuario.id : o.usuarioId;

      if (String(buyerId) === String(sellerId)) {
        antifraude.blockSelfTrade({ req, userId: usuario.id, clubeId, ordemPassivaId: o.id, makerUserId: o.usuarioId });
        continue;
      }

      const buyerIx = users.findIndex(u => String(u.id) === String(buyerId));
      const sellerIx = users.findIndex(u => String(u.id) === String(sellerId));
      if (buyerIx < 0 || sellerIx < 0) continue;

      const price = Number(o.preco);
      const total = Math.round(price * exec * 100) / 100;

      const MAKER_FEE_PCT = Number(process.env.MAKER_FEE_PCT || 0.002);
      const TAKER_FEE_PCT = Number(process.env.TAKER_FEE_PCT || 0.005);
      const buyerRole = tipo === 'compra' ? 'TAKER' : 'MAKER';
      const sellerRole = tipo === 'venda' ? 'TAKER' : 'MAKER';
      const buyerFeePct = buyerRole === 'TAKER' ? TAKER_FEE_PCT : MAKER_FEE_PCT;
      const sellerFeePct = sellerRole === 'TAKER' ? TAKER_FEE_PCT : MAKER_FEE_PCT;
      const buyerFee = Math.round((total * buyerFeePct) * 100) / 100;
      const sellerFee = Math.round((total * sellerFeePct) * 100) / 100;

      const buyerDebit = Math.round((total + buyerFee) * 100) / 100;
      const sellerCredit = Math.round((total - sellerFee) * 100) / 100;

      if (Number(users[buyerIx].saldo || 0) < buyerDebit) {
        throw new Error('Saldo insuficiente do comprador no momento da execução com taxa.');
      }

      users[buyerIx].saldo = Math.round((Number(users[buyerIx].saldo || 0) - buyerDebit) * 100) / 100;
      if (!Array.isArray(users[buyerIx].carteira)) users[buyerIx].carteira = [];
      const posBuy = users[buyerIx].carteira.find(a => String(a.clubeId) === String(clubeId));
      if (posBuy) {
        const novoTotalInv = Number(posBuy.totalInvestido || 0) + total;
        const novaQtd = Number(posBuy.quantidade || 0) + exec;
        posBuy.quantidade = novaQtd;
        posBuy.totalInvestido = novoTotalInv;
        posBuy.precoMedio = novoTotalInv / novaQtd;
      } else {
        users[buyerIx].carteira.push({
          clubeId: Number(clubeId),
          nomeClube: clubeNome,
          quantidade: exec,
          precoMedio: price,
          totalInvestido: total,
        });
      }

      users[sellerIx].saldo = Math.round((Number(users[sellerIx].saldo || 0) + sellerCredit) * 100) / 100;
      if (!Array.isArray(users[sellerIx].carteira)) users[sellerIx].carteira = [];
      const posSell = users[sellerIx].carteira.find(a => String(a.clubeId) === String(clubeId));
      if (posSell) {
        posSell.quantidade = Number(posSell.quantidade || 0) - exec;
        if (posSell.quantidade <= 0) {
          users[sellerIx].carteira = users[sellerIx].carteira.filter(a => String(a.clubeId) !== String(clubeId));
        } else {
          posSell.totalInvestido = Number(posSell.precoMedio || 0) * Number(posSell.quantidade || 0);
        }
      }

      salvarJSON(usuariosPath, users);

      try {
        const trade = ledger.buildTradeEntry({
          buyerId,
          sellerId,
          clubeId: Number(clubeId),
          qty: exec,
          price,
          buyerFee,
          sellerFee,
          buyerRole,
          sellerRole,
          makerFeePct: MAKER_FEE_PCT,
          takerFeePct: TAKER_FEE_PCT,
        });

        await ledgerAppend({
          action: trade.action,
          lines: trade.lines,
          meta: trade.meta,
          idemKey: `trade:${o.id}:${novaOrdem.id}:${exec}:${price}`,
        });
      } catch (ledgerErr) {
        console.error('Erro no ledger TRADE_EXEC:', ledgerErr);
      }

      novaOrdem.restante -= exec;
      o.restante = Number(o.restante || 0) - exec;
      houveNegocio = true;
      ultimoPrecoNegociado = price;

      antifraude.recordTrade({ req, buyerId, sellerId, clubeId, quantidade: exec, preco: price });
      antifraude.signalWashTrading({ req, buyerId, sellerId, clubeId, quantidade: exec, preco: price });

      const dataIso = new Date().toISOString();
      investimentos.push(
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          usuarioId: buyerId,
          tipo: 'COMPRA',
          clubeId: Number(clubeId),
          clubeNome,
          quantidade: exec,
          valorUnitario: price,
          totalPago: total,
          data: dataIso,
        },
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          usuarioId: sellerId,
          tipo: 'VENDA',
          clubeId: Number(clubeId),
          clubeNome,
          quantidade: exec,
          valorUnitario: price,
          totalPago: total,
          data: dataIso,
        }
      );

      salvarJSON(ordensPath, ordens);
    }

    if (houveNegocio) {
      salvarJSON(investimentosPath, investimentos);

      if (ultimoPrecoNegociado != null && clubeInfo) {
        const clubesAtual = lerJSON(clubesPath, []);
        const idxClube = clubesAtual.findIndex(c => String(c.id) === String(clubeId));
        if (idxClube >= 0) {
          const oldPrice = Number(clubesAtual[idxClube].precoAtual || clubesAtual[idxClube].precoIPO || 0);
          const newPrice = Number(ultimoPrecoNegociado);
          const trip = antifraude.recordPriceMove({ req, clubeId, oldPrice, newPrice, maxPct: 15 });

          if (trip && trip.tripped) {
            clubesAtual[idxClube].travadoAte = Date.now() + 180_000;
          }

          clubesAtual[idxClube].precoAtual = newPrice;
          salvarJSON(clubesPath, clubesAtual);
        }
      }
    }

    salvarJSON(ordensPath, ordens);

    const comprasAbertas = Array.isArray(ordens)
      ? ordens
          .filter(o => String(o.clubeId) === String(clubeId) && o.tipo === 'compra' && Number(o.restante || 0) > 0)
          .sort((a, b) => Number(b.preco) - Number(a.preco) || Number(a.criadoEm) - Number(b.criadoEm))
      : [];

    const vendasAbertas = Array.isArray(ordens)
      ? ordens
          .filter(o => String(o.clubeId) === String(clubeId) && o.tipo === 'venda' && Number(o.restante || 0) > 0)
          .sort((a, b) => Number(a.preco) - Number(b.preco) || Number(a.criadoEm) - Number(b.criadoEm))
      : [];

    const bestBid = comprasAbertas[0]?.preco ?? null;
    const bestAsk = vendasAbertas[0]?.preco ?? null;
    const estimatedRole =
      tipo === 'compra'
        ? (bestAsk != null && Number(preco) >= Number(bestAsk) ? 'TAKER' : 'MAKER')
        : (bestBid != null && Number(preco) <= Number(bestBid) ? 'TAKER' : 'MAKER');

    const estimatedFeePct = estimatedRole === 'TAKER'
      ? Number(process.env.TAKER_FEE_PCT || 0.005)
      : Number(process.env.MAKER_FEE_PCT || 0.002);

    const body = { ok: true, ordem: novaOrdem, estimatedRole, estimatedFeePct, bestBid, bestAsk };
    if (idemKey) await saveCachedResponse(String(idemKey), usuario.id, 200, body);

    return res.json(body);
  } catch (err) {
    console.error('Erro ao enviar ordem:', err);
    return res.status(500).json({ erro: 'Erro no servidor' });
  }
});

router.post('/ordem/cancelar', auth, async (req, res) => {
  try {
    const { ordemId } = req.body;
    if (!ordemId) return res.status(400).json({ erro: 'ordemId é obrigatório.' });

    const usuario = req.usuario;
    const state = antifraude.loadState() || null;

    if (state && antifraude.isFrozenUser(state, usuario.id)) {
      return res.status(403).json({ error: 'USUARIO_CONGELADO' });
    }

    const cd = antifraude.evaluateCooldown({ req, userId: usuario?.id });
    if (!cd.ok) return res.status(cd.status).json(cd.body);

    const ip = antifraude.getClientIp(req);
    const vCancel = antifraude.checkVelocity({ key: `uid:${usuario.id}`, action: 'ORDER_CANCEL', limit: 30, windowMs: 60_000 });
    if (!vCancel.ok) {
      antifraude.logEvent({ userId: String(usuario.id), ip, action: 'ORDER_CANCEL', decision: 'BLOCK', reason: 'rate limit user', retryAfterMs: vCancel.retryAfterMs });
      return res.status(429).json({ error: 'BLOQUEADO_ANTIFRAUDE', motivo: 'muitos cancelamentos em pouco tempo', cooldownMs: vCancel.retryAfterMs });
    }

    const ordens = lerJSON(ordensPath, []);
    const index = ordens.findIndex(o => String(o.id) === String(ordemId));
    if (index === -1) return res.status(404).json({ erro: 'Ordem não encontrada.' });

    const ordem = ordens[index];

    if (state && antifraude.isFrozenClube(state, ordem.clubeId)) {
      return res.status(429).json({ error: 'CLUBE_CONGELADO', motivo: 'clube congelado (admin/antifraude)' });
    }

    if (String(ordem.usuarioId) !== String(usuario.id) && String(usuario.role || '').toLowerCase() !== 'admin') {
      return res.status(403).json({ erro: 'Você não tem permissão para cancelar esta ordem.' });
    }

    const ageMs = Date.now() - Number(ordem.criadoEm || 0);
    if (Number.isFinite(ageMs) && ageMs > 0 && ageMs < 15_000) {
      antifraude.punishSpoofing({ req, userId: usuario.id, clubeId: ordem.clubeId, ordem, seconds: Math.round(ageMs / 1000) });
    }

    antifraude.recordOrderCancel({ req, userId: usuario.id, clubeId: ordem.clubeId });

    if (Number(ordem.restante || 0) <= 0) {
      return res.status(400).json({ erro: 'Não é possível cancelar uma ordem já executada.' });
    }

    ordens[index] = {
      ...ordem,
      restante: 0,
      status: 'cancelada',
      canceladaEm: Date.now(),
    };

    salvarJSON(ordensPath, ordens);
    return res.json(ordens[index]);
  } catch (err) {
    console.error('Erro ao cancelar ordem:', err);
    return res.status(500).json({ erro: 'Erro interno ao cancelar ordem.' });
  }
});

router.get('/minhas-ordens', auth, (req, res) => {
  const uid = String(req.usuario.id);
  const ordens = lerJSON(ordensPath, [])
    .filter(o => String(o.usuarioId) === uid && Number(o.restante || 0) > 0)
    .sort((a, b) => Number(b.criadoEm) - Number(a.criadoEm));

  return res.json(ordens);
});

router.get('/historico-precos/:clubeId', (req, res) => {
  try {
    const clubeId = Number(req.params.clubeId);
    if (!clubeId) return res.status(400).json({ error: 'clubeId inválido' });

    const investimentos = lerJSON(investimentosPath, []);
    const serie = investimentos
      .filter(t => Number(t.clubeId) === clubeId)
      .filter(t => ['IPO', 'COMPRA', 'VENDA'].includes(String(t.tipo || '').toUpperCase()))
      .map(t => ({
        ts: new Date(t.data).getTime(),
        preco: Number(t.precoUnitario || t.valorUnitario || 0),
      }))
      .filter(p => Number.isFinite(p.ts) && p.ts > 0 && Number.isFinite(p.preco))
      .sort((a, b) => a.ts - b.ts);

    return res.json({ clubeId, serie });
  } catch (e) {
    console.error('Erro ao montar histórico de preços:', e);
    return res.status(500).json({ error: 'Erro ao montar histórico de preços' });
  }
});

router.get('/admin/integridade/check', auth, (req, res) => {
  try {
    const usuario = req.usuario;
    const state = antifraude.loadState() || null;
    if (state && antifraude.isFrozenUser(state, usuario.id)) {
      return res.status(403).json({ error: 'USUARIO_CONGELADO' });
    }

    if (!usuario || String(usuario.role || '').toLowerCase() !== 'admin') {
      return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
    }

    const ordens = storage.readJSON(ordensPath, []);
    const usuarios = storage.readJSON(usuariosPath, []);
    const clubes = storage.readJSON(clubesPath, []);

    const problemas = [];
    usuarios.forEach(u => {
      if (Number(u.saldo || 0) < 0) problemas.push({ tipo: 'SALDO_NEGATIVO', usuarioId: u.id, saldo: u.saldo });
    });
    ordens.forEach(o => {
      if (Number(o.quantidade || 0) < 0) problemas.push({ tipo: 'ORDEM_QTD_NEGATIVA', ordemId: o.id });
      if (!o.clubeId) problemas.push({ tipo: 'ORDEM_SEM_CLUBE', ordemId: o.id });
    });

    const travados = clubes
      .filter(c => Number(c.travadoAte || 0) > Date.now())
      .map(c => ({ clubeId: c.id, travadoAte: c.travadoAte }));

    return res.json({ ok: problemas.length === 0, problemas, travadosAtivos: travados });
  } catch (err) {
    console.error('Erro integridade mercado:', err);
    return res.status(500).json({ erro: 'Erro interno na checagem de integridade.' });
  }
});

router.post('/admin/freeze-clube', auth, (req, res) => {
  try {
    const usuario = req.usuario;
    if (!usuario || String(usuario.role || '').toLowerCase() !== 'admin') return res.status(403).json({ erro: 'Admin only' });

    const { clubeId, minutos = 10, motivo = 'freeze clube' } = req.body || {};
    if (!clubeId) return res.status(400).json({ erro: 'clubeId é obrigatório' });

    const state = antifraude.loadState();
    antifraude.freezeClube(state, clubeId, Number(minutos) * 60_000, motivo);
    antifraude.saveState(state);
    antifraude.logEvent({ userId: String(usuario.id), action: 'ADMIN_FREEZE_CLUBE', decision: 'BLOCK', clubeId: String(clubeId), reason: motivo });

    return res.json({ ok: true });
  } catch (e) {
    console.error('Erro freeze clube:', e);
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

router.post('/admin/unfreeze-clube', auth, (req, res) => {
  try {
    const usuario = req.usuario;
    if (!usuario || String(usuario.role || '').toLowerCase() !== 'admin') return res.status(403).json({ erro: 'Admin only' });

    const { clubeId } = req.body || {};
    if (!clubeId) return res.status(400).json({ erro: 'clubeId é obrigatório' });

    const state = antifraude.loadState();
    antifraude.unfreezeClube(state, clubeId);
    antifraude.saveState(state);
    antifraude.logEvent({ userId: String(usuario.id), action: 'ADMIN_UNFREEZE_CLUBE', decision: 'ALLOW', clubeId: String(clubeId) });

    return res.json({ ok: true });
  } catch (e) {
    console.error('Erro unfreeze clube:', e);
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

const { registrarNoLedger } = require('../utils/ledger');

const DATA_DIR = path.join(__dirname, '..', 'data');

function readJSON(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file)));
}

function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

/**
 * POST /mercado/admin/split
 * body: { clubeId: number, ratio: number }
 */
router.post('/admin/split', (req, res) => {
  try {
    const { clubeId, ratio } = req.body;

    if (!clubeId || !ratio || ratio <= 1) {
      return res.status(400).json({ erro: 'Parâmetros inválidos' });
    }

    let clubes = readJSON('clubes.json');
    let usuarios = readJSON('usuarios.json');
    let ordens = readJSON('ordens.json');
    let investimentos = readJSON('investimentos.json');

    const clube = clubes.find(c => c.id === clubeId);

    if (!clube) {
      return res.status(404).json({ erro: 'Clube não encontrado' });
    }

    console.log(`🔄 Executando split ${ratio}:1 no clube ${clube.nome}`);

    // =============================
    // 1. AJUSTAR CLUBE
    // =============================

    clube.preco = Number((clube.preco / ratio).toFixed(2));
    clube.precoAtual = Number((clube.precoAtual / ratio).toFixed(2));

    clube.cotasEmitidas = (clube.cotasEmitidas || 0) * ratio;
    clube.cotasDisponiveis = (clube.cotasDisponiveis || 0) * ratio;

    clube.splitFactorCumulativo = (clube.splitFactorCumulativo || 1) * ratio;

    if (!clube.splits) clube.splits = [];

    clube.splits.push({
      ratio,
      data: new Date().toISOString()
    });

    // =============================
    // 2. AJUSTAR USUÁRIOS
    // =============================

    usuarios.forEach(user => {
      if (!user.carteira) return;

      user.carteira.forEach(pos => {
        if (pos.clubeId === clubeId) {
          pos.quantidade = pos.quantidade * ratio;
          pos.precoMedio = Number((pos.precoMedio / ratio).toFixed(4));
        }
      });
    });

    // =============================
    // 3. AJUSTAR ORDENS ABERTAS
    // =============================

    ordens.forEach(ordem => {
      if (ordem.clubeId === clubeId && ordem.status === 'aberta') {
        ordem.quantidade = ordem.quantidade * ratio;
        ordem.restante = ordem.restante * ratio;
        ordem.preco = Number((ordem.preco / ratio).toFixed(2));
      }
    });

    // =============================
    // 4. AJUSTAR INVESTIMENTOS
    // =============================

    investimentos.forEach(inv => {
      if (inv.clubeId === clubeId) {
        inv.quantidade = inv.quantidade * ratio;
        inv.precoUnitario = Number((inv.precoUnitario / ratio).toFixed(4));
        // totalPago permanece igual
      }
    });

    // =============================
    // 5. SALVAR
    // =============================

    writeJSON('clubes.json', clubes);
    writeJSON('usuarios.json', usuarios);
    writeJSON('ordens.json', ordens);
    writeJSON('investimentos.json', investimentos);

    // =============================
    // 6. REGISTRAR NO LEDGER
    // =============================

    const { registrarSplit } = require('../utils/ledger');

registrarSplit({ clubeId, ratio });

    return res.json({
      sucesso: true,
      mensagem: `Split ${ratio}:1 executado com sucesso`
    });

  } catch (err) {
    console.error('Erro no split:', err);
    return res.status(500).json({ erro: 'Erro interno no split' });
  }
});
module.exports = router;









































































