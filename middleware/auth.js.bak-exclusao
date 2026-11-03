const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET;

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ erro: 'Token não fornecido.' });
  }

  const partes = authHeader.split(' ');
  if (partes.length !== 2 || partes[0] !== 'Bearer') {
    return res.status(401).json({ erro: 'Header de autorização inválido.' });
  }

  const token = partes[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    const usuarioDB = await User.findById(decoded.id);

    if (!usuarioDB) {
      return res.status(401).json({ erro: 'Usuário do token não encontrado.' });
    }

    const isAdmin =
      usuarioDB?.admin === true ||
      usuarioDB?.role === 'admin' ||
      decoded.role === 'admin' ||
      decoded.perfil === 'admin' ||
      decoded.tipo === 'admin';

    req.usuario = {
      id: String(usuarioDB._id),
      legacyId: usuarioDB.legacyId ?? null,
      email: usuarioDB.email || decoded.email || null,
      nomeUsuario: usuarioDB.nomeUsuario || decoded.nomeUsuario || null,
      role: isAdmin ? 'admin' : 'user',
      admin: isAdmin,
    };

    next();
  } catch (e) {
    if (e?.name === 'TokenExpiredError') {
      return res.status(401).json({ erro: 'Token expirado.' });
    }

    return res.status(401).json({ erro: 'Token inválido.' });
  }
};