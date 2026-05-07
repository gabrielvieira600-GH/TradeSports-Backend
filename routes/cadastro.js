const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();

const User = require('../models/User');

function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

router.post('/cadastro', async (req, res) => {
  try {
    const { nome, email, nomeUsuario, senha } = req.body || {};

    if (!nome || !email || !nomeUsuario || !senha) {
      return res.status(400).json({ erro: 'Nome, email, nome de usuário e senha são obrigatórios.' });
    }

    const emailNormalizado = normalizarEmail(email);
    const nomeUsuarioNormalizado = String(nomeUsuario).trim();

    const jaExiste = await User.findOne({
      $or: [
        { email: emailNormalizado },
        { nomeUsuario: nomeUsuarioNormalizado },
      ],
    }).lean();

    if (jaExiste) {
      return res.status(400).json({ erro: 'Email ou nome de usuário já cadastrado!' });
    }

    const hash = await bcrypt.hash(String(senha), 10);
    const legacyId = Date.now();

    await User.create({
      legacyId,
      nome: String(nome).trim(),
      nomeUsuario: nomeUsuarioNormalizado,
      email: emailNormalizado,
      senha: hash,
      saldo: 10000,
      carteira: [],
      historico: [],
      transacoes: [],
      admin: false,
      role: 'user',
      criadoEm: new Date(),
      atualizadoEm: new Date(),
    });

    return res.status(201).json({ mensagem: 'Usuário cadastrado com sucesso!' });
  } catch (err) {
    console.error('[CADASTRO] Erro ao cadastrar usuário:', err);

    if (err && err.code === 11000) {
      return res.status(400).json({ erro: 'Email ou nome de usuário já cadastrado!' });
    }

    return res.status(500).json({ erro: 'Erro interno ao cadastrar usuário.' });
  }
});

module.exports = router;