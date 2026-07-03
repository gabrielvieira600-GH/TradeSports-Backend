// routes/api/admin.js (CAMADA 12 + SPLIT)
const express = require('express');

const router = express.Router();

const auth = require('../../middleware/auth');
const isAdmin = require('../../middleware/admin');
const audit = require('../../utils/audit');
const HistoricoPosse = require('../../models/HistoricoPosse');
const antifraude = require('../../utils/antifraude');

const {
  liquidarBrasileirao,
} = require('../../middleware/checkLiquidacao');

const User = require('../../models/User');
const Club = require('../../models/Club');
const Investment = require('../../models/Investment');
const Top4Rodada = require('../../models/Top4Rodada');
const Dividendo = require('../../models/dividendos');
const Liquidacao = require('../../models/Liquidacao');
const RankingSeason = require('../../models/RankingSeason');
const RankingRound = require('../../models/RankingRound');

function round2(n) {
  return Math.round(
    (Number(n) + Number.EPSILON) * 100
  ) / 100;
}

router.use(auth);
router.use(isAdmin);

router.get('/status', async (req, res) => {
  const usuarios = await User.countDocuments();

  const historicoPosse =
    await HistoricoPosse.countDocuments();

  const clubes = await Club.countDocuments();

  const investimentos =
    await Investment.countDocuments();

  const top4Snapshots =
    await Top4Rodada.countDocuments();

  const dividendos =
    await Dividendo.countDocuments();

  const liquidacoes =
    await Liquidacao.countDocuments();

  const lastAudit = await audit.readRecent(20);

  return res.json({
    ok: true,

    counts: {
      usuarios,
      clubes,
      investimentos,
      top4Snapshots,
      historicoPosse,
      dividendos,
      liquidacoes,
    },

    lastAudit,

    ts: new Date().toISOString(),
  });
});

router.post(
  '/liquidacao/disparar',
  async (req, res) => {
    try {
      const result =
        await liquidarBrasileirao();

      await audit.logEvent({
        kind: 'ADMIN',
        action: 'LIQUIDACAO_MANUAL_OK',
        userId: req.usuario?.id || null,
        meta: result,
      });

      return res.json({
        ok: true,
        mensagem:
          'Liquidação disparada com sucesso.',
        ...result,
      });
    } catch (err) {
      await audit.logEvent({
        kind: 'ADMIN',
        action: 'LIQUIDACAO_MANUAL_FAIL',
        userId: req.usuario?.id || null,
        error: String(err),
      });

      return res.status(500).json({
        erro:
          'Erro interno ao disparar liquidação.',
      });
    }
  }
);

router.get(
  '/dashboard/antifraude',
  async (req, res) => {
    try {
      const stateDoc =
        await antifraude.loadState();

      const state = stateDoc.toObject();

      const usersArr = Object.entries(
        state.users || {}
      ).map(([userId, u]) => ({
        userId,
        score: Number(u.score || 0),

        cooldownUntil: Number(
          u.cooldownUntil || 0
        ),

        frozenUntil: Number(
          u.frozenUntil || 0
        ),

        last: u.last || {},
      }));

      usersArr.sort(
        (a, b) => b.score - a.score
      );

      const frozenUsers = usersArr
        .filter(
          (u) =>
            u.frozenUntil > Date.now()
        )
        .slice(0, 50);

      const clubesArr = Object.entries(
        state.clubes || {}
      ).map(([clubeId, c]) => ({
        clubeId,

        frozenUntil: Number(
          c.frozenUntil || 0
        ),

        last: c.last || {},

        trades5m: Array.isArray(
          c.stats?.trades
        )
          ? c.stats.trades.length
          : null,

        cancels10m: Array.isArray(
          c.stats?.cancels
        )
          ? c.stats.cancels.length
          : null,
      }));

      const frozenClubes =
        clubesArr.filter(
          (c) =>
            c.frozenUntil > Date.now()
        );

      const recentSignals =
        await antifraude.AntifraudeLog.find({
          action: {
            $in: [
              'CANCEL_RATIO_SIGNAL',
              'CLUBE_VOLUME_SPIKE',
              'ADMIN_FREEZE',
              'ADMIN_FREEZE_CLUBE',
              'WASH_TRADING_SIGNAL',
              'SPOOFING_SIGNAL',
              'SELF_TRADE_BLOCK',
            ],
          },
        })
          .sort({ ts: -1 })
          .limit(100)
          .lean();

      return res.json({
        topUsers: usersArr.slice(0, 20),
        frozenUsers,
        frozenClubes,
        recentSignals,
      });
    } catch (err) {
      return res.status(500).json({
        erro:
          'Erro interno ao montar dashboard antifraude.',
      });
    }
  }
);

