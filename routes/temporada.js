const express = require('express');

const router = express.Router();

const auth = require('../middleware/auth');

const RankingSeason = require('../models/RankingSeason');
const RankingRound = require('../models/RankingRound');
const User = require('../models/User');

const {
  obterResumoDoPlano,
} = require('../utils/planFeatures');

router.get('/atual', auth, async (req, res) => {
  try {
    const usuario = await User.findById(
      req.usuario.id
    )
      .select(
        [
          '_id',
          'plano',
          'premiumAtivo',
          'premiumInicio',
          'premiumFim',
        ].join(' ')
      )
      .lean();

    if (!usuario) {
      return res.status(404).json({
        erro: 'Usuário não encontrado.',
      });
    }

    const temporada =
      await RankingSeason.buscarTemporadaAtiva();

    if (!temporada) {
      return res.json({
        temporadaAtiva: false,
        rodadaAberta: false,
        temporada: null,
        rodada: null,
        plano: obterResumoDoPlano(usuario),
      });
    }

    const rodada =
      await RankingRound.buscarRodadaAberta(
        temporada._id
      );

    const resumoPlano =
      obterResumoDoPlano(usuario);

    const limiteOrdens =
      resumoPlano.plano === 'premium'
        ? null
        : Number(
            rodada?.limiteOrdensLite ??
              temporada.limiteOrdensLitePorRodada ??
              resumoPlano.limites.ordensPorRodada ??
              15
          );

    return res.json({
      temporadaAtiva: true,
      rodadaAberta: Boolean(rodada),

      temporada: {
        id: String(temporada._id),
        codigo: temporada.codigo,
        nome: temporada.nome,
        descricao: temporada.descricao || '',
        status: temporada.status,
        capitalInicial: Number(
          temporada.capitalInicial || 1000
        ),
        rodadaAtual:
          temporada.rodadaAtual || null,
        totalRodadas:
          temporada.totalRodadas || null,
        inicioPrevisto:
          temporada.inicioPrevisto || null,
        fimPrevisto:
          temporada.fimPrevisto || null,
        iniciadaEm:
          temporada.iniciadaEm || null,
      },

      rodada: rodada
        ? {
            id: String(rodada._id),
            numero: rodada.numero,
            nome: rodada.nome || '',
            status: rodada.status,
            limiteOrdensLite: Number(
              rodada.limiteOrdensLite ??
                temporada.limiteOrdensLitePorRodada ??
                15
            ),
            inicioPrevisto:
              rodada.inicioPrevisto || null,
            fimPrevisto:
              rodada.fimPrevisto || null,
            abertaEm:
              rodada.abertaEm || null,
          }
        : null,

      plano: {
        plano: resumoPlano.plano,
        planoCadastrado:
          resumoPlano.planoCadastrado,
        premiumAtivo:
          resumoPlano.premiumAtivo,
        premiumInicio:
          resumoPlano.premiumInicio,
        premiumFim:
          resumoPlano.premiumFim,
      },

      ordens: {
        ilimitadas:
          resumoPlano.plano === 'premium',
        limitePorRodada: limiteOrdens,
      },
    });
  } catch (err) {
    console.error(
      'Erro ao consultar temporada atual:',
      err
    );

    return res.status(500).json({
      erro:
        'Erro interno ao consultar temporada atual.',
    });
  }
});

module.exports = router;