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

router.post('/', auth, async (req, res) => {

  try {

    const usuario = req.usuario;

    const valor = Number(req.body?.valor);

    const gateway = String(req.body?.gateway || 'manual');

    const autoConfirmar = req.body?.autoConfirmar !== false;

    const gatewayReference = req.body?.gatewayReference || null;

    const taxaSaque = round2(Number(req.body?.taxa ?? valor * 0.01) || 0);

    if (!Number.isFinite(valor) || valor <= 0) {

      return res.status(400).json({ erro: 'valor inválido' });

    }

    const enableWithdrawals = String(process.env.ENABLE_WITHDRAWALS ?? 'true').toLowerCase();

    if (!['1', 'true', 'yes', 'on'].includes(enableWithdrawals)) {

      return res.status(503).json({ erro: 'Saques temporariamente desabilitados.' });

    }

    const maxWithdraw = Number(process.env.MAX_WITHDRAW_VALUE || 0);

    if (maxWithdraw > 0 && valor > maxWithdraw) {

      return res

        .status(400)

        .json({ erro: `Valor máximo de saque excedido. Limite atual: R$ ${maxWithdraw.toFixed(2)}.` });

    }

    const cd = antifraude.evaluateCooldown({ req, userId: usuario.id });

    if (!cd.ok) return res.status(cd.status).json(cd.body);

    const ip = antifraude.getClientIp(req);

    const vUser = antifraude.checkVelocity({

      key: `uid:${usuario.id}`,

      action: 'SAQUE',

      limit: 10,

      windowMs: 60_000,

    });

    if (!vUser.ok) {

      return res.status(429).json({

        error: 'BLOQUEADO_ANTIFRAUDE',

        motivo: 'muitos saques em pouco tempo',

        cooldownMs: vUser.retryAfterMs,

      });

    }

    const vIp = antifraude.checkVelocity({

      key: `ip:${ip}`,

      action: 'SAQUE',

      limit: 30,

      windowMs: 60_000,

    });

    if (!vIp.ok) {

      return res.status(429).json({

        error: 'BLOQUEADO_ANTIFRAUDE',

        motivo: 'muitos saques (IP) em pouco tempo',

        cooldownMs: vIp.retryAfterMs,

      });

    }

    const idemKey = getIdempotencyKey(req);

    if (idemKey) {

      const cached = await ledger.getHttpIdempotency({

        key: String(idemKey),

        userId: usuario.id,

      });

      if (cached?.body) {

        return res.status(Number(cached.status || 200)).json(cached.body);

      }

    }

    const body = await runTx({

      action: 'SAQUE_ROUTE',

      meta: { userId: usuario.id, valor, gateway, autoConfirmar },

      mutate: async (session) => {

        const userDoc = await User.findById(usuario.id).session(session);

        if (!userDoc) {

          const err = new Error('Usuário não encontrado.');

          err.status = 404;

          throw err;

        }

        const custoTotal = round2(valor + taxaSaque);

        if (Number(userDoc.saldo || 0) < custoTotal) {

          const err = new Error('Saldo insuficiente.');

          err.status = 400;

          throw err;

        }

        const tx = await ledger.createFinancialTx({

          tipo: 'SAQUE',

          usuarioId: usuario.id,

          valorBruto: valor,

          taxa: taxaSaque,

          gateway,

          gatewayReference,

          status: 'PENDENTE',

          metadata: { ip },

          session,

        });

        const saldoAntes = round2(userDoc.saldo || 0);

        userDoc.saldo = round2(saldoAntes - custoTotal);

        await userDoc.save({ session });

        const pending = ledger.buildWithdrawPendingEntry({

          userId: usuario.id,

          amount: valor,

          fee: taxaSaque,

          provider: gateway,

          txId: tx.id,

        });

        const pendingResult = await ledger.postJournal({

          action: pending.action,

          lines: pending.lines,

          meta: pending.meta,

          idemKey: `withdraw:pending:${tx.id}`,

          session,

        });

        let txDoc = await ledger.updateFinancialTx(

          tx.id,

          (prev) => ({

            ...prev,

            status: autoConfirmar ? 'PROCESSANDO' : 'PENDENTE',

            ledgerEntryIds: pendingResult?.entry?.id

              ? [...(prev.ledgerEntryIds || []), pendingResult.entry.id]

              : prev.ledgerEntryIds || [],

          }),

          session

        );

        await Investment.create(

          [

            {

              legacyId: `saq_${userDoc.legacyId || userDoc._id}_${Date.now()}`,

              usuarioId: userDoc._id,

              usuarioLegacyId: userDoc.legacyId ?? null,

              clubeId: null,

              clubeLegacyId: null,

              clubeNome: '',

              quantidade: 0,

              precoUnitario: round2(valor),

              valorUnitario: round2(valor),

              totalPago: round2(valor),

              tipo: 'SAQUE',

              origem: 'FINANCEIRO',

              data: new Date(),

              metadata: {

                financialTransactionId: txDoc.id,

                gateway,

                gatewayReference,

                taxa: taxaSaque,

              },

            },

          ],

          { session }

        );

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

            session,

          });

          txDoc = await ledger.updateFinancialTx(

            tx.id,

            (prev) => ({

              ...prev,

              status: 'CONFIRMADO',

              reconciliacaoStatus: 'RECONCILIADO',

              reconciliadoEm: new Date(),

              ledgerEntryIds: confirmedResult?.entry?.id

                ? [...(prev.ledgerEntryIds || []), confirmedResult.entry.id]

                : prev.ledgerEntryIds || [],

            }),

            session

          );

        }

        const responseBody = { ok: true, transacao: txDoc, saldo: round2(userDoc.saldo || 0) };

        if (idemKey) {

          await ledger.saveHttpIdempotency({

            key: String(idemKey),

            userId: usuario.id,

            status: 200,

            body: responseBody,

            session,

          });

        }

        await audit.logEvent(

          {

            kind: 'FINANCE',

            action: autoConfirmar ? 'SAQUE_CONFIRMADO' : 'SAQUE_PENDENTE',

            userId: usuario.id,

            valor,

            taxa: taxaSaque,

            txId: txDoc.id,

            gatewayReference,

          },

          session

        );

        return responseBody;

      },

    });

    return res.json(body);

  } catch (e) {

    await audit.logEvent({

      kind: 'FINANCE',

      action: 'SAQUE_FAIL',

      userId: req.usuario?.id || null,

      error: String(e),

    });

    return res.status(Number(e.status || 500)).json({

      erro: e.status ? e.message : 'Erro interno ao processar saque.',

    });

  }

});

