const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const bcrypt = require('bcrypt');

const caminhoUsuarios = path.join(__dirname, '../data/usuarios.json');

router.post('/cadastro', async (req, res) => {
  const { nome, email, nomeUsuario, senha } = req.body;

  let usuarios = [];
  if (fs.existsSync(caminhoUsuarios)) {
    usuarios = JSON.parse(fs.readFileSync(caminhoUsuarios, 'utf8'));
  }

  const jaExiste = usuarios.find(u => u.email === email || u.nomeUsuario === nomeUsuario);
  if (jaExiste) {
    return res.status(400).json({ erro: 'Email ou nome de usuário já cadastrado!' });
  }

  const hash = await bcrypt.hash(senha, 10);

  const novoUsuario = {
    id: Date.now(),
    nome,
    nomeUsuario,
    email,
    senha: hash,
    saldo: 10000,
    carteira: [],
    historico: [],
    transacoes: [],
    admin: false
  };

  usuarios.push(novoUsuario);

  fs.writeFileSync(caminhoUsuarios, JSON.stringify(usuarios, null, 2));

  res.status(201).json({ mensagem: 'Usuário cadastrado com sucesso!' });
});

module.exports = router;
