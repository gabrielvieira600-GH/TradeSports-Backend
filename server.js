// server.js (Camada 1 - Segurança)
// Mantém sua arquitetura com rotas em /routes e /routes/api
require('dotenv').config();
require('./LoadEnv');

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const { connectDB } = require('./config/db');
const audit = require('./utils/audit');
const antifraude = require('./utils/antifraude');
const { runSystemCheck, buildHealthPayload } = require('./utils/operationalChecks');

const { checkLiquidacao } = require('./middleware/checkLiquidacao');
const auth = require('./middleware/auth');

const { lerUsuarios, salvarUsuarios } = require('./utils/usuarioService');
const { enviarEmailVerificacao, enviarEmailResetSenha } = require('./utils/emailService');

const adminRoutes = require('./routes/api/admin');
const loginRoute = require('./routes/api/login');

const clubeRoutes = require('./routes/clube');
const investimentoRoutes = require('./routes/investimento');
const mercadoRoutes = require('./routes/mercado');
const usuarioRoutes = require('./routes/usuario');
const ordemRoutes = require('./routes/ordens');
const classificacaoRoutes = require('./routes/classificacao');
const depositoRoutes = require('./routes/deposito');
const saqueRoutes = require('./routes/saque');

require('./models/Clube');
require('./models/Usuario');
require('./models/Top4Rodada');

const app = express();

const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 4001;

// =====================================================
// CAMADA 1 — SEGURANÇA (middlewares globais)
// =====================================================

// Em produção, atrás de proxy (Vercel/Render/Nginx), isso ajuda IP correto no rate-limit
app.set('trust proxy', 1);

connectDB()
  .then(() => {
    console.log('Mongo inicializado.');
  })
  .catch((err) => {
    console.error('Erro ao conectar no Mongo:', err);
    process.exit(1);
  });
  
// Helmet (hardening de headers)
let helmet;
try {
  helmet = require('helmet');
  app.use(
    helmet({
      contentSecurityPolicy: false, // evita quebrar Next/arquivos locais; ajuste depois se quiser
      crossOriginEmbedderPolicy: false,
    })
  );
} catch (e) {
  console.warn('[SEGURANCA] helmet não instalado. (ok em dev) Instale: npm i helmet');
}

// Rate limit (anti brute force / spam)
let rateLimit;
try {
  rateLimit = require('express-rate-limit');

  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 900,
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: 'Muitas requisições. Tente novamente em alguns minutos.' },
  });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
  });

  const cadastroLimiter = rateLimit({
    windowMs: 30 * 60 * 1000,
    max: 12,
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: 'Muitos cadastros/tentativas. Aguarde e tente novamente.' },
  });

  const resetLimiter = rateLimit({
    windowMs: 30 * 60 * 1000,
    max: 12,
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: 'Muitas solicitações. Aguarde e tente novamente.' },
  });

  app.use(globalLimiter);
  app.use('/api/login', loginLimiter);
  app.use('/cadastro', cadastroLimiter);
  app.use('/esqueci-senha', resetLimiter);
  app.use('/resetar-senha', resetLimiter);
} catch (e) {
  console.warn('[SEGURANCA] express-rate-limit não instalado. (ok em dev) Instale: npm i express-rate-limit');
}

// Body limit para evitar payload gigante
app.use(express.json({ limit: '250kb' }));

// Sanitização simples: bloqueia chaves perigosas (anti prototype pollution / injection)
app.use((req, res, next) => {
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const hasBadKeys = (obj) => {
    if (!isObj(obj)) return false;
    for (const k of Object.keys(obj)) {
      if (k === '_proto_' || k === 'constructor' || k === 'prototype') return true;
      if (k.includes('_proto_') || k.includes('constructor') || k.includes('prototype')) return true;
      if (k.startsWith('$') || k.includes('.')) return true; // anti mongo-like injection
      if (hasBadKeys(obj[k])) return true;
    }
    return false;
  };
  if (hasBadKeys(req.body)) {
    return res.status(400).json({ erro: 'Payload inválido.' });
  }
  next();
});

