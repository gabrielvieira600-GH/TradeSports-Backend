// testarSenha.js
const bcrypt = require('bcrypt');

// 1. Substitua pelo hash do banco de dados (campo "senha" do usuário)
const hashDoBanco = '$2a510$2VOLFpAK0liveV4I1EqAkQuh9JMs9VpHkTXw9XbrX2KGuIQZK2RTMcA'; // Exemplo do seu log

// 2. Substitua pela senha que você está tentando no login (texto puro)
const senhaDigitada = 'admin123'; // Senha testada no frontend

// 3. Comparação
bcrypt.compare(senhaDigitada, hashDoBanco, (err, result) => {
  if (err) {
    console.error('Erro ao comparar:', err);
    return;
  }
  console.log(result ? '✅ Senha CORRETA (hash corresponde)' : '❌ Senha INCORRETA (hash não corresponde)');
});