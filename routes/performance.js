const express = require('express');

const auth = require('../middleware/auth');
const User = require('../models/User');
const Club = require('../models/Club');
const Investment = require('../models/Investment');
const Order = require('../models/Order');
const Dividendo = require('../models/dividendos');
const PerformanceSnapshot = require('../models/PerformanceSnapshot');
const { obterPlanoEfetivo } = require('../utils/planFeatures');
const { performanceForPatrimony } = require('../utils/rankingPerformance');

const router = express.Router();

const PERIODOS = new Set(['7d', '30d', 'temporada', 'personalizado']);

function round2(valor) {
  return Math.round((Number(valor) || 0) * 100) / 100;
}

function inicioDoDia(valor) {
  const data = new Date(valor);
  data.setHours(0, 0, 0, 0);
  return data;
}

function fimDoDia(valor) {
  const data = new Date(valor);
  data.setHours(23, 59, 59, 999);
  return data;
}

function resolverPeriodo(req, usuario) {
  const agora = new Date();
  const periodo = PERIODOS.has(req.query.periodo) ? req.query.periodo : '30d';
  let inicio;

  if (periodo === '7d' || periodo === '30d') {
    inicio = inicioDoDia(agora);
    inicio.setDate(inicio.getDate() - (periodo === '7d' ? 6 : 29));
  } else if (periodo === 'temporada') {
    inicio = usuario.inicioTemporadaRanking
      ? inicioDoDia(usuario.inicioTemporadaRanking)
      : inicioDoDia(usuario.createdAt || agora);
  } else {
    inicio = inicioDoDia(req.query.inicio || agora);
  }

  const fim =
    periodo === 'personalizado'
      ? fimDoDia(req.query.fim || agora)
      : fimDoDia(agora);

  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime()) || inicio > fim) {
    const erro = new Error('Período informado é inválido.');
    erro.status = 400;
    throw erro;
  }

  const limite = new Date(agora);
  limite.setFullYear(limite.getFullYear() - 5);
  if (inicio < limite) {
    const erro = new Error('O período personalizado está limitado aos últimos 5 anos.');
    erro.status = 400;
    throw erro;
  }

  return { periodo, inicio, fim };
}

function dadosClube(clube, ativo) {
  const precoMedio = Number(ativo.precoMedio || 0);
  const precoAtual = Number(clube?.precoAtual ?? clube?.preco ?? precoMedio);
  const quantidade = Number(ativo.quantidade || 0);
  const investido = round2(
    Number.isFinite(Number(ativo.totalInvestido))
      ? ativo.totalInvestido
      : quantidade * precoMedio
  );
  const valorAtual = round2(quantidade * precoAtual);

  return {
    clubeId: Number(ativo.clubeId),
    nome: clube?.nome || ativo.nomeClube || 'Clube',
    escudo: clube?.escudo || '',
    liga: clube?.metadata?.ligaNome || clube?.metadata?.liga || 'Brasileirão Série A',
    quantidade,
    precoMedio: round2(precoMedio),
    precoAtual: round2(precoAtual),
    investido,
    valorAtual,
    resultadoNaoRealizado: round2(valorAtual - investido),
  };
}

function calcularCarteira(usuario, clubes) {
  const mapa = new Map(clubes.map((clube) => [Number(clube.legacyId), clube]));
  const posicoes = (usuario.carteira || [])
    .filter((ativo) => Number(ativo.quantidade || 0) > 0)
    .map((ativo) => dadosClube(mapa.get(Number(ativo.clubeId)), ativo));
  const valorPosicoes = round2(posicoes.reduce((soma, item) => soma + item.valorAtual, 0));
  const totalInvestido = round2(posicoes.reduce((soma, item) => soma + item.investido, 0));
  const saldo = round2(usuario.saldo);
  const patrimonio = round2(saldo + valorPosicoes);
  const patrimonioInicial = round2(
    usuario.patrimonioInicialTemporada || usuario.capitalInicial || 1000
  );
  const performance = performanceForPatrimony(
    usuario,
    patrimonio,
    usuario.temporadaRanking || 'global'
  );

  return {
    saldo,
    valorPosicoes,
    totalInvestido,
    patrimonio,
    patrimonioInicial,
    resultadoAcumulado: performance.resultado,
    rentabilidadeAcumulada: performance.rentabilidade,
    aportesExternosTotal: performance.aportesExternosTotal,
    posicoes,
  };
}

