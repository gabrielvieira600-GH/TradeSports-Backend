const express = require('express');
const crypto = require('crypto');

const router = express.Router();

const auth = require('../middleware/auth');
const requirePremium = require('../middleware/requirePremium');

const User = require('../models/User');
const Club = require('../models/Club');
const PrivateRanking = require('../models/PrivateRanking');
const PrivateRankingMember = require('../models/PrivateRankingMember');
const RankingSeason = require('../models/RankingSeason');

const {
  obterPlanoEfetivo,
  obterLimitesDoPlano,
} = require('../utils/planFeatures');

function gerarCodigoConvite() {
  return crypto
    .randomBytes(4)
    .toString('hex')
    .toLowerCase();
}

function round2(n) {
  return Number(Number(n || 0).toFixed(2));
}

async function gerarCodigoUnico() {
  for (let i = 0; i < 10; i += 1) {
    const codigo = gerarCodigoConvite();

    const existente = await PrivateRanking.findOne({
      codigoConvite: codigo,
    }).lean();

    if (!existente) {
      return codigo;
    }
  }

  return `${gerarCodigoConvite()}${Date.now()
    .toString(36)
    .slice(-4)}`;
}

async function buscarTemporadaAtiva() {
  return RankingSeason.findOne({
    status: 'ativa',
  })
    .sort({
      iniciadaEm: -1,
      createdAt: -1,
    })
    .lean();
}

async function calcularRankingPrivado({ rankingId }) {
  const membros = await PrivateRankingMember.find({
    rankingId,
    status: 'aprovado',
  })
    .select('usuarioId entrouEm')
    .lean();

  const usuarioIds = membros.map((m) => m.usuarioId);

  if (!usuarioIds.length) {
    return [];
  }

  const [usuarios, clubes] = await Promise.all([
    User.find({
      _id: { $in: usuarioIds },
      rankingAtivo: { $ne: false },
    })
      .select(
        [
          '_id',
          'nome',
          'nomeUsuario',
          'saldo',
          'capitalInicial',
          'carteira',
          'createdAt',
          'temporadaRanking',
          'patrimonioInicialTemporada',
          'saldoInicialTemporada',
          'inicioTemporadaRanking',
          'rankingAtivo',
          'plano',
          'premiumAtivo',
          'premiumInicio',
          'premiumFim',
        ].join(' ')
      )
      .lean(),

    Club.find({})
      .select('legacyId precoAtual preco')
      .lean(),
  ]);

  const membrosPorUsuarioId = new Map(
    membros.map((m) => [
      String(m.usuarioId),
      m,
    ])
  );

  const precosPorClube = new Map(
    clubes.map((clube) => [
      String(clube.legacyId),
      Number(clube.precoAtual ?? clube.preco ?? 0),
    ])
  );

  const ranking = usuarios.map((usuario) => {
    const saldo = Number(usuario.saldo || 0);

    const carteira = Array.isArray(usuario.carteira)
      ? usuario.carteira
      : [];

    let valorPosicoes = 0;
    let quantidadeUnidades = 0;
    let quantidadePosicoes = 0;

    for (const ativo of carteira) {
      const clubeId = Number(
        ativo.clubeId ??
          ativo.clubeLegacyId ??
          ativo.idClube ??
          ativo.clube?.id ??
          ativo.clube?.legacyId
      );

      const quantidade = Number(
        ativo.quantidade ??
          ativo.cotas ??
          0
      );

      if (
        !Number.isFinite(clubeId) ||
        clubeId <= 0 ||
        !Number.isFinite(quantidade) ||
        quantidade <= 0
      ) {
        continue;
      }

      const precoAtualDoClube =
        precosPorClube.get(String(clubeId));

      const precoAtual = Number.isFinite(precoAtualDoClube)
        ? precoAtualDoClube
        : Number(
            ativo.precoMedio ??
              ativo.valorUnitario ??
              0
          );

      valorPosicoes += quantidade * precoAtual;
      quantidadeUnidades += quantidade;
      quantidadePosicoes += 1;
    }

    valorPosicoes = round2(valorPosicoes);

    const patrimonio = round2(saldo + valorPosicoes);

    const patrimonioInicialTemporadaRaw = Number(
      usuario.patrimonioInicialTemporada
    );

    const temporadaInicializada =
      Boolean(usuario.temporadaRanking) &&
      Number.isFinite(patrimonioInicialTemporadaRaw) &&
      patrimonioInicialTemporadaRaw > 0;

    const patrimonioInicialTemporada =
      temporadaInicializada
        ? patrimonioInicialTemporadaRaw
        : Number(usuario.capitalInicial ?? 1000);

    const resultado = round2(
      patrimonio - patrimonioInicialTemporada
    );

    const rentabilidade =
      patrimonioInicialTemporada > 0
        ? round2(
            (resultado / patrimonioInicialTemporada) * 100
          )
        : 0;

    const membro = membrosPorUsuarioId.get(
      String(usuario._id)
    );

    return {
      usuarioId: String(usuario._id),
      nome: usuario.nome || '',
      nomeUsuario: usuario.nomeUsuario || '',
      plano: obterPlanoEfetivo(usuario),

      temporadaRanking:
        usuario.temporadaRanking || null,

      temporadaInicializada,

      patrimonioInicialTemporada: round2(
        patrimonioInicialTemporada
      ),

      inicioTemporadaRanking:
        usuario.inicioTemporadaRanking || null,

      saldo: round2(saldo),
      valorPosicoes,
      patrimonio,
      resultado,
      rentabilidade,
      quantidadePosicoes,
      quantidadeUnidades: Number(
        quantidadeUnidades.toFixed(4)
      ),

      entrouEm: membro?.entrouEm || null,
      criadoEm: usuario.createdAt || null,
    };
  });

  ranking.sort((a, b) => {
    if (b.rentabilidade !== a.rentabilidade) {
      return b.rentabilidade - a.rentabilidade;
    }

    if (b.resultado !== a.resultado) {
      return b.resultado - a.resultado;
    }

    if (b.patrimonio !== a.patrimonio) {
      return b.patrimonio - a.patrimonio;
    }

    return String(a.nomeUsuario).localeCompare(
      String(b.nomeUsuario),
      'pt-BR'
    );
  });

  return ranking.map((item, index) => ({
    posicao: index + 1,
    ...item,
  }));
}

