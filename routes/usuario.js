const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Dividendo = require('../models/dividendos');
const Liquidacao = require('../models/Liquidacao');
const User = require('../models/User');
const Investment = require('../models/Investment');
const Club = require('../models/Club');
const jwt = require('jsonwebtoken');
const Order = require('../models/Order');
const antifraude = require('../utils/antifraude');
const {
  obterResumoDoPlano,
  obterPlanoEfetivo,
} = require('../utils/planFeatures');

async function obterAntifraudeState() {
  if (typeof antifraude.getStateSnapshot === 'function') {
    return antifraude.getStateSnapshot();
  }
  if (typeof antifraude.loadState === 'function') {
    return antifraude.loadState();
  }
  return { users: {}, ips: {}, clubes: {} };
}

async function obterAntifraudeLogs(limit = 200) {
  if (typeof antifraude.getLogs === 'function') {
    return antifraude.getLogs({ limit });
  }
  if (typeof antifraude.listLogs === 'function') {
    return antifraude.listLogs({ limit });
  }
  if (typeof antifraude.getRecentLogs === 'function') {
    return antifraude.getRecentLogs(limit);
  }
  return [];
}

router.get('/atual', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(200).json(null);
    }

    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      return res.status(200).json(null);
    }

    const JWT_SECRET = process.env.JWT_SECRET;
    const decoded = jwt.verify(token, JWT_SECRET);

    const usuario = await User.findById(decoded.id).lean();

    if (!usuario) {
      return res.status(200).json({ usuario: null });
    }

    return res.json(usuario);
  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      console.warn('Token JWT inválido:', err.message);
      return res.status(200).json(null);
    }

    console.error('Erro ao buscar usuário atual:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor' });
  }
});

router.get('/', auth, async (req, res) => {
  try {
    const usuario = await User.findById(req.usuario.id).lean();
    if (!usuario) {
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }
    res.json(usuario);
  } catch (err) {
    console.error('Erro ao obter usuário:', err);
    res.status(500).json({ erro: 'Erro interno ao obter usuário.' });
  }
});

router.get('/plano', auth, async (req, res) => {
  try {
    const usuario = await User.findById(
      req.usuario.id
    )
      .select(
        [
          '_id',
          'plano',
          'premiumAtivo',
          'premiumInicio',
          'premiumFim',
        ].join(' ')
      )
      .lean();

    if (!usuario) {
      return res.status(404).json({
        erro: 'Usuário não encontrado.',
      });
    }

    const resumoPlano =
      obterResumoDoPlano(usuario);

    return res.json(resumoPlano);
  } catch (err) {
    console.error(
      'Erro ao obter plano do usuário:',
      err
    );

    return res.status(500).json({
      erro:
        'Erro interno ao obter plano do usuário.',
    });
  }
});

