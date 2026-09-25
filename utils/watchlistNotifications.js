const Club = require('../models/Club');
const { enviarPushParaUsuario } = require('../services/pushNotificationService');

function ensureUserNotificationFields(user) {
  if (!user.notificacoes) user.notificacoes = [];
  if (!user.watchlist) user.watchlist = { clubes: [], ligas: [] };
  if (!user.alertState) user.alertState = { clubPrices: {} };
}

async function synthesizeWatchlistNotifications(user) {
  ensureUserNotificationFields(user);
  const thresholdPercent = 3;
  const clubesWatch = Array.isArray(user.watchlist?.clubes)
    ? user.watchlist.clubes
    : [];
  const legacyIds = clubesWatch
    .map((clube) => Number(clube.id))
    .filter(Number.isFinite);

  if (!legacyIds.length) return false;

  const clubes = await Club.find({ legacyId: { $in: legacyIds } }).lean();
  let mudou = false;

  if (!user.alertState || typeof user.alertState !== 'object') {
    user.alertState = { clubPrices: {} };
    mudou = true;
  }
  if (!user.alertState.clubPrices || typeof user.alertState.clubPrices !== 'object') {
    user.alertState.clubPrices = {};
    mudou = true;
  }
  user.notificacoes = Array.isArray(user.notificacoes) ? user.notificacoes : [];

  for (const clube of clubes) {
    const key = String(clube.legacyId);
    const precoAtual = Number(clube.precoAtual ?? clube.preco ?? 0);
    if (!Number.isFinite(precoAtual) || precoAtual <= 0) continue;

    const anteriorRaw = user.alertState.clubPrices[key];
    if (anteriorRaw === undefined || anteriorRaw === null) {
      user.alertState.clubPrices[key] = precoAtual;
      mudou = true;
      continue;
    }

    const precoAnterior = Number(anteriorRaw);
    if (!Number.isFinite(precoAnterior) || precoAnterior <= 0) {
      user.alertState.clubPrices[key] = precoAtual;
      mudou = true;
      continue;
    }

    const variacaoPercentual = ((precoAtual - precoAnterior) / precoAnterior) * 100;
    const variacaoAbs = Math.abs(variacaoPercentual);
    if (variacaoAbs < thresholdPercent) continue;

    const subiu = variacaoPercentual > 0;
    const tipo = subiu ? 'PRICE_UP' : 'PRICE_DOWN';
    const precoAtualFormatado = Number(precoAtual.toFixed(2));
    const precoAnteriorFormatado = Number(precoAnterior.toFixed(2));
    const variacaoFormatada = Number(variacaoAbs.toFixed(2));
    const notificationKey = `price:${key}:${tipo}:${precoAtualFormatado.toFixed(2)}`;
    const jaExiste = user.notificacoes.some((item) => {
      const metadata = item?.metadata || {};
      return String(metadata.notificationKey || '') === notificationKey ||
        (String(metadata.clubeId) === key &&
          String(metadata.tipo || '') === tipo &&
          Number(metadata.precoAtual || 0).toFixed(2) === precoAtualFormatado.toFixed(2));
    });

    if (!jaExiste) {
      const notificacao = {
        id: `price_${key}_${tipo}_${precoAtualFormatado.toFixed(2)}_${Date.now()}`,
        title: `${clube.nome} ${subiu ? 'subiu' : 'caiu'} ${variacaoFormatada.toFixed(2)}%`,
        body: `Novo preço de mercado: T$ ${precoAtualFormatado.toFixed(2)}.`,
        read: false,
        createdAt: new Date(),
        metadata: {
          notificationKey,
          tipo,
          entityType: 'clube',
          clubeId: clube.legacyId,
          clubeNome: clube.nome,
          precoAnterior: precoAnteriorFormatado,
          precoAtual: precoAtualFormatado,
          variacaoPercentual: Number(variacaoPercentual.toFixed(4)),
          variacaoAbsoluta: variacaoFormatada,
          thresholdPercent,
          targetUrl: `/clube/${clube.legacyId}`,
        },
      };
      user.notificacoes.unshift(notificacao);
      enviarPushParaUsuario(user._id, notificacao).catch((erro) =>
        console.error('[WEB PUSH WATCHLIST] erro não bloqueante:', erro?.message)
      );
      mudou = true;
    }

    user.alertState.clubPrices[key] = precoAtualFormatado;
    mudou = true;
  }

  user.notificacoes = user.notificacoes.slice(0, 100);
  if (mudou) {
    user.markModified('alertState');
    user.markModified('notificacoes');
  }
  return mudou;
}

module.exports = { ensureUserNotificationFields, synthesizeWatchlistNotifications };
