const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const UserSession = require('../models/UserSession');

const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const JWT_SECRET = process.env.JWT_SECRET || 'segredo_nao_definido';

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function criarTokenAcesso(usuario) {
  return jwt.sign({
    id: String(usuario._id),
    legacyId: usuario.legacyId ?? null,
    email: usuario.email,
    nomeUsuario: usuario.nomeUsuario,
    role: usuario.role || (usuario.admin ? 'admin' : 'user'),
  }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

function gerarRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

function dadosDispositivo(req) {
  return {
    ip: String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim().slice(0, 120),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
  };
}

async function criarSessaoPersistente(usuario, req) {
  const refreshToken = gerarRefreshToken();
  const dispositivo = dadosDispositivo(req);
  await UserSession.create({
    usuarioId: usuario._id,
    tokenHash: hashToken(refreshToken),
    ultimoUsoEm: new Date(),
    ...dispositivo,
  });

  const sessoesAntigas = await UserSession.find({
    usuarioId: usuario._id,
    revogadoEm: null,
  }).sort({ ultimoUsoEm: -1 }).skip(20).select('_id').lean();

  if (sessoesAntigas.length) {
    await UserSession.updateMany(
      { _id: { $in: sessoesAntigas.map((item) => item._id) } },
      { $set: { revogadoEm: new Date() } }
    );
  }

  return {
    token: criarTokenAcesso(usuario),
    refreshToken,
  };
}

async function renovarSessaoPersistente(refreshToken, req) {
  const tokenRecebido = String(refreshToken || '');
  if (tokenRecebido.length < 40 || tokenRecebido.length > 512) return null;

  const novoRefreshToken = gerarRefreshToken();
  const dispositivo = dadosDispositivo(req);
  const sessao = await UserSession.findOneAndUpdate(
    { tokenHash: hashToken(tokenRecebido), revogadoEm: null },
    {
      $set: {
        tokenHash: hashToken(novoRefreshToken),
        ultimoUsoEm: new Date(),
        ...dispositivo,
      },
    },
    { new: true }
  );

  if (!sessao) return null;
  const usuario = await User.findById(sessao.usuarioId);
  if (!usuario) {
    sessao.revogadoEm = new Date();
    await sessao.save();
    return null;
  }

  return {
    token: criarTokenAcesso(usuario),
    refreshToken: novoRefreshToken,
    usuario,
  };
}

async function revogarSessaoPersistente(refreshToken) {
  const tokenRecebido = String(refreshToken || '');
  if (!tokenRecebido) return;
  await UserSession.updateOne(
    { tokenHash: hashToken(tokenRecebido), revogadoEm: null },
    { $set: { revogadoEm: new Date() } }
  );
}

module.exports = {
  criarSessaoPersistente,
  renovarSessaoPersistente,
  revogarSessaoPersistente,
};
