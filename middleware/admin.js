// middleware/admin.js (ADMIN SPLIT VERSION)

module.exports = (req, res, next) => {
  try {
    // 🔒 precisa estar autenticado
    if (!req.usuario) {
      return res.status(401).json({ erro: 'Não autenticado.' });
    }

    // 🔥 NOVO PADRÃO CONSOLIDADO
    const isAdmin =
      req.usuario.admin === true ||
      req.usuario.role === 'admin';

    if (!isAdmin) {
      return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
    }

    next();

  } catch (err) {
    console.error('Erro no middleware admin:', err);
    return res.status(500).json({ erro: 'Erro interno no middleware admin.' });
  }
}