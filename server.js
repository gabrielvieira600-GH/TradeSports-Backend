// server.js
require('dotenv').config();
require('./LoadEnv');

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const { connectDB } = require('./config/db');
const audit = require('./utils/audit');
const antifraude = require('./utils/antifraude');

let operationalChecks = {};
try {
  operationalChecks = require('./utils/operationalChecks');
} catch (_) {
  operationalChecks = {};
}

const { checkLiquidacao } = require('./middleware/checkLiquidacao');
const auth = require('./middleware/auth');

const User = require('./models/User');
const Club = require('./models/Club');
require('./models/Top4Rodada');
require('./models/HistoricoPosse');
require('./models/Investment');
require('./models/Order');
require('./models/Liquidacao');
require('./models/dividendos');

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

let watchlistRoutes = null;
try {
  watchlistRoutes = require('./routes/watchlist');
} catch (_) {}

const app = express();

const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 4001;

if (!JWT_SECRET) {
  console.warn('[SEGURANCA] JWT_SECRET não definido no .env.');
}

app.set('trust proxy', 1);

connectDB()
  .then(() => console.log('Mongo inicializado.'))
  .catch((err) => {
    console.error('Erro ao conectar no Mongo:', err);
    process.exit(1);
  });

let helmet;
try {
  helmet = require('helmet');
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );
} catch (_) {
  console.warn('[SEGURANCA] helmet não instalado. Instale: npm i helmet');
}

let rateLimit;
try {
  rateLimit = require('express-rate-limit');

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 900,
      standardHeaders: true,
      legacyHeaders: false,
      message: { erro: 'Muitas requisições. Tente novamente em alguns minutos.' },
    })
  );

  app.use(
    '/api/login',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 20,
      standardHeaders: true,
      legacyHeaders: false,
      message: { erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
    })
  );

  app.use(
    '/cadastro',
    rateLimit({
      windowMs: 30 * 60 * 1000,
      max: 12,
      standardHeaders: true,
      legacyHeaders: false,
      message: { erro: 'Muitos cadastros/tentativas. Aguarde e tente novamente.' },
    })
  );

  app.use(
    ['/esqueci-senha', '/resetar-senha'],
    rateLimit({
      windowMs: 30 * 60 * 1000,
      max: 12,
      standardHeaders: true,
      legacyHeaders: false,
      message: { erro: 'Muitas solicitações. Aguarde e tente novamente.' },
    })
  );
} catch (_) {
  console.warn('[SEGURANCA] express-rate-limit não instalado. Instale: npm i express-rate-limit');
}

app.use(express.json({ limit: '250kb' }));

