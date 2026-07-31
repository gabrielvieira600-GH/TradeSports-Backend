const AdvancedAlert = require('../models/AdvancedAlert');
const AdvancedAlertTrigger = require('../models/AdvancedAlertTrigger');
const Club = require('../models/Club');
const Order = require('../models/Order');
const Top4Rodada = require('../models/Top4Rodada');
const RankingSeason = require('../models/RankingSeason');

const round2 = (v) => Number(Number(v || 0).toFixed(2));
const passouCooldown = (a, agora) => !a.ultimoDisparoEm || agora - new Date(a.ultimoDisparoEm) >= Number(a.cooldownMinutos || 60) * 60000;

async function estadoDoAlerta(alerta) {
  const clube = alerta.clubeId ? await Club.findById(alerta.clubeId).lean() :
    alerta.clubeLegacyId ? await Club.findOne({ legacyId: alerta.clubeLegacyId }).lean() : null;
  const preco = clube ? Number(clube.precoAtual ?? clube.preco ?? 0) : null;
  if (['PRECO_ACIMA', 'PRECO_ABAIXO', 'VARIACAO_PERCENTUAL', 'IPO_ESGOTANDO', 'CLASSIFICACAO'].includes(alerta.tipo)) {
    return { clube, preco, posicao: Number(clube?.posicao || 0) || null, cotas: Number(clube?.cotasDisponiveis || 0), ipoEncerrado: Boolean(clube?.ipoEncerrado) };
  }
  if (['MELHOR_BID', 'MELHOR_ASK', 'SPREAD'].includes(alerta.tipo)) {
    const ordens = await Order.find({ clubeId: clube?._id, status: { $in: ['aberta', 'parcial'] }, restante: { $gt: 0 } }).lean();
    const bids = ordens.filter(o => o.tipo === 'compra').map(o => Number(o.preco)).filter(Number.isFinite);
    const asks = ordens.filter(o => o.tipo === 'venda').map(o => Number(o.preco)).filter(Number.isFinite);
    const bid = bids.length ? Math.max(...bids) : null;
    const ask = asks.length ? Math.min(...asks) : null;
    return { clube, bid, ask, spread: bid != null && ask != null ? round2(ask - bid) : null };
  }
  if (alerta.tipo === 'ORDEM_EXECUCAO') return { ordem: await Order.findById(alerta.ordemId).lean() };
  if (['TOP4', 'DIVIDENDOS'].includes(alerta.tipo)) {
    const snaps = await Top4Rodada.find({}).sort({ rodada: -1 }).limit(4).lean();
    const atual = snaps[0]; const anterior = snaps[1];
    const id = Number(alerta.clubeLegacyId);
    const posAtual = atual?.clubes?.find(c => Number(c.clubeLegacyId) === id)?.posicao || null;
    const posAnterior = anterior?.clubes?.find(c => Number(c.clubeLegacyId) === id)?.posicao || null;
    let sequencia = 0;
    for (const s of snaps) { if (s.clubes?.some(c => Number(c.clubeLegacyId) === id)) sequencia += 1; else break; }
    return { clube, posAtual, posAnterior, sequencia, rodada: atual?.rodada || null };
  }
  if (alerta.tipo === 'LIQUIDACAO') {
    const temporada = await RankingSeason.findOne({ status: 'ativa' }).sort({ iniciadaEm: -1, createdAt: -1 }).lean();
    const data = temporada?.fimPrevisto ? new Date(temporada.fimPrevisto) : null;
    return { dias: data && !Number.isNaN(data.getTime()) ? Math.ceil((data - Date.now()) / 86400000) : null };
  }
  return {};
}

