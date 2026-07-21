// utils/emailService.js
const { Resend } = require('resend');

const FRONTEND_URL = (
  process.env.FRONTEND_URL ||
  process.env.FRONTEND_ORIGIN ||
  'http://localhost:3000'
).replace(/\/$/, '');

const EMAIL_FROM =
  process.env.EMAIL_FROM ||
  'TradeSports <nao-responda@tradesports.com.br>';

const EMAIL_REPLY_TO =
  process.env.EMAIL_REPLY_TO ||
  'suporte@tradesports.com.br';

function getResend() {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();

  if (!apiKey) {
    throw new Error('RESEND_API_KEY não configurada.');
  }

  return new Resend(apiKey);
}

function criarBotao(url, texto) {
  return `
    <a href="${url}"
       style="display:inline-block;padding:14px 22px;border-radius:10px;background:#22c55e;color:#06111f;text-decoration:none;font-weight:800;">
      ${texto}
    </a>
  `;
}

function layoutEmail({ titulo, preheader, conteudo, botao, aviso }) {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${titulo}</title>
  </head>
  <body style="margin:0;background:#07111f;font-family:Arial,Helvetica,sans-serif;color:#e5edf7;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#07111f;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#0d1b2e;border:1px solid #1e3552;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:26px 30px;border-bottom:1px solid #1e3552;">
                <img

  src="https://www.tradesports.com.br/tradesports-logo.png"

  width="260"

  height="56"

  alt="TradeSports"

  style="display:block;width:260px;max-width:100%;height:56px;object-fit:cover;object-position:center;border:0;outline:none;text-decoration:none;"

>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 30px;">
                <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;color:#ffffff;">${titulo}</h1>
                <div style="font-size:16px;line-height:1.65;color:#b9c7d8;">${conteudo}</div>
                <div style="margin:26px 0;">${botao}</div>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#7f91a8;">${aviso}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 30px;background:#091525;font-size:12px;line-height:1.6;color:#71839a;">
                TradeSports — ambiente de simulação com moeda virtual T$.<br>
                Este é um e-mail automático de segurança.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function enviar({ para, assunto, html, texto }) {
  const resend = getResend();
  const { data, error } = await resend.emails.send({
    from: EMAIL_FROM,
    to: [para],
    replyTo: EMAIL_REPLY_TO,
    subject: assunto,
    html,
    text: texto,
  });

  if (error) {
    const err = new Error(error.message || 'Falha ao enviar e-mail pelo Resend.');
    err.cause = error;
    throw err;
  }

  return data;
}

async function enviarEmailVerificacao(para, token) {
  const link = `${FRONTEND_URL}/verificar-email?token=${encodeURIComponent(token)}`;
  const assunto = 'Confirme seu cadastro na TradeSports';

  return enviar({
    para,
    assunto,
    texto: `Confirme seu cadastro na TradeSports: ${link}`,
    html: layoutEmail({
      titulo: 'Confirme seu cadastro',
      preheader: 'Ative sua conta TradeSports.',
      conteudo:
        '<p>Seu cadastro foi recebido. Confirme seu endereço de e-mail para ativar a conta e acessar a plataforma.</p>',
      botao: criarBotao(link, 'Confirmar meu e-mail'),
      aviso:
        'Se você não criou uma conta na TradeSports, ignore esta mensagem.',
    }),
  });
}

async function enviarEmailResetSenha(para, token) {
  const link = `${FRONTEND_URL}/redefinir-senha?token=${encodeURIComponent(token)}`;
  const assunto = 'Redefina sua senha na TradeSports';

  return enviar({
    para,
    assunto,
    texto: `Redefina sua senha na TradeSports. O link expira em 1 hora: ${link}`,
    html: layoutEmail({
      titulo: 'Redefinição de senha',
      preheader: 'Use este link seguro para criar uma nova senha.',
      conteudo:
        '<p>Recebemos uma solicitação para redefinir sua senha.</p><p>O link abaixo é de uso único e expira em <strong style="color:#ffffff;">1 hora</strong>.</p>',
      botao: criarBotao(link, 'Criar nova senha'),
      aviso:
        'Se você não solicitou a redefinição, ignore este e-mail. Sua senha atual continuará válida.',
    }),
  });
}

module.exports = {
  enviarEmailVerificacao,
  enviarEmailResetSenha,
};

