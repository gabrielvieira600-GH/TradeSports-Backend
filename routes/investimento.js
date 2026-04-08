// routes/investimento.js

require('dotenv').config();

const express = require('express');
const router = express.Router();
const InvestimentoController = require('../controllers/InvestimentoController');
const { liquidarBrasileirao } = require('../middleware/checkLiquidacao');

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ---- caminhos dos JSONs principais ----
const usuariosPath      = path.join(__dirname, '../data/usuarios.json');
const clubesPath        = path.join(__dirname, '../data/clubes.json');
const investimentosPath = path.join(__dirname, '../data/investimentos.json');

// helpers genéricos
function lerJSON(p, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('[LER JSON]', p, e.message);
    return fallback;
  }
}

function salvarJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

// --------- ROTAS EXISTENTES (IPO) ---------

// Rota para registrar compra de cotas durante o IPO
router.post('/comprar', (req, res) => {
  req.body.clubeId = Number(req.body.clubeId);
  InvestimentoController.criarInvestimento(req, res);
});

// Rota para listar todos os investimentos
router.get('/', (req, res) => {
  InvestimentoController.listarInvestimentos(req, res);
});

// --------- NOVO: LIQUIDAÇÃO FINAL DO BRASILEIRÃO ---------

/**
 * Busca a tabela final do Brasileirão na API-Football.
 * (Mesmo endpoint de classificacao.js)
 */
async function buscarTabelaBrasileirao() {
  const API_KEY = process.env.API_FOOTBALL_KEY;
  if (!API_KEY) {
    throw new Error('API_FOOTBALL_KEY não definida no .env');
  }

  const response = await axios({
    method: 'get',
    url: 'https://v3.football.api-sports.io/standings',
    headers: {
      'x-apisports-key': API_KEY,
      Accept: 'application/json',
    },
    params: {
      league: 71,   // Brasileirão Série A
      season: 2023, // ajuste se precisar mudar de temporada
    },
  });

  const standings = response.data.response[0].league.standings[0];

  return standings.map((team) => ({
    posicao: team.rank,
    nome: team.team.name,
  }));
}

/**
 * Regra da casa:
 *  - 20º lugar: R$ 5,00
 *  - Cada posição acima vale 5% a mais que a imediatamente abaixo
 */
function valorCotaPorPosicao(posicao) {
  const BASE = 5; // valor da cota do 20º
  const FATOR = 1.05;

  const steps = 20 - posicao; // ex: pos=20 -> 0; pos=1 -> 19
  const valor = BASE * Math.pow(FATOR, steps);

  return Number(valor.toFixed(2));
}

/**
 * POST /investimentos/liquidar-brasileirao
 * Dispara a liquidação manual do campeonato.
 */
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