// Ranking geral, Lite e Premium do mercado simulado
router.get('/ranking', auth, async (req, res) => {
  try {
    const page = Math.max(
      1,
      Number.parseInt(req.query.page, 10) || 1
    );

    const limit = Math.min(
      100,
      Math.max(
        1,
        Number.parseInt(req.query.limit, 10) || 100
      )
    );

    const categoriasPermitidas = [
      'geral',
      'lite',
      'premium',
    ];

    const categoriaSolicitada = String(
      req.query.categoria || 'geral'
    )
      .trim()
      .toLowerCase();

    if (
      !categoriasPermitidas.includes(
        categoriaSolicitada
      )
    ) {
      return res.status(400).json({
        erro: 'Categoria de ranking inválida.',
        categoriasPermitidas,
      });
    }

    const [usuarios, clubes] = await Promise.all([
      User.find({
        rankingAtivo: { $ne: false },
      })
        .select(
          [
            '_id',
            'nome',
            'nomeUsuario',
            'saldo',
            'capitalInicial',
            'carteira',
            'createdAt',
            'temporadaRanking',
            'patrimonioInicialTemporada',
            'saldoInicialTemporada',
            'inicioTemporadaRanking',
            'rankingAtivo',
            'plano',
            'premiumAtivo',
            'premiumInicio',
            'premiumFim',
          ].join(' ')
        )
        .lean(),

      Club.find({})
        .select(
          'legacyId precoAtual preco'
        )
        .lean(),
    ]);

    const precosPorClube = new Map(
      clubes.map((clube) => [
        String(clube.legacyId),
        Number(
          clube.precoAtual ??
            clube.preco ??
            0
        ),
      ])
    );

    function calcularDadosRanking(usuario) {
      const saldo = Number(
        usuario.saldo || 0
      );

      const carteira = Array.isArray(
        usuario.carteira
      )
        ? usuario.carteira
        : [];

      let valorPosicoes = 0;
      let quantidadeUnidades = 0;
      let quantidadePosicoes = 0;

      for (const ativo of carteira) {
        const clubeId = Number(
          ativo.clubeId ??
            ativo.clubeLegacyId ??
            ativo.idClube ??
            ativo.clube?.id ??
            ativo.clube?.legacyId
        );

        const quantidade = Number(
          ativo.quantidade ??
            ativo.cotas ??
            0
        );

        if (
          !Number.isFinite(clubeId) ||
          clubeId <= 0 ||
          !Number.isFinite(quantidade) ||
          quantidade <= 0
        ) {
          continue;
        }

        const precoAtualDoClube =
          precosPorClube.get(
            String(clubeId)
          );

        const precoAtual =
          Number.isFinite(
            precoAtualDoClube
          )
            ? precoAtualDoClube
            : Number(
                ativo.precoMedio ??
                  ativo.valorUnitario ??
                  0
              );

        valorPosicoes +=
          quantidade * precoAtual;

        quantidadeUnidades +=
          quantidade;

        quantidadePosicoes += 1;
      }

      valorPosicoes = Number(
        valorPosicoes.toFixed(2)
      );

      const patrimonio = Number(
        (
          saldo +
          valorPosicoes
        ).toFixed(2)
      );

      const patrimonioInicialTemporadaRaw =
        Number(
          usuario
            .patrimonioInicialTemporada
        );

      const temporadaInicializada =
        Boolean(
          usuario.temporadaRanking
        ) &&
        Number.isFinite(
          patrimonioInicialTemporadaRaw
        ) &&
        patrimonioInicialTemporadaRaw > 0;

      const patrimonioInicialTemporada =
        temporadaInicializada
          ? patrimonioInicialTemporadaRaw
          : Number(
              usuario.capitalInicial ??
                1000
            );

      const resultado = Number(
        (
          patrimonio -
          patrimonioInicialTemporada
        ).toFixed(2)
      );

      const rentabilidade =
        patrimonioInicialTemporada > 0
          ? Number(
              (
                (
                  resultado /
                  patrimonioInicialTemporada
                ) * 100
              ).toFixed(2)
            )
          : 0;

      const planoEfetivo =
        obterPlanoEfetivo(usuario);

      return {
        usuarioId:
          String(usuario._id),

        nome:
          usuario.nome || '',

        nomeUsuario:
          usuario.nomeUsuario || '',

        plano:
          planoEfetivo,

        planoCadastrado:
          usuario.plano || 'lite',

        premiumAtivo:
          planoEfetivo === 'premium',

        temporadaRanking:
          usuario.temporadaRanking ||
          null,

        temporadaInicializada,

        capitalInicial: Number(
          Number(
            usuario.capitalInicial ??
              1000
          ).toFixed(2)
        ),

        saldoInicialTemporada:
          usuario
            .saldoInicialTemporada !=
          null
            ? Number(
                Number(
                  usuario
                    .saldoInicialTemporada
                ).toFixed(2)
              )
            : null,

        patrimonioInicialTemporada:
          Number(
            patrimonioInicialTemporada.toFixed(
              2
            )
          ),

        inicioTemporadaRanking:
          usuario
            .inicioTemporadaRanking ||
          null,

        saldo:
          Number(saldo.toFixed(2)),

        valorPosicoes,

        patrimonio,

        resultado,

        rentabilidade,

        quantidadePosicoes,

        quantidadeUnidades: Number(
          quantidadeUnidades.toFixed(4)
        ),

        criadoEm:
          usuario.createdAt || null,
      };
    }

    function ordenarRanking(a, b) {
      if (
        b.rentabilidade !==
        a.rentabilidade
      ) {
        return (
          b.rentabilidade -
          a.rentabilidade
        );
      }

      if (
        b.resultado !==
        a.resultado
      ) {
        return (
          b.resultado -
          a.resultado
        );
      }

      if (
        b.patrimonio !==
        a.patrimonio
      ) {
        return (
          b.patrimonio -
          a.patrimonio
        );
      }

      return String(
        a.nomeUsuario
      ).localeCompare(
        String(b.nomeUsuario),
        'pt-BR'
      );
    }

    const rankingBase = usuarios
      .map(calcularDadosRanking)
      .sort(ordenarRanking);

    const rankingGeral =
      rankingBase.map(
        (item, index) => ({
          ...item,
          posicaoGeral:
            index + 1,
        })
      );

    const rankingLite =
      rankingGeral
        .filter(
          (item) =>
            item.plano === 'lite'
        )
        .map(
          (item, index) => ({
            ...item,
            posicaoPlano:
              index + 1,
          })
        );

    const rankingPremium =
      rankingGeral
        .filter(
          (item) =>
            item.plano === 'premium'
        )
        .map(
          (item, index) => ({
            ...item,
            posicaoPlano:
              index + 1,
          })
        );

    const posicaoPlanoPorUsuario =
      new Map();

    for (const item of [
      ...rankingLite,
      ...rankingPremium,
    ]) {
      posicaoPlanoPorUsuario.set(
        item.usuarioId,
        item.posicaoPlano
      );
    }

    const rankingGeralCompleto =
      rankingGeral.map(
        (item) => ({
          ...item,

          posicao:
            item.posicaoGeral,

          posicaoPlano:
            posicaoPlanoPorUsuario.get(
              item.usuarioId
            ) || null,
        })
      );

    const rankingLiteCompleto =
      rankingLite.map(
        (item) => ({
          ...item,

          posicao:
            item.posicaoPlano,
        })
      );

    const rankingPremiumCompleto =
      rankingPremium.map(
        (item) => ({
          ...item,

          posicao:
            item.posicaoPlano,
        })
      );

    let rankingSelecionado =
      rankingGeralCompleto;

    if (
      categoriaSolicitada === 'lite'
    ) {
      rankingSelecionado =
        rankingLiteCompleto;
    }

    if (
      categoriaSolicitada ===
      'premium'
    ) {
      rankingSelecionado =
        rankingPremiumCompleto;
    }

    const usuarioAtualGeral =
      rankingGeralCompleto.find(
        (item) =>
          item.usuarioId ===
          String(req.usuario.id)
      ) || null;

    const usuarioAtualCategoria =
      rankingSelecionado.find(
        (item) =>
          item.usuarioId ===
          String(req.usuario.id)
      ) || null;

    const planoUsuarioAtual =
      usuarioAtualGeral?.plano ||
      'lite';

    const rankingDoPlanoAtual =
      planoUsuarioAtual === 'premium'
        ? rankingPremiumCompleto
        : rankingLiteCompleto;

    const usuarioAtualNoPlano =
      rankingDoPlanoAtual.find(
        (item) =>
          item.usuarioId ===
          String(req.usuario.id)
      ) || null;

    const totalUsuarios =
      rankingSelecionado.length;

    const totalPages = Math.max(
      1,
      Math.ceil(
        totalUsuarios / limit
      )
    );

    const pageNormalizada =
      Math.min(page, totalPages);

    const inicio =
      (pageNormalizada - 1) *
      limit;

    const fim =
      inicio + limit;

    const temporadasAtivas = [
      ...new Set(
        rankingBase
          .map(
            (item) =>
              item.temporadaRanking
          )
          .filter(Boolean)
      ),
    ];

    return res.json({
      moeda: 'T$',

      criterio:
        'RENTABILIDADE_TEMPORADA',

      capitalInicialPadrao: 1000,

      categoria:
        categoriaSolicitada,

      categoriasPermitidas,

      temporadasAtivas,

      page:
        pageNormalizada,

      limit,

      totalPages,

      totalUsuarios,

      totaisPorCategoria: {
        geral:
          rankingGeralCompleto.length,

        lite:
          rankingLiteCompleto.length,

        premium:
          rankingPremiumCompleto.length,
      },

      usuarioAtual: usuarioAtualGeral
        ? {
            ...usuarioAtualGeral,

            posicaoGeral:
              usuarioAtualGeral
                .posicaoGeral,

            posicaoNoPlano:
              usuarioAtualNoPlano
                ?.posicaoPlano ||
              null,

            categoriaSolicitada,

            apareceNaCategoria:
              Boolean(
                usuarioAtualCategoria
              ),
          }
        : null,

      ranking:
        rankingSelecionado.slice(
          inicio,
          fim
        ),
    });
  } catch (err) {
    console.error(
      'Erro ao gerar ranking de usuários:',
      err
    );

    return res.status(500).json({
      erro:
        'Erro interno ao gerar ranking de usuários.',
    });
  }
});