async function recalcularTotalParticipantes(rankingId) {
  const total = await PrivateRankingMember.countDocuments({
    rankingId,
    status: 'aprovado',
  });

  await PrivateRanking.findByIdAndUpdate(rankingId, {
    $set: {
      totalParticipantes: total,
    },
  });

  return total;
}

router.use(auth);

router.get('/', requirePremium, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;

    const membros = await PrivateRankingMember.find({
      usuarioId,
      status: {
        $in: ['aprovado', 'pendente'],
      },
    })
      .select('rankingId status entrouEm criadoEm')
      .lean();

    const rankingIds = membros.map((m) => m.rankingId);

    const [criados, participando] = await Promise.all([
      PrivateRanking.find({
        criadorId: usuarioId,
        status: { $ne: 'cancelado' },
      })
        .sort({ createdAt: -1 })
        .lean(),

      PrivateRanking.find({
        _id: { $in: rankingIds },
        status: { $ne: 'cancelado' },
      })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const membrosPorRankingId = new Map(
      membros.map((m) => [
        String(m.rankingId),
        m,
      ])
    );

    return res.json({
      ok: true,

      criados,

      participando: participando.map((ranking) => ({
        ...ranking,
        membro:
          membrosPorRankingId.get(String(ranking._id)) ||
          null,
      })),
    });
  } catch (err) {
    console.error(
      'Erro ao listar rankings privados:',
      err
    );

    return res.status(500).json({
      erro:
        'Erro interno ao listar rankings privados.',
    });
  }
});

