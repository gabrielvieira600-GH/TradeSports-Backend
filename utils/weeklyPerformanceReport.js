const User = require('../models/User');
const Club = require('../models/Club');
const Investment = require('../models/Investment');
const Order = require('../models/Order');
const Dividendo = require('../models/dividendos');
const PerformanceSnapshot = require('../models/PerformanceSnapshot');
const WeeklyPerformanceReport = require('../models/WeeklyPerformanceReport');
const { obterPlanoEfetivo } = require('./planFeatures');

const OFFSET_BRASIL_MS = 3 * 60 * 60 * 1000;

function round2(valor) {
  return Math.round((Number(valor) || 0) * 100) / 100;
}

function semanaConcluida(agora = new Date()) {
  const local = new Date(agora.getTime() - OFFSET_BRASIL_MS);
  const dia = local.getUTCDay() || 7;
  const segundaAtual = new Date(Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() - dia + 1,
    3, 0, 0, 0
  ));
  const inicio = new Date(segundaAtual.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fim = new Date(segundaAtual.getTime() - 1);
  return { inicio, fim, chaveSemana: inicio.toISOString().slice(0, 10) };
}

function calcularCarteira(usuario, clubes) {
  const mapa = new Map(clubes.map((clube) => [Number(clube.legacyId), clube]));
  const posicoes = (usuario.carteira || [])
    .filter((ativo) => Number(ativo.quantidade || 0) > 0)
    .map((ativo) => {
      const clube = mapa.get(Number(ativo.clubeId));
      const quantidade = Number(ativo.quantidade || 0);
      const precoAtual = Number(clube?.precoAtual ?? clube?.preco ?? ativo.precoMedio ?? 0);
      const valorAtual = round2(quantidade * precoAtual);
      return {
        clubeId: Number(ativo.clubeId),
        nome: clube?.nome || ativo.nomeClube || 'Clube',
        escudo: clube?.escudo || '',
        liga: clube?.metadata?.ligaNome || clube?.metadata?.liga || 'BrasileirÃ£o SÃ©rie A',
        quantidade,
        valorAtual,
        posicao: Number.isFinite(Number(clube?.posicao)) ? Number(clube.posicao) : null,
      };
    });
  const valorPosicoes = round2(posicoes.reduce((soma, item) => soma + item.valorAtual, 0));
  const saldo = round2(usuario.saldo);
  return { saldo, valorPosicoes, patrimonio: round2(saldo + valorPosicoes), posicoes };
}

function analisarOperacoes(investimentos, inicio, fim) {
  const lotes = new Map();
  const impactos = new Map();
  let resultadoRealizado = 0;
  let taxas = 0;
  let execucoes = 0;

  for (const item of investimentos) {
    const clubeId = Number(item.clubeLegacyId);
    if (!Number.isFinite(clubeId)) continue;
    const tipo = String(item.tipo || '').toUpperCase();
    const quantidade = Number(item.quantidade || 0);
    const total = Number(item.totalPago || 0);
    const data = new Date(item.data || item.createdAt);
    const noPeriodo = data >= inicio && data <= fim;
    const fee = Number(item.metadata?.fee || 0);
    const lote = lotes.get(clubeId) || { quantidade: 0, custo: 0 };

    if (['IPO', 'COMPRA'].includes(tipo)) {
      lote.quantidade += quantidade;
      lote.custo += total;
      lotes.set(clubeId, lote);
      if (noPeriodo) { taxas += fee; execucoes += 1; }
      continue;
    }

    if (tipo === 'IPO_RETURN' && quantidade > 0) {
      const custoMedio = lote.quantidade > 0 ? lote.custo / lote.quantidade : 0;
      const custoBaixado = Math.min(lote.quantidade, quantidade) * custoMedio;
      lote.quantidade = Math.max(0, lote.quantidade - quantidade);
      lote.custo = Math.max(0, lote.custo - custoBaixado);
      lotes.set(clubeId, lote);
      // DevoluÃ§Ã£o de IPO nÃ£o Ã© execuÃ§Ã£o de ordem, nÃ£o gera taxa e nÃ£o entra
      // como resultado realizado do mercado secundÃ¡rio.
      continue;
    }

    if (['VENDA', 'LIQUIDACAO'].includes(tipo) && quantidade > 0) {
      const custoMedio = lote.quantidade > 0 ? lote.custo / lote.quantidade : 0;
      const custoBaixado = Math.min(lote.quantidade, quantidade) * custoMedio;
      const resultado = round2(total - custoBaixado);
      lote.quantidade = Math.max(0, lote.quantidade - quantidade);
      lote.custo = Math.max(0, lote.custo - custoBaixado);
      lotes.set(clubeId, lote);
      if (noPeriodo) {
        resultadoRealizado += resultado;
        taxas += fee;
        execucoes += 1;
        const impacto = impactos.get(clubeId) || {
          clubeId,
          nome: item.clubeNome || 'Clube',
          resultadoRealizado: 0,
          dividendos: 0,
        };
        impacto.resultadoRealizado += resultado;
        impactos.set(clubeId, impacto);
      }
    }
  }

  return { resultadoRealizado: round2(resultadoRealizado), taxas: round2(taxas), execucoes, impactos };
}