router.get('/dividendos', auth, async (req, res) => {
  try {
    const usuario = await User.findById(req.usuario.id).lean();
    if (!usuario) {
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }

    const dividendos = await Dividendo.find({
      $or: [
        { usuarioId: req.usuario.id },
        { usuarioId: usuario.legacyId ?? null },
      ],
    })
      .populate('clubeId', 'nome')
      .sort({ data: -1 });

    res.json(dividendos);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar dividendos.' });
  }
});

router.get('/historico', auth, async (req, res) => {
  try {
    const usuario = await User.findById(req.usuario.id).lean();
    if (!usuario) {
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }

    const inv = await Investment.find({
      $or: [
        { usuarioId: req.usuario.id },
        { usuarioLegacyId: usuario.legacyId ?? null },
      ],
    })
      .sort({ data: -1 })
      .lean();

    const formatado = inv.map((i) => {
      const unit =
        i.precoUnitario != null
          ? i.precoUnitario
          : i.valorUnitario != null
          ? i.valorUnitario
          : 0;

      const total =
        i.totalPago != null
          ? i.totalPago
          : i.quantidade != null
          ? Number(i.quantidade) * Number(unit)
          : 0;

      return {
        tipo: i.tipo || 'OPERACAO',
        clubeNome: i.clubeNome || '',
        clubeId: i.clubeLegacyId ?? null,
        quantidade: i.quantidade,
        valorUnitario: unit,
        totalPago: total,
        data: i.data,
      };
    });

    res.json(formatado);
  } catch (err) {
    console.error('Erro ao buscar histórico:', err);
    res.status(500).json({ erro: 'Erro ao buscar histórico' });
  }
});

