// middleware/auth.js

const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const JWT_SECRET = process.env.JWT_SECRET;
const USERS_PATH = path.join(__dirname, '..', 'data', 'usuarios.json');

function carregarUsuarios() {
  try {
    return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
  } catch (err) {
    console.error('[AUTH] Erro ao ler usuarios.json:', err.message);
    return [];
  }
}

module.exports = (req, res, next) => {
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

    const usuarios = carregarUsuarios();

    const usuarioDB = usuarios.find(
      (u) => String(u.id) === String(decoded.id)
    );

    const isAdmin =
      usuarioDB?.admin === 'true' ||
      usuarioDB?.admin === true ||
      decoded.role === 'admin' ||
      decoded.perfil === 'admin' ||
      decoded.tipo === 'admin';

    req.usuario = {
      id: decoded.id,
      email: decoded.email || usuarioDB?.email || null,
      nomeUsuario: decoded.nomeUsuario || usuarioDB?.nomeUsuario || null,
      role: isAdmin ? 'admin' : (decoded.role || decoded.perfil || decoded.tipo || 'user'),
      admin: isAdmin,
    };
    
    console.log('[AUTH] req.usuario =', req.usuario);
    
    next();
  } catch (e) {
    if (e?.name === 'TokenExpiredError') {
      return res.status(401).json({ erro: 'Token expirado.' });
    }

    return res.status(401).json({ erro: 'Token inválido.' });
  }
};