async function calcularRanking(usuarioId, clubes) {
  const mapa = new Map(clubes.map((clube) => [Number(clube.legacyId), clube]));
  const usuarios = await User.find({ rankingAtivo: { $ne: false } })
    .select('saldo carteira capitalInicial patrimonioInicialTemporada plano premiumAtivo premiumInicio premiumFim')
    .lean();
  const lista = usuarios.map((usuario) => {
    const valorPosicoes = (usuario.carteira || []).reduce((soma, ativo) => {
      const clube = mapa.get(Number(ativo.clubeId));
      const preco = Number(clube?.precoAtual ?? clube?.preco ?? ativo.precoMedio ?? 0);
      return soma + Number(ativo.quantidade || 0) * preco;
    }, 0);
    const patrimonio = Number(usuario.saldo || 0) + valorPosicoes;
    const base = Number(usuario.patrimonioInicialTemporada || usuario.capitalInicial || 1000);
    return {
      id: String(usuario._id),
      plano: obterPlanoEfetivo(usuario),
      patrimonio,
      rentabilidade: base > 0 ? ((patrimonio - base) / base) * 100 : 0,
    };
  }).sort((a, b) => b.rentabilidade - a.rentabilidade || b.patrimonio - a.patrimonio);
  const geral = lista.findIndex((item) => item.id === String(usuarioId));
  const atual = lista[geral];
  const premium = lista.filter((item) => item.plano === 'premium');
  const posicaoPremium = premium.findIndex((item) => item.id === String(usuarioId));
  return {
    posicaoGeral: geral >= 0 ? geral + 1 : null,
    totalGeral: lista.length,
    posicaoPremium: posicaoPremium >= 0 ? posicaoPremium + 1 : null,
    totalPremium: premium.length,
  };
}

function adicionarNotificacao(usuario, relatorio) {
  if (!Array.isArray(usuario.notificacoes)) usuario.notificacoes = [];
  const id = `weekly-report:${relatorio.chaveSemana}`;
  if (usuario.notificacoes.some((item) => String(item.id) === id)) return;
  usuario.notificacoes.unshift({
    id,
    title: 'Seu relatório semanal está pronto',
    body: 'Veja a evolução da carteira, suas operações e os destaques da semana.',
    read: false,
    createdAt: new Date(),
    metadata: { tipo: 'relatorio_semanal', relatorioId: String(relatorio._id), url: `/relatorios-semanais?id=${relatorio._id}` },
  });
  usuario.notificacoes = usuario.notificacoes.slice(0, 100);
  usuario.markModified?.('notificacoes');
}