router.get('/carteira', auth, async (req, res) => {
  try {
    const usuario = await User.findById(req.usuario.id).lean();

    if (!usuario) {
      return res.status(404).json({ erro: 'Usuário não encontrado' });
    }

    const clubesData = await Club.find({}).lean();

    const clubesPorLegacyId = new Map(
      clubesData.map((c) => [String(c.legacyId), c])
    );

    const carteiraMap = new Map();

    // 1. Primeiro usa a carteira salva no usuário
    const carteiraUsuario = Array.isArray(usuario.carteira)
      ? usuario.carteira
      : [];

    for (const ativo of carteiraUsuario) {
      const clubeId = Number(
        ativo.clubeId ??
          ativo.clubeLegacyId ??
          ativo.idClube ??
          ativo.clube?.id ??
          ativo.clube?.legacyId
      );

      if (!Number.isFinite(clubeId) || clubeId <= 0) continue;

      const quantidade = Number(ativo.quantidade ?? ativo.cotas ?? 0);
      if (!Number.isFinite(quantidade) || quantidade <= 0) continue;

      const precoMedio = Number(ativo.precoMedio ?? ativo.valorUnitario ?? 0);
      const totalInvestido = Number(
        ativo.totalInvestido ?? quantidade * precoMedio
      );

      carteiraMap.set(String(clubeId), {
        clubeId,
        nomeClube: ativo.nomeClube || ativo.clubeNome || ativo.nome || '',
        quantidade,
        precoMedio,
        totalInvestido,
      });
    }

    // 2. Depois reconstrói/valida com base no histórico de investimentos
    const movimentos = await Investment.find({
      $or: [
        { usuarioId: req.usuario.id },
        { usuarioLegacyId: usuario.legacyId ?? null },
      ],
    })
      .sort({ data: 1, createdAt: 1 })
      .lean();

    for (const mov of movimentos) {
      const tipo = String(mov.tipo || '').toUpperCase();

      const clubeId = Number(
        mov.clubeLegacyId ??
          mov.clubeId?.legacyId ??
          mov.clubeId ??
          mov.clube?.id
      );

      if (!Number.isFinite(clubeId) || clubeId <= 0) continue;

      const quantidade = Number(mov.quantidade || 0);
      if (!Number.isFinite(quantidade) || quantidade <= 0) continue;

      const precoUnitario = Number(
        mov.precoUnitario ?? mov.valorUnitario ?? 0
      );

      const total = Number(
        mov.totalPago ?? quantidade * precoUnitario
      );

      const atual =
        carteiraMap.get(String(clubeId)) || {
          clubeId,
          nomeClube: mov.clubeNome || '',
          quantidade: 0,
          precoMedio: 0,
          totalInvestido: 0,
        };

      if (
        tipo === 'IPO' ||
        tipo === 'COMPRA' ||
        tipo === 'COMPRA_SECUNDARIO'
      ) {
        const novaQtd = Number(atual.quantidade || 0) + quantidade;
        const novoTotal =
          Number(atual.totalInvestido || 0) + Number(total || 0);

        carteiraMap.set(String(clubeId), {
          ...atual,
          nomeClube: atual.nomeClube || mov.clubeNome || '',
          quantidade: novaQtd,
          totalInvestido: Number(novoTotal.toFixed(2)),
          precoMedio:
            novaQtd > 0 ? Number((novoTotal / novaQtd).toFixed(2)) : 0,
        });
      }

      if (
        tipo === 'VENDA' ||
        tipo === 'LIQUIDACAO' ||
        tipo === 'LIQUIDAÇÃO'
      ) {
        const qtdAtual = Number(atual.quantidade || 0);
        const novaQtd = Math.max(0, qtdAtual - quantidade);

        if (novaQtd <= 0) {
          carteiraMap.delete(String(clubeId));
        } else {
          const precoMedioAtual = Number(atual.precoMedio || 0);
          carteiraMap.set(String(clubeId), {
            ...atual,
            quantidade: novaQtd,
            totalInvestido: Number((novaQtd * precoMedioAtual).toFixed(2)),
            precoMedio: precoMedioAtual,
          });
        }
      }
    }

    const carteiraDetalhada = Array.from(carteiraMap.values())
      .filter((ativo) => Number(ativo.quantidade || 0) > 0)
      .map((ativo) => {
        const clube = clubesPorLegacyId.get(String(ativo.clubeId));

        const precoAtual = Number(
          clube?.precoAtual ?? clube?.preco ?? ativo.precoMedio ?? 0
        );

        const valorAtual = Number(
          (Number(ativo.quantidade || 0) * precoAtual).toFixed(2)
        );

        return {
          ...ativo,
          nome: clube?.nome || ativo.nomeClube || 'Desconhecido',
          nomeClube: clube?.nome || ativo.nomeClube || 'Desconhecido',
          escudo: clube?.escudo || '',
          precoAtual,
          valorAtual,
        };
      });

    // 3. Sincroniza user.carteira com a carteira reconstruída
    await User.findByIdAndUpdate(req.usuario.id, {
      $set: {
        carteira: carteiraDetalhada.map((a) => ({
          clubeId: Number(a.clubeId),
          nomeClube: a.nomeClube || a.nome,
          quantidade: Number(a.quantidade || 0),
          precoMedio: Number(a.precoMedio || 0),
          totalInvestido: Number(a.totalInvestido || 0),
        })),
      },
    });

    return res.json(carteiraDetalhada);
  } catch (err) {
    console.error('Erro ao buscar carteira:', err);
    return res.status(500).json({ erro: 'Erro interno ao buscar carteira' });
  }
});

router.get('/saldo', auth, async (req, res) => {
  try {
    const usuario = await User.findById(req.usuario.id).lean();
    if (!usuario) {
      return res.status(404).json({ erro: 'Usuário não encontrado' });
    }

    const saldo = Number(usuario.saldo || 0);
    return res.json({ saldo });
  } catch (err) {
    console.error('Erro ao buscar saldo do usuário:', err);
    return res.status(500).json({ erro: 'Erro interno ao buscar saldo' });
  }
});

