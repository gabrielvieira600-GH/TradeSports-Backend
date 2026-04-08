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

    if (!Number.isFinite(valor) || valor <= 0) return res.status(400).json({ erro: 'valor inválido' });

    const ENABLE_DEPOSITS = String(process.env.ENABLE_DEPOSITS ?? 'true').toLowerCase();
    if (!['1', 'true', 'yes', 'on'].includes(ENABLE_DEPOSITS)) {
      return res.status(503).json({ erro: 'Depósitos temporariamente desabilitados.' });
    }

    const MAX_DEPOSIT_VALUE = Number(process.env.MAX_DEPOSIT_VALUE || 0);
    if (MAX_DEPOSIT_VALUE > 0 && valor > MAX_DEPOSIT_VALUE) {
      return res.status(400).json({ erro: `Valor máximo de depósito excedido. Limite atual: R$ ${MAX_DEPOSIT_VALUE.toFixed(2)}.` });
    }

    const cd = antifraude.evaluateCooldown({ req, userId: usuario.id });
    if (!cd.ok) return res.status(cd.status).json(cd.body);

    const ip = antifraude.getClientIp(req);
    const vUser = antifraude.checkVelocity({ key: `uid:${usuario.id}`, action: 'DEPOSITO', limit: 10, windowMs: 60_000 });
    if (!vUser.ok) return res.status(429).json({ error: 'BLOQUEADO_ANTIFRAUDE', motivo: 'muitos depósitos em pouco tempo', cooldownMs: vUser.retryAfterMs });
    const vIp = antifraude.checkVelocity({ key: `ip:${ip}`, action: 'DEPOSITO', limit: 30, windowMs: 60_000 });
    if (!vIp.ok) return res.status(429).json({ error: 'BLOQUEADO_ANTIFRAUDE', motivo: 'muitos depósitos (IP) em pouco tempo', cooldownMs: vIp.retryAfterMs });

    const idemKey = getIdempotencyKey(req);
    if (idemKey) {
      const cached = await findCached(String(idemKey), usuario.id);
      if (cached) return res.status(cached.status).json(cached.body);
    }

    const tx = ledger.createFinancialTx({
      tipo: 'DEPOSITO',
      usuarioId: usuario.id,
      valorBruto: valor,
      taxa: 0,
      gateway,
      gatewayReference,
      status: 'PENDENTE',
      metadata: { ip },
    });

    const financeiro = ledger.readFinancialTx();
    financeiro.push(tx);

    const pending = ledger.buildDepositPendingEntry({ userId: usuario.id, amount: valor, provider: gateway, txId: tx.id });
    const pendingResult = await ledger.postJournal({
      action: pending.action, lines: pending.lines, meta: pending.meta, idemKey: `deposit:pending:${tx.id}`,
    });
    const pendingId = pendingResult.entry?.id || pendingResult.entryId;
    if (pendingId) tx.ledgerEntryIds.push(pendingId);
    tx.status = autoConfirmar ? 'PROCESSANDO' : 'PENDENTE';
    tx.updatedAt = new Date().toISOString();

    if (autoConfirmar) {
      const confirmed = ledger.buildDepositConfirmEntry({ userId: usuario.id, amount: valor, provider: gateway, txId: tx.id });
      const confirmedResult = await ledger.postJournal({
        action: confirmed.action,
        lines: confirmed.lines,
        meta: confirmed.meta,
        idemKey: `deposit:confirm:${tx.id}`,
        applyToUsuarios: { usuariosPath },
      });
      const confirmedId = confirmedResult.entry?.id || confirmedResult.entryId;
      if (confirmedId) tx.ledgerEntryIds.push(confirmedId);
      tx.status = 'CONFIRMADO';
      tx.reconciliacaoStatus = 'RECONCILIADO';
      tx.reconciliadoEm = new Date().toISOString();
    }

    await ledger.writeFinancialTx(financeiro);

    const saldo = autoConfirmar ? storage.readJSON(usuariosPath, []).find(u => String(u.id) === String(usuario.id))?.saldo : undefined;
    const body = { ok: true, transacao: tx, saldo };

    audit.logEvent({ kind: 'FINANCE', action: autoConfirmar ? 'DEPOSITO_CONFIRMADO' : 'DEPOSITO_PENDENTE', userId: usuario.id, valor, txId: tx.id });
    if (idemKey) await saveCached(String(idemKey), usuario.id, 200, body);
    return res.json(body);
  } catch (e) {
    audit.logEvent({ kind: 'FINANCE', action: 'DEPOSITO_FAIL', userId: req.usuario?.id || null, error: String(e) });
    return res.status(500).json({ erro: 'Erro interno ao processar depósito.' });
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
    if (tx.tipo !== 'DEPOSITO') return res.status(400).json({ erro: 'Tipo inválido.' });
    if (tx.status === 'CONFIRMADO') return res.json({ ok: true, transacao: tx });

    const confirmed = ledger.buildDepositConfirmEntry({ userId: tx.usuarioId, amount: tx.valorBruto, provider: tx.gateway, txId: tx.id });
    const confirmedResult = await ledger.postJournal({
      action: confirmed.action,
      lines: confirmed.lines,
      meta: confirmed.meta,
      idemKey: `deposit:confirm:${tx.id}`,
      applyToUsuarios: { usuariosPath },
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
    return res.status(500).json({ erro: 'Erro interno ao confirmar depósito.' });
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

    const { gatewayReference, status, valor, provider = 'gateway', usuarioId } = req.body || {};
    if (!gatewayReference || !status) {
      return res.status(400).json({ erro: 'gatewayReference e status são obrigatórios.' });
    }

    let tx = ledger.findFinancialTxByGatewayReference(gatewayReference);

    if (!tx && String(status).toUpperCase() === 'APPROVED' && usuarioId && Number(valor) > 0) {
      tx = ledger.createFinancialTx({
        tipo: 'DEPOSITO',
        usuarioId,
        valorBruto: Number(valor),
        taxa: 0,
        gateway: provider,
        gatewayReference,
        status: 'PROCESSANDO',
        metadata: { webhookCreated: true },
      });
      const financeiro = ledger.readFinancialTx();
      financeiro.push(tx);
      await ledger.writeFinancialTx(financeiro);

      const pending = ledger.buildDepositPendingEntry({ userId: tx.usuarioId, amount: tx.valorBruto, provider, txId: tx.id });
      const pendingResult = await ledger.postJournal({
        action: pending.action,
        lines: pending.lines,
        meta: pending.meta,
        idemKey: `deposit:pending:${tx.id}`,
      });
      const pendingId = pendingResult.entry?.id || pendingResult.entryId;
      if (pendingId) {
        tx = await ledger.updateFinancialTx(tx.id, (prev) => ({
          ...prev,
          status: 'PROCESSANDO',
          ledgerEntryIds: [...(prev.ledgerEntryIds || []), pendingId]
        }));
      }
    }

    if (!tx) return res.status(404).json({ erro: 'Transação não encontrada.' });

    const normalized = String(status).toUpperCase();

    if (normalized === 'APPROVED' || normalized === 'CONFIRMED') {
      const confirmed = ledger.buildDepositConfirmEntry({
        userId: tx.usuarioId,
        amount: tx.valorBruto,
        provider: tx.gateway,
        txId: tx.id,
        gatewayReference,
      });
      const confirmedResult = await ledger.postJournal({
        action: confirmed.action,
        lines: confirmed.lines,
        meta: confirmed.meta,
        idemKey: `deposit:confirm:${tx.id}`,
        applyToUsuarios: { usuariosPath },
      });
      const confirmedId = confirmedResult.entry?.id || confirmedResult.entryId;
      tx = await ledger.updateFinancialTx(tx.id, (prev) => ({
        ...prev,
        status: 'CONFIRMADO',
        gatewayReference,
        reconciliacaoStatus: 'RECONCILIADO',
        reconciliadoEm: new Date().toISOString(),
        ledgerEntryIds: confirmedId ? [...(prev.ledgerEntryIds || []), confirmedId] : (prev.ledgerEntryIds || [])
      }));
    } else if (normalized === 'REFUNDED' || normalized === 'CHARGEBACK' || normalized === 'REVERSED') {
      const reversed = ledger.buildDepositReversalEntry({
        userId: tx.usuarioId,
        amount: tx.valorBruto,
        provider: tx.gateway,
        txId: tx.id,
        gatewayReference,
      });
      const reversedResult = await ledger.postJournal({
        action: reversed.action,
        lines: reversed.lines,
        meta: reversed.meta,
        idemKey: `deposit:reverse:${tx.id}`,
      });
      const reversedId = reversedResult.entry?.id || reversedResult.entryId;
      tx = await ledger.updateFinancialTx(tx.id, (prev) => ({
        ...prev,
        status: 'ESTORNADO',
        gatewayReference,
        reconciliacaoStatus: 'RECONCILIADO',
        reconciliadoEm: new Date().toISOString(),
        ledgerEntryIds: reversedId ? [...(prev.ledgerEntryIds || []), reversedId] : (prev.ledgerEntryIds || [])
      }));
    } else if (normalized === 'FAILED' || normalized === 'CANCELLED') {
      tx = await ledger.updateFinancialTx(tx.id, {
        status: normalized === 'FAILED' ? 'FALHOU' : 'CANCELADO',
        gatewayReference,
        reconciliacaoStatus: 'RECONCILIADO',
        reconciliadoEm: new Date().toISOString(),
      });
    } else {
      return res.status(400).json({ erro: 'status de webhook não suportado.' });
    }

    audit.logEvent({ kind: 'FINANCE', action: 'DEPOSITO_WEBHOOK', gatewayReference, status: normalized, txId: tx.id });
    return res.json({ ok: true, transacao: tx });
  } catch (e) {
    console.error('[DEPOSITO WEBHOOK] erro:', e);
    return res.status(500).json({ erro: 'Erro interno no webhook de depósito.' });
  }
});

module.exports = router;
