// routes/api/login.js
// Endpoint de login (camada 1: rate limit + bloqueio por tentativas)

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

// ✅ Correto para backend/routes/api/login.js -> backend/data/usuarios.json
const usuariosPath = path.join(__dirname, '../../data/usuarios.json');

// Ajustes antifraude (camada 1)
const MAX_TENTATIVAS = 5; // tentativas antes do bloqueio
const JANELA_TENTATIVAS_MS = 15 * 60 * 1000; // 15 minutos
const BLOQUEIO_MS = 15 * 60 * 1000; // 15 minutos

function lerUsuarios() {
  if (!fs.existsSync(usuariosPath)) return [];
  const raw = fs.readFileSync(usuariosPath, 'utf-8') || '[]';
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
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
  max: 30, // 30 req/15min por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
});

// POST /api/login
// Aceita:
//  - { email, senha } (frontend atual)
//  - email pode ser e-mail OU nome de usuário
//  - alternativamente { identificador, senha }
router.post('/', loginLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const identificadorRaw =
      body.identificador ?? body.email ?? body.nomeUsuario ?? body.login ?? '';

    const identificador = String(identificadorRaw || '').trim();
    const senha = body.senha;

    if (!identificador || !senha) {
      // mantém a mesma mensagem do frontend
      return res.status(400).json({ erro: 'Preencha e-mail e senha.' });
    }

    const identificadorNorm = identificador.toLowerCase();
    const ehEmail = identificadorNorm.includes('@');

    const usuarios = lerUsuarios();

    const index = usuarios.findIndex((u) => {
      const email = String(u.email || '').trim().toLowerCase();
      const nomeUsuario = String(u.nomeUsuario || '').trim().toLowerCase();
      return ehEmail ? email === identificadorNorm : nomeUsuario === identificadorNorm;
    });

    // evita enumeração (resposta genérica)
    if (index === -1) {
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
      }
      usuario.lockUntil = null;
      usuario.failedLoginAttempts = 0;
    }

    // ✅ compatível com bases antigas: senhaHash OU senha (caso já esteja hash)
    const hash = String(usuario.senhaHash || usuario.senha || '');

    // ✅ compatível com bases antigas:
    // - se o valor parece um bcrypt hash (começa com "$2"), valida com bcrypt
    // - senão, compara como texto (útil em ambientes antigos de dev)
    let ok = false;
    if (hash) {
      if (hash.startsWith('$2')) {
        ok = await bcrypt.compare(String(senha), hash);
      } else {
        ok = String(senha) === hash;
      }
    }

    if (!ok) {
      usuario.failedLoginAttempts = Number(usuario.failedLoginAttempts || 0) + 1;
      usuario.lastFailedLoginAt = agoraISO();

      if (usuario.failedLoginAttempts >= MAX_TENTATIVAS) {
        usuario.lockUntil = new Date(Date.now() + BLOQUEIO_MS).toISOString();
      }

      salvarUsuarios(usuarios);
      return res.status(401).json({ erro: 'Credenciais inválidas.' });
    }

    // Login OK: zera tentativas
    usuario.failedLoginAttempts = 0;
    usuario.lockUntil = null;

    // Telemetria antifraude simples (IP / UA)
    usuario.lastLoginAt = agoraISO();
    usuario.lastLoginIp =
      (req.headers['x-forwarded-for']?.toString().split(',')[0] || '').trim() || req.ip;
    usuario.lastLoginUserAgent = req.headers['user-agent'] || '';

    usuario.loginHistory = Array.isArray(usuario.loginHistory) ? usuario.loginHistory : [];
    usuario.loginHistory.unshift({
      at: usuario.lastLoginAt,
      ip: usuario.lastLoginIp,
      ua: usuario.lastLoginUserAgent,
    });
    usuario.loginHistory = usuario.loginHistory.slice(0, 20);

    salvarUsuarios(usuarios);

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