router.post(
  '/freeze-user',
  async (req, res) => {
    try {
      const {
        userId,
        minutos = 10,
        motivo = 'freeze manual',
      } = req.body;

      const stateDoc =
        await antifraude.loadState();

      const state = stateDoc.toObject();

      antifraude.freezeUser(
        state,
        userId,
        Number(minutos) * 60_000,
        motivo
      );

      stateDoc.users = state.users;

      await antifraude.saveState(
        stateDoc
      );

      await antifraude.logEvent({
        userId: String(userId),
        action: 'ADMIN_FREEZE',
        decision: 'BLOCK',
        reason: motivo,
      });

      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({
        erro:
          'Erro ao congelar usuário.',
      });
    }
  }
);

router.post(
  '/unfreeze-user',
  async (req, res) => {
    try {
      const { userId } = req.body;

      const stateDoc =
        await antifraude.loadState();

      const state = stateDoc.toObject();

      antifraude.unfreezeUser(
        state,
        userId
      );

      stateDoc.users = state.users;

      await antifraude.saveState(
        stateDoc
      );

      await antifraude.logEvent({
        userId: String(userId),
        action: 'ADMIN_UNFREEZE',
        decision: 'ALLOW',
      });

      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({
        erro:
          'Erro ao descongelar usuário.',
      });
    }
  }
);

// ==============================
// TEMPORADAS DO RANKING
// ==============================

router.post(
  '/temporadas',
  async (req, res) => {
    try {
      const {
        codigo,
        nome,
        descricao = '',
        capitalInicial = 1000,
        limiteOrdensLitePorRodada = 15,
        totalRodadas = null,
        inicioPrevisto = null,
        fimPrevisto = null,
        configuracoes = {},
      } = req.body || {};

      if (!codigo || !nome) {
        return res.status(400).json({
          erro:
            'Código e nome da temporada são obrigatórios.',
        });
      }

      const codigoNormalizado =
        String(codigo)
          .trim()
          .toLowerCase();

      const existente =
        await RankingSeason.findOne({
          codigo: codigoNormalizado,
        }).lean();

      if (existente) {
        return res.status(409).json({
          erro:
            'Já existe uma temporada com este código.',
        });
      }

      const temporada =
        await RankingSeason.create({
          codigo: codigoNormalizado,

          nome: String(nome).trim(),

          descricao: String(
            descricao || ''
          ).trim(),

          status: 'rascunho',

          capitalInicial: Number(
            capitalInicial
          ),

          limiteOrdensLitePorRodada:
            Number(
              limiteOrdensLitePorRodada
            ),

          totalRodadas:
            totalRodadas != null
              ? Number(totalRodadas)
              : null,

          inicioPrevisto:
            inicioPrevisto
              ? new Date(inicioPrevisto)
              : null,

          fimPrevisto:
            fimPrevisto
              ? new Date(fimPrevisto)
              : null,

          criadaPor:
            req.usuario?.id || null,

          configuracoes:
            configuracoes &&
            typeof configuracoes ===
              'object' &&
            !Array.isArray(configuracoes)
              ? configuracoes
              : {},
        });

      await audit.logEvent({
        kind: 'ADMIN',
        action:
          'RANKING_SEASON_CREATED',
        userId:
          req.usuario?.id || null,

        meta: {
          temporadaId: String(
            temporada._id
          ),
          codigo: temporada.codigo,
        },
      });

      return res.status(201).json({
        ok: true,
        temporada,
      });
    } catch (err) {
      console.error(
        '[ADMIN TEMPORADAS] Erro ao criar temporada:',
        err
      );

      return res.status(500).json({
        erro:
          'Erro interno ao criar temporada.',
      });
    }
  }
);

