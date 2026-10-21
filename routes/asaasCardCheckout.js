// Checkout recorrente com cartão hospedado pelo Asaas. Nenhum dado de cartão passa pela TradeSports.
const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Sub = require('../models/AsaasSubscription');
const asaas = require('../services/asaas');
const router = express.Router();
const FRONTEND = (process.env.TRADESPORTS_FRONTEND_URL || 'https://www.tradesports.com.br').replace(/\/$/, '');

router.post('/start', auth, async (req, res) => {
  try {
    if (process.env.ASAAS_ENV !== 'sandbox' || process.env.ASAAS_PREMIUM_ENABLED !== 'true')
      return res.status(503).json({ erro: 'Checkout de cartão disponível somente no Sandbox.' });
    const user = await User.findById(req.usuario.id);
    if (!user) return res.sendStatus(401);
    const cpf = String(user.cpf || '').replace(/\D/g, '');
    if (!/^\d{11}$/.test(cpf)) return res.status(422).json({ erro: 'Atualize seu CPF no perfil para continuar.' });
    const active = await Sub.findOne({ userId: user._id, status: { $in: ['ACTIVE','PENDING'] }, cancelledAt: null });
    if (active) return res.status(409).json({ erro: 'Você já possui uma assinatura. Consulte sua situação antes de contratar outra.' });
    const ref = String(user._id);
    const result = await asaas('get', '/customers?externalReference=' + encodeURIComponent(ref) + '&limit=100');
    let customer = result.data?.find(x => x.externalReference === ref);
    if (!customer) customer = await asaas('post', '/customers', {
      name: [user.nome, user.sobrenome].filter(Boolean).join(' ') || user.nomeUsuario,
      email: user.email, cpfCnpj: cpf, externalReference: ref, notificationDisabled: true
    });
    // Checkout recorrente: os dados de cartão são coletados exclusivamente pelo Asaas.
    const checkout = await asaas('post', '/checkouts', {
      billingTypes: ['CREDIT_CARD'], chargeTypes: ['RECURRENT'], minutesToExpire: 60,
      externalReference: ref,
      customer: customer.id,
      callback: {
        successUrl: FRONTEND + '/checkout/premium?retorno=sucesso',
        cancelUrl: FRONTEND + '/checkout/premium?retorno=cancelado',
        expiredUrl: FRONTEND + '/checkout/premium?retorno=expirado'
      },
      items: [{ name: 'TradeSports Premium', description: 'Assinatura mensal Premium', quantity: 1, value: 9.90 }],
      subscription: { cycle: 'MONTHLY', nextDueDate: new Date(Date.now() + 2 * 60 * 1000).toISOString().slice(0,19).replace('T',' ') }
    });
    // O link é montado conforme a documentação oficial do Asaas Checkout.
    if (!checkout.id || !/^[a-zA-Z0-9-]{8,100}$/.test(checkout.id))
      throw new Error('Asaas não retornou um identificador válido de checkout');
    return res.json({ checkoutId: checkout.id, url: 'https://asaas.com/checkoutSession/show?id=' + encodeURIComponent(checkout.id) });
  } catch (e) {
    console.error('[ASAAS CARD CHECKOUT]', e.response?.status || e.code || e.message);
    return res.status(502).json({ erro: 'Não foi possível abrir o checkout seguro do cartão.' });
  }
});
module.exports = router;
