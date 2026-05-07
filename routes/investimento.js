// routes/investimento.js
require('dotenv').config();

const express = require('express');
const router = express.Router();

const InvestimentoController = require('../controllers/InvestimentoController');
const { liquidarBrasileirao } = require('../middleware/checkLiquidacao');

// --------- ROTAS EXISTENTES (IPO) ---------
// Mantém compatibilidade com o frontend: POST /investimentos/comprar
router.post('/comprar', async (req, res, next) => {
  try {
    req.body.clubeId = Number(req.body.clubeId);
    return InvestimentoController.criarInvestimento(req, res, next);
  } catch (err) {
    return next ? next(err) : res.status(500).json({ erro: 'Erro ao registrar investimento.' });
  }
});

// Mantém compatibilidade com o frontend/admin: GET /investimentos
router.get('/', async (req, res, next) => {
  try {
    return InvestimentoController.listarInvestimentos(req, res, next);
  } catch (err) {
    return next ? next(err) : res.status(500).json({ erro: 'Erro ao listar investimentos.' });
  }
});

// --------- LIQUIDAÇÃO FINAL DO BRASILEIRÃO ---------
// A regra Mongo fica centralizada em middleware/checkLiquidacao.js,
// que já deve operar sobre User/Club/Investment/Liquidacao/ledger.
router.post('/liquidar-brasileirao', async (req, res) => {
  try {
    const resultado = await liquidarBrasileirao();

    const totalGeral = Number((resultado.totalGeral || 0).toFixed(2));
    const { resumoUsuarios = [], rankingPorClubeId = {} } = resultado;

    return res.json({
      ok: true,
      mensagem: 'Liquidação do Brasileirão concluída.',
      totalGeral,
      usuarios: resumoUsuarios,
      clubesConsiderados: Object.keys(rankingPorClubeId).length,
    });
  } catch (err) {
    console.error('[LIQUIDACAO] Erro na liquidação do campeonato:', err);
    return res.status(500).json({ erro: 'Erro ao liquidar campeonato.' });
  }
});

module.exports = router;