router.get(
  '/temporadas',
  async (req, res) => {
    try {
      const { status } =
        req.query || {};

      const filtro = {};

      if (
        status &&
        [
          'rascunho',
          'ativa',
          'encerrada',
          'cancelada',
        ].includes(String(status))
      ) {
        filtro.status =
          String(status);
      }

      const temporadas =
        await RankingSeason.find(
          filtro
        )
          .sort({
            createdAt: -1,
          })
          .lean();

      return res.json({
        ok: true,
        total: temporadas.length,
        temporadas,
      });
    } catch (err) {
      console.error(
        '[ADMIN TEMPORADAS] Erro ao listar temporadas:',
        err
      );

      return res.status(500).json({
        erro:
          'Erro interno ao listar temporadas.',
      });
    }
  }
);

router.get(
  '/temporadas/ativa',
  async (req, res) => {
    try {
      const temporada =
        await RankingSeason.buscarTemporadaAtiva();

      if (!temporada) {
        return res.status(404).json({
          erro:
            'Nenhuma temporada ativa encontrada.',
        });
      }

      const rodadaAberta =
        await RankingRound.buscarRodadaAberta(
          temporada._id
        );

      return res.json({
        ok: true,
        temporada,
        rodadaAberta,
      });
    } catch (err) {
      console.error(
        '[ADMIN TEMPORADAS] Erro ao buscar temporada ativa:',
        err
      );

      return res.status(500).json({
        erro:
          'Erro interno ao buscar temporada ativa.',
      });
    }
  }
);

router.get(
  '/temporadas/:id',
  async (req, res) => {
    try {
      const temporada =
        await RankingSeason.findById(
          req.params.id
        ).lean();

      if (!temporada) {
        return res.status(404).json({
          erro:
            'Temporada não encontrada.',
        });
      }

      const rodadas =
        await RankingRound.find({
          temporadaId:
            temporada._id,
        })
          .sort({ numero: 1 })
          .lean();

      return res.json({
        ok: true,
        temporada,
        rodadas,
      });
    } catch (err) {
      console.error(
        '[ADMIN TEMPORADAS] Erro ao buscar temporada:',
        err
      );

      return res.status(500).json({
        erro:
          'Erro interno ao buscar temporada.',
      });
    }
  }
);

router.post(
  '/temporadas/:id/iniciar',
  async (req, res) => {
    try {
      const temporada =
        await RankingSeason.findById(
          req.params.id
        );

      if (!temporada) {
        return res.status(404).json({
          erro:
            'Temporada não encontrada.',
        });
      }

      if (
        temporada.status !==
        'rascunho'
      ) {
        return res.status(409).json({
          erro:
            'Somente temporadas em rascunho podem ser iniciadas.',
        });
      }

      const outraAtiva =
        await RankingSeason.findOne({
          _id: {
            $ne: temporada._id,
          },

          status: 'ativa',
        }).lean();

      if (outraAtiva) {
        return res.status(409).json({
          erro:
            'Já existe outra temporada ativa. Encerre-a antes de iniciar uma nova.',
        });
      }

      temporada.status = 'ativa';

      temporada.iniciadaEm =
        new Date();

      temporada.iniciadaPor =
        req.usuario?.id || null;

      await temporada.save();

      await audit.logEvent({
        kind: 'ADMIN',
        action:
          'RANKING_SEASON_STARTED',
        userId:
          req.usuario?.id || null,

        meta: {
          temporadaId: String(
            temporada._id
          ),
          codigo: temporada.codigo,
        },
      });

      return res.json({
        ok: true,
        temporada,
      });
    } catch (err) {
      console.error(
        '[ADMIN TEMPORADAS] Erro ao iniciar temporada:',
        err
      );

      return res.status(500).json({
        erro:
          'Erro interno ao iniciar temporada.',
      });
    }
  }
);

