const mongoose = require('mongoose');
const Usuario = require('./models/Usuario'); // Ajuste o caminho conforme sua estrutura

async function atualizarUsuarioEspecifico() {
  // 1. Conecte ao MongoDB
  await mongoose.connect('mongodb+srv://gabrielvieira600:futflas2@tradesports.tzkgqrk.mongodb.net/?retryWrites=true&w=majority&appName=TradeSports', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  // 2. Defina o critério de busca (ex: email ou _id) e o novo nomeUsuario
  const emailDoUsuario = 'admin@tradesports.com'; // Substitua pelo email do usuário
  const novoNomeUsuario = 'admin'; // Escolha um nome de usuário único

  try {
    // 3. Busque e atualize o usuário
    const usuario = await Usuario.findOne({ email: emailDoUsuario });
// No script atualizarUsuarioEspecifico.js, dentro do try:
if (!usuario.nomeUsuario) {
  usuario.nomeUsuario = novoNomeUsuario; // Define o campo se não existir
} else {
  usuario.nomeUsuario = novoNomeUsuario; // Atualiza se existir
}
await usuario.save();
    if (!usuario) {
      console.error('Usuário não encontrado!');
      return;
    }

    // 4. Atribua o novo nomeUsuario e salve
    usuario.nomeUsuario = novoNomeUsuario;
    await usuario.save();

    console.log(`Usuário atualizado com sucesso!`);
    console.log(`Novo nomeUsuario: ${usuario.nomeUsuario}`);
  } catch (err) {
    console.error('Erro ao atualizar usuário:', err);
  } finally {
    // 5. Desconecte do banco
    await mongoose.disconnect();
  }
}

// Execute a função
atualizarUsuarioEspecifico();