function analisarOperacoes(investimentos, inicio, fim) {
  const lotes = new Map();
  const porClube = new Map();
  const fechamentos = [];
  let taxas = 0;
  let ordensExecutadas = 0;

  for (const item of investimentos) {
    const clubeId = Number(item.clubeLegacyId);
    if (!Number.isFinite(clubeId)) continue;

    const tipo = String(item.tipo || '').toUpperCase();
    const quantidade = Number(item.quantidade || 0);
    const total = Number(item.totalPago || 0);
    const data = new Date(item.data || item.createdAt);
    const noPeriodo = data >= inicio && data <= fim;
    const fee = Number(item.metadata?.fee || 0);
    const estado = lotes.get(clubeId) || { quantidade: 0, custo: 0 };

    if (['IPO', 'COMPRA'].includes(tipo)) {
      estado.quantidade += quantidade;
      estado.custo += total;
      lotes.set(clubeId, estado);
      if (noPeriodo) {
        taxas += fee;
        ordensExecutadas += 1;
      }
      continue;
    }

    if (['VENDA', 'LIQUIDACAO'].includes(tipo) && quantidade > 0) {
      const custoMedio = estado.quantidade > 0 ? estado.custo / estado.quantidade : 0;
      const custoBaixado = Math.min(estado.quantidade, quantidade) * custoMedio;
      const resultado = round2(total - custoBaixado);

      estado.quantidade = Math.max(0, estado.quantidade - quantidade);
      estado.custo = Math.max(0, estado.custo - custoBaixado);
      lotes.set(clubeId, estado);

      if (noPeriodo) {
        taxas += fee;
        ordensExecutadas += 1;
        fechamentos.push({
          clubeId,
          clubeNome: item.clubeNome || 'Clube',
          tipo,
          data,
          quantidade,
          valorLiquido: round2(total),
          custo: round2(custoBaixado),
          resultado,
        });
        const atual = porClube.get(clubeId) || { realizado: 0, taxas: 0, operacoes: 0 };
        atual.realizado += resultado;
        atual.taxas += fee;
        atual.operacoes += 1;
        porClube.set(clubeId, atual);
      }
    }
  }

  fechamentos.sort((a, b) => b.resultado - a.resultado);
  const vencedoras = fechamentos.filter((item) => item.resultado > 0).length;

  return {
    resultadoRealizado: round2(fechamentos.reduce((soma, item) => soma + item.resultado, 0)),
    taxasPagas: round2(taxas),
    ordensExecutadas,
    taxaAcerto: fechamentos.length ? round2((vencedoras / fechamentos.length) * 100) : null,
    operacoesEncerradas: fechamentos.length,
    melhorNegociacao: fechamentos[0] || null,
    piorNegociacao: fechamentos.length ? fechamentos[fechamentos.length - 1] : null,
    porClube,
  };
}

