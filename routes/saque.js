const express = require('express');
const path = require('path');
const router = express.Router();

const auth = require('../middleware/auth');
const antifraude = require('../utils/antifraude');
const audit = require('../utils/audit');
const storage = require('../utils/storage');
const ledger = require('../utils/ledger');

const usuariosPath = path.join(__dirname, '../data/usuarios.json');
const idempotencyPath = path.join(__dirname, '../data/idempotency.json');

function getIdempotencyKey(req) {
  return req.headers['idempotency-key'] || req.headers['Idempotency-Key'] || (req.body && (req.body.idempotencyKey || req.body.idempotency_key)) || null;
}
function prune(list, ttlMs = 10 * 60 * 1000) {
  const cutoff = Date.now() - ttlMs;
  return (Array.isArray(list) ? list : []).filter((x) => Number(x.ts || 0) >= cutoff);
}
async function findCached(key, usuarioId) {
  const list = prune(storage.readJSON(idempotencyPath, []));
  return list.find((x) => x.key === key && String(x.usuarioId) === String(usuarioId)) || null;
}
async function saveCached(key, usuarioId, status, body) {
  let list = prune(storage.readJSON(idempotencyPath, []));
  list.push({ key, usuarioId, ts: Date.now(), status, body });
  if (list.length > 3000) list = list.slice(list.length - 3000);
  await storage.writeJSON(idempotencyPath, list);
}

router.post('/', auth, async (req, res) => {
  try {
    const usuario = req.usuario;
    const valor = Number(req.body?.valor);
    const gateway = String(req.body?.gateway || 'manual');
    const autoConfirmar = req.body?.autoConfirmar !== false;
    const gatewayReference = req.body?.gatewayReference || null;
    const taxaSaque = Math.round((Number(req.body?.taxa ?? (valor * 0.01)) || 0) * 100) / 100;

    if (!Number.isFinite(valor) || valor <= 0) return res.status(400).json({ erro: 'valor inválido' });

    const ENABLE_WITHDRAWALS = String(process.env.ENABLE_WITHDRAWALS ?? 'true').toLowerCase();
    if (!['1', 'true', 'yes', 'on'].includes(ENABLE_WITHDRAWALS)) {
      return res.status(503).json({ erro: 'Saques temporariamente desabilitados.' });
    }

    const MAX_WITHDRAW_VALUE = Number(process.env.MAX_WITHDRAW_VALUE || 0);
    if (MAX_WITHDRAW_VALUE > 0 && valor > MAX_WITHDRAW_VALUE) {
      return res.status(400).json({ erro: `Valor máximo de saque excedido. Limite atual: R$ ${MAX_WITHDRAW_VALUE.toFixed(2)}.` });
    }

    const cd = antifraude.evaluateCooldown({ req, userId: usuario.id });
    if (!cd.ok) return res.status(cd.status).json(cd.body);

    const ip = antifraude.getClientIp(req);
    const vUser = antifraude.checkVelocity({ key: `uid:${usuario.id}`, action: 'SAQUE', limit: 10, windowMs: 60_000 });
    if (!vUser.ok) return res.status(429).json({ error: 'BLOQUEADO_ANTIFRAUDE', motivo: 'muitos saques em pouco tempo', cooldownMs: vUser.retryAfterMs });
    const vIp = antifraude.checkVelocity({ key: `ip:${ip}`, action: 'SAQUE', limit: 30, windowMs: 60_000 });
    if (!vIp.ok) return res.status(429).json({ error: 'BLOQUEADO_ANTIFRAUDE', motivo: 'muitos saques (IP) em pouco tempo', cooldownMs: vIp.retryAfterMs });

    const idemKey = getIdempotencyKey(req);
    if (idemKey) {
      const cached = await findCached(String(idemKey), usuario.id);
      if (cached) return res.status(cached.status).json(cached.body);
    }

    const usuarios = storage.readJSON(usuariosPath, []);
    const u = usuarios.find(x => String(x.id) === String(usuario.id));
    if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    const custoTotal = Math.round((valor + taxaSaque) * 100) / 100;
    if (Number(u.saldo || 0) < custoTotal) return res.status(400).json({ erro: 'Saldo insuficiente.' });

    const tx = ledger.createFinancialTx({
      tipo: 'SAQUE',
      usuarioId: usuario.id,
      valorBruto: valor,
      taxa: taxaSaque,
      gateway,
      gatewayReference,
      status: 'PENDENTE',
      metadata: { ip },
    });

    const financeiro = ledger.readFinancialTx();
    financeiro.push(tx);

    const pending = ledger.buildWithdrawPendingEntry({
      userId: usuario.id,
      amount: valor,
      fee: taxaSaque,
      provider: gateway,
      txId: tx.id
    });

    const pendingResult = await ledger.postJournal({
      action: pending.action,
      lines: pending.lines,
      meta: pending.meta,
      idemKey: `withdraw:pending:${tx.id}`,
      applyToUsuarios: { usuariosPath },
    });

    const pendingId = pendingResult.entry?.id || pendingResult.entryId;
    if (pendingId) tx.ledgerEntryIds.push(pendingId);
    tx.status = autoConfirmar ? 'PROCESSANDO' : 'PENDENTE';
    tx.updatedAt = new Date().toISOString();

    if (autoConfirmar) {
      const confirmed = ledger.buildWithdrawConfirmEntry({
        userId: usuario.id,
        amount: valor,
        fee: taxaSaque,
        provider: gateway,
        txId: tx.id,
        gatewayReference,
      });

      const confirmedResult = await ledger.postJournal({
        action: confirmed.action,
        lines: confirmed.lines,
        meta: confirmed.meta,
        idemKey: `withdraw:confirm:${tx.id}`,
      });

      const confirmedId = confirmedResult.entry?.id || confirmedResult.entryId;
      if (confirmedId) tx.ledgerEntryIds.push(confirmedId);
      tx.status = 'CONFIRMADO';
      tx.reconciliacaoStatus = 'RECONCILIADO';
      tx.reconciliadoEm = new Date().toISOString();
    }

    await ledger.writeFinancialTx(financeiro);

    const saldo = storage.readJSON(usuariosPath, []).find(x => String(x.id) === String(usuario.id))?.saldo;
    const body = { ok: true, transacao: tx, saldo };

    audit.logEvent({
      kind: 'FINANCE',
      action: autoConfirmar ? 'SAQUE_CONFIRMADO' : 'SAQUE_PENDENTE',
      userId: usuario.id,
      valor,
      taxa: taxaSaque,
      txId: tx.id,
      gatewayReference,
    });

    if (idemKey) await saveCached(String(idemKey), usuario.id, 200, body);
    return res.json(body);
  } catch (e) {
    audit.logEvent({ kind: 'FINANCE', action: 'SAQUE_FAIL', userId: req.usuario?.id || null, error: String(e) });
    return res.status(500).json({ erro: 'Erro interno ao processar saque.' });
  }
});

