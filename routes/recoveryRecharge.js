const express = require('express');
const crypto = require('crypto');
const Stripe = require('stripe');
const auth = require('../middleware/auth');
const User = require('../models/User');
const RecoveryRecharge = require('../models/RecoveryRecharge');
const audit = require('../utils/audit');
const {
  brlCentsForTs,
  confirmRecharge,
  rechargeSummary,
  validateAmount,
} = require('../services/recoveryRechargeService');

const router = express.Router();
const PIX_EXPIRATION_SECONDS = 30 * 60;

function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) {
    const error = new Error('O pagamento PIX ainda não foi configurado.');
    error.status = 503;
    error.code = 'PIX_NAO_CONFIGURADO';
    throw error;
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function serializeRecharge(recharge) {
  if (!recharge) return null;
  const item = recharge.toObject ? recharge.toObject() : recharge;
  return {
    id: String(item._id),
    quantidadeTs: Number(item.quantidadeTs),
    valorReaisCentavos: Number(item.valorReaisCentavos),
    valorReais: Number(item.valorReaisCentavos) / 100,
    patrimonioSolicitacao: Number(item.patrimonioSolicitacao),
    patrimonioConfirmacao:
      item.patrimonioConfirmacao == null ? null : Number(item.patrimonioConfirmacao),
    status: item.status,
    expiraEm: item.expiraEm,
    confirmadaEm: item.confirmadaEm,
    reembolsadaEm: item.reembolsadaEm,
    motivoFalha: item.motivoFalha,
    createdAt: item.createdAt,
  };
}

function ageFromBirthDate(value) {
  if (!value) return null;
  const birth = new Date(value);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

async function refundAndMark(recharge, paymentIntentId, reason) {
  const stripe = stripeClient();
  try {
    await stripe.refunds.create(
      { payment_intent: paymentIntentId, reason: 'requested_by_customer' },
      { idempotencyKey: `recovery-refund-${String(recharge._id)}` }
    );
    await RecoveryRecharge.updateOne(
      { _id: recharge._id, status: 'FALHA' },
      {
        $set: {
          status: 'REEMBOLSADA',
          reembolsadaEm: new Date(),
          motivoFalha: reason,
        },
      }
    );
  } catch (error) {
    await audit.logEvent({
      kind: 'FINANCE',
      action: 'RECARGA_REEMBOLSO_FALHOU',
      userId: String(recharge.usuarioId),
      entityType: 'RecoveryRecharge',
      entityId: String(recharge._id),
      error: error.message,
      meta: { paymentIntentId, reason },
    });
    throw error;
  }
}

async function processSucceededPayment(paymentIntent) {
  const recharge = await RecoveryRecharge.findOne({
    $or: [
      { pagamentoId: paymentIntent.id },
      ...(paymentIntent.metadata?.recoveryRechargeId
        ? [{ _id: paymentIntent.metadata.recoveryRechargeId }]
        : []),
    ],
  });
  if (!recharge) return null;
  if (recharge.status === 'CONFIRMADA' || recharge.status === 'REEMBOLSADA') {
    return recharge;
  }

  const confirmed = await confirmRecharge(recharge._id, { paymentId: paymentIntent.id });
  if (confirmed?.status === 'FALHA') {
    await refundAndMark(
      recharge,
      paymentIntent.id,
      'O patrimônio mudou durante o pagamento e a recarga ultrapassaria T$ 1.000.'
    );
    return RecoveryRecharge.findById(recharge._id);
  }
  return RecoveryRecharge.findById(recharge._id);
}

async function stripeWebhook(req, res) {
  try {
    const secret = process.env.STRIPE_RECOVERY_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ erro: 'Webhook PIX não configurado.' });
    const stripe = stripeClient();
    const signature = req.headers['stripe-signature'];
    const event = stripe.webhooks.constructEvent(req.body, signature, secret);

    if (event.type === 'payment_intent.succeeded') {
      await processSucceededPayment(event.data.object);
    } else if (event.type === 'payment_intent.payment_failed') {
      await RecoveryRecharge.updateOne(
        { pagamentoId: event.data.object.id, status: 'PENDENTE' },
        { $set: { status: 'FALHA', motivoFalha: 'O pagamento PIX não foi concluído.' } }
      );
    } else if (event.type === 'payment_intent.canceled') {
      await RecoveryRecharge.updateOne(
        { pagamentoId: event.data.object.id, status: 'PENDENTE' },
        { $set: { status: 'CANCELADA', motivoFalha: 'Pagamento cancelado.' } }
      );
    }

    return res.json({ received: true });
  } catch (error) {
    console.error('[RECARGA] Webhook Stripe inválido:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }
}

router.use(auth);

router.get('/resumo', async (req, res) => {
  try {
    const user = await User.findById(req.usuario.id);
    if (!user) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    const age = ageFromBirthDate(user.dataNascimento);
    const summary = await rechargeSummary(user);
    const maioridadeConfirmada = age != null && age >= 18;
    const cpfConfirmado = /^\d{11}$/.test(String(user.cpf || '').replace(/\D/g, ''));
    return res.json({
      ok: true,
      ...summary,
      maioridadeConfirmada,
      cpfConfirmado,
      elegivel: summary.elegivel && maioridadeConfirmada && cpfConfirmado,
      motivoInelegibilidade: !maioridadeConfirmada
        ? 'A recarga está disponível apenas para maiores de 18 anos com data de nascimento confirmada.'
        : !cpfConfirmado
          ? 'Confirme um CPF válido no cadastro antes de realizar a recarga.'
        : !summary.elegivel
          ? 'Seu patrimônio total precisa estar em T$ 900 ou menos.'
          : null,
      stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
      pixConfigurado: Boolean(
        process.env.STRIPE_SECRET_KEY &&
        process.env.STRIPE_PUBLISHABLE_KEY &&
        process.env.STRIPE_RECOVERY_WEBHOOK_SECRET
      ),
    });
  } catch (error) {
    console.error('[RECARGA] Erro no resumo:', error);
    return res.status(500).json({ erro: 'Não foi possível calcular seu limite de recuperação.' });
  }
});

router.post('/intencoes', async (req, res) => {
  try {
    const user = await User.findById(req.usuario.id);
    if (!user) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    if (ageFromBirthDate(user.dataNascimento) < 18) {
      return res.status(403).json({ erro: 'A recarga está disponível apenas para maiores de 18 anos.' });
    }
    if (!/^\d{11}$/.test(String(user.cpf || '').replace(/\D/g, ''))) {
      return res.status(403).json({ erro: 'Confirme um CPF válido no cadastro antes de realizar a recarga.' });
    }

    const summary = await rechargeSummary(user);
    const amountTs = validateAmount(req.body?.quantidadeTs, summary.maximoTs);
    const idempotencyHeader = String(req.headers['idempotency-key'] || '').trim();
    const idempotencyKey = idempotencyHeader ||
      `recovery_${req.usuario.id}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;

    const existing = await RecoveryRecharge.findOne({ idempotencyKey, usuarioId: user._id });
    if (existing) {
      let intent = null;
      if (existing.pagamentoId && existing.status === 'PENDENTE') {
        intent = await stripeClient().paymentIntents.retrieve(existing.pagamentoId);
      }
      return res.json({
        ok: true,
        recarga: serializeRecharge(existing),
        clientSecret: intent?.client_secret || null,
        stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
      });
    }

    const expiresAt = new Date(Date.now() + PIX_EXPIRATION_SECONDS * 1000);
    const recharge = await RecoveryRecharge.create({
      usuarioId: user._id,
      temporadaId: summary.temporada?.id || null,
      quantidadeTs: amountTs,
      valorReaisCentavos: brlCentsForTs(amountTs),
      patrimonioSolicitacao: summary.patrimonio,
      idempotencyKey,
      status: 'PENDENTE',
      expiraEm: expiresAt,
      metadata: {
        ip: req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.ip,
        userAgent: req.headers['user-agent'] || '',
      },
    });

    try {
      const intent = await stripeClient().paymentIntents.create(
        {
          amount: recharge.valorReaisCentavos,
          currency: 'brl',
          automatic_payment_methods: { enabled: true },
          payment_method_options: { pix: { expires_after_seconds: PIX_EXPIRATION_SECONDS } },
          receipt_email: user.email,
          description: `Recarga de Recuperação TradeSports — T$ ${amountTs}`,
          metadata: {
            recoveryRechargeId: String(recharge._id),
            userId: String(user._id),
            quantidadeTs: String(amountTs),
          },
        },
        { idempotencyKey: `stripe-${idempotencyKey}` }
      );
      recharge.pagamentoId = intent.id;
      await recharge.save();
      return res.status(201).json({
        ok: true,
        recarga: serializeRecharge(recharge),
        clientSecret: intent.client_secret,
        stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
      });
    } catch (error) {
      recharge.status = 'FALHA';
      recharge.motivoFalha = 'Não foi possível iniciar o pagamento PIX.';
      await recharge.save();
      throw error;
    }
  } catch (error) {
    console.error('[RECARGA] Erro ao criar intenção:', error.message);
    return res.status(Number(error.status || 500)).json({
      erro: error.status ? error.message : 'Não foi possível iniciar o pagamento PIX.',
      codigo: error.code || null,
    });
  }
});

router.get('/intencoes/:id', async (req, res) => {
  try {
    let recharge = await RecoveryRecharge.findOne({ _id: req.params.id, usuarioId: req.usuario.id });
    if (!recharge) return res.status(404).json({ erro: 'Recarga não encontrada.' });

    if (recharge.status === 'PENDENTE' && recharge.pagamentoId) {
      const intent = await stripeClient().paymentIntents.retrieve(recharge.pagamentoId);
      if (intent.status === 'succeeded') recharge = await processSucceededPayment(intent);
      else if (intent.status === 'canceled') {
        recharge.status = 'CANCELADA';
        recharge.motivoFalha = 'Pagamento cancelado.';
        await recharge.save();
      } else if (new Date(recharge.expiraEm) <= new Date()) {
        recharge.status = 'EXPIRADA';
        recharge.motivoFalha = 'O código PIX expirou.';
        await recharge.save();
      }
    }

    return res.json({ ok: true, recarga: serializeRecharge(recharge) });
  } catch (error) {
    return res.status(500).json({ erro: 'Não foi possível consultar a recarga.' });
  }
});

router.get('/historico', async (req, res) => {
  const items = await RecoveryRecharge.find({ usuarioId: req.usuario.id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  return res.json({ ok: true, recargas: items.map(serializeRecharge) });
});

module.exports = { router, stripeWebhook };
