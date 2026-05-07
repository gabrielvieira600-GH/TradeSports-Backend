const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth');
const antifraude = require('../utils/antifraude');
const audit = require('../utils/audit');
const ledger = require('../utils/ledger');
const { runTx, round2 } = require('../utils/tx');

const User = require('../models/User');
const Investment = require('../models/Investment');

function getIdempotencyKey(req) {
  return (
    req.headers['idempotency-key'] ||
    req.headers['Idempotency-Key'] ||
    (req.body && (req.body.idempotencyKey || req.body.idempotency_key)) ||
    null
  );
}

async function registrarDepositoNoHistorico({ userDoc, txDoc, valor, gateway, gatewayReference, session }) {
  await Investment.create(
    [
      {
        legacyId: `dep_${userDoc.legacyId || userDoc._id}_${Date.now()}`,
        usuarioId: userDoc._id,
        usuarioLegacyId: userDoc.legacyId ?? null,
        clubeId: null,
        clubeLegacyId: null,
        clubeNome: '',
        quantidade: 0,
        precoUnitario: round2(valor),
        valorUnitario: round2(valor),
        totalPago: round2(valor),
        tipo: 'DEPOSITO',
        origem: 'FINANCEIRO',
        data: new Date(),
        metadata: {
          financialTransactionId: txDoc.id,
          gateway,
          gatewayReference,
        },
      },
    ],
    { session }
  );
}

async function confirmarDeposito({ tx, session, gatewayReference = null }) {
  if (tx.status === 'CONFIRMADO') return tx;

  const userDoc = await User.findById(tx.usuarioId).session(session);
  if (!userDoc) {
    const err = new Error('Usuário não encontrado.');
    err.status = 404;
    throw err;
  }

  const confirmed = ledger.buildDepositConfirmEntry({
    userId: tx.usuarioId,
    amount: tx.valorBruto,
    provider: tx.gateway,
    txId: tx.id,
    gatewayReference: gatewayReference || tx.gatewayReference || null,
  });

  const confirmedResult = await ledger.postJournal({
    action: confirmed.action,
    lines: confirmed.lines,
    meta: confirmed.meta,
    idemKey: `deposit:confirm:${tx.id}`,
    session,
  });

  userDoc.saldo = round2(Number(userDoc.saldo || 0) + Number(tx.valorBruto || 0));
  await userDoc.save({ session });

  const ledgerEntryIds = confirmedResult?.entry?.id
    ? Array.from(new Set([...(tx.ledgerEntryIds || []), confirmedResult.entry.id]))
    : tx.ledgerEntryIds || [];

  const txDoc = await ledger.updateFinancialTx(
    tx.id,
    (prev) => ({
      ...prev,
      status: 'CONFIRMADO',
      gatewayReference: gatewayReference || prev.gatewayReference || null,
      reconciliacaoStatus: 'RECONCILIADO',
      reconciliadoEm: new Date(),
      ledgerEntryIds,
    }),
    session
  );

  await registrarDepositoNoHistorico({
    userDoc,
    txDoc,
    valor: tx.valorBruto,
    gateway: tx.gateway,
    gatewayReference: gatewayReference || tx.gatewayReference || null,
    session,
  });

  return { ...txDoc, saldo: round2(userDoc.saldo || 0) };
}

