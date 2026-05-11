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
}

function normalizarItem({ entityId, nome, ligaId, ligaNome }) {
  return {
    id: String(entityId),
    nome: nome || '',
    ligaId: ligaId || null,
    ligaNome: ligaNome || null,
  };
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
    }

    user.watchlist[campo] = lista;
    user.markModified('watchlist');

    await user.save();

    return res.json({
      ok: true,
      favoritado,
      watchlist: user.watchlist,
    });
  } catch (err) {
    console.error('[WATCHLIST TOGGLE] erro:', err);
    return res.status(500).json({ erro: 'Erro ao atualizar watchlist.' });
  }
});

module.exports = router;