const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const auth = require('../middleware/auth');
const storage = require('../utils/storage');
const audit = require('../utils/audit');
const { runTx } = require('../utils/tx');

const ordensPath = path.join(__dirname, '../data/ordens.json');
const dataDir = path.join(__dirname, '../data');

// Função para ler o arquivo de ordens
function lerOrdens() {
  return storage.readJSON(ordensPath, []);
}

// Função para salvar o arquivo de ordens
async function salvarOrdens(ordens) {
  return storage.writeJSON(ordensPath, ordens);
}

router.get('/:clubeId', (req, res) => {
  try {
    const { clubeId } = req.params;
    const todasOrdens = lerOrdens();

    const ordensCompra = todasOrdens
      .filter((ordem) => String(ordem.clubeId) === String(clubeId) && ordem.tipo === 'compra' && Number(ordem.restante || 0) > 0)
      .sort((a, b) => Number(b.preco) - Number(a.preco));

    const ordensVenda = todasOrdens
      .filter((ordem) => String(ordem.clubeId) === String(clubeId) && ordem.tipo === 'venda' && Number(ordem.restante || 0) > 0)
      .sort((a, b) => Number(a.preco) - Number(b.preco));

    res.json({
      compra: ordensCompra,
      venda: ordensVenda,
    });
  } catch (err) {
    console.error('[ERRO ORDENS]', err);
    res.status(500).json({ erro: 'Erro interno ao buscar ordens.' });
  }
});

// Cancelar ordem (somente dono da ordem ou admin) — CAMADA 9 TX
router.post('/:id/cancelar', auth, async (req, res) => {
  try {
    const ordemId = req.params.id; // NÃO parsear para número
    const usuario = req.usuario;

    const out = await runTx({
      files: [ordensPath],
      dataDir,
      action: 'ORDER_CANCEL_LEGACY',
      meta: { userId: usuario.id, ordemId: String(ordemId) },
      fallbacks: { ordens: [] },
      mutate: (state) => {
        const ordens = state.ordens;

        const index = ordens.findIndex((o) => String(o.id) === String(ordemId));
        if (index === -1) {
          const e = new Error('Ordem não encontrada.');
          e.code = 'ORDER_NOT_FOUND';
          throw e;
        }

        const ordem = ordens[index];

        const isOwner = String(ordem.usuarioId) === String(usuario.id);
        const isAdmin = String(usuario?.role || '').toLowerCase() === 'admin';
        if (!isOwner && !isAdmin) {
          const e = new Error('Sem permissão.');
          e.code = 'FORBIDDEN';
          throw e;
        }

        if (Number(ordem.restante || 0) <= 0 || String(ordem.status || '').toLowerCase() === 'cancelada') {
          const e = new Error('Já executada/cancelada.');
          e.code = 'ALREADY';
          throw e;
        }

        ordens[index] = {
          ...ordem,
          restante: 0,
          canceladaEm: Date.now(),
          status: 'cancelada',
        };

        state.ordens = ordens;
        return state;
      },
    });

    const ordemOut = (out.ordens || []).find((o) => String(o.id) === String(ordemId));
    audit.logEvent({ kind: 'ORDENS', action: 'CANCEL_OK', userId: usuario.id, ordemId: String(ordemId) });

    return res.json(ordemOut);
  } catch (err) {
    console.error('Erro ao cancelar ordem:', err);
    if (err && err.code === 'ORDER_NOT_FOUND') return res.status(404).json({ erro: 'Ordem não encontrada.' });
    if (err && err.code === 'FORBIDDEN') return res.status(403).json({ erro: 'Você não tem permissão para cancelar esta ordem.' });
    if (err && err.code === 'ALREADY') return res.status(400).json({ erro: 'Não é possível cancelar uma ordem já executada/cancelada.' });
    return res.status(500).json({ erro: 'Erro interno ao cancelar ordem.' });
  }
});


module.exports = router;