router.post('/deposito', auth, async (req, res) => {
  try {
    const valor = Number(req.body.valor);

    if (!Number.isFinite(valor) || valor <= 0) {
      return res.status(400).json({ erro: 'Valor de depósito inválido.' });
    }

    const usuario = await User.findById(req.usuario.id);
    if (!usuario) {
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }

    const saldoAtual = Number(usuario.saldo || 0);
    const novoSaldo = Number((saldoAtual + valor).toFixed(2));

    usuario.saldo = novoSaldo;
    await usuario.save();

    await Investment.create({
      usuarioId: usuario._id,
      usuarioLegacyId: usuario.legacyId ?? null,
      clubeId: null,
      clubeLegacyId: null,
      clubeNome: '',
      quantidade: 0,
      precoUnitario: valor,
      valorUnitario: valor,
      totalPago: valor,
      tipo: 'DEPOSITO',
      data: new Date(),
    });

    return res.json({
      usuario: {
        id: String(usuario._id),
        legacyId: usuario.legacyId ?? null,
        nomeUsuario: usuario.nomeUsuario,
        saldo: usuario.saldo,
      },
    });
  } catch (err) {
    console.error('Erro ao processar depósito:', err);
    return res.status(500).json({ erro: 'Erro interno ao processar depósito.' });
  }
});

router.post('/saque', auth, async (req, res) => {
  try {
    const valor = Number(req.body.valor);

    if (!Number.isFinite(valor) || valor <= 0) {
      return res.status(400).json({ erro: 'Valor de saque inválido.' });
    }

    const usuario = await User.findById(req.usuario.id);
    if (!usuario) {
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }

    const saldoAtual = Number(usuario.saldo || 0);

    if (valor > saldoAtual) {
      return res
        .status(400)
        .json({ erro: 'Saldo insuficiente para realizar o saque.' });
    }

    const novoSaldo = Number((saldoAtual - valor).toFixed(2));
    usuario.saldo = novoSaldo;
    await usuario.save();

    await Investment.create({
      usuarioId: usuario._id,
      usuarioLegacyId: usuario.legacyId ?? null,
      clubeId: null,
      clubeLegacyId: null,
      clubeNome: '',
      quantidade: 0,
      precoUnitario: valor,
      valorUnitario: valor,
      totalPago: valor,
      tipo: 'SAQUE',
      data: new Date(),
    });

    return res.json({
      usuario: {
        id: String(usuario._id),
        legacyId: usuario.legacyId ?? null,
        nomeUsuario: usuario.nomeUsuario,
        saldo: usuario.saldo,
      },
    });
  } catch (err) {
    console.error('Erro ao processar saque:', err);
    return res.status(500).json({ erro: 'Erro interno ao processar saque.' });
  }
});