router.post('/', requirePremium, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;

    const usuario = await User.findById(usuarioId)
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

    const limites = obterLimitesDoPlano(usuario);

    const totalCriados = await PrivateRanking.countDocuments({
      criadorId: usuarioId,
      status: { $ne: 'cancelado' },
    });

    if (
      limites.rankingsPrivadosCriados != null &&
      totalCriados >= limites.rankingsPrivadosCriados
    ) {
      return res.status(403).json({
        erro:
          'Você atingiu o limite de rankings privados criados no plano Premium.',
        codigo: 'LIMITE_RANKINGS_PRIVADOS_CRIADOS',
        limite: limites.rankingsPrivadosCriados,
      });
    }

    const temporada = await buscarTemporadaAtiva();

    if (!temporada) {
      return res.status(409).json({
        erro:
          'Não existe uma temporada ativa para criar ranking privado.',
        codigo: 'TEMPORADA_NAO_ATIVA',
      });
    }

    const {
      nome,
      descricao = '',
      imagemUrl = null,
      maxParticipantes = 50,
      aprovacaoManual = false,
      dataInicio = null,
      dataFim = null,
      configuracoes = {},
    } = req.body || {};

    if (!nome || !String(nome).trim()) {
      return res.status(400).json({
        erro: 'O nome do ranking privado é obrigatório.',
      });
    }

    const maxParticipantesNormalizado = Math.min(
      500,
      Math.max(2, Number(maxParticipantes || 50))
    );

    const codigoConvite = await gerarCodigoUnico();

    const ranking = await PrivateRanking.create({
      nome: String(nome).trim(),
      descricao: String(descricao || '').trim(),
      imagemUrl: imagemUrl ? String(imagemUrl).trim() : null,
      criadorId: usuarioId,
      temporadaId: temporada._id,
      codigoConvite,
      status: 'ativo',
      maxParticipantes: maxParticipantesNormalizado,
      aprovacaoManual: Boolean(aprovacaoManual),
      dataInicio: dataInicio ? new Date(dataInicio) : null,
      dataFim: dataFim ? new Date(dataFim) : null,
      totalParticipantes: 1,
      configuracoes:
        configuracoes &&
        typeof configuracoes === 'object' &&
        !Array.isArray(configuracoes)
          ? configuracoes
          : {},
    });

    await PrivateRankingMember.create({
      rankingId: ranking._id,
      usuarioId,
      status: 'aprovado',
      entrouEm: new Date(),
      aprovadoEm: new Date(),
      aprovadoPor: usuarioId,
      metadata: {
        papel: 'criador',
      },
    });

    return res.status(201).json({
      ok: true,
      ranking,
    });
  } catch (err) {
    console.error(
      'Erro ao criar ranking privado:',
      err
    );

    if (err?.code === 11000) {
      return res.status(409).json({
        erro:
          'Conflito ao criar ranking privado. Tente novamente.',
      });
    }

    return res.status(500).json({
      erro:
        'Erro interno ao criar ranking privado.',
    });
  }
});

router.get('/convite/:codigo', async (req, res) => {
  try {
    const codigo = String(req.params.codigo || '')
      .trim()
      .toLowerCase();

    const ranking = await PrivateRanking.findOne({
      codigoConvite: codigo,
      status: 'ativo',
    }).lean();

    if (!ranking) {
      return res.status(404).json({
        erro:
          'Ranking privado não encontrado ou convite inválido.',
      });
    }

    const usuario = await User.findById(req.usuario.id)
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

    const plano = obterPlanoEfetivo(usuario);

    const membro = await PrivateRankingMember.findOne({
      rankingId: ranking._id,
      usuarioId: req.usuario.id,
    }).lean();

    return res.json({
      ok: true,
      ranking: {
        id: String(ranking._id),
        nome: ranking.nome,
        descricao: ranking.descricao || '',
        imagemUrl: ranking.imagemUrl || null,
        totalParticipantes:
          ranking.totalParticipantes || 0,
        maxParticipantes: ranking.maxParticipantes,
        aprovacaoManual: ranking.aprovacaoManual,
      },
      plano,
      premiumNecessario: plano !== 'premium',
      membro,
    });
  } catch (err) {
    console.error(
      'Erro ao consultar convite de ranking privado:',
      err
    );

    return res.status(500).json({
      erro:
        'Erro interno ao consultar convite de ranking privado.',
    });
  }
});

