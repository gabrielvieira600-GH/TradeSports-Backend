// routes/watchlist.js
const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth');
const User = require('../models/User');

function ensureWatchlist(user) {
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
}

function criarIdNotificacao(prefix = 'notif') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizarItem({ entityId, nome, ligaId, ligaNome }) {
  return {
    id: String(entityId),
    nome: nome || '',
    ligaId: ligaId || null,
    ligaNome: ligaNome || null,
  };
}

function adicionarNotificacaoFavorito(user, { entityType, entityId, nome, ligaNome }) {
  const isClube = entityType === 'clube';
  const idStr = String(entityId);

  const notificationKey = `watchlist:${entityType}:${idStr}:favoritado`;

  const jaExiste = user.notificacoes.some((n) => {
    const meta = n?.metadata || {};
    return String(meta.notificationKey || '') === notificationKey;
  });

  if (jaExiste) return;

  const title = isClube ? 'Clube favoritado' : 'Liga favoritada';

  const body = isClube
    ? `${nome || 'Clube'} foi adicionado à sua lista de favoritos. Você receberá alertas sobre movimentações de preço.`
    : `${nome || 'Liga'} foi adicionada à sua lista de favoritos.`;

  user.notificacoes.unshift({
    id: criarIdNotificacao('watchlist'),
    title,
    body,
    read: false,
    createdAt: new Date(),
    metadata: {
      notificationKey,
      entityType,
      entityId: idStr,
      clubeId: isClube ? idStr : null,
      clubeNome: isClube ? nome || '' : null,
      ligaNome: ligaNome || null,
      targetUrl: isClube ? `/clube/${idStr}` : null,
      tipo: 'WATCHLIST_FAVORITED',
    },
  });

  user.notificacoes = user.notificacoes.slice(0, 100);
  user.markModified('notificacoes');
}

router.get('/', auth, async (req, res) => {
  try {
    const user = await User.findById(req.usuario.id);

    if (!user) {
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }

    ensureWatchlist(user);

    return res.json({
      ok: true,
      watchlist: user.watchlist,
    });
  } catch (err) {
    console.error('[WATCHLIST GET] erro:', err);
    return res.status(500).json({ erro: 'Erro ao carregar watchlist.' });
  }
});

router.post('/toggle', auth, async (req, res) => {
  try {
    const { entityType, entityId, nome, ligaId, ligaNome } = req.body || {};

    if (!['clube', 'liga'].includes(String(entityType))) {
      return res.status(400).json({ erro: 'entityType inválido.' });
    }

    if (!entityId) {
      return res.status(400).json({ erro: 'entityId é obrigatório.' });
    }

    const user = await User.findById(req.usuario.id);

    if (!user) {
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }

    ensureWatchlist(user);

    const campo = entityType === 'clube' ? 'clubes' : 'ligas';
    const lista = Array.isArray(user.watchlist[campo]) ? user.watchlist[campo] : [];

    const idStr = String(entityId);
    const index = lista.findIndex((item) => String(item.id) === idStr);

    let favoritado = false;

    if (index >= 0) {
      lista.splice(index, 1);
      favoritado = false;
    } else {
      lista.push(
        normalizarItem({
          entityId,
          nome,
          ligaId,
          ligaNome,
        })
      );

      favoritado = true;

      adicionarNotificacaoFavorito(user, {
        entityType,
        entityId,
        nome,
        ligaNome,
      });
    }

    user.watchlist[campo] = lista;
    user.markModified('watchlist');

    await user.save();

    return res.json({
      ok: true,
      favoritado,
      watchlist: user.watchlist,
      unreadCount: user.notificacoes.filter((n) => !n.read).length,
    });
  } catch (err) {
    console.error('[WATCHLIST TOGGLE] erro:', err);
    return res.status(500).json({ erro: 'Erro ao atualizar watchlist.' });
  }
});

module.exports = router;