app.use((req, res, next) => {
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

  const hasBadKeys = (obj) => {
    if (!isObj(obj)) return false;

    for (const k of Object.keys(obj)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') return true;
      if (k.includes('__proto__') || k.includes('constructor') || k.includes('prototype')) return true;
      if (k.startsWith('$') || k.includes('.')) return true;
      if (hasBadKeys(obj[k])) return true;
    }

    return false;
  };

  if (hasBadKeys(req.body)) {
    return res.status(400).json({ erro: 'Payload inválido.' });
  }

  next();
});

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
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS bloqueado para origin: ${origin}`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    credentials: false,
  })
);

app.use(checkLiquidacao);

// Rotas principais
app.use('/api/admin', adminRoutes);
app.use('/admin', adminRoutes); // compatibilidade com endpoints antigos

app.use('/api/login', loginRoute);
app.use('/api', classificacaoRoutes);

app.use('/clube', clubeRoutes);
app.use('/investimentos', investimentoRoutes);
app.use('/mercado', mercadoRoutes);
app.use('/ordens', ordemRoutes);
app.use('/usuario', usuarioRoutes);
app.use('/deposito', depositoRoutes);
app.use('/saque', saqueRoutes);

if (watchlistRoutes) {
  app.use('/watchlist', watchlistRoutes);
}

function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function senhaEhForte(senha) {
  const s = String(senha || '');
  return s.length >= 8 && /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s);
}

// Cadastro Mongo com verificação por e-mail
app.post('/cadastro', async (req, res) => {
  try {
    const {
      nome,
      sobrenome = '',
      email,
      cpf,
      dataNascimento,
      genero,
      nomeUsuario,
      senha,
      aceitouTermos,
      versaoTermos,
      aceites,
    } = req.body || {};

    if (!nome || !email || !nomeUsuario || !senha) {
      return res.status(400).json({ erro: 'Preencha todos os campos obrigatórios.' });
    }

    if (aceitouTermos !== true) {
      return res.status(400).json({ erro: 'Você precisa aceitar os Termos de Uso para concluir o cadastro.' });
    }

    if (!senhaEhForte(senha)) {
      return res.status(400).json({
        erro: 'A senha deve ter pelo menos 8 caracteres, com letra maiúscula, minúscula e número.',
      });
    }

    const emailNormalizado = normalizarEmail(email);
    const nomeUsuarioNormalizado = String(nomeUsuario).trim();

    const jaExiste = await User.findOne({
      $or: [
        { email: emailNormalizado },
        { nomeUsuario: nomeUsuarioNormalizado },
        ...(cpf ? [{ cpf: String(cpf).trim() }] : []),
      ],
    }).lean();

    if (jaExiste?.email === emailNormalizado) {
      return res.status(400).json({ erro: 'E-mail já cadastrado.' });
    }

    if (jaExiste?.nomeUsuario === nomeUsuarioNormalizado) {
      return res.status(400).json({ erro: 'Nome de usuário já em uso.' });
    }

    if (cpf && jaExiste?.cpf === String(cpf).trim()) {
      return res.status(400).json({ erro: 'CPF já cadastrado.' });
    }

    const hashSenha = await bcrypt.hash(String(senha), 10);
    const tokenVerificacao = crypto.randomBytes(32).toString('hex');

    const now = new Date();
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.ip;
    const userAgent = req.headers['user-agent'] || '';

    const aceitesCadastro = typeof aceites === 'object' && aceites ? { ...aceites } : {};
    aceitesCadastro.termosUso = aceitesCadastro.termosUso || {
      versao: versaoTermos || 'v1-beta',
      aceitoEm: now,
      ip,
      userAgent,
    };

    await User.create({
      legacyId: Date.now(),
      nome: String(nome).trim(),
      sobrenome: String(sobrenome || '').trim(),
      email: emailNormalizado,
      cpf: cpf ? String(cpf).trim() : undefined,
      dataNascimento: dataNascimento || null,
      genero: genero || null,
      nomeUsuario: nomeUsuarioNormalizado,
      senha: hashSenha,
      saldo: 0,
      carteira: [],
      historico: [],
      transacoes: [],
      aceites: aceitesCadastro,
      aceitouTermos: true,
      aceitouTermosEm: now,
      versaoTermosAceita: versaoTermos || 'v1-beta',
      emailVerificado: false,
      tokenVerificacao,
      role: 'user',
      admin: false,
    });

    await enviarEmailVerificacao(emailNormalizado, tokenVerificacao);

    return res.status(201).json({
      mensagem: 'Cadastro realizado com sucesso! Enviamos um e-mail com o link para confirmar seu cadastro.',
    });
  } catch (err) {
    console.error('[CADASTRO] Erro no cadastro:', err);

    if (err?.code === 11000) {
      return res.status(400).json({ erro: 'Dados já cadastrados.' });
    }

    return res.status(500).json({ erro: 'Erro interno ao realizar cadastro.' });
  }
});

// Verificação de e-mail Mongo
app.get('/verificar-email', async (req, res) => {
  try {
    const { token } = req.query || {};
    if (!token) return res.status(400).json({ erro: 'Token de verificação não informado.' });

    const usuario = await User.findOne({ tokenVerificacao: String(token) });
    if (!usuario) return res.status(400).json({ erro: 'Token de verificação inválido ou expirado.' });

    usuario.emailVerificado = true;
    usuario.tokenVerificacao = null;
    usuario.emailVerificadoEm = new Date();
    await usuario.save();

    return res.json({ mensagem: 'E-mail verificado com sucesso! Você já pode fazer login.' });
  } catch (err) {
    console.error('[VERIFICAR EMAIL] Erro:', err);
    return res.status(500).json({ erro: 'Erro interno ao verificar e-mail.' });
  }
});

// Solicitar reset de senha Mongo
app.post('/esqueci-senha', async (req, res) => {
  try {
    const { emailOuUsuario } = req.body || {};
    if (!emailOuUsuario) {
      return res.status(400).json({ erro: 'Informe seu e-mail ou nome de usuário.' });
    }

    const termo = String(emailOuUsuario).trim().toLowerCase();

    const usuario = await User.findOne({
      $or: [{ email: termo }, { nomeUsuario: termo }],
    });

    if (!usuario) {
      return res.json({
        mensagem: 'Se o usuário existir, enviaremos um e-mail com instruções para redefinir a senha.',
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    usuario.resetSenhaToken = token;
    usuario.resetSenhaExpiraEm = Date.now() + 60 * 60 * 1000;
    await usuario.save();

    await enviarEmailResetSenha(usuario.email, token);

    return res.json({
      mensagem: 'Se o usuário existir, enviaremos um e-mail com instruções para redefinir a senha.',
    });
  } catch (err) {
    console.error('[RESET SENHA] Erro no /esqueci-senha:', err);
    return res.status(500).json({ erro: 'Erro interno.' });
  }
});

// Redefinir senha Mongo
app.post('/resetar-senha', async (req, res) => {
  try {
    const { token, novaSenha } = req.body || {};
    if (!token || !novaSenha) {
      return res.status(400).json({ erro: 'Token e nova senha são obrigatórios.' });
    }

    if (!senhaEhForte(novaSenha)) {
      return res.status(400).json({
        erro: 'A senha deve ter pelo menos 8 caracteres, com letra maiúscula, minúscula e número.',
      });
    }

    const usuario = await User.findOne({
      resetSenhaToken: String(token),
      resetSenhaExpiraEm: { $gt: Date.now() },
    });

    if (!usuario) {
      return res.status(400).json({
        erro: 'Token inválido ou expirado. Solicite uma nova redefinição de senha.',
      });
    }

    usuario.senha = await bcrypt.hash(String(novaSenha), 10);
    usuario.resetSenhaToken = null;
    usuario.resetSenhaExpiraEm = null;
    usuario.senhaAlteradaEm = new Date();
    await usuario.save();

    return res.json({ mensagem: 'Senha alterada com sucesso! Você já pode fazer login.' });
  } catch (err) {
    console.error('[RESET SENHA] Erro no /resetar-senha:', err);
    return res.status(500).json({ erro: 'Erro interno ao redefinir senha.' });
  }
});

// Notificações Mongo
function ensureUserNotificationFields(user) {
  if (!user.notificacoes) user.notificacoes = [];
  if (!user.watchlist) user.watchlist = { clubes: [], ligas: [] };
  if (!user.alertState) user.alertState = { clubPrices: {} };
}

async function synthesizeWatchlistNotifications(user) {
  ensureUserNotificationFields(user);

  const clubesWatch = Array.isArray(user.watchlist?.clubes)
    ? user.watchlist.clubes
    : [];

  if (!clubesWatch.length) return false;

  const legacyIds = clubesWatch
    .map((c) => Number(c.id))
    .filter((id) => Number.isFinite(id));

  if (!legacyIds.length) return false;

  const clubes = await Club.find({ legacyId: { $in: legacyIds } }).lean();

  let mudou = false;

  if (!user.alertState || typeof user.alertState !== 'object') {
    user.alertState = { clubPrices: {} };
    mudou = true;
  }

  if (!user.alertState.clubPrices || typeof user.alertState.clubPrices !== 'object') {
    user.alertState.clubPrices = {};
    mudou = true;
  }

  user.notificacoes = Array.isArray(user.notificacoes) ? user.notificacoes : [];

  for (const clube of clubes) {
    const key = String(clube.legacyId);
    const precoAtual = Number(clube.precoAtual ?? clube.preco ?? 0);

    if (!Number.isFinite(precoAtual) || precoAtual <= 0) continue;

    const anteriorRaw = user.alertState.clubPrices[key];

    // Primeira vez: apenas registra o preço-base, sem criar notificação.
    if (anteriorRaw === undefined || anteriorRaw === null) {
      user.alertState.clubPrices[key] = precoAtual;
      mudou = true;
      continue;
    }

    const anterior = Number(anteriorRaw);

    // Sem mudança real de preço: não cria notificação.
    if (Number(anterior.toFixed(2)) === Number(precoAtual.toFixed(2))) {
      continue;
    }

    const notificationKey = `price:${key}:${precoAtual.toFixed(2)}`;

    const jaExiste = user.notificacoes.some((n) => {
      const meta = n?.metadata || {};
      return (
        String(meta.notificationKey || '') === notificationKey ||
        (
          String(meta.clubeId) === key &&
          Number(meta.precoAtual || 0).toFixed(2) === precoAtual.toFixed(2) &&
          String(n.title || '') === 'Preço atualizado'
        )
      );
    });

    if (!jaExiste) {
      user.notificacoes.unshift({
        id: `price_${key}_${precoAtual.toFixed(2)}_${Date.now()}`,
        title: 'Preço atualizado',
        body: `${clube.nome} agora está em R$ ${precoAtual.toFixed(2)}.`,
        read: false,
        createdAt: new Date(),
        metadata: {
          notificationKey,
          clubeId: clube.legacyId,
          clubeNome: clube.nome,
          precoAnterior: anterior,
          precoAtual,
        },
      });

      mudou = true;
    }

    // Atualiza o estado mesmo se a notificação já existia.
    user.alertState.clubPrices[key] = precoAtual;
    mudou = true;
  }

  user.notificacoes = user.notificacoes.slice(0, 100);

  if (mudou) {
    user.markModified('alertState');
    user.markModified('notificacoes');
  }

  return mudou;
}

app.get('/notifications', auth, async (req, res) => {
  try {
    const user = await User.findById(req.usuario.id);
    if (!user) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    ensureUserNotificationFields(user);
    await synthesizeWatchlistNotifications(user);
    await user.save();

    const notifications = Array.isArray(user.notificacoes) ? user.notificacoes : [];
    const unreadCount = notifications.filter((n) => !n.read).length;

    return res.json({ ok: true, notifications, unreadCount });
  } catch (err) {
    console.error('[NOTIFICATIONS GET] erro:', err);
    return res.status(500).json({ erro: 'Erro ao carregar notificações.' });
  }
});

app.post('/notifications/read-all', auth, async (req, res) => {
  try {
    const user = await User.findById(req.usuario.id);
    if (!user) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    ensureUserNotificationFields(user);
    user.notificacoes = user.notificacoes.map((n) => ({ ...n.toObject?.() || n, read: true }));
    await user.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error('[NOTIFICATIONS READ ALL] erro:', err);
    return res.status(500).json({ erro: 'Erro ao marcar notificações.' });
  }
});

app.post('/notifications/:id/read', auth, async (req, res) => {
  try {
    const user = await User.findById(req.usuario.id);
    if (!user) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    ensureUserNotificationFields(user);
    user.notificacoes = user.notificacoes.map((n) => {
      const obj = n.toObject?.() || n;
      return String(obj.id) === String(req.params.id) ? { ...obj, read: true } : obj;
    });

    await user.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error('[NOTIFICATIONS READ] erro:', err);
    return res.status(500).json({ erro: 'Erro ao marcar notificação.' });
  }
});

// Healthcheck
app.get('/health', async (req, res) => {
  try {
    if (typeof operationalChecks.buildHealthPayload === 'function') {
      return res.json(await operationalChecks.buildHealthPayload());
    }

    return res.json({
      ok: true,
      service: 'TradeSports API',
      ts: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      status: 'CRITICO',
      erro: 'Erro ao executar healthcheck.',
      detalhe: String(err.message || err),
      ts: new Date().toISOString(),
    });
  }
});

// Admin antifraude status compatível
app.get('/admin/antifraude/status', auth, async (req, res) => {
  try {
    if (String(req.usuario?.role || '').toLowerCase() !== 'admin') {
      return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
    }

    if (typeof antifraude.getAntifraudeStatus === 'function') {
      const status = await antifraude.getAntifraudeStatus();
      return res.json({ ok: true, ...status });
    }

    const stateDoc = await antifraude.loadState();
    const state = stateDoc.toObject ? stateDoc.toObject() : stateDoc;

    return res.json({
      ok: true,
      users: Object.keys(state.users || {}).length,
      ips: Object.keys(state.ips || {}).length,
      clubes: Object.keys(state.clubes || {}).length,
    });
  } catch (err) {
    console.error('[ANTIFRAUDE STATUS] erro:', err);
    return res.status(500).json({ erro: 'Erro interno ao consultar antifraude.' });
  }
});

app.get('/admin/system/check', auth, async (req, res) => {
  try {
    if (String(req.usuario?.role || '').toLowerCase() !== 'admin') {
      return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
    }

    if (typeof operationalChecks.runSystemCheck === 'function') {
      return res.json({ ok: true, ...operationalChecks.runSystemCheck() });
    }
    const check = await operationalChecks.runSystemCheck();
    return res.json({ ok: true, statusGeral: 'OK', resumo: {}, flags: {} });
  } catch (err) {
    console.error('[SYSTEM CHECK] erro:', err);
    return res.status(500).json({ erro: 'Erro interno ao executar checagem do sistema.' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});