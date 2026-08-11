// routes/clube.js
const express = require('express');

const router = express.Router();

const Club = require('../models/Club');

const Investment = require('../models/Investment');

const auth = require('../middleware/auth');

const InvestimentoController = require('../controllers/InvestimentoController');

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

const RANGE_MS = Object.freeze({
  '24H': 24 * 60 * 60 * 1000,
  '7D': 7 * 24 * 60 * 60 * 1000,
  '1M': 30 * 24 * 60 * 60 * 1000,
  '3M': 90 * 24 * 60 * 60 * 1000,
});

function round2(valor) {
  return Number(Number(valor || 0).toFixed(2));
}

function downsamplePoints(pontos, limite = 240) {
  if (pontos.length <= limite) return pontos;

  const resultado = [pontos[0]];
  const intervalo = (pontos.length - 1) / (limite - 1);

  for (let indice = 1; indice < limite - 1; indice += 1) {
    resultado.push(pontos[Math.round(indice * intervalo)]);
  }

  resultado.push(pontos[pontos.length - 1]);
  return resultado;
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

      return res.status(404).json({ erro: 'Clube nÃÂ£o encontrado.' });

    }

    return res.json(toClubResponse(clube));

  } catch (err) {

    console.error('Erro ao buscar clube:', err);

    return res.status(500).json({ erro: 'Erro ao buscar clube.' });

  }

});

router.get('/:id/historico-precos', async (req, res) => {
  try {
    const legacyId = Number(req.params.id);

    if (!Number.isInteger(legacyId) || legacyId <= 0) {
      return res.status(400).json({ erro: 'Clube invÃ¡lido.' });
    }

    const clube = await Club.findOne({ legacyId }).lean();

    if (!clube) {
      return res.status(404).json({ erro: 'Clube nÃ£o encontrado.' });
    }

    const rangeInformado = String(req.query.range || '7D').toUpperCase();
    const range = rangeInformado === 'ALL' || RANGE_MS[rangeInformado]
      ? rangeInformado
      : '7D';
    const filtroData = range === 'ALL'
      ? {}
      : { data: { $gte: new Date(Date.now() - RANGE_MS[range]) } };

    /*
     * Cada execuÃ§Ã£o do secundÃ¡rio cria um registro COMPRA e um VENDA.
     * Usar somente a ponta compradora evita duplicar trades e volume no grÃ¡fico.
     * COMPRA_SECUNDARIO mantÃ©m compatibilidade com registros de versÃµes antigas.
     */
    const operacoes = await Investment.find({
      clubeLegacyId: legacyId,
      tipo: { $in: ['COMPRA', 'COMPRA_SECUNDARIO'] },
      ...filtroData,
    })
      .sort({ data: -1, createdAt: -1 })
      .limit(5000)
      .select('data createdAt precoUnitario valorUnitario quantidade')
      .lean();

    const pontosCompletos = operacoes
      .map((operacao) => {
        const price = Number(operacao.precoUnitario ?? operacao.valorUnitario);
        const volume = Number(operacao.quantidade || 0);
        const data = operacao.data || operacao.createdAt;
        const timestamp = data ? new Date(data) : null;

        if (
          !timestamp ||
          Number.isNaN(timestamp.getTime()) ||
          !Number.isFinite(price) ||
          price <= 0
        ) return null;

        return {
          timestamp: timestamp.toISOString(),
          price: round2(price),
          volume: Number.isFinite(volume) && volume > 0 ? volume : 0,
        };
      })
      .filter(Boolean)
      .reverse();

    const primeiro = pontosCompletos[0] || null;
    const ultimo = pontosCompletos[pontosCompletos.length - 1] || null;
    const precos = pontosCompletos.map((ponto) => ponto.price);
    const variacaoAbs = primeiro && ultimo ? round2(ultimo.price - primeiro.price) : 0;
    const variacaoPct = primeiro?.price
      ? Number(((variacaoAbs / primeiro.price) * 100).toFixed(2))
      : 0;

    res.set('Cache-Control', 'private, no-store');

    return res.json({
      range,
      pontos: downsamplePoints(pontosCompletos),
      resumo: {
        desde: primeiro?.timestamp || null,
        ate: ultimo?.timestamp || null,
        inicial: primeiro?.price ?? null,
        atual: ultimo?.price ?? round2(clube.precoAtual ?? clube.preco),
        variacaoAbs,
        variacaoPct,
        min: precos.length ? Math.min(...precos) : null,
        max: precos.length ? Math.max(...precos) : null,
        tradesCount: pontosCompletos.length,
        volume: pontosCompletos.reduce((total, ponto) => total + ponto.volume, 0),
      },
      ipoLiquidacao: round2(clube.preco),
      precoMercado: round2(clube.precoAtual ?? clube.preco),
    });
  } catch (err) {
    console.error('Erro ao carregar histÃ³rico de preÃ§os:', err);
    return res.status(500).json({ erro: 'Erro ao carregar histÃ³rico de preÃ§os.' });
  }
});

router.get('/:id', async (req, res) => {

  try {

    const legacyId = Number(req.params.id);

    const clube = await Club.findOne({ legacyId }).lean();

    if (!clube) {

      return res.status(404).json({ erro: 'Clube nÃÂ£o encontrado.' });

    }

    return res.json(toClubResponse(clube));

  } catch (err) {

    console.error('Erro ao buscar clube por id:', err);

    return res.status(500).json({ erro: 'Erro ao buscar clube.' });

  }

});

/**

 * Compatibilidade com o frontend antigo:

 * POST /clube/:id/comprar

 */

router.post('/:id/comprar', auth, (req, res, next) => {

  req.body = {

    ...req.body,

    clubeId: Number(req.params.id),

  };

  return InvestimentoController.comprarCota(req, res, next);

});

/**

 * Durante o IPO, a venda ÃÂ© uma devoluÃÂ§ÃÂ£o imediata ÃÂ  oferta inicial.

 * O backend define o preÃÂ§o oficial, nÃÂ£o cobra taxas e devolve as cotas

 * ao estoque do clube sem criar ordem no mercado secundÃÂ¡rio.

 */

router.post('/:id/devolver', auth, (req, res, next) => {

  req.body = {

    ...req.body,

    clubeId: Number(req.params.id),

  };

  return InvestimentoController.devolverCotaIPO(req, res, next);

});

module.exports = router;
