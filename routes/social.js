const express = require('express');

const router = express.Router();

const auth = require('../middleware/auth');

const User = require('../models/User');
const UserFollow = require('../models/UserFollow');

const {
  obterPlanoEfetivo,
} = require('../utils/planFeatures');

function montarNomePublico(usuario) {
  return (
    usuario.nomeUsuario ||
    usuario.username ||
    usuario.nome ||
    'Usuário'
  );
}

function normalizarBusca(valor) {
  return String(valor || '')
    .trim()
    .replace(/\s+/g, ' ');
}

async function obterEstatisticasSociais(usuarioId) {
  const [seguidores, seguindo] = await Promise.all([
    UserFollow.countDocuments({
      seguidoId: usuarioId,
      status: 'ativo',
    }),

    UserFollow.countDocuments({
      seguidorId: usuarioId,
      status: 'ativo',
    }),
  ]);

  return {
    seguidores,
    seguindo,
  };
}

async function verificarRelacaoSocial({
  usuarioLogadoId,
  usuarioAlvoId,
}) {
  if (!usuarioLogadoId || !usuarioAlvoId) {
    return {
      seguindo: false,
      segueVoce: false,
    };
  }

  const [seguindo, segueVoce] = await Promise.all([
    UserFollow.findOne({
      seguidorId: usuarioLogadoId,
      seguidoId: usuarioAlvoId,
      status: 'ativo',
    }).lean(),

    UserFollow.findOne({
      seguidorId: usuarioAlvoId,
      seguidoId: usuarioLogadoId,
      status: 'ativo',
    }).lean(),
  ]);

  return {
    seguindo: Boolean(seguindo),
    segueVoce: Boolean(segueVoce),
  };
}

function montarPerfilPublico({
  usuario,
  estatisticas,
  relacao,
}) {
  const plano = obterPlanoEfetivo(usuario);

  return {
    id: String(usuario._id),
    nome: usuario.nome || '',
    nomeUsuario: usuario.nomeUsuario || '',
    nomePublico: montarNomePublico(usuario),

    plano,
    premiumAtivo: plano === 'premium',

    rankingAtivo: usuario.rankingAtivo !== false,

    criadoEm: usuario.createdAt || null,

    estatisticas: {
      seguidores: estatisticas?.seguidores || 0,
      seguindo: estatisticas?.seguindo || 0,
    },

    relacao: {
      seguindo: Boolean(relacao?.seguindo),
      segueVoce: Boolean(relacao?.segueVoce),
    },

    mercado: {
      saldo: Number(usuario.saldo || 0),
      patrimonio: null,
      rentabilidade: null,
      quantidadePosicoes: Array.isArray(usuario.carteira)
        ? usuario.carteira.filter(
            (ativo) =>
              Number(
                ativo.quantidade ??
                  ativo.cotas ??
                  0
              ) > 0
          ).length
        : 0,
    },
  };
}

router.use(auth);

/**
 * GET /social/usuarios?busca=gabriel
 *
 * Busca usuários públicos por nome, nome de usuário ou e-mail.
 * Retorna uma lista resumida para autocomplete/listagem.
 */
