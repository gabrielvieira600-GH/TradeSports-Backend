const express = require('express');

const auth = require('../middleware/auth');
const User = require('../models/User');
const Club = require('../models/Club');
const { obterPlanoEfetivo } = require('../utils/planFeatures');
const {
  calcularPrecoPorPosicao,
  ajustarPrecoLiquidacaoPorSplit,
} = require('../middleware/checkLiquidacao');

const router = express.Router();
const TAXAS = { maker: 0.002, taker: 0.005 };
const DIVIDENDOS = { 1: 0.025, 2: 0.018, 3: 0.013, 4: 0.009 };

const round2 = (valor) => Math.round((Number(valor) || 0) * 100) / 100;

function precoAtual(clube, fallback = 0) {
  return round2(clube?.precoAtual ?? clube?.preco ?? fallback);
}

function precoLiquidacao(clube, posicao) {
  return ajustarPrecoLiquidacaoPorSplit(
    calcularPrecoPorPosicao(Number(posicao)),
    Number(clube?.splitFactorCumulativo || 1)
  );
}

function carteiraAtual(usuario, clubes) {
  const mapa = new Map(clubes.map((clube) => [Number(clube.legacyId), clube]));
  const posicoes = (usuario.carteira || [])
    .filter((ativo) => Number(ativo.quantidade || 0) > 0)
    .map((ativo) => {
      const clube = mapa.get(Number(ativo.clubeId));
      const quantidade = Number(ativo.quantidade || 0);
      const atual = precoAtual(clube, ativo.precoMedio);
      return {
        clubeId: Number(ativo.clubeId),
        nome: clube?.nome || ativo.nomeClube || 'Clube',
        escudo: clube?.escudo || '',
        posicaoAtual: Number(clube?.posicao || 20),
        quantidade,
        precoMedio: round2(ativo.precoMedio),
        precoAtual: atual,
        valorAtual: round2(quantidade * atual),
      };
    });
  const saldo = round2(usuario.saldo);
  const valorPosicoes = round2(posicoes.reduce((soma, item) => soma + item.valorAtual, 0));
  return { saldo, valorPosicoes, patrimonio: round2(saldo + valorPosicoes), posicoes };
}

function exigirPremium(usuario, res) {
  if (obterPlanoEfetivo(usuario) === 'premium') return true;
  res.status(403).json({
    erro: 'O Simulador de Cenários é exclusivo para assinantes Premium.',
    premiumNecessario: true,
  });
  return false;
}

router.get('/', auth, async (req, res) => {
  try {
    const usuario = await User.findById(req.usuario.id).lean();
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    const premium = obterPlanoEfetivo(usuario) === 'premium';
    if (!premium) {
      return res.json({ plano: 'lite', premium: false, previaLite: true });
    }

    const clubes = await Club.find({}).sort({ nome: 1 }).lean();
    const carteira = carteiraAtual(usuario, clubes);
    return res.json({
      plano: 'premium',
      premium: true,
      carteira,
      clubes: clubes.map((clube) => ({
        clubeId: Number(clube.legacyId),
        nome: clube.nome,
        escudo: clube.escudo || '',
        posicaoAtual: Number(clube.posicao || 20),
        precoAtual: precoAtual(clube),
        splitFactorCumulativo: Number(clube.splitFactorCumulativo || 1),
      })),
      regras: {
        taxaMaker: TAXAS.maker * 100,
        taxaTaker: TAXAS.taker * 100,
        rodadasDividendos: 4,
        dividendosPercentuais: Object.fromEntries(
          Object.entries(DIVIDENDOS).map(([posicao, taxa]) => [posicao, taxa * 100])
        ),
      },
    });
  } catch (err) {
    console.error('Erro ao carregar Simulador de Cenários:', err);
    return res.status(500).json({ erro: 'Erro interno ao carregar o simulador.' });
  }
});