router.post('/', auth, async (req, res) => {
  try {
    const usuario = req.usuario;
    const valor = Number(req.body?.valor);
    const gateway = String(req.body?.gateway || 'manual');
    const autoConfirmar = req.body?.autoConfirmar !== false;
    const gatewayReference = req.body?.gatewayReference || null;

    if (!Number.isFinite(valor) || valor <= 0) {
      return res.status(400).json({ erro: 'valor inválido' });
    }

    const enableDeposits = String(process.env.ENABLE_DEPOSITS ?? 'true').toLowerCase();
    if (!['1', 'true', 'yes', 'on'].includes(enableDeposits)) {
      return res.status(503).json({ erro: 'Depósitos temporariamente desabilitados.' });
    }

    const maxDeposit = Number(process.env.MAX_DEPOSIT_VALUE || 0);
    if (maxDeposit > 0 && valor > maxDeposit) {
      return res.status(400).json({ erro: `Valor máximo de depósito excedido. Limite atual: R$ ${maxDeposit.toFixed(2)}.` });
    }

    const cd = antifraude.evaluateCooldown({ req, userId: usuario.id });
    if (!cd.ok) return res.status(cd.status).json(cd.body);

    const ip = antifraude.getClientIp(req);
    const vUser = antifraude.checkVelocity({ key: `uid:${usuario.id}`, action: 'DEPOSITO', limit: 10, windowMs: 60_000 });
    if (!vUser.ok) {
      return res.status(429).json({ error: 'BLOQUEADO_ANTIFRAUDE', motivo: 'muitos depósitos em pouco tempo', cooldownMs: vUser.retryAfterMs });
    }

    const vIp = antifraude.checkVelocity({ key: `ip:${ip}`, action: 'DEPOSITO', limit: 30, windowMs: 60_000 });
    if (!vIp.ok) {
      return res.status(429).json({ error: 'BLOQUEADO_ANTIFRAUDE', motivo: 'muitos depósitos (IP) em pouco tempo', cooldownMs: vIp.retryAfterMs });
    }

    const idemKey = getIdempotencyKey(req);
    if (idemKey) {
      const cached = await ledger.getHttpIdempotency({ key: String(idemKey), userId: usuario.id });
      if (cached?.body) return res.status(Number(cached.status || 200)).json(cached.body);
    }

    const body = await runTx({
      action: 'DEPOSITO_ROUTE',
      meta: { userId: usuario.id, valor, gateway, autoConfirmar },
      mutate: async (session) => {
        const userDoc = await User.findById(usuario.id).session(session);
        if (!userDoc) {
          const err = new Error('Usuário não encontrado.');
          err.status = 404;
          throw err;
        }

        let txDoc = await ledger.createFinancialTx({
          tipo: 'DEPOSITO',
          usuarioId: usuario.id,
          valorBruto: round2(valor),
          taxa: 0,
          gateway,
          gatewayReference,
          status: 'PENDENTE',
          metadata: { ip },
          session,
        });

        const pending = ledger.buildDepositPendingEntry({ userId: usuario.id, amount: valor, provider: gateway, txId: txDoc.id });
        const pendingResult = await ledger.postJournal({
          action: pending.action,
          lines: pending.lines,
          meta: pending.meta,
          idemKey: `deposit:pending:${txDoc.id}`,
          session,
        });

        txDoc = await ledger.updateFinancialTx(
          txDoc.id,
          (prev) => ({
            ...prev,
            status: autoConfirmar ? 'PROCESSANDO' : 'PENDENTE',
            ledgerEntryIds: pendingResult?.entry?.id
              ? [...(prev.ledgerEntryIds || []), pendingResult.entry.id]
              : prev.ledgerEntryIds || [],
          }),
          session
        );

        let saldo = round2(userDoc.saldo || 0);
        if (autoConfirmar) {
          txDoc = await confirmarDeposito({ tx: txDoc, session, gatewayReference });
          saldo = round2(txDoc.saldo || 0);
        }

        const responseBody = { ok: true, transacao: txDoc, saldo };

        if (idemKey) {
          await ledger.saveHttpIdempotency({ key: String(idemKey), userId: usuario.id, status: 200, body: responseBody, session });
        }

        await audit.logEvent(
          { kind: 'FINANCE', action: autoConfirmar ? 'DEPOSITO_CONFIRMADO' : 'DEPOSITO_PENDENTE', userId: usuario.id, valor, txId: txDoc.id, gatewayReference },
          session
        );

        return responseBody;
      },
    });

    return res.json(body);
  } catch (e) {
    await audit.logEvent({ kind: 'FINANCE', action: 'DEPOSITO_FAIL', userId: req.usuario?.id || null, error: String(e) });
    return res.status(Number(e.status || 500)).json({ erro: e.status ? e.message : 'Erro interno ao processar depósito.' });
  }
});