router.post('/confirmar', auth, async (req, res) => {
  try {
    const role = String(req.usuario?.role || '').toLowerCase();
    if (role !== 'admin') return res.status(403).json({ erro: 'Acesso restrito a administradores.' });

    const { transacaoId } = req.body || {};
    if (!transacaoId) return res.status(400).json({ erro: 'transacaoId é obrigatório.' });

    const financeiro = ledger.readFinancialTx();
    const ix = financeiro.findIndex(t => String(t.id) === String(transacaoId));
    if (ix < 0) return res.status(404).json({ erro: 'Transação não encontrada.' });

    const tx = financeiro[ix];
    if (tx.tipo !== 'SAQUE') return res.status(400).json({ erro: 'Tipo inválido.' });
    if (tx.status === 'CONFIRMADO') return res.json({ ok: true, transacao: tx });

    const confirmed = ledger.buildWithdrawConfirmEntry({
      userId: tx.usuarioId,
      amount: tx.valorBruto,
      fee: tx.taxa,
      provider: tx.gateway,
      txId: tx.id,
      gatewayReference: tx.gatewayReference || null,
    });

    const confirmedResult = await ledger.postJournal({
      action: confirmed.action,
      lines: confirmed.lines,
      meta: confirmed.meta,
      idemKey: `withdraw:confirm:${tx.id}`,
    });

    const confirmedId = confirmedResult.entry?.id || confirmedResult.entryId;
    if (confirmedId) tx.ledgerEntryIds.push(confirmedId);
    tx.status = 'CONFIRMADO';
    tx.reconciliacaoStatus = 'RECONCILIADO';
    tx.reconciliadoEm = new Date().toISOString();
    tx.updatedAt = new Date().toISOString();

    await ledger.writeFinancialTx(financeiro);
    return res.json({ ok: true, transacao: tx });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno ao confirmar saque.' });
  }
});