router.post(
  '/convite/:codigo/entrar',
  requirePremium,
  async (req, res) => {
    try {
      const codigo = String(req.params.codigo || '')
        .trim()
        .toLowerCase();

      const ranking = await PrivateRanking.findOne({
        codigoConvite: codigo,
        status: 'ativo',
      });

      if (!ranking) {
        return res.status(404).json({
          erro:
            'Ranking privado não encontrado ou convite inválido.',
        });
      }

      if (
        ranking.dataInicio &&
        new Date() < new Date(ranking.dataInicio)
      ) {
        return res.status(409).json({
          erro:
            'Este ranking privado ainda não começou.',
          codigo: 'RANKING_PRIVADO_NAO_INICIADO',
        });
      }

      if (
        ranking.dataFim &&
        new Date() > new Date(ranking.dataFim)
      ) {
        return res.status(409).json({
          erro:
            'Este ranking privado já foi encerrado.',
          codigo: 'RANKING_PRIVADO_ENCERRADO',
        });
      }

      const totalParticipantes =
        await PrivateRankingMember.countDocuments({
          rankingId: ranking._id,
          status: 'aprovado',
        });

      if (
        totalParticipantes >=
        Number(ranking.maxParticipantes || 50)
      ) {
        return res.status(403).json({
          erro:
            'Este ranking privado atingiu o limite de participantes.',
          codigo: 'RANKING_PRIVADO_LOTADO',
        });
      }

      const usuario = await User.findById(req.usuario.id)
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

      const limites = obterLimitesDoPlano(usuario);

      const totalParticipando =
        await PrivateRankingMember.countDocuments({
          usuarioId: req.usuario.id,
          status: {
            $in: ['aprovado', 'pendente'],
          },
        });

      if (
        limites.rankingsPrivadosParticipando != null &&
        totalParticipando >=
          limites.rankingsPrivadosParticipando
      ) {
        return res.status(403).json({
          erro:
            'Você atingiu o limite de rankings privados em participação.',
          codigo:
            'LIMITE_RANKINGS_PRIVADOS_PARTICIPANDO',
          limite:
            limites.rankingsPrivadosParticipando,
        });
      }

      const status = ranking.aprovacaoManual
        ? 'pendente'
        : 'aprovado';

      const agora = new Date();

      const membro =
        await PrivateRankingMember.findOneAndUpdate(
          {
            rankingId: ranking._id,
            usuarioId: req.usuario.id,
          },
          {
            $set: {
              status,
              entrouEm:
                status === 'aprovado'
                  ? agora
                  : null,
              aprovadoEm:
                status === 'aprovado'
                  ? agora
                  : null,
              aprovadoPor:
                status === 'aprovado'
                  ? ranking.criadorId
                  : null,
              convidadoEm: agora,
              removidoEm: null,
              recusadoEm: null,
              saiuEm: null,
            },
          },
          {
            new: true,
            upsert: true,
            setDefaultsOnInsert: true,
          }
        );

      const totalAtualizado =
        await recalcularTotalParticipantes(ranking._id);

      return res.json({
        ok: true,
        status,
        membro,
        totalParticipantes: totalAtualizado,
      });
    } catch (err) {
      console.error(
        'Erro ao entrar em ranking privado:',
        err
      );

      if (err?.code === 11000) {
        return res.status(409).json({
          erro:
            'Você já possui vínculo com este ranking privado.',
        });
      }

      return res.status(500).json({
        erro:
          'Erro interno ao entrar em ranking privado.',
      });
    }
  }
);

router.get('/:id', requirePremium, async (req, res) => {
  try {
    const ranking = await PrivateRanking.findById(
      req.params.id
    ).lean();

    if (!ranking) {
      return res.status(404).json({
        erro: 'Ranking privado não encontrado.',
      });
    }

    const membro = await PrivateRankingMember.findOne({
      rankingId: ranking._id,
      usuarioId: req.usuario.id,
      status: 'aprovado',
    }).lean();

    const isCriador =
      String(ranking.criadorId) ===
      String(req.usuario.id);

    if (!membro && !isCriador) {
      return res.status(403).json({
        erro:
          'Você não participa deste ranking privado.',
      });
    }

    return res.json({
      ok: true,
      ranking,
      membro,
      isCriador,
    });
  } catch (err) {
    console.error(
      'Erro ao consultar ranking privado:',
      err
    );

    return res.status(500).json({
      erro:
        'Erro interno ao consultar ranking privado.',
    });
  }
});

