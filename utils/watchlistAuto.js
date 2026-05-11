// utils/watchlistAuto.js

function ensureUserWatchlistFields(user) {
  if (!user.watchlist) {
    user.watchlist = { clubes: [], ligas: [] };
  }

  if (!Array.isArray(user.watchlist.clubes)) {
    user.watchlist.clubes = [];
  }

  if (!Array.isArray(user.watchlist.ligas)) {
    user.watchlist.ligas = [];
  }

  if (!Array.isArray(user.notificacoes)) {
    user.notificacoes = [];
  }

  if (!user.alertState || typeof user.alertState !== 'object') {
    user.alertState = { clubPrices: {} };
  }

  if (!user.alertState.clubPrices || typeof user.alertState.clubPrices !== 'object') {
    user.alertState.clubPrices = {};
  }
}

function criarIdNotificacao(prefix = 'notif') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getPrecoAtualClube(clube) {
  const preco = Number(clube?.precoAtual ?? clube?.preco ?? 0);
  return Number.isFinite(preco) && preco > 0 ? Number(preco.toFixed(2)) : 0;
}

function autoFavoritarClubeAoComprar(user, clube, options = {}) {
  if (!user || !clube) {
    return false;
  }

  ensureUserWatchlistFields(user);

  const clubeId = clube.legacyId ?? clube.id;

  if (!clubeId) {
    return false;
  }

  const clubeIdStr = String(clubeId);

  const jaFavoritado = user.watchlist.clubes.some(
    (item) => String(item.id) === clubeIdStr
  );

  const precoAtual = getPrecoAtualClube(clube);

  // Mesmo que já esteja favoritado, garante que o preço-base exista
  // para a lógica futura de notificações de variação acima de 3%.
  if (precoAtual > 0) {
    user.alertState.clubPrices[clubeIdStr] = user.alertState.clubPrices[clubeIdStr] ?? precoAtual;
    user.markModified?.('alertState');
  }

  if (jaFavoritado) {
    return false;
  }

  user.watchlist.clubes.push({
    id: clubeIdStr,
    nome: clube.nome || '',
    ligaId: options.ligaId || 'brasileirao-a',
    ligaNome: options.ligaNome || 'Brasileirão Série A',
  });

  user.markModified?.('watchlist');

  if (precoAtual > 0) {
    user.alertState.clubPrices[clubeIdStr] = precoAtual;
    user.markModified?.('alertState');
  }

  const criarNotificacao = options.criarNotificacao !== false;

  if (criarNotificacao) {
    const notificationKey = `watchlist:auto:${clubeIdStr}`;

    const jaExisteNotificacao = user.notificacoes.some((n) => {
      const meta = n?.metadata || {};
      return String(meta.notificationKey || '') === notificationKey;
    });

    if (!jaExisteNotificacao) {
      user.notificacoes.unshift({
        id: criarIdNotificacao('watchlist_auto'),
        title: 'Clube adicionado aos favoritos',
        body: `${clube.nome || 'Clube'} foi adicionado automaticamente aos seus favoritos porque você adquiriu cotas dele.`,
        read: false,
        createdAt: new Date(),
        metadata: {
          notificationKey,
          tipo: 'WATCHLIST_AUTO_FAVORITED',
          entityType: 'clube',
          clubeId: clubeIdStr,
          clubeNome: clube.nome || '',
          targetUrl: `/clube/${clubeIdStr}`,
        },
      });

      user.notificacoes = user.notificacoes.slice(0, 100);
      user.markModified?.('notificacoes');
    }
  }

  return true;
}

module.exports = {
  autoFavoritarClubeAoComprar,
};