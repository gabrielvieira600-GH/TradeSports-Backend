const express = require('express');
const auth = require('../middleware/auth');
const PushSubscription = require('../models/PushSubscription');
const {
  enviarPushParaUsuario,
  obterChavePublica,
  pushEstaConfigurado,
} = require('../services/pushNotificationService');

const router = express.Router();
router.use(auth);

function assinaturaValida(subscription) {
  return Boolean(
    subscription &&
      typeof subscription.endpoint === 'string' &&
      subscription.endpoint.startsWith('https://') &&
      subscription.endpoint.length <= 2048 &&
      typeof subscription.keys?.p256dh === 'string' &&
      subscription.keys.p256dh.length <= 512 &&
      typeof subscription.keys?.auth === 'string' &&
      subscription.keys.auth.length <= 512
  );
}

router.get('/config', (_req, res) => {
  const configured = pushEstaConfigurado();
  return res.json({
    ok: true,
    configured,
    publicKey: configured ? obterChavePublica() : '',
  });
});

router.post('/subscribe', async (req, res) => {
  try {
    if (!pushEstaConfigurado()) {
      return res.status(503).json({
        erro: 'Notificações push ainda não foram configuradas no servidor.',
        codigo: 'PUSH_NAO_CONFIGURADO',
      });
    }

    const subscription = req.body?.subscription || req.body;
    if (!assinaturaValida(subscription)) {
      return res.status(400).json({ erro: 'Assinatura push inválida.' });
    }

    await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        $set: {
          usuarioId: req.usuario.id,
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
          },
          userAgent: String(req.get('user-agent') || '').slice(0, 500),
          ativo: true,
          ultimoErro: '',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.json({ ok: true, subscribed: true });
  } catch (err) {
    console.error('[WEB PUSH SUBSCRIBE] erro:', err);
    return res.status(500).json({ erro: 'Não foi possível ativar as notificações push.' });
  }
});

router.delete('/subscribe', async (req, res) => {
  try {
    const endpoint = String(req.body?.endpoint || '');
    if (!endpoint) return res.status(400).json({ erro: 'Endpoint obrigatório.' });

    await PushSubscription.deleteOne({
      usuarioId: req.usuario.id,
      endpoint,
    });

    return res.json({ ok: true, subscribed: false });
  } catch (err) {
    return res.status(500).json({ erro: 'Não foi possível desativar o push.' });
  }
});

router.post('/test', async (req, res) => {
  try {
    const resultado = await enviarPushParaUsuario(req.usuario.id, {
      id: `push_test_${Date.now()}`,
      title: 'Notificações ativadas!',
      body: 'A TradeSports já pode enviar novidades para este aparelho.',
      metadata: { tipo: 'PUSH_TEST', targetUrl: '/dashboard' },
    });

    if (!resultado.enviados) {
      return res.status(409).json({ erro: 'Nenhum aparelho ativo foi encontrado.' });
    }

    return res.json({ ok: true, enviados: resultado.enviados });
  } catch (err) {
    console.error('[WEB PUSH TEST] erro:', err);
    return res.status(500).json({ erro: 'Não foi possível enviar a notificação de teste.' });
  }
});

module.exports = router;