// CORS (mantenha o origin do seu frontend)
const allowedOrigins = [
  process.env.FRONTEND_ORIGIN,
 'https://www.tradesports.com.br',
  'https://tradesports.com.br',
  'https://trade-sports-frontend-ok.vercel.app',
  'https://trade-sports-frontend-ok-om3a.vercel.app',
  'http://localhost:3000',
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS bloqueado para origin: ${origin}`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    credentials: false,
  })
);

// =====================================================
// Middleware de checagem de liquidação (já existia)
// =====================================================
app.use(checkLiquidacao);

// =====================================================
// Rotas (mantém seu padrão /routes e /routes/api)
// =====================================================
app.use('/api/admin', adminRoutes);
app.use('/api/login', loginRoute);
app.use('/api', classificacaoRoutes);

app.use('/clube', clubeRoutes);
app.use('/investimentos', investimentoRoutes);
app.use('/mercado', mercadoRoutes);
app.use('/ordens', ordemRoutes);
app.use('/usuario', usuarioRoutes);
app.use('/deposito', depositoRoutes);
app.use('/saque', saqueRoutes);


// =====================================================
// CAMADA 11 — Healthcheck (útil para smoke test)
// =====================================================
app.get('/health', (req, res) => {
  return res.json(buildHealthPayload());
});

// =====================================================
// CAMADA 11 — Admin: Reset / Nova temporada (idempotente + audit)
// POST /admin/temporada/reset  body opcional: { temporada: 2026, rodadaAtual: 0 }
// =====================================================


// =====================================================
// CAMADA 14 — Admin antifraude status
// =====================================================
app.get('/admin/antifraude/status', auth, (req, res) => {
  try {
    const role = String(req.usuario?.role || '').toLowerCase();
    if (role !== 'admin') return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
    return res.json({ ok: true, ...antifraude.getAntifraudeStatus() });
  } catch (err) {
    console.error('[ANTIFRAUDE STATUS] erro:', err);
    return res.status(500).json({ erro: 'Erro interno ao consultar antifraude.' });
  }
});

app.post('/admin/antifraude/freeze-user', auth, (req, res) => {
  try {
    const role = String(req.usuario?.role || '').toLowerCase();
    if (role !== 'admin') return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
    const { userId, minutos = 15, motivo = 'freeze manual' } = req.body || {};
    if (!userId) return res.status(400).json({ erro: 'userId é obrigatório.' });
    const state = antifraude.loadState();
    antifraude.freezeUser(state, userId, Number(minutos) * 60_000, motivo);
    antifraude.saveState(state);
    antifraude.logEvent({ userId: String(userId), action: 'ADMIN_FREEZE_USER', decision: 'BLOCK', reason: motivo });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[FREEZE USER] erro:', err);
    return res.status(500).json({ erro: 'Erro interno ao congelar usuário.' });
  }
});

app.post('/admin/antifraude/unfreeze-user', auth, (req, res) => {
  try {
    const role = String(req.usuario?.role || '').toLowerCase();
    if (role !== 'admin') return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ erro: 'userId é obrigatório.' });
    const state = antifraude.loadState();
    antifraude.unfreezeUser(state, userId);
    antifraude.saveState(state);
    antifraude.logEvent({ userId: String(userId), action: 'ADMIN_UNFREEZE_USER', decision: 'ALLOW' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[UNFREEZE USER] erro:', err);
    return res.status(500).json({ erro: 'Erro interno ao descongelar usuário.' });
  }
});


// =====================================================
// CAMADA 15 — Admin financeiro / reconciliação
// =====================================================
app.get('/admin/financeiro/transacoes', auth, (req, res) => {
  try {
    const role = String(req.usuario?.role || '').toLowerCase();
    if (role !== 'admin') return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
    const ledger = require('./utils/ledger');
    const txs = ledger.readFinancialTx().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return res.json({ ok: true, transacoes: txs });
  } catch (err) {
    console.error('[FINANCEIRO TRANSACOES] erro:', err);
    return res.status(500).json({ erro: 'Erro interno ao consultar transações financeiras.' });
  }
});

app.post('/admin/financeiro/reconciliar', auth, async (req, res) => {
  try {
    const role = String(req.usuario?.role || '').toLowerCase();
    if (role !== 'admin') return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
    const ledger = require('./utils/ledger');
    const storage = require('./utils/storage');
    const txs = ledger.readFinancialTx();
    const journal = storage.readJSON(ledger.paths.JOURNAL_PATH, []);
    let reconciliadas = 0;
    let divergentes = 0;
    for (const tx of txs) {
      const result = ledger.reconcileFinancialTx(tx, journal);
      tx.reconciliacaoStatus = result.status;
      tx.divergenceReason = result.reason;
      tx.reconciliadoEm = new Date().toISOString();
      if (result.status === 'RECONCILIADO') reconciliadas += 1;
      if (result.status === 'DIVERGENTE') divergentes += 1;
    }
    await ledger.writeFinancialTx(txs);
    return res.json({ ok: true, reconciliadas, divergentes, total: txs.length });
  } catch (err) {
    console.error('[FINANCEIRO RECONCILIAR] erro:', err);
    return res.status(500).json({ erro: 'Erro interno ao reconciliar.' });
  }
});


app.get('/admin/financeiro/divergentes', auth, (req, res) => {
  try {
    const role = String(req.usuario?.role || '').toLowerCase();
    if (role !== 'admin') return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
    const ledger = require('./utils/ledger');
    const txs = ledger.readFinancialTx().filter(tx => String(tx.reconciliacaoStatus) === 'DIVERGENTE');
    return res.json({ ok: true, total: txs.length, transacoes: txs });
  } catch (err) {
    console.error('[FINANCEIRO DIVERGENTES] erro:', err);
    return res.status(500).json({ erro: 'Erro interno ao consultar divergências.' });
  }
});

app.get('/admin/financeiro/gateway/:gatewayReference', auth, (req, res) => {
  try {
    const role = String(req.usuario?.role || '').toLowerCase();
    if (role !== 'admin') return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
    const ledger = require('./utils/ledger');
    const tx = ledger.findFinancialTxByGatewayReference(req.params.gatewayReference);
    if (!tx) return res.status(404).json({ erro: 'Transação não encontrada.' });
    return res.json({ ok: true, transacao: tx });
  } catch (err) {
    console.error('[FINANCEIRO GATEWAY REF] erro:', err);
    return res.status(500).json({ erro: 'Erro interno ao consultar gatewayReference.' });
  }
});


app.get('/admin/system/check', auth, (req, res) => {
  try {
    const role = String(req.usuario?.role || '').toLowerCase();
    if (role !== 'admin') return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
    return res.json({ ok: true, ...runSystemCheck() });
  } catch (err) {
    console.error('[SYSTEM CHECK] erro:', err);
    return res.status(500).json({ erro: 'Erro interno ao executar checagem do sistema.' });
  }
});

app.get('/admin/system/checklist', auth, (req, res) => {
  try {
    const role = String(req.usuario?.role || '').toLowerCase();
    if (role !== 'admin') return res.status(403).json({ erro: 'Acesso restrito a administradores.' });

    const check = runSystemCheck();
    return res.json({
      ok: true,
      checklist: [
        { item: 'Mercado operacional', status: check.problemasCriticos.some(p => String(p.tipo || '').includes('ORDEM')) ? 'ATENCAO' : 'OK' },
        { item: 'Ledger íntegro', status: check.problemasCriticos.some(p => String(p.tipo || '').includes('LEDGER') || String(p.tipo || '').includes('FIN_TX')) ? 'CRITICO' : 'OK' },
        { item: 'Financeiro reconciliado', status: check.problemasCriticos.some(p => String(p.tipo || '').includes('FIN_TX')) ? 'CRITICO' : (check.problemasMedios.length ? 'ATENCAO' : 'OK') },
        { item: 'Antifraude operacional', status: 'OK' },
        { item: 'Arquivos críticos presentes', status: check.problemasCriticos.some(p => p.tipo === 'ARQUIVO_AUSENTE') ? 'CRITICO' : 'OK' },
        { item: 'Pronto para beta', status: check.statusGeral === 'CRITICO' ? 'NAO' : 'SIM' }
      ],
      resumo: check.resumo,
      flags: check.flags
    });
  } catch (err) {
    console.error('[SYSTEM CHECKLIST] erro:', err);
    return res.status(500).json({ erro: 'Erro interno ao montar checklist.' });
  }
});

app.post('/admin/temporada/reset', auth, async (req, res) => {
  try {
    const role = String(req.usuario?.role || '').toLowerCase();
    if (role !== 'admin') return res.status(403).json({ erro: 'Acesso restrito a administradores.' });

    const fs = require('fs');
    const path = require('path');
    const storage = require('./utils/storage');

    const dataDir = path.join(__dirname, './data');
    const configPath = path.join(__dirname, './data/configCampeonato.json');

    const cfg = storage.readJSON(configPath, null);
    if (!cfg) return res.status(500).json({ erro: 'configCampeonato.json não encontrado/ inválido.' });

    const temporadaInput = req.body && Number(req.body.temporada);
    const rodadaInput = req.body && Number(req.body.rodadaAtual);

    const novaTemporada = Number.isFinite(temporadaInput) ? temporadaInput : (Number(cfg.temporada || 0) + 1);

    const nextCfg = {
      ...cfg,
      temporada: novaTemporada,
      rodadaAtual: Number.isFinite(rodadaInput) ? rodadaInput : 0,
      ultimaRodadaProcessadaDividendos: 0,
      dispararLiquidacao: false,
      liquidado: false,
    };

    await storage.writeJSON(configPath, nextCfg);

    // Arquivos de estado de temporada que devem ser zerados (se existirem)
    const toResetAsArray = [
      'top4Rodadas.json',
      'historicoPosse.json',
      'classificacaoFinal.json',
      'liquidacaoFinal.json',
      'dividendosPagos.json',
      'top4Rodadas_state.json',
      'historicoPosse_state.json',
    ];

    const toResetAsObject = [
      'antifraude_state.json', // opcional: se quiser manter score, remova daqui
    ];

    const resetReport = [];

    for (const f of toResetAsArray) {
      const p = path.join(dataDir, f);
      if (fs.existsSync(p)) {
        await storage.writeJSON(p, []);
        resetReport.push({ file: f, status: 'reset[]' });
      } else {
        resetReport.push({ file: f, status: 'missing' });
      }
    }

    for (const f of toResetAsObject) {
      const p = path.join(dataDir, f);
      if (fs.existsSync(p)) {
        await storage.writeJSON(p, { users: {}, ips: {}, clubes: {} });
        resetReport.push({ file: f, status: 'reset{}' });
      } else {
        resetReport.push({ file: f, status: 'missing' });
      }
    }

    audit.logEvent({
      kind: 'ADMIN',
      action: 'RESET_TEMPORADA_OK',
      userId: req.usuario?.id || null,
      meta: { temporada: novaTemporada, rodadaAtual: nextCfg.rodadaAtual, files: resetReport },
    });

    return res.json({ ok: true, config: nextCfg, resetReport });
  } catch (err) {
    console.error('[RESET TEMPORADA] erro:', err);
    audit.logEvent({
      kind: 'ADMIN',
      action: 'RESET_TEMPORADA_FAIL',
      userId: req.usuario?.id || null,
      error: String(err),
    });
    return res.status(500).json({ erro: 'Erro interno ao resetar temporada.' });
  }
});



// =====================================================
// [EMAIL] CADASTRO COM TOKEN DE VERIFICAÇÃO
// =====================================================
app.post('/cadastro', async (req, res) => {
  try {
    const {
      nome,
      sobrenome,
      email,
      cpf,
      dataNascimento,
      genero,
      nomeUsuario,
      senha,
      aceitouTermos,
      versaoTermos,
      aceites, // opcional (frontend pode mandar)
    } = req.body || {};

    // validações mínimas
    if (!nome || !sobrenome || !email || !cpf || !dataNascimento || !nomeUsuario || !senha) {
      return res.status(400).json({ erro: 'Preencha todos os campos obrigatórios.' });
    }

    // Termos de Uso (obrigatório)
    if (aceitouTermos !== true) {
      return res.status(400).json({ erro: 'Você precisa aceitar os Termos de Uso para concluir o cadastro.' });
    }

    // senha minimamente forte (Camada 1)
    const senhaStr = String(senha);
    const senhaForte =
      senhaStr.length >= 8 &&
      /[a-z]/.test(senhaStr) &&
      /[A-Z]/.test(senhaStr) &&
      /\d/.test(senhaStr);

    if (!senhaForte) {
      return res.status(400).json({
        erro: 'A senha deve ter pelo menos 8 caracteres, com letra maiúscula, minúscula e número.',
      });
    }

    let usuarios = lerUsuarios();

    const emailJaExiste = usuarios.some((u) => u.email?.toLowerCase() === String(email).toLowerCase());
    if (emailJaExiste) return res.status(400).json({ erro: 'E-mail já cadastrado.' });

    const usuarioJaExiste = usuarios.some(
      (u) => u.nomeUsuario?.toLowerCase() === String(nomeUsuario).toLowerCase()
    );
    if (usuarioJaExiste) return res.status(400).json({ erro: 'Nome de usuário já em uso.' });

    const hashSenha = await bcrypt.hash(senhaStr, 10);
    const tokenVerificacao = crypto.randomBytes(32).toString('hex');

    const nowIso = new Date().toISOString();
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.ip;
    const userAgent = req.headers['user-agent'] || '';

    // Aceites no cadastro (Termos obrigatórios; demais opcionais)
    const aceitesCadastro = typeof aceites === 'object' && aceites ? aceites : {};
    aceitesCadastro.termosUso = aceitesCadastro.termosUso || {
      versao: versaoTermos || 'v1-beta',
      aceitoEm: nowIso,
      ip,
      userAgent,
    };

    const novoUsuario = {
      id: Date.now().toString(),
      nome,
      sobrenome,
      email,
      cpf,
      dataNascimento,
      genero,
      nomeUsuario,
      senha: hashSenha,
      saldo: 0,

      // histórico/carteira (mantém seus campos)
      carteira: [],
      historico: [],
      transacoes: [],

      // Aceites centralizados
      aceites: aceitesCadastro,

      // Termos (campos legados, se seu frontend usa)
      aceitouTermos: true,
      aceitouTermosEm: nowIso,
      versaoTermosAceita: versaoTermos || 'v1-beta',

      // verificação de e-mail
      emailVerificado: false,
      tokenVerificacao,
    };

    usuarios.push(novoUsuario);
    salvarUsuarios(usuarios);

    await enviarEmailVerificacao(email, tokenVerificacao);

    return res.status(201).json({
      mensagem:
        'Cadastro realizado com sucesso! Enviamos um e-mail com o link para confirmar seu cadastro.',
    });
  } catch (err) {
    console.error('[CADASTRO] Erro no cadastro:', err);
    return res.status(500).json({ erro: 'Erro interno ao realizar cadastro.' });
  }
});

// =====================================================
// [EMAIL] VERIFICAÇÃO DE E-MAIL VIA TOKEN
// =====================================================
app.get('/verificar-email', (req, res) => {
  try {
    const { token } = req.query || {};
    if (!token) return res.status(400).json({ erro: 'Token de verificação não informado.' });

    const usuarios = lerUsuarios();
    const idx = usuarios.findIndex((u) => u.tokenVerificacao === token);
    if (idx === -1) return res.status(400).json({ erro: 'Token de verificação inválido ou expirado.' });

    usuarios[idx].emailVerificado = true;
    usuarios[idx].tokenVerificacao = null;
    usuarios[idx].emailVerificadoEm = new Date().toISOString();

    salvarUsuarios(usuarios);

    return res.json({ mensagem: 'E-mail verificado com sucesso! Você já pode fazer login.' });
  } catch (err) {
    console.error('[VERIFICAR EMAIL] Erro:', err);
    return res.status(500).json({ erro: 'Erro interno ao verificar e-mail.' });
  }
});

// =====================================================
// ESQUECI MINHA SENHA / RESETAR SENHA
// =====================================================

// 1) Usuário pede reset de senha
app.post('/esqueci-senha', (req, res) => {
  try {
    const { emailOuUsuario } = req.body || {};
    if (!emailOuUsuario) {
      return res.status(400).json({ erro: 'Informe seu e-mail ou nome de usuário.' });
    }

    const usuarios = lerUsuarios();
    const usuarioIndex = usuarios.findIndex(
      (u) =>
        u.email?.toLowerCase() === String(emailOuUsuario).toLowerCase() ||
        u.nomeUsuario?.toLowerCase() === String(emailOuUsuario).toLowerCase()
    );

    // Nunca revela se existe ou não
    if (usuarioIndex === -1) {
      return res.json({
        mensagem: 'Se o usuário existir, enviaremos um e-mail com instruções para redefinir a senha.',
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const umaHora = 60 * 60 * 1000;

    usuarios[usuarioIndex].resetSenhaToken = token;
    usuarios[usuarioIndex].resetSenhaExpiraEm = Date.now() + umaHora;

    salvarUsuarios(usuarios);

    enviarEmailResetSenha(usuarios[usuarioIndex].email, token)
      .then(() =>
        res.json({
          mensagem: 'Se o usuário existir, enviaremos um e-mail com instruções para redefinir a senha.',
        })
      )
      .catch((err) => {
        console.error('[RESET SENHA] Erro ao enviar e-mail:', err);
        return res.status(500).json({ erro: 'Erro ao enviar e-mail de redefinição.' });
      });
  } catch (err) {
    console.error('[RESET SENHA] Erro no /esqueci-senha:', err);
    return res.status(500).json({ erro: 'Erro interno.' });
  }
});

// 2) Usuário envia nova senha com token
app.post('/resetar-senha', async (req, res) => {
  try {
    const { token, novaSenha } = req.body || {};
    if (!token || !novaSenha) {
      return res.status(400).json({ erro: 'Token e nova senha são obrigatórios.' });
    }

    const senhaStr = String(novaSenha);
    const senhaForte =
      senhaStr.length >= 8 && /[a-z]/.test(senhaStr) && /[A-Z]/.test(senhaStr) && /\d/.test(senhaStr);

    if (!senhaForte) {
      return res.status(400).json({
        erro: 'A senha deve ter pelo menos 8 caracteres, com letra maiúscula, minúscula e número.',
      });
    }

    let usuarios = lerUsuarios();
    const agora = Date.now();

    const idx = usuarios.findIndex(
      (u) =>
        u.resetSenhaToken === token &&
        typeof u.resetSenhaExpiraEm === 'number' &&
        u.resetSenhaExpiraEm > agora
    );

    if (idx === -1) {
      return res.status(400).json({
        erro: 'Token inválido ou expirado. Solicite uma nova redefinição de senha.',
      });
    }

    const hash = await bcrypt.hash(senhaStr, 10);

    usuarios[idx].senha = hash;
    usuarios[idx].resetSenhaToken = null;
    usuarios[idx].resetSenhaExpiraEm = null;
    usuarios[idx].senhaAlteradaEm = new Date().toISOString();

    salvarUsuarios(usuarios);

    return res.json({ mensagem: 'Senha alterada com sucesso! Você já pode fazer login.' });
  } catch (err) {
    console.error('[RESET SENHA] Erro no /resetar-senha:', err);
    return res.status(500).json({ erro: 'Erro interno ao redefinir senha.' });
  }
});

// =====================================================
// Endpoint: Saldo (mantém exatamente sua rota existente)
// =====================================================
function autenticarToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ erro: 'Token não fornecido' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ erro: 'Token inválido ou expirado' });
    req.usuario = decoded;
    next();
  });
}

app.get('/usuario/saldo', autenticarToken, (req, res) => {
  const usuarios = lerUsuarios();
  const usuario = usuarios.find((u) => u.id === req.usuario.id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });
  res.json({ saldo: usuario.saldo });
});


// =====================================================
// WATCHLIST + NOTIFICAÇÕES
// =====================================================
const fs = require('fs');


const CLUBES_DATA_PATH = path.join(__dirname, 'data', 'clubes.json');

function lerClubesWatchlist() {
  try {
    if (!fs.existsSync(CLUBES_DATA_PATH)) return [];
    return JSON.parse(fs.readFileSync(CLUBES_DATA_PATH, 'utf-8'));
  } catch (e) {
    console.error('[WATCHLIST] erro ao ler clubes.json:', e);
    return [];
  }
}

function ensureWatchlistFields(user) {
  if (!user.watchlist || typeof user.watchlist !== 'object') {
    user.watchlist = { clubes: [], ligas: [] };
  }
  if (!Array.isArray(user.watchlist.clubes)) user.watchlist.clubes = [];
  if (!Array.isArray(user.watchlist.ligas)) user.watchlist.ligas = [];
  if (!Array.isArray(user.notificacoes)) user.notificacoes = [];
  if (!user.alertState || typeof user.alertState !== 'object') user.alertState = {};
  if (!user.alertState.clubPrices || typeof user.alertState.clubPrices !== 'object') user.alertState.clubPrices = {};
}

function addNotification(user, payload) {
  ensureWatchlistFields(user);
  const key = String(payload.key || `${payload.type}:${payload.entityType}:${payload.entityId}:${payload.value || ''}`);
  const exists = user.notificacoes.some((n) => String(n.key) === key);
  if (exists) return null;

  const item = {
    id: crypto.randomBytes(10).toString('hex'),
    key,
    title: payload.title,
    body: payload.body,
    type: payload.type || 'INFO',
    entityType: payload.entityType || null,
    entityId: payload.entityId != null ? String(payload.entityId) : null,
    read: false,
    createdAt: new Date().toISOString(),
    meta: payload.meta || {},
  };

  user.notificacoes.unshift(item);
  if (user.notificacoes.length > 150) user.notificacoes = user.notificacoes.slice(0, 150);
  return item;
}

function synthesizeWatchlistNotifications(user) {
  ensureWatchlistFields(user);
  const clubes = lerClubesWatchlist();

  for (const fav of user.watchlist.clubes) {
    const clube = clubes.find((c) => String(c.id) === String(fav.id));
    if (!clube) continue;

    const currentPrice = Number(clube.precoAtual ?? clube.preco ?? 0);
    const lastPrice = Number(user.alertState.clubPrices[String(clube.id)] ?? 0);

    if (lastPrice > 0 && currentPrice > 0) {
      const pct = ((currentPrice - lastPrice) / lastPrice) * 100;
      if (Math.abs(pct) >= 5) {
        const direction = pct > 0 ? 'subiu' : 'caiu';
        addNotification(user, {
          key: `club-price:${clube.id}:${currentPrice.toFixed(2)}`,
          title: `${clube.nome} ${direction} ${Math.abs(pct).toFixed(1)}%`,
          body: `Novo preço de mercado: R$ ${currentPrice.toFixed(2)}.`,
          type: pct > 0 ? 'PRICE_UP' : 'PRICE_DOWN',
          entityType: 'clube',
          entityId: clube.id,
          meta: { price: currentPrice, pct: Number(pct.toFixed(2)) },
        });
      }
    }

    user.alertState.clubPrices[String(clube.id)] = currentPrice;
  }
}

app.get('/watchlist', auth, (req, res) => {
  try {
    const usuarios = lerUsuarios();
    const idx = usuarios.findIndex((u) => String(u.id) === String(req.usuario.id));
    if (idx < 0) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    ensureWatchlistFields(usuarios[idx]);
    salvarUsuarios(usuarios);
    return res.json({ ok: true, watchlist: usuarios[idx].watchlist });
  } catch (err) {
    console.error('[WATCHLIST GET] erro:', err);
    return res.status(500).json({ erro: 'Erro ao carregar watchlist.' });
  }
});

app.post('/watchlist/toggle', auth, (req, res) => {
  try {
    const { entityType, entityId, nome, ligaId, ligaNome } = req.body || {};
    if (!entityType || !entityId) return res.status(400).json({ erro: 'entityType e entityId são obrigatórios.' });

    const usuarios = lerUsuarios();
    const idx = usuarios.findIndex((u) => String(u.id) === String(req.usuario.id));
    if (idx < 0) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    const user = usuarios[idx];
    ensureWatchlistFields(user);

    if (String(entityType) === 'clube') {
      const exists = user.watchlist.clubes.find((c) => String(c.id) === String(entityId));
      if (exists) {
        user.watchlist.clubes = user.watchlist.clubes.filter((c) => String(c.id) !== String(entityId));
      } else {
        user.watchlist.clubes.push({
          id: String(entityId),
          nome: String(nome || ''),
          ligaId: ligaId ? String(ligaId) : 'brasileirao-a',
          ligaNome: String(ligaNome || 'Brasileirão Série A'),
          createdAt: new Date().toISOString(),
        });
        addNotification(user, {
          key: `fav-clube:${entityId}`,
          title: `${nome || 'Clube'} adicionado aos favoritos`,
          body: 'Você receberá alertas importantes sobre este clube.',
          type: 'WATCHLIST_CLUBE_ADDED',
          entityType: 'clube',
          entityId,
        });
      }
    } else if (String(entityType) === 'liga') {
      const exists = user.watchlist.ligas.find((l) => String(l.id) === String(entityId));
      if (exists) {
        user.watchlist.ligas = user.watchlist.ligas.filter((l) => String(l.id) !== String(entityId));
      } else {
        user.watchlist.ligas.push({
          id: String(entityId),
          nome: String(nome || ''),
          createdAt: new Date().toISOString(),
        });
        addNotification(user, {
          key: `fav-liga:${entityId}`,
          title: `${nome || 'Liga'} adicionada às favoritas`,
          body: 'Você receberá alertas e atualizações principais desta liga.',
          type: 'WATCHLIST_LIGA_ADDED',
          entityType: 'liga',
          entityId,
        });
      }
    } else {
      return res.status(400).json({ erro: 'entityType inválido.' });
    }

    salvarUsuarios(usuarios);
    return res.json({ ok: true, watchlist: user.watchlist });
  } catch (err) {
    console.error('[WATCHLIST TOGGLE] erro:', err);
    return res.status(500).json({ erro: 'Erro ao atualizar watchlist.' });
  }
});

app.get('/notifications', auth, (req, res) => {
  try {
    const usuarios = lerUsuarios();
    const idx = usuarios.findIndex((u) => String(u.id) === String(req.usuario.id));
    if (idx < 0) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    const user = usuarios[idx];
    ensureWatchlistFields(user);
    synthesizeWatchlistNotifications(user);
    salvarUsuarios(usuarios);

    const unreadCount = user.notificacoes.filter((n) => !n.read).length;
    return res.json({ ok: true, notifications: user.notificacoes, unreadCount });
  } catch (err) {
    console.error('[NOTIFICATIONS GET] erro:', err);
    return res.status(500).json({ erro: 'Erro ao carregar notificações.' });
  }
});

app.post('/notifications/read-all', auth, (req, res) => {
  try {
    const usuarios = lerUsuarios();
    const idx = usuarios.findIndex((u) => String(u.id) === String(req.usuario.id));
    if (idx < 0) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    const user = usuarios[idx];
    ensureWatchlistFields(user);
    user.notificacoes = user.notificacoes.map((n) => ({ ...n, read: true }));
    salvarUsuarios(usuarios);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[NOTIFICATIONS READ ALL] erro:', err);
    return res.status(500).json({ erro: 'Erro ao marcar notificações.' });
  }
});

app.post('/notifications/:id/read', auth, (req, res) => {
  try {
    const usuarios = lerUsuarios();
    const idx = usuarios.findIndex((u) => String(u.id) === String(req.usuario.id));
    if (idx < 0) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    const user = usuarios[idx];
    ensureWatchlistFields(user);
    user.notificacoes = user.notificacoes.map((n) =>
      String(n.id) === String(req.params.id) ? { ...n, read: true } : n
    );
    salvarUsuarios(usuarios);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[NOTIFICATIONS READ] erro:', err);
    return res.status(500).json({ erro: 'Erro ao marcar notificação.' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em process.env.NEXT_PUBLIC_API_URL`);
});