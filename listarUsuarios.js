const mongoose = require('mongoose');
const Usuario = require('./models/Usuario'); // Ajuste o caminho se necessário

async function listarUsuarios() {
  try {
    // 1. Conecte ao MongoDB (ativando logs para debug)
    mongoose.set('debug', true); // Mostra queries no console
    await mongoose.connect('mongodb+srv://gabrielvieira600:futflas2@tradesports.tzkgqrk.mongodb.net/bolsaFutebol?retryWrites=true&w=majority&appName=TradeSports');
    console.log('Conectado ao banco de dados.');

    // 2. Liste os usuários (com fallback para coleções alternativas)
    let usuarios = await Usuario.find({});
    if (usuarios.length === 0) {
      console.log('Nenhum usuário encontrado em "usuarios". Verificando outras coleções...');
      const collections = await mongoose.connection.db.listCollections().toArray();
      console.log('Coleções disponíveis:', collections.map(c => c.name));
    }

    console.log('Usuários cadastrados:', usuarios);
  } catch (err) {
    console.error('Erro:', err);
  } finally {
    await mongoose.disconnect();
  }
}

listarUsuarios();