router.post('/individual', auth, async (req, res) => {
  try {
    const usuario = await User.findById(req.usuario.id).lean();
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    if (!exigirPremium(usuario, res)) return;

    const clubeId = Number(req.body.clubeId);
    const posicaoFinal = Number(req.body.posicaoFinal);
    const variacaoQuantidade = Number(req.body.variacaoQuantidade || 0);
    const tipoTaxa = req.body.tipoTaxa === 'maker' ? 'maker' : 'taker';
    const clube = await Club.findOne({ legacyId: clubeId }).lean();
    if (!clube) return res.status(404).json({ erro: 'Clube não encontrado.' });
    if (!Number.isInteger(posicaoFinal) || posicaoFinal < 1 || posicaoFinal > 20) {
      return res.status(400).json({ erro: 'A posição final deve estar entre 1 e 20.' });
    }
    if (!Number.isInteger(variacaoQuantidade) || Math.abs(variacaoQuantidade) > 100000) {
      return res.status(400).json({ erro: 'A quantidade simulada deve ser um número inteiro válido.' });
    }

    const clubes = await Club.find({}).lean();
    const carteira = carteiraAtual(usuario, clubes);
    const ativo = carteira.posicoes.find((item) => item.clubeId === clubeId);
    const quantidadeAtual = Number(ativo?.quantidade || 0);
    const quantidadeFinal = quantidadeAtual + variacaoQuantidade;
    if (quantidadeFinal < 0) {
      return res.status(400).json({ erro: 'A venda simulada supera a quantidade disponível.' });
    }

    const precoOperacaoInformado = Number(req.body.precoOperacao);
    const precoOperacao = round2(
      Number.isFinite(precoOperacaoInformado) && precoOperacaoInformado > 0
        ? precoOperacaoInformado
        : precoAtual(clube, ativo?.precoAtual)
    );
    const brutoOperacao = round2(Math.abs(variacaoQuantidade) * precoOperacao);
    const taxaOperacao = round2(brutoOperacao * TAXAS[tipoTaxa]);
    const impactoSaldo = variacaoQuantidade > 0
      ? round2(-(brutoOperacao + taxaOperacao))
      : variacaoQuantidade < 0
        ? round2(brutoOperacao - taxaOperacao)
        : 0;
    const saldoDepois = round2(carteira.saldo + impactoSaldo);
    const valorAtualClubeAntes = round2(quantidadeAtual * precoAtual(clube, ativo?.precoAtual));
    const valorAtualClubeDepois = round2(quantidadeFinal * precoAtual(clube, ativo?.precoAtual));
    const patrimonioDepoisOperacao = round2(
      saldoDepois + carteira.valorPosicoes - valorAtualClubeAntes + valorAtualClubeDepois
    );
    const valorPosicoesDepois = round2(
      carteira.valorPosicoes - valorAtualClubeAntes + valorAtualClubeDepois
    );
    const unitarioLiquidacao = precoLiquidacao(clube, posicaoFinal);
    const totalLiquidacao = round2(quantidadeFinal * unitarioLiquidacao);
    const quantidadeElegivelPedida = Number(req.body.quantidadeElegivelDividendos || 0);
    const quantidadeElegivel = Math.max(
      0,
      Math.min(quantidadeFinal, Number.isFinite(quantidadeElegivelPedida) ? quantidadeElegivelPedida : 0)
    );
    const percentualDividendo = DIVIDENDOS[posicaoFinal] || 0;
    const dividendoUnitario = round2(calcularPrecoPorPosicao(posicaoFinal) * percentualDividendo);
    const dividendoCondicional = round2(quantidadeElegivel * dividendoUnitario);
    const patrimonioLiquidado = round2(
      saldoDepois + carteira.valorPosicoes - valorAtualClubeAntes + totalLiquidacao + dividendoCondicional
    );
    const comparativoPosicoes = Array.from({ length: 20 }, (_, indice) => {
      const posicao = indice + 1;
      const unitario = precoLiquidacao(clube, posicao);
      const total = round2(quantidadeFinal * unitario);
      const patrimonio = round2(
        saldoDepois + carteira.valorPosicoes - valorAtualClubeAntes + total
      );
      return {
        posicao,
        precoLiquidacao: unitario,
        patrimonio,
        impacto: round2(patrimonio - carteira.patrimonio),
      };
    });

    return res.json({
      tipo: 'individual',
      hipotetico: true,
      clube: { clubeId, nome: clube.nome, escudo: clube.escudo || '' },
      operacao: {
        variacaoQuantidade,
        quantidadeAtual,
        quantidadeFinal,
        precoOperacao,
        tipoTaxa,
        taxaOperacao,
        impactoSaldo,
      },
      cenario: {
        posicaoFinal,
        precoLiquidacao: unitarioLiquidacao,
        totalLiquidacao,
        quantidadeElegivelDividendos: quantidadeElegivel,
        dividendoCondicional,
        percentualDividendo: round2(percentualDividendo * 100),
      },
      patrimonio: {
        atual: carteira.patrimonio,
        depoisOperacao: patrimonioDepoisOperacao,
        liquidadoNoCenario: patrimonioLiquidado,
        impactoOperacao: round2(patrimonioDepoisOperacao - carteira.patrimonio),
        impactoTotal: round2(patrimonioLiquidado - carteira.patrimonio),
        concentracaoAntes: carteira.valorPosicoes > 0
          ? round2((valorAtualClubeAntes / carteira.valorPosicoes) * 100)
          : 0,
        concentracaoDepois: valorPosicoesDepois > 0
          ? round2((valorAtualClubeDepois / valorPosicoesDepois) * 100)
          : 0,
      },
      comparativoPosicoes,
      avisos: [
        'Cenário hipotético. Não representa previsão, probabilidade ou promessa de resultado.',
        'O dividendo só é incluído se a quantidade indicada permanecer elegível durante as 4 rodadas exigidas.',
        'A simulação não envia ordens e não altera saldo, carteira ou posições.',
      ],
    });
  } catch (err) {
    console.error('Erro na simulação individual:', err);
    return res.status(500).json({ erro: 'Erro interno ao calcular o cenário.' });
  }
});