router.post('/confirmar', auth, async (req, res) => {

  try {

    const role = String(req.usuario?.role || '').toLowerCase();

    if (role !== 'admin') {

      return res.status(403).json({ erro: 'Acesso restrito a administradores.' });

    }

    const { transacaoId } = req.body || {};

    if (!transacaoId) {

      return res.status(400).json({ erro: 'transacaoId é obrigatório.' });

    }

    const body = await runTx({

      action: 'SAQUE_CONFIRMAR_ADMIN',

      meta: { transacaoId, adminUserId: req.usuario.id },

      mutate: async (session) => {

        let tx = await ledger.findFinancialTxById(transacaoId, session);

        if (!tx) {

          const err = new Error('Transação não encontrada.');

          err.status = 404;

          throw err;

        }

        if (tx.tipo !== 'SAQUE') {

          const err = new Error('Tipo inválido.');

          err.status = 400;

          throw err;

        }

        if (tx.status === 'CONFIRMADO') {

          return { ok: true, transacao: tx };

        }

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

          session,

        });

        tx = await ledger.updateFinancialTx(

          tx.id,

          (prev) => ({

            ...prev,

            status: 'CONFIRMADO',

            reconciliacaoStatus: 'RECONCILIADO',

            reconciliadoEm: new Date(),

            ledgerEntryIds: confirmedResult?.entry?.id

              ? [...(prev.ledgerEntryIds || []), confirmedResult.entry.id]

              : prev.ledgerEntryIds || [],

          }),

          session

        );

        return { ok: true, transacao: tx };

      },

    });

    return res.json(body);

  } catch (e) {

    return res.status(Number(e.status || 500)).json({

      erro: e.status ? e.message : 'Erro interno ao confirmar saque.',

    });

  }

});

router.get('/gateway/:gatewayReference', auth, async (req, res) => {

  try {

    const { gatewayReference } = req.params;

    const tx = await ledger.findFinancialTxByGatewayReference(gatewayReference);

    if (!tx) {

      return res.status(404).json({ erro: 'Transação não encontrada.' });

    }

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

    const provided =

      req.headers['x-gateway-secret'] || req.headers['x-webhook-secret'] || '';

    if (secret && String(provided) !== String(secret)) {

      return res.status(401).json({ erro: 'Webhook não autorizado.' });

    }

    const { gatewayReference, status } = req.body || {};

    if (!gatewayReference || !status) {

      return res

        .status(400)

        .json({ erro: 'gatewayReference e status são obrigatórios.' });

    }

    const normalized = String(status).toUpperCase();

    const body = await runTx({

      action: 'SAQUE_WEBHOOK',

      meta: { gatewayReference, status: normalized },

      mutate: async (session) => {

        let tx = await ledger.findFinancialTxByGatewayReference(gatewayReference, session);

        if (!tx) {

          const err = new Error('Transação não encontrada.');

          err.status = 404;

          throw err;

        }

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

            session,

          });

          tx = await ledger.updateFinancialTx(

            tx.id,

            (prev) => ({

              ...prev,

              status: 'CONFIRMADO',

              gatewayReference,

              reconciliacaoStatus: 'RECONCILIADO',

              reconciliadoEm: new Date(),

              ledgerEntryIds: confirmedResult?.entry?.id

                ? Array.from(new Set([...(prev.ledgerEntryIds || []), confirmedResult.entry.id]))

                : prev.ledgerEntryIds || [],

            }),

            session

          );

        } else if (

          normalized === 'FAILED' ||

          normalized === 'CANCELLED' ||

          normalized === 'REJECTED'

        ) {

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

            session,

          });

          const userDoc = await User.findById(tx.usuarioId).session(session);

          if (!userDoc) {

            const err = new Error('Usuário não encontrado.');

            err.status = 404;

            throw err;

          }

          userDoc.saldo = round2(Number(userDoc.saldo || 0) + Number(tx.valorBruto || 0) + Number(tx.taxa || 0));

          await userDoc.save({ session });

          tx = await ledger.updateFinancialTx(

            tx.id,

            (prev) => ({

              ...prev,

              status: 'CANCELADO',

              gatewayReference,

              reconciliacaoStatus: 'RECONCILIADO',

              reconciliadoEm: new Date(),

              ledgerEntryIds: cancelledResult?.entry?.id

                ? Array.from(new Set([...(prev.ledgerEntryIds || []), cancelledResult.entry.id]))

                : prev.ledgerEntryIds || [],

            }),

            session

          );

        }

        return { ok: true, transacao: tx };

      },

    });

    return res.json(body);

  } catch (e) {

    return res.status(Number(e.status || 500)).json({

      erro: e.status ? e.message : 'Erro interno ao processar webhook.',

    });

  }

});

module.exports = router;