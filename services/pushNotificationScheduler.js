const User = require('../models/User');
const PushSubscription = require('../models/PushSubscription');
const { avaliarAlertasDoUsuario } = require('../utils/advancedAlerts');
const { obterPlanoEfetivo } = require('../utils/planFeatures');
const { garantirRelatorioSemanal } = require('../utils/weeklyPerformanceReport');
const { synthesizeWatchlistNotifications } = require('../utils/watchlistNotifications');
const { pushEstaConfigurado } = require('./pushNotificationService');

const intervaloPadraoMs = 5 * 60 * 1000;
let timer = null;
let executando = false;

async function processarNotificacoesPush() {
  if (executando || !pushEstaConfigurado()) return;
  executando = true;
  try {
    const usuarioIds = await PushSubscription.distinct('usuarioId', { ativo: true });
    if (!usuarioIds.length) return;

    const usuarios = await User.find({ _id: { $in: usuarioIds } });
    for (const usuario of usuarios) {
      try {
        await synthesizeWatchlistNotifications(usuario);
        await garantirRelatorioSemanal(usuario);
        if (obterPlanoEfetivo(usuario) === 'premium') {
          await avaliarAlertasDoUsuario(usuario);
        }
        await usuario.save();
      } catch (erro) {
        console.error(`[WEB PUSH SCHEDULER] Falha para usuário ${usuario._id}:`, erro?.message);
      }
    }
  } catch (erro) {
    console.error('[WEB PUSH SCHEDULER] Falha no ciclo:', erro?.message);
  } finally {
    executando = false;
  }
}

function iniciarAgendadorNotificacoesPush() {
  if (timer || !pushEstaConfigurado()) {
    if (!pushEstaConfigurado()) {
      console.warn('[WEB PUSH] Agendador inativo: configure as chaves VAPID.');
    }
    return;
  }

  const configurado = Number(process.env.PUSH_SCHEDULER_INTERVAL_MS);
  const intervaloMs = Number.isFinite(configurado) && configurado >= 60000
    ? configurado
    : intervaloPadraoMs;

  setTimeout(processarNotificacoesPush, 15000).unref?.();
  timer = setInterval(processarNotificacoesPush, intervaloMs);
  timer.unref?.();
  console.log(`[WEB PUSH] Agendador iniciado (intervalo: ${intervaloMs} ms).`);
}

module.exports = { iniciarAgendadorNotificacoesPush, processarNotificacoesPush };