router.post(
  '/temporadas/:id/encerrar',
  async (req, res) => {
    try {
      const temporada =
        await RankingSeason.findById(
          req.params.id
        );

      if (!temporada) {
        return res.status(404).json({
          erro:
            'Temporada não encontrada.',
        });
      }

      if (
        temporada.status !==
        'ativa'
      ) {
        return res.status(409).json({
          erro:
            'Somente temporadas ativas podem ser encerradas.',
        });
      }

      const rodadaAberta =
        await RankingRound.findOne({
          temporadaId:
            temporada._id,
          status: 'aberta',
        }).lean();

      if (rodadaAberta) {
        return res.status(409).json({
          erro:
            'Encerre a rodada aberta antes de encerrar a temporada.',

          rodadaAbertaId: String(
            rodadaAberta._id
          ),
        });
      }

      temporada.status =
        'encerrada';

      temporada.encerradaEm =
        new Date();

      temporada.encerradaPor =
        req.usuario?.id || null;

      await temporada.save();

      await audit.logEvent({
        kind: 'ADMIN',
        action:
          'RANKING_SEASON_CLOSED',
        userId:
          req.usuario?.id || null,

        meta: {
          temporadaId: String(
            temporada._id
          ),
          codigo: temporada.codigo,
        },
      });

      return res.json({
        ok: true,
        temporada,
      });
    } catch (err) {
      console.error(
        '[ADMIN TEMPORADAS] Erro ao encerrar temporada:',
        err
      );

      return res.status(500).json({
        erro:
          'Erro interno ao encerrar temporada.',
      });
    }
  }
);

router.post(
  '/temporadas/:id/cancelar',
  async (req, res) => {
    try {
      const temporada =
        await RankingSeason.findById(
          req.params.id
        );

      if (!temporada) {
        return res.status(404).json({
          erro:
            'Temporada não encontrada.',
        });
      }

      if (
        ![
          'rascunho',
          'ativa',
        ].includes(temporada.status)
      ) {
        return res.status(409).json({
          erro:
            'A temporada não pode ser cancelada no estado atual.',
        });
      }

      const rodadaAberta =
        await RankingRound.findOne({
          temporadaId:
            temporada._id,
          status: 'aberta',
        }).lean();

      if (rodadaAberta) {
        return res.status(409).json({
          erro:
            'Encerre ou cancele a rodada aberta antes de cancelar a temporada.',

          rodadaAbertaId: String(
            rodadaAberta._id
          ),
        });
      }

      temporada.status =
        'cancelada';

      temporada.encerradaEm =
        new Date();

      temporada.encerradaPor =
        req.usuario?.id || null;

      await temporada.save();

      await RankingRound.updateMany(
        {
          temporadaId:
            temporada._id,
          status: 'agendada',
        },
        {
          $set: {
            status: 'cancelada',
            encerradaEm:
              new Date(),
            encerradaPor:
              req.usuario?.id ||
              null,
          },
        }
      );

      await audit.logEvent({
        kind: 'ADMIN',
        action:
          'RANKING_SEASON_CANCELLED',
        userId:
          req.usuario?.id || null,

        meta: {
          temporadaId: String(
            temporada._id
          ),
          codigo: temporada.codigo,
        },
      });

      return res.json({
        ok: true,
        temporada,
      });
    } catch (err) {
      console.error(
        '[ADMIN TEMPORADAS] Erro ao cancelar temporada:',
        err
      );

      return res.status(500).json({
        erro:
          'Erro interno ao cancelar temporada.',
      });
    }
  }
);

// ==============================
// RODADAS DO RANKING
// ==============================