router.get('/gateway/:gatewayReference', auth, async (req, res) => {
  try {
    const { gatewayReference } = req.params;
    const tx = ledger.findFinancialTxByGatewayReference(gatewayReference);
    if (!tx) return res.status(404).json({ erro: 'Transação não encontrada.' });

    const role = String(req.usuario?.role || '').toLowerCase();
    if (String(tx.usuarioId) !== String(req.usuario?.id) && role !== 'admin') {
      return res.status(403).json({ erro: 'Acesso negado.' });
    }

    return res.json({ ok: true, transacao: tx });
  } catch (e) {
    return res.status(500).json({ erro: 'Erro interno ao consultar transação.' });
  }
});

router.post('/webhook', async (req, res) => {
  try {
    const secret = process.env.GATEWAY_WEBHOOK_SECRET || '';
    const provided = req.headers['x-gateway-secret'] || req.headers['x-webhook-secret'] || '';
    if (secret && String(provided) !== String(secret)) {
      return res.status(401).json({ erro: 'Webhook não autorizado.' });
    }

    const { gatewayReference, status } = req.body || {};
    if (!gatewayReference || !status) {
      return res.status(400).json({ erro: 'gatewayReference e status são obrigatórios.' });
    }

    const tx = ledger.findFinancialTxByGatewayReference(gatewayReference);
    if (!tx) return res.status(404).json({ erro: 'Transação não encontrada.' });

    const normalized = String(status).toUpperCase();

    if (normalized === 'PAID' || normalized === 'COMPLETED' || normalized === 'CONFIRMED') {
      const confirmed = ledger.buildWithdrawConfirmEntry({
        userId: tx.usuarioId,
        amount: tx.valorBruto,
        fee: tx.taxa,
        provider: tx.gateway,
        txId: tx.id,
        gatewayReference,
      });

      const confirmedResult = await ledger.postJournal({
        action: confirmed.action,
        lines: confirmed.lines,
        meta: confirmed.meta,
        idemKey: `withdraw:confirm:${tx.id}`,
      });

      const confirmedId = confirmedResult.entry?.id || confirmedResult.entryId;

      await ledger.updateFinancialTx(tx.id, (prev) => ({
        ...prev,
        status: 'CONFIRMADO',
        gatewayReference,
        reconciliacaoStatus: 'RECONCILIADO',
        reconciliadoEm: new Date().toISOString(),
        ledgerEntryIds: confirmedId ? [...(prev.ledgerEntryIds || []), confirmedId] : (prev.ledgerEntryIds || []),
      }));
    } else if (normalized === 'FAILED' || normalized === 'CANCELLED' || normalized === 'REJECTED') {
      const cancelled = ledger.buildWithdrawCancelEntry({
        userId: tx.usuarioId,
        amount: tx.valorBruto,
        fee: tx.taxa,
        provider: tx.gateway,
        txId: tx.id,
        gatewayReference,
      });

      const cancelledResult = await ledger.postJournal({
        action: cancelled.action,
        lines: cancelled.lines,
        meta: cancelled.meta,
        idemKey: `withdraw:cancel:${tx.id}`,
        applyToUsuarios: { usuariosPath },
      });

      const cancelledId = cancelledResult.entry?.id || cancelledResult.entryId;

      await ledger.updateFinancialTx(tx.id, (prev) => ({
        ...prev,
        status: normalized === 'FAILED' ? 'FALHOU' : 'CANCELADO',
        gatewayReference,
        reconciliacaoStatus: 'RECONCILIADO',
        reconciliadoEm: new Date().toISOString(),
        ledgerEntryIds: cancelledId ? [...(prev.ledgerEntryIds || []), cancelledId] : (prev.ledgerEntryIds || []),
      }));
    } else {
      return res.status(400).json({ erro: 'status de webhook não suportado.' });
    }

    audit.logEvent({
      kind: 'FINANCE',
      action: 'SAQUE_WEBHOOK',
      gatewayReference,
      status: normalized,
      txId: tx.id,
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error('[SAQUE WEBHOOK] erro:', e);
    return res.status(500).json({ erro: 'Erro interno no webhook de saque.' });
  }
});

module.exports = router;