router.post('/confirmar', auth, async (req, res) => {
  try {
    const role = String(req.usuario?.role || '').toLowerCase();
    if (role !== 'admin') return res.status(403).json({ erro: 'Acesso restrito a administradores.' });

    const { transacaoId } = req.body || {};
    if (!transacaoId) return res.status(400).json({ erro: 'transacaoId é obrigatório.' });

    const body = await runTx({
      action: 'DEPOSITO_CONFIRMAR_ADMIN',
      meta: { transacaoId, adminUserId: req.usuario.id },
      mutate: async (session) => {
        const tx = await ledger.findFinancialTxById(transacaoId, session);
        if (!tx) {
          const err = new Error('Transação não encontrada.');
          err.status = 404;
          throw err;
        }
        if (tx.tipo !== 'DEPOSITO') {
          const err = new Error('Tipo inválido.');
          err.status = 400;
          throw err;
        }
        const txDoc = await confirmarDeposito({ tx, session });
        return { ok: true, transacao: txDoc, saldo: txDoc.saldo };
      },
    });

    return res.json(body);
  } catch (e) {
    return res.status(Number(e.status || 500)).json({ erro: e.status ? e.message : 'Erro interno ao confirmar depósito.' });
  }
});

router.get('/gateway/:gatewayReference', auth, async (req, res) => {
  try {
    const { gatewayReference } = req.params;
    const tx = await ledger.findFinancialTxByGatewayReference(gatewayReference);
    if (!tx) return res.status(404).json({ erro: 'Transação não encontrada.' });

    const role = String(req.usuario?.role || '').toLowerCase();
    if (String(tx.usuarioId) !== String(req.usuario?.id) && role !== 'admin') {
      return res.status(403).json({ erro: 'Acesso negado.' });
    }

    return res.json({ ok: true, transacao: tx });
  } catch (_) {
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

    const normalized = String(status).toUpperCase();

    const body = await runTx({
      action: 'DEPOSITO_WEBHOOK',
      meta: { gatewayReference, status: normalized },
      mutate: async (session) => {
        let tx = await ledger.findFinancialTxByGatewayReference(gatewayReference, session);

        if (!tx && ['APPROVED', 'CONFIRMED', 'PAID', 'COMPLETED'].includes(normalized) && usuarioId && Number(valor) > 0) {
          tx = await ledger.createFinancialTx({
            tipo: 'DEPOSITO',
            usuarioId,
            valorBruto: round2(valor),
            taxa: 0,
            gateway: provider,
            gatewayReference,
            status: 'PROCESSANDO',
            metadata: { webhookCreated: true },
            session,
          });

          const pending = ledger.buildDepositPendingEntry({ userId: tx.usuarioId, amount: tx.valorBruto, provider, txId: tx.id });
          const pendingResult = await ledger.postJournal({
            action: pending.action,
            lines: pending.lines,
            meta: pending.meta,
            idemKey: `deposit:pending:${tx.id}`,
            session,
          });

          tx = await ledger.updateFinancialTx(
            tx.id,
            (prev) => ({
              ...prev,
              status: 'PROCESSANDO',
              ledgerEntryIds: pendingResult?.entry?.id
                ? [...(prev.ledgerEntryIds || []), pendingResult.entry.id]
                : prev.ledgerEntryIds || [],
            }),
            session
          );
        }

        if (!tx) {
          const err = new Error('Transação não encontrada.');
          err.status = 404;
          throw err;
        }

        if (['APPROVED', 'CONFIRMED', 'PAID', 'COMPLETED'].includes(normalized)) {
          tx = await confirmarDeposito({ tx, session, gatewayReference });
        } else if (['FAILED', 'CANCELLED', 'CANCELED', 'REJECTED', 'EXPIRED'].includes(normalized)) {
          tx = await ledger.updateFinancialTx(
            tx.id,
            (prev) => ({
              ...prev,
              status: 'CANCELADO',
              gatewayReference,
              reconciliacaoStatus: 'RECONCILIADO',
              reconciliadoEm: new Date(),
            }),
            session
          );
        } else if (['PENDING', 'PROCESSING', 'IN_PROCESS'].includes(normalized)) {
          tx = await ledger.updateFinancialTx(
            tx.id,
            (prev) => ({ ...prev, status: 'PROCESSANDO', gatewayReference }),
            session
          );
        } else {
          const err = new Error('status de webhook não suportado.');
          err.status = 400;
          throw err;
        }

        return { ok: true, transacao: tx, saldo: tx.saldo };
      },
    });

    return res.json(body);
  } catch (e) {
    return res.status(Number(e.status || 500)).json({ erro: e.status ? e.message : 'Erro interno no webhook de depósito.' });
  }
});

module.exports = router;