router.post('/carteira', auth, async (req, res) => {
  try {
    const usuario = await User.findById(req.usuario.id).lean();
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    if (!exigirPremium(usuario, res)) return;

    const clubes = await Club.find({}).lean();
    const mapa = new Map(clubes.map((clube) => [Number(clube.legacyId), clube]));
    const carteira = carteiraAtual(usuario, clubes);
    const entradas = Array.isArray(req.body.cenarios) ? req.body.cenarios : [];
    const posicoesInformadas = new Map(
      entradas.map((item) => [Number(item.clubeId), Number(item.posicaoFinal)])
    );
    const resultados = carteira.posicoes.map((ativo) => {
      const clube = mapa.get(ativo.clubeId);
      const posicaoFinal = posicoesInformadas.get(ativo.clubeId) || ativo.posicaoAtual || 20;
      if (!Number.isInteger(posicaoFinal) || posicaoFinal < 1 || posicaoFinal > 20) {
        const erro = new Error(`Posição inválida para ${ativo.nome}.`);
        erro.status = 400;
        throw erro;
      }
      const unitario = precoLiquidacao(clube, posicaoFinal);
      const valorLiquidacao = round2(ativo.quantidade * unitario);
      return {
        clubeId: ativo.clubeId,
        nome: ativo.nome,
        escudo: ativo.escudo,
        quantidade: ativo.quantidade,
        posicaoFinal,
        precoAtual: ativo.precoAtual,
        valorAtual: ativo.valorAtual,
        precoLiquidacao: unitario,
        valorLiquidacao,
        impacto: round2(valorLiquidacao - ativo.valorAtual),
      };
    });
    const valorLiquidado = round2(resultados.reduce((soma, item) => soma + item.valorLiquidacao, 0));
    const patrimonioLiquidado = round2(carteira.saldo + valorLiquidado);
    return res.json({
      tipo: 'carteira',
      hipotetico: true,
      resumo: {
        patrimonioAtual: carteira.patrimonio,
        saldoMantido: carteira.saldo,
        valorAtualPosicoes: carteira.valorPosicoes,
        valorLiquidado,
        patrimonioLiquidado,
        impactoTotal: round2(patrimonioLiquidado - carteira.patrimonio),
      },
      posicoes: resultados,
      avisos: [
        'Cenário hipotético, sem estimativa de probabilidade e sem promessa de resultado.',
        'Dividendos não são incluídos na simulação consolidada da carteira.',
        'Nenhum dado da conta foi alterado.',
      ],
    });
  } catch (err) {
    console.error('Erro na simulação da carteira:', err);
    return res.status(err.status || 500).json({
      erro: err.status ? err.message : 'Erro interno ao calcular a carteira.',
    });
  }
});

module.exports = router;
