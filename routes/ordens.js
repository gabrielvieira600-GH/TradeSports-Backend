const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const auth = require('../middleware/auth');
const audit = require('../utils/audit');
const { runTx } = require('../utils/tx');
const Order = require('../models/Order');

function round2(n) {
  return Number(Number(n || 0).toFixed(2));
}

function toOrderResponse(ordem) {
  return {
    id: String(ordem._id),
    legacyId: ordem.legacyId || null,
    usuarioId: String(ordem.usuarioId),
    usuarioLegacyId: ordem.usuarioLegacyId ?? null,
    clubeId: ordem.clubeLegacyId ?? null,
    clubeMongoId: ordem.clubeId ? String(ordem.clubeId) : null,
    tipo: ordem.tipo,
    preco: round2(ordem.preco),
    quantidade: Number(ordem.quantidade || 0),
    restante: Number(ordem.restante || 0),
    status: ordem.status,
    criadoEm: ordem.criadoEm,
    executadoEm: ordem.executadoEm,
    canceladoEm: ordem.canceladoEm,
  };
}

function buildOrderIdQuery(id) {
  if (mongoose.Types.ObjectId.isValid(String(id))) {
    return { $or: [{ _id: id }, { legacyId: String(id) }] };
  }
  return { legacyId: String(id) };
}

// Livro legado usado por componentes antigos: GET /ordens/:clubeId
router.get('/:clubeId', async (req, res) => {
  try {
    const clubeLegacyId = Number(req.params.clubeId);

    const ordens = await Order.find({
      clubeLegacyId,
      status: { $in: ['aberta', 'parcial'] },
      restante: { $gt: 0 },
    })
      .sort({ criadoEm: 1 })
      .lean();

    const compra = ordens
      .filter((ordem) => ordem.tipo === 'compra')
      .sort((a, b) => Number(b.preco) - Number(a.preco) || new Date(a.criadoEm) - new Date(b.criadoEm))
      .map(toOrderResponse);

    const venda = ordens
      .filter((ordem) => ordem.tipo === 'venda')
      .sort((a, b) => Number(a.preco) - Number(b.preco) || new Date(a.criadoEm) - new Date(b.criadoEm))
      .map(toOrderResponse);

    return res.json({ compra, venda });
  } catch (err) {
    console.error('[ERRO ORDENS]', err);
    return res.status(500).json({ erro: 'Erro interno ao buscar ordens.' });
  }
});

// Cancelar ordem: somente dono da ordem ou admin.
router.post('/:id/cancelar', auth, async (req, res) => {
  try {
    const ordemId = req.params.id;
    const usuario = req.usuario;

    const ordemOut = await runTx({
      action: 'ORDER_CANCEL',
      meta: { userId: usuario.id, ordemId: String(ordemId) },
      mutate: async (session) => {
        const ordem = await Order.findOne(buildOrderIdQuery(ordemId)).session(session);

        if (!ordem) {
          const e = new Error('Ordem não encontrada.');
          e.code = 'ORDER_NOT_FOUND';
          e.status = 404;
          throw e;
        }

        const isOwner = String(ordem.usuarioId) === String(usuario.id);
        const isAdmin = String(usuario?.role || '').toLowerCase() === 'admin' || usuario?.admin === true;

        if (!isOwner && !isAdmin) {
          const e = new Error('Você não tem permissão para cancelar esta ordem.');
          e.code = 'FORBIDDEN';
          e.status = 403;
          throw e;
        }

        if (Number(ordem.restante || 0) <= 0 || String(ordem.status || '').toLowerCase() === 'cancelada') {
          const e = new Error('Não é possível cancelar uma ordem já executada/cancelada.');
          e.code = 'ALREADY';
          e.status = 400;
          throw e;
        }

        ordem.restante = 0;
        ordem.status = 'cancelada';
        ordem.canceladoEm = new Date();
        ordem.atualizadoEm = new Date();

        await ordem.save({ session });

        await audit.logEvent(
          { kind: 'ORDENS', action: 'CANCEL_OK', userId: usuario.id, ordemId: String(ordem._id) },
          session
        );

        return toOrderResponse(ordem.toObject());
      },
    });

    return res.json(ordemOut);
  } catch (err) {
    console.error('Erro ao cancelar ordem:', err);
    if (err?.code === 'ORDER_NOT_FOUND') return res.status(404).json({ erro: 'Ordem não encontrada.' });
    if (err?.code === 'FORBIDDEN') return res.status(403).json({ erro: 'Você não tem permissão para cancelar esta ordem.' });
    if (err?.code === 'ALREADY') return res.status(400).json({ erro: 'Não é possível cancelar uma ordem já executada/cancelada.' });
    return res.status(Number(err?.status || 500)).json({ erro: 'Erro interno ao cancelar ordem.' });
  }
});

module.exports = router;