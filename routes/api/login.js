const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const antifraude = require("../../utils/antifraude");
const User = require("../../models/User");
const { pendenciasAceite } = require("../../config/legalDocuments");

const MAX_TENTATIVAS = 5;
const JANELA_TENTATIVAS_MS = 15 * 60 * 1000;
const BLOQUEIO_MS = 15 * 60 * 1000;

function agoraISO() {
  return new Date().toISOString();
}

function limparTentativasSeJanelaExpirou(usuario) {
  const last = usuario.lastFailedLoginAt
    ? new Date(usuario.lastFailedLoginAt).getTime()
    : 0;

  if (!last) return;

  if (Date.now() - last > JANELA_TENTATIVAS_MS) {
    usuario.failedLoginAttempts = 0;
    usuario.lockUntil = null;
  }
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    erro: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
  },
});

router.post("/", loginLimiter, async (req, res) => {
  try {
    const body = req.body || {};

    const ip = antifraude.getClientIp(req);

    const vLoginIp = antifraude.checkVelocity({
      key: `ip:${ip}`,
      action: "LOGIN_ATTEMPT",
      limit: 8,
      windowMs: 10 * 60 * 1000,
    });

    if (!vLoginIp.ok) {
      antifraude.logEvent({
        userId: null,
        ip,
        action: "LOGIN_BLOCK_IP",
        decision: "BLOCK",
        reason: "rate limit login ip",
        retryAfterMs: vLoginIp.retryAfterMs,
      });

      return res.status(429).json({
        erro: "Muitas tentativas de login. Aguarde alguns minutos.",
        cooldownMs: vLoginIp.retryAfterMs,
      });
    }

    const identificadorRaw =
      body.email ||
      body.nomeUsuario ||
      body.usuario ||
      body.login ||
      body.identificador ||
      body.emailOuUsuario ||
      body.username;

    const senha = body.senha || body.password;
    const identificadorOriginal = String(identificadorRaw || "").trim();
    const emailNormalizado = identificadorOriginal.toLowerCase();

    if (!identificadorOriginal || !senha) {
      return res
        .status(400)
        .json({ erro: "Preencha e-mail ou nome de usuário e senha." });
    }

    const usuario = await User.findOne({
      $or: [
        { email: emailNormalizado },
        { nomeUsuario: identificadorOriginal },
      ],
    });

    if (!usuario) {
      antifraude.logEvent({
        userId: null,
        ip,
        action: "LOGIN_FAIL",
        decision: "ALLOW",
        reason: "usuario inexistente",
      });

      return res.status(401).json({ erro: "Credenciais inválidas." });
    }

    limparTentativasSeJanelaExpirou(usuario);

    if (usuario.lockUntil) {
      const lockTs = new Date(usuario.lockUntil).getTime();
      if (lockTs > Date.now()) {
        const restante = Math.ceil((lockTs - Date.now()) / 1000);
        return res.status(423).json({
          erro: "Conta temporariamente bloqueada por tentativas inválidas.",
          segundosRestantes: restante,
        });
      } else {
        usuario.lockUntil = null;
        usuario.failedLoginAttempts = 0;
      }
    }

    const hash = String(usuario.senha || "");
    const senhaStr = String(senha);
    const pareceHashBcrypt = /^\$2[aby]\$/.test(hash);
    const ok = pareceHashBcrypt
      ? await bcrypt.compare(senhaStr, hash)
      : senhaStr === hash;

    if (!ok) {
      usuario.failedLoginAttempts =
        Number(usuario.failedLoginAttempts || 0) + 1;
      usuario.lastFailedLoginAt = agoraISO();

      if (usuario.failedLoginAttempts >= MAX_TENTATIVAS) {
        usuario.lockUntil = new Date(Date.now() + BLOQUEIO_MS);
      }

      antifraude.logEvent({
        userId: String(usuario.legacyId || usuario._id),
        ip,
        action: "LOGIN_FAIL",
        decision: "ALLOW",
        reason: "senha incorreta",
        failedAttempts: usuario.failedLoginAttempts,
      });

      await usuario.save();
      return res.status(401).json({ erro: "Credenciais inválidas." });
    }

    if (
      usuario.verificacaoEmailObrigatoria === true &&
      usuario.emailVerificado !== true
    ) {
      usuario.failedLoginAttempts = 0;
      usuario.lockUntil = null;
      usuario.lastFailedLoginAt = null;
      await usuario.save();

      return res.status(403).json({
        erro: "Confirme seu e-mail antes de acessar a TradeSports.",
        codigo: "EMAIL_NAO_VERIFICADO",
        reenviarVerificacao: true,
      });
    }

    usuario.failedLoginAttempts = 0;
    usuario.lockUntil = null;
    usuario.lastFailedLoginAt = null;

    usuario.lastLoginAt = new Date();
    usuario.lastLoginIp =
      req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
      req.ip;
    usuario.lastLoginUserAgent = req.headers["user-agent"] || "";

    usuario.loginHistory = Array.isArray(usuario.loginHistory)
      ? usuario.loginHistory
      : [];

    usuario.loginHistory.unshift({
      at: usuario.lastLoginAt,
      ip: usuario.lastLoginIp,
      ua: usuario.lastLoginUserAgent,
    });

    usuario.loginHistory = usuario.loginHistory.slice(0, 20);

    await usuario.save();

    antifraude.logEvent({
      userId: String(usuario.legacyId || usuario._id),
      ip,
      action: "LOGIN_SUCCESS",
      decision: "ALLOW",
    });

    const token = jwt.sign(
      {
        id: String(usuario._id),
        legacyId: usuario.legacyId ?? null,
        email: usuario.email,
        nomeUsuario: usuario.nomeUsuario,
        role: usuario.role || (usuario.admin ? "admin" : "user"),
      },
      process.env.JWT_SECRET || "segredo_nao_definido",
      { expiresIn: "2h" },
    );

    const aceitesPendentes = pendenciasAceite(usuario.aceites);

    return res.status(200).json({
      mensagem: "Login realizado com sucesso!",
      token,
      aceitesJuridicos: {
        pendencias: aceitesPendentes,
        exigeNovoAceite: aceitesPendentes.length > 0,
      },
      usuario: {
        id: String(usuario._id),
        legacyId: usuario.legacyId ?? null,
        nomeUsuario: usuario.nomeUsuario,
        saldo: Number(usuario.saldo || 0),
        role: usuario.role || (usuario.admin ? "admin" : "user"),
      },
    });
  } catch (err) {
    console.error("Erro no /api/login:", err);
    return res.status(500).json({ erro: "Erro interno ao realizar login." });
  }
});

module.exports = router;
