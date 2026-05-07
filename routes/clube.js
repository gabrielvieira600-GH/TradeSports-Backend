// routes/clube.js
const express = require('express');

const router = express.Router();

const Club = require('../models/Club');

function toClubResponse(clube) {

  return {

    id: clube.legacyId,

    nome: clube.nome,

    escudo: clube.escudo || '',

    posicao: clube.posicao ?? null,

    preco: Number(clube.preco || 0),

    precoAtual:

      clube.precoAtual != null ? Number(clube.precoAtual) : Number(clube.preco || 0),

    cotasDisponiveis: Number(clube.cotasDisponiveis || 0),

    cotasEmitidas: Number(clube.cotasEmitidas || 0),

    ipoEncerrado: Boolean(clube.ipoEncerrado),

    splitFactorCumulativo: Number(clube.splitFactorCumulativo || 1),

    travadoAte: Number(clube.travadoAte || 0),

    metadata: clube.metadata || {},

  };

}

router.get('/clubes', async (req, res) => {

  try {

    const clubes = await Club.find({})

      .sort({ posicao: 1, nome: 1 })

      .lean();

    return res.json(clubes.map(toClubResponse));

  } catch (err) {

    console.error('Erro ao listar clubes:', err);

    return res.status(500).json({ erro: 'Erro ao listar clubes.' });

  }

});

router.get('/clubes/:id', async (req, res) => {

  try {

    const legacyId = Number(req.params.id);

    const clube = await Club.findOne({ legacyId }).lean();

    if (!clube) {

      return res.status(404).json({ erro: 'Clube não encontrado.' });

    }

    return res.json(toClubResponse(clube));

  } catch (err) {

    console.error('Erro ao buscar clube:', err);

    return res.status(500).json({ erro: 'Erro ao buscar clube.' });

  }

});

router.get('/:id', async (req, res) => {

  try {

    const legacyId = Number(req.params.id);

    const clube = await Club.findOne({ legacyId }).lean();

    if (!clube) {

      return res.status(404).json({ erro: 'Clube não encontrado.' });

    }

    return res.json(toClubResponse(clube));

  } catch (err) {

    console.error('Erro ao buscar clube por id:', err);

    return res.status(500).json({ erro: 'Erro ao buscar clube.' });

  }

});

module.exports = router;