router.get('/extrato', auth, async (req, res) => {
  try {
    const usuario = await User.findById(
      req.usuario.id
    ).lean();

    if (!usuario) {
      return res.status(404).json({
        erro: 'Usuário não encontrado.',
      });
    }

    const saldoAtual = Number(
      usuario.saldo || 0
    );

    const saldoInicial = Number(
      usuario.capitalInicial ?? 1000
    );

    const {
      from,
      to,
      tipos,
    } = req.query;

    const tiposFiltro =
      tipos && String(tipos).trim()
        ? String(tipos)
            .split(',')
            .map((tipo) =>
              String(tipo)
                .trim()
                .toUpperCase()
            )
            .filter(Boolean)
        : null;

    const fromDate = from
      ? new Date(
          `${from}T00:00:00.000-03:00`
        )
      : null;

    const toDate = to
      ? new Date(
          `${to}T23:59:59.999-03:00`
        )
      : null;

    /*
     * Nunca consultar usuarioLegacyId null.
     * Isso poderia incluir registros pertencentes
     * a outros usuários sem legacyId.
     */
    const criteriosUsuario = [
      {
        usuarioId: req.usuario.id,
      },
    ];

    if (
      usuario.legacyId !== null &&
      usuario.legacyId !== undefined
    ) {
      criteriosUsuario.push({
        usuarioLegacyId:
          usuario.legacyId,
      });
    }

    const investments =
      await Investment.find({
        $or: criteriosUsuario,
      })
        .sort({
          data: 1,
          createdAt: 1,
        })
        .lean();

    function normalizarTipo(tipoOriginal) {
      const tipo = String(
        tipoOriginal || 'OPERACAO'
      )
        .trim()
        .toUpperCase();

      if (
        tipo === 'COMPRA_SECUNDARIO' ||
        tipo.includes('COMPRA')
      ) {
        return 'COMPRA';
      }

      if (
        tipo === 'DIVIDENDOS'
      ) {
        return 'DIVIDENDO';
      }

      if (
        tipo === 'LIQUIDAÇÃO'
      ) {
        return 'LIQUIDACAO';
      }

      return tipo;
    }

    function calcularDelta(movimento) {
      const tipo = movimento.tipo;
      const valor = Number(
        movimento.valor || 0
      );

      if (
        [
          'DEPOSITO',
          'VENDA',
          'LIQUIDACAO',
          'DIVIDENDO',
        ].includes(tipo)
      ) {
        return Math.abs(valor);
      }

      if (
        [
          'SAQUE',
          'COMPRA',
          'IPO',
        ].includes(tipo)
      ) {
        return -Math.abs(valor);
      }

      if (tipo === 'AJUSTE') {
        const direcao = String(
          movimento.metadata?.direcao ||
            movimento.metadata?.direction ||
            ''
        ).toUpperCase();

        if (
          direcao === 'D' ||
          direcao === 'DEBITO'
        ) {
          return -Math.abs(valor);
        }

        if (
          direcao === 'C' ||
          direcao === 'CREDITO'
        ) {
          return Math.abs(valor);
        }

        return Number(valor);
      }

      return 0;
    }

    function descricaoMovimento(movimento) {
      const nomeClube =
        movimento.clubeNome
          ? ` — ${movimento.clubeNome}`
          : '';

      const quantidade =
        movimento.quantidade > 0
          ? `${movimento.quantidade} ${
              movimento.quantidade === 1
                ? 'cota'
                : 'cotas'
            }`
          : '';

      if (
        movimento.tipo ===
        'DEPOSITO'
      ) {
        return 'Depósito de saldo fictício';
      }

      if (
        movimento.tipo ===
        'SAQUE'
      ) {
        return 'Retirada de saldo fictício';
      }

      if (
        movimento.tipo ===
        'COMPRA'
      ) {
        return `Compra de ${quantidade}${nomeClube}`;
      }

      if (
        movimento.tipo ===
        'IPO'
      ) {
        return `Compra no IPO de ${quantidade}${nomeClube}`;
      }

      if (
        movimento.tipo ===
        'VENDA'
      ) {
        return `Venda de ${quantidade}${nomeClube}`;
      }

      if (
        movimento.tipo ===
        'LIQUIDACAO'
      ) {
        return `Liquidação${nomeClube}`;
      }

      if (
        movimento.tipo ===
        'DIVIDENDO'
      ) {
        return `Dividendos${nomeClube}`;
      }

      if (
        movimento.tipo ===
        'AJUSTE'
      ) {
        return 'Ajuste administrativo de saldo';
      }

      return `${movimento.tipo}${nomeClube}`;
    }

    const movimentos =
      investments.map((investment) => {
        const tipo =
          normalizarTipo(
            investment.tipo
          );

        const quantidade = Number(
          investment.quantidade || 0
        );

        const precoUnitario = Number(
          investment.precoUnitario ??
            investment.valorUnitario ??
            0
        );

        const valorBruto = Number(
          (
            quantidade *
            precoUnitario
          ).toFixed(2)
        );

        const valor = Number(
          investment.totalPago ??
            valorBruto ??
            0
        );

        const taxa = Number(
          investment.metadata?.fee ??
            investment.metadata?.taxa ??
            0
        );

        const movimento = {
          id: String(
            investment._id
          ),

          tipo,

          tipoOriginal:
            investment.tipo,

          clubeId:
            investment.clubeLegacyId ??
            null,

          clubeNome:
            investment.clubeNome || '',

          quantidade,

          precoUnitario,

          valorBruto,

          valor,

          taxa,

          tipoTaxa:
            investment.metadata
              ?.feeType || null,

          orderId:
            investment.metadata
              ?.orderId || null,

          origem:
            investment.origem ||
            investment.metadata
              ?.mercado ||
            null,

          data:
            investment.data
              ? new Date(
                  investment.data
                )
              : new Date(0),

          metadata:
            investment.metadata || {},
        };

        movimento.delta =
          calcularDelta(movimento);

        movimento.descricao =
          descricaoMovimento(
            movimento
          );

        return movimento;
      });

    /*
     * O saldo é reconstruído desde o capital
     * inicial, e não mais a partir de zero.
     */
    let saldoCalculado =
      saldoInicial;

    const linhas = [
      {
        id: 'saldo-inicial',
        data:
          usuario.createdAt ||
          movimentos[0]?.data ||
          new Date(),

        tipo: 'SALDO_INICIAL',
        tipoOriginal:
          'SALDO_INICIAL',

        descricao:
          'Saldo fictício inicial',

        clubeId: null,
        clubeNome: '',
        quantidade: 0,
        precoUnitario: 0,
        valorBruto:
          saldoInicial,
        taxa: 0,
        tipoTaxa: null,
        orderId: null,
        origem: 'SISTEMA',
        valor:
          Math.abs(saldoInicial),
        direcao:
          saldoInicial >= 0
            ? 'C'
            : 'D',
        saldoApos:
          Number(
            saldoInicial.toFixed(2)
          ),
      },
    ];

    for (
      const movimento of
      movimentos
    ) {
      saldoCalculado = Number(
        (
          saldoCalculado +
          movimento.delta
        ).toFixed(2)
      );

      linhas.push({
        id: movimento.id,
        data:
          movimento.data.toISOString(),

        tipo:
          movimento.tipo,

        tipoOriginal:
          movimento.tipoOriginal,

        descricao:
          movimento.descricao,

        clubeId:
          movimento.clubeId,

        clubeNome:
          movimento.clubeNome,

        quantidade:
          movimento.quantidade,

        precoUnitario:
          movimento.precoUnitario,

        valorBruto:
          movimento.valorBruto,

        taxa:
          movimento.taxa,

        tipoTaxa:
          movimento.tipoTaxa,

        orderId:
          movimento.orderId,

        origem:
          movimento.origem,

        valor:
          Number(
            Math.abs(
              movimento.delta
            ).toFixed(2)
          ),

        direcao:
          movimento.delta >= 0
            ? 'C'
            : 'D',

        saldoApos:
          saldoCalculado,
      });
    }

    /*
     * Diferenças de dados legados permanecem
     * auditáveis como ajuste de reconciliação.
     */
    const diferenca = Number(
      (
        saldoAtual -
        saldoCalculado
      ).toFixed(2)
    );

    if (
      Math.abs(diferenca) >=
      0.01
    ) {
      saldoCalculado = Number(
        (
          saldoCalculado +
          diferenca
        ).toFixed(2)
      );

      linhas.push({
        id:
          'ajuste-reconciliacao',

        data:
          new Date().toISOString(),

        tipo: 'AJUSTE',
        tipoOriginal:
          'AJUSTE_RECONCILIACAO',

        descricao:
          'Ajuste de reconciliação de dados anteriores',

        clubeId: null,
        clubeNome: '',
        quantidade: 0,
        precoUnitario: 0,
        valorBruto:
          Math.abs(diferenca),
        taxa: 0,
        tipoTaxa: null,
        orderId: null,
        origem: 'SISTEMA',

        valor:
          Math.abs(diferenca),

        direcao:
          diferenca >= 0
            ? 'C'
            : 'D',

        saldoApos:
          saldoCalculado,
      });
    }

    /*
     * Filtros são aplicados somente depois do
     * cálculo. Assim, saldoApos continua correto
     * mesmo ao consultar apenas um período.
     */
    const itensFiltrados =
      linhas.filter((linha) => {
        const dataLinha =
          new Date(linha.data);

        if (
          fromDate &&
          dataLinha < fromDate
        ) {
          return false;
        }

        if (
          toDate &&
          dataLinha > toDate
        ) {
          return false;
        }

        if (
          tiposFiltro &&
          !tiposFiltro.includes(
            linha.tipo
          )
        ) {
          return false;
        }

        return true;
      });

    const totais = linhas.reduce(
      (acc, linha) => {
        if (
          linha.tipo ===
          'SALDO_INICIAL'
        ) {
          return acc;
        }

        const valor = Number(
          linha.valor || 0
        );

        if (
          linha.direcao ===
          'C'
        ) {
          acc.creditos += valor;
        } else {
          acc.debitos += valor;
        }

        acc.taxas += Number(
          linha.taxa || 0
        );

        return acc;
      },
      {
        creditos: 0,
        debitos: 0,
        taxas: 0,
      }
    );

    return res.json({
      saldoInicial:
        Number(
          saldoInicial.toFixed(2)
        ),

      saldoAtual:
        Number(
          saldoAtual.toFixed(2)
        ),

      saldoCalculadoFinal:
        Number(
          saldoCalculado.toFixed(2)
        ),

      reconciliado:
        Math.abs(
          saldoAtual -
            saldoCalculado
        ) < 0.01,

      resumo: {
        totalCreditos:
          Number(
            totais.creditos.toFixed(2)
          ),

        totalDebitos:
          Number(
            totais.debitos.toFixed(2)
          ),

        totalTaxas:
          Number(
            totais.taxas.toFixed(2)
          ),
      },

      itens:
        itensFiltrados.sort(
          (a, b) =>
            new Date(b.data) -
            new Date(a.data)
        ),
    });
  } catch (err) {
    console.error(
      'Erro ao gerar extrato:',
      err
    );

    return res.status(500).json({
      erro:
        'Erro ao gerar extrato.',
    });
  }
});