function avaliar(alerta, e) {
  const alvo = Number(alerta.valorAlvo);
  const cruza = (v, op = alerta.operador) => v != null && (op === 'ABAIXO' ? v <= alvo : v >= alvo);
  if (alerta.tipo === 'PRECO_ACIMA') return { ok: cruza(e.preco, 'ACIMA'), valor: e.preco, texto: `A cotação de ${e.clube?.nome} atingiu T$ ${round2(e.preco).toFixed(2)}.` };
  if (alerta.tipo === 'PRECO_ABAIXO') return { ok: cruza(e.preco, 'ABAIXO'), valor: e.preco, texto: `A cotação de ${e.clube?.nome} chegou a T$ ${round2(e.preco).toFixed(2)}.` };
  if (alerta.tipo === 'VARIACAO_PERCENTUAL') { const base = Number(alerta.valorBase); const variacao = base > 0 ? ((e.preco - base) / base) * 100 : null; return { ok: variacao != null && Math.abs(variacao) >= alvo, valor: variacao, texto: `${e.clube?.nome} variou ${round2(variacao)}% desde a criação do alerta.` }; }
  if (alerta.tipo === 'MELHOR_BID') return { ok: cruza(e.bid), valor: e.bid, texto: `O melhor bid de ${e.clube?.nome} está em T$ ${round2(e.bid).toFixed(2)}.` };
  if (alerta.tipo === 'MELHOR_ASK') return { ok: cruza(e.ask), valor: e.ask, texto: `O melhor ask de ${e.clube?.nome} está em T$ ${round2(e.ask).toFixed(2)}.` };
  if (alerta.tipo === 'SPREAD') return { ok: cruza(e.spread), valor: e.spread, texto: `O spread de ${e.clube?.nome} atingiu T$ ${round2(e.spread).toFixed(2)}.` };
  if (alerta.tipo === 'ORDEM_EXECUCAO') { const status = e.ordem?.status; return { ok: status === 'parcial' || status === 'executada', valor: Number(e.ordem?.quantidade || 0) - Number(e.ordem?.restante || 0), texto: status === 'executada' ? 'Sua ordem foi executada integralmente.' : 'Sua ordem teve execução parcial.' }; }
  if (alerta.tipo === 'IPO_ESGOTANDO') return { ok: e.ipoEncerrado || e.cotas <= alvo, valor: e.cotas, texto: e.ipoEncerrado ? `O IPO de ${e.clube?.nome} foi encerrado.` : `Restam ${e.cotas} cotas no IPO de ${e.clube?.nome}.` };
  if (alerta.tipo === 'CLASSIFICACAO') { const ant = Number(alerta.ultimoEstado?.posicao || 0) || null; return { ok: ant && e.posicao && ant !== e.posicao, valor: e.posicao, texto: `${e.clube?.nome} mudou da ${ant}ª para a ${e.posicao}ª posição.` }; }
  if (alerta.tipo === 'TOP4') { const entrou = !e.posAnterior && e.posAtual; const saiu = e.posAnterior && !e.posAtual; const ok = alerta.operador === 'ENTROU' ? entrou : alerta.operador === 'SAIU' ? saiu : entrou || saiu; return { ok, valor: e.posAtual, texto: entrou ? `${e.clube?.nome} entrou no Top 4.` : `${e.clube?.nome} saiu do Top 4.` }; }
  if (alerta.tipo === 'DIVIDENDOS') return { ok: e.sequencia >= alvo, valor: e.sequencia, texto: `${e.clube?.nome} alcançou ${e.sequencia} rodada(s) consecutiva(s) no Top 4.` };
  if (alerta.tipo === 'LIQUIDACAO') return { ok: e.dias != null && e.dias >= 0 && e.dias <= alvo, valor: e.dias, texto: `A liquidação está a ${e.dias} dia(s).` };
  return { ok: false };
}

async function avaliarAlertasDoUsuario(user) {
  const agora = new Date();
  const alertas = await AdvancedAlert.find({ usuarioId: user._id, status: 'ATIVO' });
  let disparos = 0;
  user.notificacoes = Array.isArray(user.notificacoes) ? user.notificacoes : [];
  for (const alerta of alertas) {
    const estado = await estadoDoAlerta(alerta);
    const resultado = avaliar(alerta, estado);
    const fingerprint = JSON.stringify({ ok: Boolean(resultado.ok), valor: resultado.valor ?? null, status: estado.ordem?.status || null });
    const mudou = fingerprint !== alerta.ultimoEstado?.fingerprint;
    alerta.ultimoEstado = { ...estado, clube: undefined, ordem: undefined, fingerprint, posicao: estado.posicao || alerta.ultimoEstado?.posicao || null };
    if (resultado.ok && mudou && passouCooldown(alerta, agora)) {
      const titulo = `Alerta: ${alerta.nome}`;
      const metadata = { tipo: 'ADVANCED_ALERT', alertaId: String(alerta._id), clubeId: alerta.clubeLegacyId, targetUrl: '/alertas' };
      await AdvancedAlertTrigger.create({ usuarioId: user._id, alertaId: alerta._id, tipo: alerta.tipo, titulo, mensagem: resultado.texto, valorObservado: resultado.valor ?? null, metadata, disparadoEm: agora });
      user.notificacoes.unshift({ id: `advanced_alert_${alerta._id}_${agora.getTime()}`, title: titulo, body: resultado.texto, read: false, createdAt: agora, metadata: { ...metadata, notificationKey: `advanced:${alerta._id}:${agora.getTime()}` } });
      alerta.ultimoDisparoEm = agora; disparos += 1;
      if (!alerta.recorrente || (alerta.tipo === 'ORDEM_EXECUCAO' && estado.ordem?.status === 'executada')) alerta.status = 'PAUSADO';
    }
    alerta.markModified('ultimoEstado'); await alerta.save();
  }
  if (disparos) { user.notificacoes = user.notificacoes.slice(0, 100); user.markModified('notificacoes'); }
  return disparos;
}

module.exports = { avaliarAlertasDoUsuario };
