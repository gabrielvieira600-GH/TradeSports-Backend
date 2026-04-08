const fs = require('fs');
const path = require('path');
const caminho = path.join(__dirname, '../data/usuarios.json');

function buscarUsuarioPorId(id) {
  const usuarios = JSON.parse(fs.readFileSync(caminho, 'utf-8'));
  return usuarios.find(u => String(u.id) === String(id));
}

function lerUsuarios() {
  try {
    if (!fs.existsSync(caminho)) {
      return [];
    }
    return JSON.parse(fs.readFileSync(caminho, 'utf8'));
  } catch (err) {
    console.error('Erro ao ler usuários:', err);
    return [];
  }
}

function salvarUsuarios(usuarios) {
  try {
    fs.writeFileSync(caminho, JSON.stringify(usuarios, null, 2));
  } catch (err) {
    console.error('Erro ao salvar usuários:', err);
  }
}

module.exports = { lerUsuarios, salvarUsuarios, buscarUsuarioPorId };