router.post('/aceites', auth, async (req, res) => {
  try {
    const { tipo, versao } = req.body || {};
    if (!tipo || !versao) {
      return res.status(400).json({ erro: 'tipo e versao são obrigatórios' });
    }

    const usuario = await User.findById(req.usuario.id);
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

    const nowIso = new Date().toISOString();
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.ip;
    const userAgent = req.headers['user-agent'] || '';

    if (!usuario.aceites) usuario.aceites = {};
    usuario.aceites[tipo] = {
      versao,
      aceitoEm: nowIso,
      ip,
      userAgent,
    };

    await usuario.save();
    return res.json({ ok: true, tipo, versao, aceitoEm: nowIso });
  } catch (err) {
    console.error('Erro ao registrar aceite:', err);
    return res.status(500).json({ erro: 'Erro ao registrar aceite' });
  }
});

router.get('/admin/antifraude/logs', auth, async (req, res) => {
  try {
    const usuario = req.usuario;

    if (!usuario || usuario.role !== 'admin') {
      return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
    }

    const limit = Math.min(Number(req.query.limit || 200), 1000);
    const logs = await obterAntifraudeLogs(limit);

    const recentes = (Array.isArray(logs) ? logs : [])
      .slice()
      .sort((a, b) => new Date(b.ts || b.createdAt || b.data || 0) - new Date(a.ts || a.createdAt || a.data || 0))
      .slice(0, limit);

    return res.json({ total: recentes.length, logs: recentes });
  } catch (err) {
    console.error('Erro ao buscar logs antifraude:', err);
    return res.status(500).json({ erro: 'Erro interno ao buscar logs antifraude.' });
  }
});

