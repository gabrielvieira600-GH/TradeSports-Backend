const mongoose = require('mongoose');

let isConnected = false;

async function connectDB() {
  if (isConnected) return mongoose.connection;

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI não definida no ambiente.');
  }

  mongoose.set('strictQuery', true);

  await mongoose.connect(mongoUri, {
    autoIndex: true,
    serverSelectionTimeoutMS: 10000,
  });

  isConnected = true;

  mongoose.connection.on('error', (err) => {
    console.error('[MongoDB] erro de conexão:', err);
  });

  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    console.warn('[MongoDB] conexão encerrada.');
  });

  console.log('[MongoDB] conectado com sucesso.');
  return mongoose.connection;
}

module.exports = { connectDB };