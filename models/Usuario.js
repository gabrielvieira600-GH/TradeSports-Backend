// models/Usuario.js

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const usuariosPath = path.join(__dirname, '../data/usuarios.json');

function lerUsuarios() {
  try {
    const data = fs.readFileSync(usuariosPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

function salvarUsuarios(usuarios) {
  fs.writeFileSync(usuariosPath, JSON.stringify(usuarios, null, 2), 'utf-8');
}

function encontrarUsuarioPorEmail(email) {
  const usuarios = lerUsuarios();
  return usuarios.find((u) => u.email === email);
}

function encontrarUsuarioPorNomeUsuario(nomeUsuario) {
  const usuarios = lerUsuarios();
  return usuarios.find((u) => u.nomeUsuario === nomeUsuario);
}

async function criarUsuario(novoUsuario) {
  const usuarios = lerUsuarios();

  const existeEmail = usuarios.some((u) => u.email === novoUsuario.email);
  const existeNomeUsuario = usuarios.some((u) => u.nomeUsuario === novoUsuario.nomeUsuario);

  if (existeEmail || existeNomeUsuario) {
    throw new Error('Email ou nome de usuário já cadastrado');
  }

  const salt = await bcrypt.genSalt(10);
  const senhaCriptografada = await bcrypt.hash(novoUsuario.senha, salt);

  const usuarioFinal = {
    id: Date.now(),
    nome: novoUsuario.nome || '',
    sobrenome: novoUsuario.sobrenome || '',
    email: novoUsuario.email,
    nomeUsuario: novoUsuario.nomeUsuario,
    senha: senhaCriptografada,
    saldo: novoUsuario.saldo || 0,
    admin: novoUsuario.admin || false,
    cpf: novoUsuario.cpf || '',
    dataNascimento: novoUsuario.dataNascimento || '',
    genero: novoUsuario.genero || '',
    dadosBancarios: novoUsuario.dadosBancarios || {}
  };

  usuarios.push(usuarioFinal);
  salvarUsuarios(usuarios);

  return usuarioFinal;
}

function atualizarUsuario(id, novosDados) {
  const usuarios = lerUsuarios();
  const index = usuarios.findIndex((u) => u.id === id);

  if (index === -1) return null;

  usuarios[index] = { ...usuarios[index], ...novosDados };
  salvarUsuarios(usuarios);
  return usuarios[index];
}

function buscarUsuarioPorId(id) {
  const usuarios = lerUsuarios();
  return usuarios.find((u) => u.id === id);
}

module.exports = {
  lerUsuarios,
  salvarUsuarios,
  encontrarUsuarioPorEmail,
  encontrarUsuarioPorNomeUsuario,
  criarUsuario,
  atualizarUsuario,
  buscarUsuarioPorId
};