async function registrarSnapshot(usuario, carteira) {
  const agora = new Date();
  const chaveDia = agora.toISOString().slice(0, 10);

  await PerformanceSnapshot.findOneAndUpdate(
    { usuarioId: usuario._id, chaveDia },
    {
      $set: {
        data: agora,
        patrimonio: carteira.patrimonio,
        saldo: carteira.saldo,
        valorPosicoes: carteira.valorPosicoes,
        resultadoAcumulado: carteira.resultadoAcumulado,
        rentabilidadeAcumulada: carteira.rentabilidadeAcumulada,
        quantidadePosicoes: carteira.posicoes.length,
        posicoes: carteira.posicoes.map((item) => ({
          clubeId: item.clubeId,
          nome: item.nome,
          quantidade: item.quantidade,
          valorAtual: item.valorAtual,
        })),
      },
      $setOnInsert: { usuarioId: usuario._id, chaveDia },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function calcularRanking(usuarioId, clubes) {
  const mapa = new Map(clubes.map((clube) => [Number(clube.legacyId), clube]));
  const usuarios = await User.find({ rankingAtivo: { $ne: false } })
    .select('saldo carteira capitalInicial patrimonioInicialTemporada temporadaRanking rankingPerformance plano premiumAtivo premiumInicio premiumFim')
    .lean();
  const lista = usuarios
    .map((usuario) => {
      const valorPosicoes = (usuario.carteira || []).reduce((soma, ativo) => {
        const clube = mapa.get(Number(ativo.clubeId));
        const preco = Number(clube?.precoAtual ?? clube?.preco ?? ativo.precoMedio ?? 0);
        return soma + Number(ativo.quantidade || 0) * preco;
      }, 0);
      const patrimonio = round2(Number(usuario.saldo || 0) + valorPosicoes);
      const performance = performanceForPatrimony(
        usuario,
        patrimonio,
        usuario.temporadaRanking || 'global'
      );
      return {
        id: String(usuario._id),
        plano: obterPlanoEfetivo(usuario),
        patrimonio,
        rentabilidade: performance.rentabilidade,
      };
    })
    .sort((a, b) => b.rentabilidade - a.rentabilidade || a.id.localeCompare(b.id));

  const geral = lista.findIndex((item) => item.id === String(usuarioId));
  const atual = lista[geral];
  const mesmoPlano = lista.filter((item) => item.plano === atual?.plano);
  const plano = mesmoPlano.findIndex((item) => item.id === String(usuarioId));

  return {
    posicaoGeral: geral >= 0 ? geral + 1 : null,
    totalGeral: lista.length,
    posicaoPlano: plano >= 0 ? plano + 1 : null,
    totalPlano: mesmoPlano.length,
  };
}

router.get('/', auth, async (req, res) => {
  try {
    const usuario = await User.findById(req.usuario.id).lean();
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    const plano = obterPlanoEfetivo(usuario);
    const periodo = resolverPeriodo(req, usuario);
    const clubes = await Club.find({}).lean();
    const carteira = calcularCarteira(usuario, clubes);
    await registrarSnapshot(usuario, carteira);

    const base = {
      plano,
      premium: plano === 'premium',
      periodo: {
        tipo: periodo.periodo,
        inicio: periodo.inicio,
        fim: periodo.fim,
      },
      resumo: {
        patrimonioAtual: carteira.patrimonio,
        variacaoAcumulada: carteira.rentabilidadeAcumulada,
        resultadoNaoRealizado: round2(
          carteira.valorPosicoes - carteira.totalInvestido
        ),
      },
      atualizadoEm: new Date(),
    };

    if (plano !== 'premium') {
      return res.json({
        ...base,
        previaLite: true,
        recursosBloqueados: [
          'curva_patrimonial',
          'resultado_realizado',
          'taxas_e_dividendos',
          'desempenho_por_clube',
          'desempenho_por_liga',
          'melhores_operacoes',
          'concentracao',
          'taxa_de_acerto',
          'comparacao_ranking',
        ],
      });
    }

    const [investimentos, dividendos, snapshots, ordensExecutadas, ranking] =
      await Promise.all([
        Investment.find({ usuarioId: usuario._id })
          .sort({ data: 1, createdAt: 1 })
          .lean(),
        Dividendo.find({
          usuarioId: usuario._id,
          data: { $gte: periodo.inicio, $lte: periodo.fim },
        }).lean(),
        PerformanceSnapshot.find({
          usuarioId: usuario._id,
          data: { $gte: periodo.inicio, $lte: periodo.fim },
        })
          .sort({ data: 1 })
          .lean(),
        Order.countDocuments({
          usuarioId: usuario._id,
          status: { $in: ['executada', 'parcial'] },
          $or: [
            { executadoEm: { $gte: periodo.inicio, $lte: periodo.fim } },
            { updatedAt: { $gte: periodo.inicio, $lte: periodo.fim } },
          ],
        }),
        calcularRanking(usuario._id, clubes),
      ]);

    const operacoes = analisarOperacoes(investimentos, periodo.inicio, periodo.fim);
    const dividendosRecebidos = round2(
      dividendos.reduce((soma, item) => soma + Number(item.totalPago || 0), 0)
    );
    const valorPosicoes = carteira.valorPosicoes || 1;
    const porClube = carteira.posicoes.map((posicao) => {
      const realizado = operacoes.porClube.get(posicao.clubeId)?.realizado || 0;
      return {
        ...posicao,
        resultadoRealizado: round2(realizado),
        resultadoTotal: round2(realizado + posicao.resultadoNaoRealizado),
        concentracao: round2((posicao.valorAtual / valorPosicoes) * 100),
      };
    });
    const porLigaMap = new Map();
    for (const item of porClube) {
      const liga = porLigaMap.get(item.liga) || {
        liga: item.liga,
        valorAtual: 0,
        resultadoRealizado: 0,
        resultadoNaoRealizado: 0,
      };
      liga.valorAtual += item.valorAtual;
      liga.resultadoRealizado += item.resultadoRealizado;
      liga.resultadoNaoRealizado += item.resultadoNaoRealizado;
      porLigaMap.set(item.liga, liga);
    }
    const porLiga = [...porLigaMap.values()].map((item) => ({
      ...item,
      valorAtual: round2(item.valorAtual),
      resultadoRealizado: round2(item.resultadoRealizado),
      resultadoNaoRealizado: round2(item.resultadoNaoRealizado),
      resultadoTotal: round2(item.resultadoRealizado + item.resultadoNaoRealizado),
    }));
    const ordenados = [...porClube].sort((a, b) => b.resultadoTotal - a.resultadoTotal);

    return res.json({
      ...base,
      resumo: {
        ...base.resumo,
        saldo: carteira.saldo,
        valorPosicoes: carteira.valorPosicoes,
        resultadoRealizado: operacoes.resultadoRealizado,
        taxasPagas: operacoes.taxasPagas,
        dividendosRecebidos,
        resultadoDoPeriodo: round2(
          operacoes.resultadoRealizado +
            (carteira.valorPosicoes - carteira.totalInvestido) +
            dividendosRecebidos
        ),
        ordensExecutadas: Math.max(ordensExecutadas, operacoes.ordensExecutadas),
        taxaAcerto: operacoes.taxaAcerto,
        operacoesEncerradas: operacoes.operacoesEncerradas,
      },
      curvaPatrimonial: snapshots.map((item) => ({
        data: item.data,
        patrimonio: round2(item.patrimonio),
        rentabilidade: round2(item.rentabilidadeAcumulada),
      })),
      carteira: {
        concentracaoMaiorPosicao: porClube.length
          ? Math.max(...porClube.map((item) => item.concentracao))
          : 0,
        quantidadePosicoes: porClube.length,
        porClube: ordenados,
        porLiga,
        melhorAtivo: ordenados[0] || null,
        piorAtivo: ordenados.length ? ordenados[ordenados.length - 1] : null,
      },
      negociacoes: {
        melhor: operacoes.melhorNegociacao,
        pior: operacoes.piorNegociacao,
      },
      ranking,
      metodologia: {
        resultadoRealizado:
          'Receita líquida de vendas e liquidações menos o custo médio das cotas baixadas no período.',
        resultadoNaoRealizado:
          'Valor atual das posições abertas menos o custo registrado da carteira.',
        taxaAcerto:
          'Percentual de vendas e liquidações encerradas com resultado realizado positivo. Sem operações encerradas, o indicador é exibido como indisponível.',
        curvaPatrimonial:
          'Snapshots diários registrados pela Central de Performance a partir da implantação. Não há preenchimento retroativo estimado.',
      },
    });
  } catch (err) {
    console.error('Erro ao gerar Central de Performance:', err);
    return res.status(err.status || 500).json({
      erro: err.status ? err.message : 'Erro interno ao gerar a Central de Performance.',
    });
  }
});

module.exports = router;