router.get('/usuarios', async (req, res) => {
  try {
    const busca = normalizarBusca(
      req.query.busca ||
        req.query.q ||
        req.query.search
    );

    const limit = Math.min(
      30,
      Math.max(
        1,
        Number.parseInt(req.query.limit, 10) || 20
      )
    );

    if (!busca || busca.length < 2) {
      return res.json({
        ok: true,
        busca,
        usuarios: [],
      });
    }

    const regex = new RegExp(
      busca.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'i'
    );

    const usuarios = await User.find({
      _id: { $ne: req.usuario.id },
      rankingAtivo: { $ne: false },
      $or: [
        { nome: regex },
        { nomeUsuario: regex },
        { email: regex },
      ],
    })
      .select(
        [
          '_id',
          'nome',
          'nomeUsuario',
          'email',
          'createdAt',
          'rankingAtivo',
          'plano',
          'premiumAtivo',
          'premiumInicio',
          'premiumFim',
          'carteira',
        ].join(' ')
      )
      .sort({
        nomeUsuario: 1,
        nome: 1,
      })
      .limit(limit)
      .lean();

    const usuarioIds = usuarios.map((u) => u._id);

    const [seguindoDocs, seguidoresAgg, seguindoAgg] =
      await Promise.all([
        UserFollow.find({
          seguidorId: req.usuario.id,
          seguidoId: { $in: usuarioIds },
          status: 'ativo',
        })
          .select('seguidoId')
          .lean(),

        UserFollow.aggregate([
          {
            $match: {
              seguidoId: {
                $in: usuarioIds,
              },
              status: 'ativo',
            },
          },
          {
            $group: {
              _id: '$seguidoId',
              total: { $sum: 1 },
            },
          },
        ]),

        UserFollow.aggregate([
          {
            $match: {
              seguidorId: {
                $in: usuarioIds,
              },
              status: 'ativo',
            },
          },
          {
            $group: {
              _id: '$seguidorId',
              total: { $sum: 1 },
            },
          },
        ]),
      ]);

    const seguindoSet = new Set(
      seguindoDocs.map((doc) =>
        String(doc.seguidoId)
      )
    );

    const seguidoresPorUsuario = new Map(
      seguidoresAgg.map((item) => [
        String(item._id),
        Number(item.total || 0),
      ])
    );

    const seguindoPorUsuario = new Map(
      seguindoAgg.map((item) => [
        String(item._id),
        Number(item.total || 0),
      ])
    );

    const resposta = usuarios.map((usuario) => {
      const usuarioId = String(usuario._id);
      const plano = obterPlanoEfetivo(usuario);

      return {
        id: usuarioId,
        nome: usuario.nome || '',
        nomeUsuario: usuario.nomeUsuario || '',
        nomePublico: montarNomePublico(usuario),

        plano,
        premiumAtivo: plano === 'premium',

        seguindo: seguindoSet.has(usuarioId),

        estatisticas: {
          seguidores:
            seguidoresPorUsuario.get(usuarioId) || 0,
          seguindo:
            seguindoPorUsuario.get(usuarioId) || 0,
        },

        quantidadePosicoes: Array.isArray(usuario.carteira)
          ? usuario.carteira.filter(
              (ativo) =>
                Number(
                  ativo.quantidade ??
                    ativo.cotas ??
                    0
                ) > 0
            ).length
          : 0,

        criadoEm: usuario.createdAt || null,
      };
    });

    return res.json({
      ok: true,
      busca,
      usuarios: resposta,
    });
  } catch (err) {
    console.error(
      'Erro ao buscar usuários sociais:',
      err
    );

    return res.status(500).json({
      erro: 'Erro interno ao buscar usuários.',
    });
  }
});

/**
 * GET /social/usuarios/:id
 *
 * Perfil público de um usuário.
 */
router.get('/usuarios/:id', async (req, res) => {
  try {
    const usuario = await User.findById(req.params.id)
      .select(
        [
          '_id',
          'nome',
          'nomeUsuario',
          'createdAt',
          'rankingAtivo',
          'plano',
          'premiumAtivo',
          'premiumInicio',
          'premiumFim',
          'saldo',
          'carteira',
        ].join(' ')
      )
      .lean();

    if (!usuario || usuario.rankingAtivo === false) {
      return res.status(404).json({
        erro: 'Usuário não encontrado.',
      });
    }

    const [estatisticas, relacao] = await Promise.all([
      obterEstatisticasSociais(usuario._id),

      verificarRelacaoSocial({
        usuarioLogadoId: req.usuario.id,
        usuarioAlvoId: usuario._id,
      }),
    ]);

    return res.json({
      ok: true,
      usuario: montarPerfilPublico({
        usuario,
        estatisticas,
        relacao,
      }),
    });
  } catch (err) {
    console.error(
      'Erro ao buscar perfil público:',
      err
    );

    return res.status(500).json({
      erro:
        'Erro interno ao buscar perfil público.',
    });
  }
});

/**
 * POST /social/usuarios/:id/seguir
 *
 * Segue um usuário.
 */
