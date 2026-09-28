const express = require('express');
const rateLimit = require('express-rate-limit');
const auth = require('../../middleware/auth');
const User = require('../../models/User');
const {
  criarSessaoPersistente,
  renovarSessaoPersistente,
  revogarSessaoPersistente,
} = require('../../services/authSessionService');

const router = express.Router();

const sessionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas de renovação. Aguarde alguns minutos.' },
});

router.post('/adopt', auth, async (req, res) => {
  try {
    const usuario = await User.findById(req.usuario.id);
    if (!usuario) return res.status(401).json({ erro: 'Usuário não encontrado.' });
    const sessao = await criarSessaoPersistente(usuario, req);
    return res.json({ ok: true, ...sessao });
  } catch (err) {
    console.error('[SESSION ADOPT] erro:', err);
    return res.status(500).json({ erro: 'Não foi possível tornar a sessão persistente.' });
  }
});

router.post('/refresh', sessionLimiter, async (req, res) => {
  try {
    const sessao = await renovarSessaoPersistente(req.body?.refreshToken, req);
    if (!sessao) {
      return res.status(401).json({
        erro: 'Sessão inválida ou encerrada.',
        codigo: 'SESSAO_INVALIDA',
      });
    }

    return res.json({
      ok: true,
      token: sessao.token,
      refreshToken: sessao.refreshToken,
    });
  } catch (err) {
    console.error('[SESSION REFRESH] erro:', err);
    return res.status(500).json({ erro: 'Não foi possível renovar a sessão.' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    await revogarSessaoPersistente(req.body?.refreshToken);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[SESSION LOGOUT] erro:', err);
    return res.status(500).json({ erro: 'Não foi possível encerrar a sessão.' });
  }
});

module.exports = router;