router.get('/admin/antifraude/state', auth, async (req, res) => {
  try {
    const usuario = req.usuario;
    if (!usuario || usuario.role !== 'admin') {
      return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
    }

    const state = await obterAntifraudeState();
    return res.json(state || { users: {}, ips: {}, clubes: {} });
  } catch (err) {
    console.error('Erro ao buscar antifraude state:', err);
    return res.status(500).json({ erro: 'Erro interno ao buscar antifraude state.' });
  }
});

router.post('/admin/freeze-user', auth, async (req, res) => {
  if (req.usuario.role !== 'admin') return res.status(403).json({ erro: 'Admin only' });
  const { userId, minutos = 10, motivo = 'freeze manual' } = req.body;
  const state = await obterAntifraudeState();
  antifraude.freezeUser(state, userId, Number(minutos) * 60_000, motivo);
  antifraude.logEvent({ userId: String(userId), action: 'ADMIN_FREEZE', decision: 'BLOCK', reason: motivo });
  res.json({ ok: true });
});

router.post('/admin/unfreeze-user', auth, async (req, res) => {
  if (req.usuario.role !== 'admin') return res.status(403).json({ erro: 'Admin only' });
  const { userId } = req.body;
  const state = await obterAntifraudeState();
  antifraude.unfreezeUser(state, userId);
  antifraude.logEvent({ userId: String(userId), action: 'ADMIN_UNFREEZE', decision: 'ALLOW' });
  res.json({ ok: true });
});

router.get('/admin/dashboard/antifraude', auth, async (req, res) => {
  try {
    const usuario = req.usuario;
    if (!usuario || usuario.role !== 'admin') {
      return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
    }

    const state = (await obterAntifraudeState()) || { users: {}, ips: {}, clubes: {} };

    const usersArr = Object.entries(state.users || {}).map(([userId, u]) => ({
      userId,
      score: Number(u.score || 0),
      cooldownUntil: Number(u.cooldownUntil || 0),
      frozenUntil: Number(u.frozenUntil || 0),
      last: u.last || {},
    }));

    usersArr.sort((a, b) => b.score - a.score);

    const frozenUsers = usersArr.filter((u) => u.frozenUntil > Date.now()).slice(0, 50);

    const clubesArr = Object.entries(state.clubes || {}).map(([clubeId, c]) => ({
      clubeId,
      frozenUntil: Number(c.frozenUntil || 0),
      last: c.last || {},
      trades5m: Array.isArray(c.stats?.trades) ? c.stats.trades.length : null,
      cancels10m: Array.isArray(c.stats?.cancels) ? c.stats.cancels.length : null,
    }));
    const frozenClubes = clubesArr.filter((c) => c.frozenUntil > Date.now());

    const logs = await obterAntifraudeLogs(500);
    const recent = (Array.isArray(logs) ? logs : [])
      .slice()
      .sort((a, b) => new Date(b.ts || b.createdAt || b.data || 0) - new Date(a.ts || a.createdAt || a.data || 0))
      .filter((l) =>
        [
          'CANCEL_RATIO_SIGNAL',
          'CLUBE_VOLUME_SPIKE',
          'ADMIN_FREEZE',
          'ADMIN_FREEZE_CLUBE',
          'WASH_TRADING_SIGNAL',
          'SPOOFING_SIGNAL',
          'SELF_TRADE_BLOCK',
        ].includes(String(l.action || ''))
      )
      .slice(0, 100);

    return res.json({
      topUsers: usersArr.slice(0, 20),
      frozenUsers,
      frozenClubes,
      recentSignals: recent,
    });
  } catch (err) {
    console.error('Erro dashboard antifraude:', err);
    return res.status(500).json({ erro: 'Erro interno ao montar dashboard antifraude.' });
  }
});

router.get('/admin/dashboard/mercado', auth, async (req, res) => {
  try {
    const usuario = req.usuario;
    if (!usuario || usuario.role !== 'admin') {
      return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
    }

    const agora = new Date();

    const clubesTravados = await Club.find({ travadoAte: { $gt: Date.now() } })
      .select('legacyId nome travadoAte precoAtual preco')
      .lean();

    const travados = clubesTravados.map((c) => ({
      clubeId: c.legacyId,
      nome: c.nome,
      travadoAte: c.travadoAte,
      precoAtual: c.precoAtual ?? c.preco ?? 0,
    }));

    const agrupadas = await Order.aggregate([
      {
        $match: {
          status: { $in: ['aberta', 'parcial'] },
          restante: { $gt: 0 },
        },
      },
      {
        $group: {
          _id: '$clubeLegacyId',
          ordensAbertas: { $sum: 1 },
        },
      },
      { $sort: { ordensAbertas: -1 } },
      { $limit: 20 },
    ]);

    const topClubesPorOrdens = agrupadas.map((item) => ({
      clubeId: item._id,
      ordensAbertas: item.ordensAbertas,
    }));

    return res.json({
      data: agora.toISOString(),
      travadosCircuitBreaker: travados,
      topClubesPorOrdens,
    });
  } catch (err) {
    console.error('Erro dashboard mercado:', err);
    return res.status(500).json({ erro: 'Erro interno ao montar dashboard mercado.' });
  }
});

module.exports = router;