router.post('/usuarios/:id/seguir', async (req, res) => {
  try {
    const usuarioAlvoId = req.params.id;

    if (String(usuarioAlvoId) === String(req.usuario.id)) {
      return res.status(400).json({
        erro: 'Você não pode seguir a si mesmo.',
      });
    }

    const usuarioAlvo = await User.findById(usuarioAlvoId)
      .select('_id rankingAtivo')
      .lean();

    if (!usuarioAlvo || usuarioAlvo.rankingAtivo === false) {
      return res.status(404).json({
        erro: 'Usuário não encontrado.',
      });
    }

    const agora = new Date();

    const follow = await UserFollow.findOneAndUpdate(
      {
        seguidorId: req.usuario.id,
        seguidoId: usuarioAlvoId,
      },
      {
        $set: {
          status: 'ativo',
          seguidoEm: agora,
          removidoEm: null,
          bloqueadoEm: null,
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    const estatisticas = await obterEstatisticasSociais(
      usuarioAlvoId
    );

    return res.json({
      ok: true,
      seguindo: true,
      follow,
      estatisticas,
    });
  } catch (err) {
    console.error(
      'Erro ao seguir usuário:',
      err
    );

    if (err?.code === 11000) {
      return res.status(409).json({
        erro:
          'Você já possui vínculo social com este usuário.',
      });
    }

    return res.status(500).json({
      erro: 'Erro interno ao seguir usuário.',
    });
  }
});

/**
 * POST /social/usuarios/:id/deixar-de-seguir
 *
 * Remove o follow ativo.
 */
router.post(
  '/usuarios/:id/deixar-de-seguir',
  async (req, res) => {
    try {
      const usuarioAlvoId = req.params.id;

      if (String(usuarioAlvoId) === String(req.usuario.id)) {
        return res.status(400).json({
          erro:
            'Você não pode deixar de seguir a si mesmo.',
        });
      }

      const follow = await UserFollow.findOneAndUpdate(
        {
          seguidorId: req.usuario.id,
          seguidoId: usuarioAlvoId,
          status: 'ativo',
        },
        {
          $set: {
            status: 'removido',
            removidoEm: new Date(),
          },
        },
        {
          new: true,
        }
      );

      const estatisticas =
        await obterEstatisticasSociais(usuarioAlvoId);

      return res.json({
        ok: true,
        seguindo: false,
        follow,
        estatisticas,
      });
    } catch (err) {
      console.error(
        'Erro ao deixar de seguir usuário:',
        err
      );

      return res.status(500).json({
        erro:
          'Erro interno ao deixar de seguir usuário.',
      });
    }
  }
);

/**
 * GET /social/seguindo
 *
 * Lista quem o usuário logado segue.
 */
router.get('/seguindo', async (req, res) => {
  try {
    const follows = await UserFollow.find({
      seguidorId: req.usuario.id,
      status: 'ativo',
    })
      .sort({ seguidoEm: -1, createdAt: -1 })
      .limit(100)
      .lean();

    const usuarioIds = follows.map((f) => f.seguidoId);

    const usuarios = await User.find({
      _id: { $in: usuarioIds },
      rankingAtivo: { $ne: false },
    })
      .select(
        [
          '_id',
          'nome',
          'nomeUsuario',
          'plano',
          'premiumAtivo',
          'premiumInicio',
          'premiumFim',
          'createdAt',
        ].join(' ')
      )
      .lean();

    const usuariosPorId = new Map(
      usuarios.map((u) => [
        String(u._id),
        u,
      ])
    );

    return res.json({
      ok: true,
      usuarios: follows
        .map((follow) => {
          const usuario = usuariosPorId.get(
            String(follow.seguidoId)
          );

          if (!usuario) return null;

          const plano = obterPlanoEfetivo(usuario);

          return {
            id: String(usuario._id),
            nome: usuario.nome || '',
            nomeUsuario: usuario.nomeUsuario || '',
            nomePublico: montarNomePublico(usuario),
            plano,
            premiumAtivo: plano === 'premium',
            seguidoEm:
              follow.seguidoEm ||
              follow.createdAt ||
              null,
          };
        })
        .filter(Boolean),
    });
  } catch (err) {
    console.error(
      'Erro ao listar seguindo:',
      err
    );

    return res.status(500).json({
      erro:
        'Erro interno ao listar usuários seguidos.',
    });
  }
});

/**
 * GET /social/seguidores
 *
 * Lista seguidores do usuário logado.
 */
router.get('/seguidores', async (req, res) => {
  try {
    const follows = await UserFollow.find({
      seguidoId: req.usuario.id,
      status: 'ativo',
    })
      .sort({ seguidoEm: -1, createdAt: -1 })
      .limit(100)
      .lean();

    const usuarioIds = follows.map((f) => f.seguidorId);

    const usuarios = await User.find({
      _id: { $in: usuarioIds },
      rankingAtivo: { $ne: false },
    })
      .select(
        [
          '_id',
          'nome',
          'nomeUsuario',
          'plano',
          'premiumAtivo',
          'premiumInicio',
          'premiumFim',
          'createdAt',
        ].join(' ')
      )
      .lean();

    const usuariosPorId = new Map(
      usuarios.map((u) => [
        String(u._id),
        u,
      ])
    );

    return res.json({
      ok: true,
      usuarios: follows
        .map((follow) => {
          const usuario = usuariosPorId.get(
            String(follow.seguidorId)
          );

          if (!usuario) return null;

          const plano = obterPlanoEfetivo(usuario);

          return {
            id: String(usuario._id),
            nome: usuario.nome || '',
            nomeUsuario: usuario.nomeUsuario || '',
            nomePublico: montarNomePublico(usuario),
            plano,
            premiumAtivo: plano === 'premium',
            seguidoEm:
              follow.seguidoEm ||
              follow.createdAt ||
              null,
          };
        })
        .filter(Boolean),
    });
  } catch (err) {
    console.error(
      'Erro ao listar seguidores:',
      err
    );

    return res.status(500).json({
      erro:
        'Erro interno ao listar seguidores.',
    });
  }
});

module.exports = router;