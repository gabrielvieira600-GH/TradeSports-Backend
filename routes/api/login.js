// routes/api/login.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const antifraude = require('../../utils/antifraude');

// Arquivo de usuários
const usuariosPath = path.join(__dirname, '../../data/usuarios.json');

// Ajustes antifraude (camada 1)
const MAX_TENTATIVAS = 5;                 // tentativas antes do bloqueio
const JANELA_TENTATIVAS_MS = 15 * 60 * 1000; // 15 minutos
const BLOQUEIO_MS = 15 * 60 * 1000;       // 15 minutos

function lerUsuarios() {
  if (!fs.existsSync(usuariosPath)) return [];
  const raw = fs.readFileSync(usuariosPath, 'utf-8') || '[]';
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function salvarUsuarios(usuarios) {
  fs.writeFileSync(usuariosPath, JSON.stringify(usuarios, null, 2), 'utf-8');
}

function agoraISO() {
  return new Date().toISOString();
}

function limparTentativasSeJanelaExpirou(usuario) {
  const last = usuario.lastFailedLoginAt ? new Date(usuario.lastFailedLoginAt).getTime() : 0;
  if (!last) return;
  if (Date.now() - last > JANELA_TENTATIVAS_MS) {
    usuario.failedLoginAttempts = 0;
    usuario.lockUntil = null;
  }
}

// Rate limit específico do endpoint de login (proteção anti brute force por IP)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30, // 30 requisições/15min por IP (suave p/ dev, seguro p/ prod inicial)
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
});

// POST /api/login
router.post('/', loginLimiter, async (req, res) => {
  try {
    // Compatibilidade com o frontend: pode enviar "email" OU "nomeUsuario" (ou aliases)
    // e "senha" OU "password".
    const body = req.body || {};
// -------- CAMADA 2: Velocity antifraude por IP (login) --------
const ip = antifraude.getClientIp(req);

const vLoginIp = antifraude.checkVelocity({
  key: `ip:${ip}`,
  action: 'LOGIN_ATTEMPT',
  limit: 8,
  windowMs: 10 * 60 * 1000
});

if (!vLoginIp.ok) {
  antifraude.logEvent({
    userId: null,
    ip,
    action: 'LOGIN_BLOCK_IP',
    decision: 'BLOCK',
    reason: 'rate limit login ip',
    retryAfterMs: vLoginIp.retryAfterMs
  });

  return res.status(429).json({
    erro: 'Muitas tentativas de login. Aguarde alguns minutos.',
    cooldownMs: vLoginIp.retryAfterMs
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
    const identNorm = String(identificadorRaw || '').trim().toLowerCase();

    if (!identNorm || !senha) {
      return res
        .status(400)
        .json({ erro: 'Preencha e-mail ou nome de usuário e senha.' });
    }

    const usuarios = lerUsuarios();
    const index = usuarios.findIndex((u) => {
      const email = String(u.email || '').trim().toLowerCase();
      const nomeUsuario = String(u.nomeUsuario || u.username || '').trim().toLowerCase();
      return email === identNorm || nomeUsuario === identNorm;
    });

    // Para não permitir enumeração por e-mail, usamos mensagem genérica em erro de credenciais.
    // Ainda assim, se não existir usuário, respondemos como credencial inválida.
    if (index === -1) {
  antifraude.logEvent({
    userId: null,
    ip,
    action: 'LOGIN_FAIL',
    decision: 'ALLOW',
    reason: 'usuario inexistente'
  });

  return res.status(401).json({ erro: 'Credenciais inválidas.' });
}

    const usuario = usuarios[index];

    // Limpa tentativas se passou a janela
    limparTentativasSeJanelaExpirou(usuario);

    // Verifica bloqueio
    if (usuario.lockUntil) {
      const lockTs = new Date(usuario.lockUntil).getTime();
      if (lockTs > Date.now()) {
        const restante = Math.ceil((lockTs - Date.now()) / 1000);
        return res.status(423).json({
          erro: 'Conta temporariamente bloqueada por tentativas inválidas.',
          segundosRestantes: restante,
        });
      } else {
        usuario.lockUntil = null;
        usuario.failedLoginAttempts = 0;
      }
    }

    // Suporta ambos os formatos de armazenamento:
    // - senhaHash (novo)
    // - senha (legado)
    const hash = String(usuario.senhaHash || usuario.senha || '');
    const senhaStr = String(senha);
    // Se o campo ainda estiver em texto puro (legado), permite login e recomenda migração.
    const pareceHashBcrypt = /^\$2[aby]\$/.test(hash);
    const ok = pareceHashBcrypt ? await bcrypt.compare(senhaStr, hash) : senhaStr === hash;

    if (!ok) {
      usuario.failedLoginAttempts = Number(usuario.failedLoginAttempts || 0) + 1;
      usuario.lastFailedLoginAt = agoraISO();

      // Quando estoura o limite, bloqueia por BLOQUEIO_MS
      if (usuario.failedLoginAttempts >= MAX_TENTATIVAS) {
        usuario.lockUntil = new Date(Date.now() + BLOQUEIO_MS).toISOString();
      }

      antifraude.logEvent({
        userId: String(usuario.id),
        ip,
        action: 'LOGIN_FAIL',
        decision: 'ALLOW',
        reason: 'senha incorreta',
        failedAttempts: usuario.failedLoginAttempts,
      });

      salvarUsuarios(usuarios);
      return res.status(401).json({ erro: 'Credenciais inválidas.' });
    }

    // Login OK: zera tentativas
    usuario.failedLoginAttempts = 0;
    usuario.lockUntil = null;

    // Telemetria antifraude simples (IP / UA)
    usuario.lastLoginAt = agoraISO();
    usuario.lastLoginIp = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.ip;
    usuario.lastLoginUserAgent = req.headers['user-agent'] || '';

    // Mantém histórico resumido (últimos 20 logins)
    usuario.loginHistory = Array.isArray(usuario.loginHistory) ? usuario.loginHistory : [];
    usuario.loginHistory.unshift({
      at: usuario.lastLoginAt,
      ip: usuario.lastLoginIp,
      ua: usuario.lastLoginUserAgent,
    });
    usuario.loginHistory = usuario.loginHistory.slice(0, 20);

    salvarUsuarios(usuarios);

    antifraude.logEvent({
      userId: String(usuario.id),
      ip,
      action: 'LOGIN_SUCCESS',
      decision: 'ALLOW'
    });

    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, nomeUsuario: usuario.nomeUsuario },
      process.env.JWT_SECRET || 'segredo_nao_definido',
      { expiresIn: '2h' }
    );

    return res.status(200).json({
      mensagem: 'Login realizado com sucesso!',
      token,
      usuario: { id: usuario.id, nomeUsuario: usuario.nomeUsuario, saldo: usuario.saldo },
    });
  } catch (err) {
    console.error('Erro no /api/login:', err);
    return res.status(500).json({ erro: 'Erro interno ao realizar login.' });
  }
});

module.exports = router;