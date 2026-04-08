// resetFinal.js
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const Usuario = require('./models/Usuario');

async function resetAdmin() {
  try {
    await mongoose.connect('mongodb+srv://gabrielvieira600:futflas2@tradesports.tzkgqrk.mongodb.net/?retryWrites=true&w=majority&appName=TradeSports');
    
    // 1. Primeiro delete o usuário existente (se houver)
    await Usuario.deleteOne({ email: "admin@tradesports.com" });
    
    // 2. Crie um novo admin com hash correto
    const hash = await bcrypt.hash('admin123', 10);
    const newAdmin = new Usuario({
      nome: 'Administrador',
      email: 'admin@tradesports.com',
      senha: hash,
      nomeUsuario: 'admin',
      saldo: 1000,
      admin: true
    });
    
    await newAdmin.save();
    console.log("✅ Novo admin criado com sucesso!");
    
    // 3. Verifique o novo hash
    const test = await bcrypt.compare('admin123', newAdmin.senha);
    console.log("Teste de senha:", test ? "✅ CORRETO" : "❌ INCORRETO");
    
  } catch (err) {
    console.error("Erro:", err);
  } finally {
    mongoose.disconnect();
  }
}

resetAdmin();