async function garantirRelatorioSemanal(usuario) {
  if (!usuario || obterPlanoEfetivo(usuario) !== 'premium') return null;
  const semana = semanaConcluida();
  const existente = await WeeklyPerformanceReport.findOne({
    usuarioId: usuario._id,
    chaveSemana: semana.chaveSemana,
  });
  if (existente) {
    adicionarNotificacao(usuario, existente);
    return existente;
  }

  const clubes = await Club.find({}).lean();
  const carteira = calcularCarteira(usuario, clubes);
  const [investimentos, dividendos, ordensEnviadas, ordensExecutadas, snapshotInicio, snapshotFim, ranking, anterior] = await Promise.all([
    Investment.find({ usuarioId: usuario._id }).sort({ data: 1, createdAt: 1 }).lean(),
    Dividendo.find({ usuarioId: usuario._id, data: { $gte: semana.inicio, $lte: semana.fim } }).lean(),
    Order.countDocuments({ usuarioId: usuario._id, criadoEm: { $gte: semana.inicio, $lte: semana.fim } }),
    Order.countDocuments({ usuarioId: usuario._id, status: { $in: ['executada', 'parcial'] }, $or: [
      { executadoEm: { $gte: semana.inicio, $lte: semana.fim } },
      { updatedAt: { $gte: semana.inicio, $lte: semana.fim } },
    ] }),
    PerformanceSnapshot.findOne({ usuarioId: usuario._id, data: { $lt: semana.inicio } }).sort({ data: -1 }).lean(),
    PerformanceSnapshot.findOne({ usuarioId: usuario._id, data: { $gte: semana.inicio, $lte: semana.fim } }).sort({ data: -1 }).lean(),
    calcularRanking(usuario._id, clubes),
    WeeklyPerformanceReport.findOne({ usuarioId: usuario._id }).sort({ inicio: -1 }).lean(),
  ]);

  const operacoes = analisarOperacoes(investimentos, semana.inicio, semana.fim);
  let totalDividendos = 0;
  for (const item of dividendos) {
    const valor = Number(item.totalPago || 0);
    totalDividendos += valor;
    const clubeId = Number(item.clubeLegacyId);
    if (!Number.isFinite(clubeId)) continue;
    const impacto = operacoes.impactos.get(clubeId) || {
      clubeId,
      nome: item.clubeNome || 'Clube',
      resultadoRealizado: 0,
      dividendos: 0,
    };
    impacto.dividendos += valor;
    operacoes.impactos.set(clubeId, impacto);
  }

  const mapaClubes = new Map(clubes.map((item) => [Number(item.legacyId), item]));
  const clubesImpacto = [...operacoes.impactos.values()].map((item) => ({
    ...item,
    escudo: mapaClubes.get(item.clubeId)?.escudo || '',
    impactoObjetivo: round2(item.resultadoRealizado + item.dividendos),
  })).sort((a, b) => b.impactoObjetivo - a.impactoObjetivo);
  const maiorValor = carteira.posicoes.length ? Math.max(...carteira.posicoes.map((item) => item.valorAtual)) : 0;
  const concentracao = carteira.valorPosicoes > 0 ? round2((maiorValor / carteira.valorPosicoes) * 100) : 0;
  const patrimonioInicial = snapshotInicio ? round2(snapshotInicio.patrimonio) : null;
  const patrimonioFinal = snapshotFim ? round2(snapshotFim.patrimonio) : carteira.patrimonio;
  const resultadoSemana = patrimonioInicial !== null && snapshotFim
    ? round2(patrimonioFinal - patrimonioInicial)
    : null;
  const variacaoPercentual = resultadoSemana !== null && patrimonioInicial > 0
    ? round2((resultadoSemana / patrimonioInicial) * 100)
    : null;
  const mudancaRanking = anterior?.ranking?.posicaoGeral && ranking.posicaoGeral
    ? Number(anterior.ranking.posicaoGeral) - Number(ranking.posicaoGeral)
    : null;
  const alertas = [];
  if (concentracao >= 35) alertas.push({ tipo: 'concentracao', texto: `${concentracao.toFixed(1)}% das posições estão concentradas no maior ativo.` });
  const top4 = carteira.posicoes.filter((item) => item.posicao && item.posicao <= 4);
  if (top4.length) alertas.push({ tipo: 'top4', texto: `${top4.map((item) => item.nome).slice(0, 3).join(', ')} ${top4.length === 1 ? 'está' : 'estão'} no Top 4 antes da próxima rodada.` });
  if (!alertas.length) alertas.push({ tipo: 'informativo', texto: 'Acompanhe a classificação e suas ordens abertas antes da próxima rodada.' });

  let relatorio;
  try {
    relatorio = await WeeklyPerformanceReport.create({
      usuarioId: usuario._id,
      ...semana,
      resumo: {
        patrimonioInicial,
        patrimonioFinal,
        resultadoSemana,
        variacaoPercentual,
        resultadoRealizado: operacoes.resultadoRealizado,
        ordensEnviadas,
        ordensExecutadas: Math.max(ordensExecutadas, operacoes.execucoes),
        taxasPagas: operacoes.taxas,
        dividendosRecebidos: round2(totalDividendos),
      },
      clubesImpacto,
      exposicao: {
        saldo: carteira.saldo,
        valorPosicoes: carteira.valorPosicoes,
        quantidadePosicoes: carteira.posicoes.length,
        concentracaoMaiorPosicao: concentracao,
        posicoes: carteira.posicoes.map((item) => ({ ...item, concentracao: carteira.valorPosicoes > 0 ? round2((item.valorAtual / carteira.valorPosicoes) * 100) : 0 })),
      },
      ranking: { ...ranking, mudancaPosicoes: mudancaRanking },
      alertasProximaRodada: alertas,
      qualidadeDados: {
        variacaoPatrimonialDisponivel: resultadoSemana !== null,
        mudancaRankingDisponivel: mudancaRanking !== null,
        observacao: resultadoSemana === null
          ? 'A base histórica ainda não contém snapshots suficientes para comparar o início e o fim desta semana.'
          : null,
      },
      metodologia: {
        periodo: 'Semana concluída, de segunda-feira a domingo, no horário de Brasí­lia.',
        impactoClubes: 'Resultado realizado em vendas e liquidações, somado aos dividendos recebidos por clube. Variações de preço sem snapshot histórico por ativo não são estimadas.',
        natureza: 'Relatório informativo baseado em dados objetivos. Não constitui recomendação de compra ou venda.',
      },
    });
  } catch (err) {
    if (err?.code !== 11000) throw err;
    relatorio = await WeeklyPerformanceReport.findOne({ usuarioId: usuario._id, chaveSemana: semana.chaveSemana });
  }

  adicionarNotificacao(usuario, relatorio);
  return relatorio;
}

module.exports = { garantirRelatorioSemanal, semanaConcluida };