router.post(
  '/temporadas/:temporadaId/rodadas',
  async (req, res) => {
    try {
      const temporada =
        await RankingSeason.findById(
          req.params.temporadaId
        );

      if (!temporada) {
        return res.status(404).json({
          erro:
            'Temporada não encontrada.',
        });
      }

      if (
        [
          'encerrada',
          'cancelada',
        ].includes(temporada.status)
      ) {
        return res.status(409).json({
          erro:
            'Não é possível criar rodadas em uma temporada encerrada ou cancelada.',
        });
      }

      const {
        numero,
        nome = '',
        limiteOrdensLite = null,
        inicioPrevisto = null,
        fimPrevisto = null,
        observacoes = '',
        configuracoes = {},
      } = req.body || {};

      if (
        !Number.isInteger(
          Number(numero)
        ) ||
        Number(numero) < 1
      ) {
        return res.status(400).json({
          erro:
            'O número da rodada deve ser um inteiro maior que zero.',
        });
      }

      const rodadaExistente =
        await RankingRound.findOne({
          temporadaId:
            temporada._id,
          numero:
            Number(numero),
        }).lean();

      if (rodadaExistente) {
        return res.status(409).json({
          erro:
            'Já existe uma rodada com este número nesta temporada.',
        });
      }

      const rodada =
        await RankingRound.create({
          temporadaId:
            temporada._id,

          numero:
            Number(numero),

          nome: String(
            nome || ''
          ).trim(),

          status: 'agendada',

          limiteOrdensLite:
            limiteOrdensLite != null
              ? Number(
                  limiteOrdensLite
                )
              : Number(
                  temporada
                    .limiteOrdensLitePorRodada
                ),

          inicioPrevisto:
            inicioPrevisto
              ? new Date(
                  inicioPrevisto
                )
              : null,

          fimPrevisto:
            fimPrevisto
              ? new Date(
                  fimPrevisto
                )
              : null,

          criadaPor:
            req.usuario?.id || null,

          observacoes: String(
            observacoes || ''
          ).trim(),

          configuracoes:
            configuracoes &&
            typeof configuracoes ===
              'object' &&
            !Array.isArray(
              configuracoes
            )
              ? configuracoes
              : {},
        });

      await audit.logEvent({
        kind: 'ADMIN',
        action:
          'RANKING_ROUND_CREATED',
        userId:
          req.usuario?.id || null,

        meta: {
          rodadaId: String(
            rodada._id
          ),

          temporadaId: String(
            temporada._id
          ),

          numero: rodada.numero,
        },
      });

      return res.status(201).json({
        ok: true,
        rodada,
      });
    } catch (err) {
      console.error(
        '[ADMIN RODADAS] Erro ao criar rodada:',
        err
      );

      return res.status(500).json({
        erro:
          'Erro interno ao criar rodada.',
      });
    }
  }
);

router.get(
  '/temporadas/:temporadaId/rodadas',
  async (req, res) => {
    try {
      const temporada =
        await RankingSeason.findById(
          req.params.temporadaId
        ).lean();

      if (!temporada) {
        return res.status(404).json({
          erro:
            'Temporada não encontrada.',
        });
      }

      const rodadas =
        await RankingRound.find({
          temporadaId:
            temporada._id,
        })
          .sort({ numero: 1 })
          .lean();

      return res.json({
        ok: true,

        temporadaId: String(
          temporada._id
        ),

        total: rodadas.length,
        rodadas,
      });
    } catch (err) {
      console.error(
        '[ADMIN RODADAS] Erro ao listar rodadas:',
        err
      );

      return res.status(500).json({
        erro:
          'Erro interno ao listar rodadas.',
      });
    }
  }
);

router.get(
  '/temporadas/:temporadaId/rodadas/aberta',
  async (req, res) => {
    try {
      const temporada =
        await RankingSeason.findById(
          req.params.temporadaId
        ).lean();

      if (!temporada) {
        return res.status(404).json({
          erro:
            'Temporada não encontrada.',
        });
      }

      const rodada =
        await RankingRound.buscarRodadaAberta(
          temporada._id
        );

      if (!rodada) {
        return res.status(404).json({
          erro:
            'Nenhuma rodada aberta encontrada nesta temporada.',
        });
      }

      return res.json({
        ok: true,
        rodada,
      });
    } catch (err) {
      console.error(
        '[ADMIN RODADAS] Erro ao buscar rodada aberta:',
        err
      );

      return res.status(500).json({
        erro:
          'Erro interno ao buscar rodada aberta.',
      });
    }
  }
);

