const mongoose = require('mongoose');
const Usuario = require('./models/Usuario');
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

async function main() {
  try {
    // 1. Conectar ao MongoDB (substitua pela sua URI)
    await mongoose.connect('mongodb+srv://gabrielvieira600:futflas2@tradesports.tzkgqrk.mongodb.net/?retryWrites=true&w=majority&appName=TradeSports');
    console.log('Conectado ao banco de dados.');

    // 2. Pedir entrada do usuário (email e novo nomeUsuario)
    readline.question('Digite o email do usuário: admin@tradesports.com', async (email) => {
      readline.question('Digite o novo nomeUsuario: admin', async (nomeUsuario) => {
        try {
          // 3. Buscar usuário pelo email
          const usuario = await Usuario.findOne({ email });

          if (!usuario) {
            console.error('Usuário não encontrado!');
            return;
          }

          // 4. Adicionar/atualizar nomeUsuario
          usuario.nomeUsuario = nomeUsuario;
          await usuario.save();

          console.log(`\n---\nUsuário atualizado com sucesso!`);
          console.log(`Email: ${usuario.email}`);
          console.log(`Novo nomeUsuario: ${usuario.nomeUsuario}\n---`);
        } catch (err) {
          console.error('Erro:', err.message);
        } finally {
          readline.close();
          await mongoose.disconnect();
        }
      });
    });
  } catch (err) {
    console.error('Erro de conexão:', err.message);
  }
}

main();