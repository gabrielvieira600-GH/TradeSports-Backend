// backend/utils/emailService.js

// Hoje: apenas logs no console.
// Depois: você troca o conteúdo das funções por chamadas do gateway (SendGrid, SES, etc.)

async function enviarEmailVerificacao(para, token) {
  const link = `http://localhost:3000/verificar-email?token=${token}`;

  console.log('================= EMAIL DE VERIFICAÇÃO (STUB) =================');
  console.log(`Para: ${para}`);
  console.log(`Assunto: Confirme seu cadastro na TradeSports`);
  console.log(`Corpo: Olá! Para ativar sua conta, acesse o link:`);
  console.log(link);
  console.log('================================================================');
}

async function enviarEmailResetSenha(para, token) {
  const link = `http://localhost:3000/resetar-senha?token=${token}`;

  console.log('================= EMAIL DE RESET DE SENHA (STUB) ===============');
  console.log(`Para: ${para}`);
  console.log(`Assunto: Redefina sua senha na TradeSports`);
  console.log(`Corpo: Você solicitou redefinição de senha. Acesse o link abaixo:`);
  console.log(link);
  console.log('================================================================');
}

module.exports = {
  enviarEmailVerificacao,
  enviarEmailResetSenha,
};
