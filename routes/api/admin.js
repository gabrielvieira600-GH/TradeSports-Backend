// routes/api/admin.js (CAMADA 12 + SPLIT)
const express = require('express');

const router = express.Router();

const auth = require('../../middleware/auth');

const isAdmin = require('../../middleware/admin');

const audit = require('../../utils/audit');

const HistoricoPosse = require('../../models/HistoricoPosse');

const antifraude = require('../../utils/antifraude');

const { liquidarBrasileirao } = require('../../middleware/checkLiquidacao');

const User = require('../../models/User');

const Club = require('../../models/Club');

const Investment = require('../../models/Investment');

const Top4Rodada = require('../../models/Top4Rodada');

const Dividendo = require('../../models/dividendos');

const Liquidacao = require('../../models/Liquidacao');

function round2(n) {

  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;

}

router.use(auth);

router.use(isAdmin);

router.get('/status', async (req, res) => {

  const usuarios = await User.countDocuments();

  const historicoPosse = await HistoricoPosse.countDocuments();

  const clubes = await Club.countDocuments();

  const investimentos = await Investment.countDocuments();

  const top4Snapshots = await Top4Rodada.countDocuments();

  const dividendos = await Dividendo.countDocuments();

  const liquidacoes = await Liquidacao.countDocuments();

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

router.post('/liquidacao/disparar', async (req, res) => {

  try {

    const result = await liquidarBrasileirao();

    await audit.logEvent({

      kind: 'ADMIN',

      action: 'LIQUIDACAO_MANUAL_OK',

      userId: req.usuario?.id || null,

      meta: result,

    });

    return res.json({

      ok: true,

      mensagem: 'Liquidação disparada com sucesso.',

      ...result,

    });

  } catch (err) {

    await audit.logEvent({

      kind: 'ADMIN',

      action: 'LIQUIDACAO_MANUAL_FAIL',

      userId: req.usuario?.id || null,

      error: String(err),

    });

    return res.status(500).json({ erro: 'Erro interno ao disparar liquidação.' });

  }

});

router.get('/dashboard/antifraude', async (req, res) => {

  try {

    const stateDoc = await antifraude.loadState();

    const state = stateDoc.toObject();

    const usersArr = Object.entries(state.users || {}).map(([userId, u]) => ({

      userId,

      score: Number(u.score || 0),

      cooldownUntil: Number(u.cooldownUntil || 0),

      frozenUntil: Number(u.frozenUntil || 0),

      last: u.last || {},

    }));

    usersArr.sort((a, b) => b.score - a.score);

    const frozenUsers = usersArr.filter((u) => u.frozenUntil > Date.now()).slice(0, 50);

    const clubesArr = Object.entries(state.clubes || {}).map(([clubeId, c]) => ({

      clubeId,

      frozenUntil: Number(c.frozenUntil || 0),

      last: c.last || {},

      trades5m: Array.isArray(c.stats?.trades) ? c.stats.trades.length : null,

      cancels10m: Array.isArray(c.stats?.cancels) ? c.stats.cancels.length : null,

    }));

    const frozenClubes = clubesArr.filter((c) => c.frozenUntil > Date.now());

    const recentSignals = await antifraude.AntifraudeLog.find({

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

    return res.status(500).json({ erro: 'Erro interno ao montar dashboard antifraude.' });

  }

});

router.post('/freeze-user', async (req, res) => {

  try {

    const { userId, minutos = 10, motivo = 'freeze manual' } = req.body;

    const stateDoc = await antifraude.loadState();

    const state = stateDoc.toObject();

    antifraude.freezeUser(state, userId, Number(minutos) * 60_000, motivo);

    stateDoc.users = state.users;

    await antifraude.saveState(stateDoc);

    await antifraude.logEvent({

      userId: String(userId),

      action: 'ADMIN_FREEZE',

      decision: 'BLOCK',

      reason: motivo,

    });

    return res.json({ ok: true });

  } catch (err) {

    return res.status(500).json({ erro: 'Erro ao congelar usuário.' });

  }

});

router.post('/unfreeze-user', async (req, res) => {

  try {

    const { userId } = req.body;

    const stateDoc = await antifraude.loadState();

    const state = stateDoc.toObject();

    antifraude.unfreezeUser(state, userId);

    stateDoc.users = state.users;

    await antifraude.saveState(stateDoc);

    await antifraude.logEvent({

      userId: String(userId),

      action: 'ADMIN_UNFREEZE',

      decision: 'ALLOW',

    });

    return res.json({ ok: true });

  } catch (err) {

    return res.status(500).json({ erro: 'Erro ao descongelar usuário.' });

  }

});

module.exports = router;