router.get(
  '/:id/classificacao',
  requirePremium,
  async (req, res) => {
    try {
      const ranking = await PrivateRanking.findById(
        req.params.id
      ).lean();

      if (!ranking) {
        return res.status(404).json({
          erro:
            'Ranking privado não encontrado.',
        });
      }

      const membro = await PrivateRankingMember.findOne({
        rankingId: ranking._id,
        usuarioId: req.usuario.id,
        status: 'aprovado',
      }).lean();

      const isCriador =
        String(ranking.criadorId) ===
        String(req.usuario.id);

      if (!membro && !isCriador) {
        return res.status(403).json({
          erro:
            'Você não participa deste ranking privado.',
        });
      }

      const page = Math.max(
        1,
        Number.parseInt(req.query.page, 10) || 1
      );

      const limit = Math.min(
        100,
        Math.max(
          1,
          Number.parseInt(req.query.limit, 10) || 50
        )
      );

      const classificacao =
        await calcularRankingPrivado({
          rankingId: ranking._id,
        });

      const totalUsuarios =
        classificacao.length;

      const totalPages = Math.max(
        1,
        Math.ceil(totalUsuarios / limit)
      );

      const pageNormalizada = Math.min(
        page,
        totalPages
      );

      const inicio =
        (pageNormalizada - 1) * limit;

      const fim = inicio + limit;

      const usuarioAtual =
        classificacao.find(
          (item) =>
            item.usuarioId ===
            String(req.usuario.id)
        ) || null;

      return res.json({
        ok: true,
        moeda: 'T$',
        criterio:
          'RENTABILIDADE_TEMPORADA',
        ranking: {
          id: String(ranking._id),
          nome: ranking.nome,
          descricao:
            ranking.descricao || '',
          codigoConvite:
            ranking.codigoConvite,
          totalParticipantes:
            ranking.totalParticipantes || 0,
          maxParticipantes:
            ranking.maxParticipantes,
          aprovacaoManual:
            ranking.aprovacaoManual,
        },
        page: pageNormalizada,
        limit,
        totalPages,
        totalUsuarios,
        usuarioAtual,
        classificacao: classificacao.slice(
          inicio,
          fim
        ),
      });
    } catch (err) {
      console.error(
        'Erro ao gerar classificação privada:',
        err
      );

      return res.status(500).json({
        erro:
          'Erro interno ao gerar classificação privada.',
      });
    }
  }
);

router.post(
  '/:id/aprovar/:usuarioId',
  requirePremium,
  async (req, res) => {
    try {
      const ranking = await PrivateRanking.findById(
        req.params.id
      );

      if (!ranking) {
        return res.status(404).json({
          erro:
            'Ranking privado não encontrado.',
        });
      }

      if (
        String(ranking.criadorId) !==
        String(req.usuario.id)
      ) {
        return res.status(403).json({
          erro:
            'Apenas o criador pode aprovar participantes.',
        });
      }

      const membro =
        await PrivateRankingMember.findOne({
          rankingId: ranking._id,
          usuarioId: req.params.usuarioId,
          status: 'pendente',
        });

      if (!membro) {
        return res.status(404).json({
          erro:
            'Solicitação pendente não encontrada.',
        });
      }

      const totalParticipantes =
        await PrivateRankingMember.countDocuments({
          rankingId: ranking._id,
          status: 'aprovado',
        });

      if (
        totalParticipantes >=
        Number(ranking.maxParticipantes || 50)
      ) {
        return res.status(403).json({
          erro:
            'Este ranking privado atingiu o limite de participantes.',
          codigo: 'RANKING_PRIVADO_LOTADO',
        });
      }

      membro.status = 'aprovado';
      membro.entrouEm = new Date();
      membro.aprovadoEm = new Date();
      membro.aprovadoPor = req.usuario.id;

      await membro.save();

      const totalAtualizado =
        await recalcularTotalParticipantes(ranking._id);

      return res.json({
        ok: true,
        membro,
        totalParticipantes: totalAtualizado,
      });
    } catch (err) {
      console.error(
        'Erro ao aprovar participante:',
        err
      );

      return res.status(500).json({
        erro:
          'Erro interno ao aprovar participante.',
      });
    }
  }
);

router.post(
  '/:id/recusar/:usuarioId',
  requirePremium,
  async (req, res) => {
    try {
      const ranking = await PrivateRanking.findById(
        req.params.id
      );

      if (!ranking) {
        return res.status(404).json({
          erro:
            'Ranking privado não encontrado.',
        });
      }

      if (
        String(ranking.criadorId) !==
        String(req.usuario.id)
      ) {
        return res.status(403).json({
          erro:
            'Apenas o criador pode recusar participantes.',
        });
      }

      const membro =
        await PrivateRankingMember.findOne({
          rankingId: ranking._id,
          usuarioId: req.params.usuarioId,
          status: 'pendente',
        });

      if (!membro) {
        return res.status(404).json({
          erro:
            'Solicitação pendente não encontrada.',
        });
      }

      membro.status = 'recusado';
      membro.recusadoEm = new Date();

      await membro.save();

      return res.json({
        ok: true,
        membro,
      });
    } catch (err) {
      console.error(
        'Erro ao recusar participante:',
        err
      );

      return res.status(500).json({
        erro:
          'Erro interno ao recusar participante.',
      });
    }
  }
);

