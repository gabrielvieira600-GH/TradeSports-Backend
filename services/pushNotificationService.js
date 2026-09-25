const webPush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

let configurado = false;

function configurarWebPush() {
  const publicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = String(
    process.env.VAPID_SUBJECT || 'mailto:suporte@tradesports.com.br'
  ).trim();

  configurado = Boolean(publicKey && privateKey && subject);

  if (configurado) {
    webPush.setVapidDetails(subject, publicKey, privateKey);
  }

  return configurado;
}

function pushEstaConfigurado() {
  return configurarWebPush();
}

function obterChavePublica() {
  return pushEstaConfigurado()
    ? String(process.env.VAPID_PUBLIC_KEY).trim()
    : '';
}

function normalizarPayload(notificacao = {}) {
  const metadata = notificacao.metadata || notificacao.meta || {};
  const targetUrl =
    metadata.targetUrl || metadata.url || notificacao.targetUrl || '/';

  return {
    title: String(notificacao.title || 'TradeSports').slice(0, 120),
    body: String(notificacao.body || '').slice(0, 300),
    icon: '/android-chrome-192x192.png',
    badge: '/favicon-96x96.png',
    tag: String(notificacao.id || `tradesports_${Date.now()}`).slice(0, 160),
    data: {
      url: String(targetUrl || '/'),
      notificationId: String(notificacao.id || ''),
      tipo: String(metadata.tipo || ''),
    },
  };
}

async function enviarParaAssinatura(assinatura, payload) {
  try {
    await webPush.sendNotification(
      {
        endpoint: assinatura.endpoint,
        keys: {
          p256dh: assinatura.keys.p256dh,
          auth: assinatura.keys.auth,
        },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 6, urgency: 'high' }
    );

    await PushSubscription.updateOne(
      { _id: assinatura._id },
      {
        $set: {
          ativo: true,
          ultimoSucessoEm: new Date(),
          ultimoErro: '',
        },
      }
    );
    return true;
  } catch (err) {
    const statusCode = Number(err?.statusCode || err?.status || 0);
    if (statusCode === 404 || statusCode === 410) {
      await PushSubscription.deleteOne({ _id: assinatura._id });
      return false;
    }

    await PushSubscription.updateOne(
      { _id: assinatura._id },
      {
        $set: {
          ultimaFalhaEm: new Date(),
          ultimoErro: String(err?.message || 'Falha ao enviar push').slice(0, 500),
        },
      }
    );
    throw err;
  }
}

async function enviarPushParaUsuario(usuarioId, notificacao) {
  if (!usuarioId || !pushEstaConfigurado()) return { enviados: 0 };

  const assinaturas = await PushSubscription.find({
    usuarioId,
    ativo: true,
  }).lean();

  if (!assinaturas.length) return { enviados: 0 };

  const payload = normalizarPayload(notificacao);
  const resultados = await Promise.allSettled(
    assinaturas.map((assinatura) => enviarParaAssinatura(assinatura, payload))
  );

  const enviados = resultados.filter(
    (resultado) => resultado.status === 'fulfilled' && resultado.value
  ).length;

  resultados.forEach((resultado) => {
    if (resultado.status === 'rejected') {
      console.error('[WEB PUSH] Falha não bloqueante:', resultado.reason?.message);
    }
  });

  return { enviados };
}

configurarWebPush();

module.exports = {
  enviarPushParaUsuario,
  obterChavePublica,
  pushEstaConfigurado,
};