router.post(
  '/rodadas/:id/abrir',
  async (req, res) => {
    try {
      const rodada =
        await RankingRound.findById(
          req.params.id
        );

      if (!rodada) {
        return res.status(404).json({
          erro:
            'Rodada não encontrada.',
        });
      }

      if (
        rodada.status !==
        'agendada'
      ) {
        return res.status(409).json({
          erro:
            'Somente rodadas agendadas podem ser abertas.',
        });
      }

      const temporada =
        await RankingSeason.findById(
          rodada.temporadaId
        );

      if (!temporada) {
        return res.status(404).json({
          erro:
            'Temporada da rodada não encontrada.',
        });
      }

      if (
        temporada.status !==
        'ativa'
      ) {
        return res.status(409).json({
          erro:
            'A temporada precisa estar ativa para abrir uma rodada.',
        });
      }

      const outraAberta =
        await RankingRound.findOne({
          _id: {
            $ne: rodada._id,
          },

          temporadaId:
            temporada._id,

          status: 'aberta',
        }).lean();

      if (outraAberta) {
        return res.status(409).json({
          erro:
            'Já existe outra rodada aberta nesta temporada.',

          rodadaAbertaId: String(
            outraAberta._id
          ),
        });
      }

      rodada.status = 'aberta';

      rodada.abertaEm =
        new Date();

      rodada.abertaPor =
        req.usuario?.id || null;

      await rodada.save();

      temporada.rodadaAtual =
        rodada.numero;

      await temporada.save();

      await audit.logEvent({
        kind: 'ADMIN',
        action:
          'RANKING_ROUND_OPENED',
        userId:
          req.usuario?.id || null,

        meta: {
          rodadaId: String(
            rodada._id
          ),

          temporadaId: String(
            temporada._id
          ),

          numero: rodada.numero,
        },
      });

      return res.json({
        ok: true,
        rodada,
        temporada,
      });
    } catch (err) {
      console.error(
        '[ADMIN RODADAS] Erro ao abrir rodada:',
        err
      );

      return res.status(500).json({
        erro:
          'Erro interno ao abrir rodada.',
      });
    }
  }
);

router.post(
  '/rodadas/:id/encerrar',
  async (req, res) => {
    try {
      const rodada =
        await RankingRound.findById(
          req.params.id
        );

      if (!rodada) {
        return res.status(404).json({
          erro:
            'Rodada não encontrada.',
        });
      }

      if (
        rodada.status !== 'aberta'
      ) {
        return res.status(409).json({
          erro:
            'Somente rodadas abertas podem ser encerradas.',
        });
      }

      rodada.status =
        'encerrada';

      rodada.encerradaEm =
        new Date();

      rodada.encerradaPor =
        req.usuario?.id || null;

      await rodada.save();

      await audit.logEvent({
        kind: 'ADMIN',
        action:
          'RANKING_ROUND_CLOSED',
        userId:
          req.usuario?.id || null,

        meta: {
          rodadaId: String(
            rodada._id
          ),

          temporadaId: String(
            rodada.temporadaId
          ),

          numero: rodada.numero,
        },
      });

      return res.json({
        ok: true,
        rodada,
      });
    } catch (err) {
      console.error(
        '[ADMIN RODADAS] Erro ao encerrar rodada:',
        err
      );

      return res.status(500).json({
        erro:
          'Erro interno ao encerrar rodada.',
      });
    }
  }
);

router.post(
  '/rodadas/:id/cancelar',
  async (req, res) => {
    try {
      const rodada =
        await RankingRound.findById(
          req.params.id
        );

      if (!rodada) {
        return res.status(404).json({
          erro:
            'Rodada não encontrada.',
        });
      }

      if (
        ![
          'agendada',
          'aberta',
        ].includes(rodada.status)
      ) {
        return res.status(409).json({
          erro:
            'A rodada não pode ser cancelada no estado atual.',
        });
      }

      rodada.status =
        'cancelada';

      rodada.encerradaEm =
        new Date();

      rodada.encerradaPor =
        req.usuario?.id || null;

      await rodada.save();

      await audit.logEvent({
        kind: 'ADMIN',
        action:
          'RANKING_ROUND_CANCELLED',
        userId:
          req.usuario?.id || null,

        meta: {
          rodadaId: String(
            rodada._id
          ),

          temporadaId: String(
            rodada.temporadaId
          ),

          numero: rodada.numero,
        },
      });

      return res.json({
        ok: true,
        rodada,
      });
    } catch (err) {
      console.error(
        '[ADMIN RODADAS] Erro ao cancelar rodada:',
        err
      );

      return res.status(500).json({
        erro:
          'Erro interno ao cancelar rodada.',
      });
    }
  }
);

module.exports = router;