router.post(
  '/:id/remover/:usuarioId',
  requirePremium,
  async (req, res) => {
    try {
      const ranking = await PrivateRanking.findById(
        req.params.id
      );

      if (!ranking) {
        return res.status(404).json({
          erro:
            'Ranking privado não encontrado.',
        });
      }

      if (
        String(ranking.criadorId) !==
        String(req.usuario.id)
      ) {
        return res.status(403).json({
          erro:
            'Apenas o criador pode remover participantes.',
        });
      }

      if (
        String(ranking.criadorId) ===
        String(req.params.usuarioId)
      ) {
        return res.status(400).json({
          erro:
            'O criador não pode ser removido do próprio ranking.',
        });
      }

      const membro =
        await PrivateRankingMember.findOne({
          rankingId: ranking._id,
          usuarioId: req.params.usuarioId,
          status: 'aprovado',
        });

      if (!membro) {
        return res.status(404).json({
          erro:
            'Participante aprovado não encontrado.',
        });
      }

      membro.status = 'removido';
      membro.removidoEm = new Date();

      await membro.save();

      const totalAtualizado =
        await recalcularTotalParticipantes(ranking._id);

      return res.json({
        ok: true,
        membro,
        totalParticipantes: totalAtualizado,
      });
    } catch (err) {
      console.error(
        'Erro ao remover participante:',
        err
      );

      return res.status(500).json({
        erro:
          'Erro interno ao remover participante.',
      });
    }
  }
);

router.post(
  '/:id/sair',
  requirePremium,
  async (req, res) => {
    try {
      const ranking = await PrivateRanking.findById(
        req.params.id
      );

      if (!ranking) {
        return res.status(404).json({
          erro:
            'Ranking privado não encontrado.',
        });
      }

      if (
        String(ranking.criadorId) ===
        String(req.usuario.id)
      ) {
        return res.status(400).json({
          erro:
            'O criador não pode sair do próprio ranking. Cancele o ranking se desejar encerrá-lo.',
        });
      }

      const membro =
        await PrivateRankingMember.findOne({
          rankingId: ranking._id,
          usuarioId: req.usuario.id,
          status: {
            $in: ['aprovado', 'pendente'],
          },
        });

      if (!membro) {
        return res.status(404).json({
          erro:
            'Você não participa deste ranking privado.',
        });
      }

      membro.status = 'saiu';
      membro.saiuEm = new Date();

      await membro.save();

      const totalAtualizado =
        await recalcularTotalParticipantes(ranking._id);

      return res.json({
        ok: true,
        membro,
        totalParticipantes: totalAtualizado,
      });
    } catch (err) {
      console.error(
        'Erro ao sair do ranking privado:',
        err
      );

      return res.status(500).json({
        erro:
          'Erro interno ao sair do ranking privado.',
      });
    }
  }
);

router.post(
  '/:id/cancelar',
  requirePremium,
  async (req, res) => {
    try {
      const ranking = await PrivateRanking.findById(
        req.params.id
      );

      if (!ranking) {
        return res.status(404).json({
          erro:
            'Ranking privado não encontrado.',
        });
      }

      if (
        String(ranking.criadorId) !==
        String(req.usuario.id)
      ) {
        return res.status(403).json({
          erro:
            'Apenas o criador pode cancelar este ranking.',
        });
      }

      if (ranking.status !== 'ativo') {
        return res.status(409).json({
          erro:
            'Este ranking privado não está ativo.',
        });
      }

      ranking.status = 'cancelado';

      await ranking.save();

      await PrivateRankingMember.updateMany(
        {
          rankingId: ranking._id,
          status: {
            $in: ['aprovado', 'pendente'],
          },
        },
        {
          $set: {
            status: 'removido',
            removidoEm: new Date(),
          },
        }
      );

      await recalcularTotalParticipantes(ranking._id);

      return res.json({
        ok: true,
        ranking,
      });
    } catch (err) {
      console.error(
        'Erro ao cancelar ranking privado:',
        err
      );

      return res.status(500).json({
        erro:
          'Erro interno ao cancelar ranking privado.',
      });
    }
  }
);

module.exports = router;