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
    const usuario = await User.findById(req.usuario.id).lean();
    if (!usuario) {
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }

    const saldoAtual = Number(usuario?.saldo || 0);
    const { from, to, tipos } = req.query;

    let tiposFiltro = null;
    if (tipos && String(tipos).trim()) {
      tiposFiltro = String(tipos)
        .split(',')
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean);
    }

    const fromDate = from ? new Date(`${from}T00:00:00.000Z`) : null;
    const toDate = to ? new Date(`${to}T23:59:59.999Z`) : null;

    let movimentos = await Investment.find({
      $or: [
        { usuarioId: req.usuario.id },
        { usuarioLegacyId: usuario.legacyId ?? null },
      ],
    })
      .sort({ data: 1 })
      .lean();

    movimentos = movimentos
      .map((i) => {
        const unit =
          i.precoUnitario != null
            ? Number(i.precoUnitario)
            : i.valorUnitario != null
            ? Number(i.valorUnitario)
            : 0;

        const total =
          i.totalPago != null
            ? Number(i.totalPago)
            : i.quantidade != null
            ? Number(i.quantidade) * Number(unit)
            : 0;

        const tipo = (i.tipo || 'OPERACAO').toUpperCase();

        return {
          tipo,
          clubeId: i.clubeLegacyId ?? null,
          clubeNome: i.clubeNome || '',
          quantidade: Number(i.quantidade || 0),
          valor: Number(total || 0),
          valorUnitario: unit,
          data: i.data ? new Date(i.data) : new Date(0),
        };
      })
      .filter((m) => {
        if (fromDate && m.data < fromDate) return false;
        if (toDate && m.data > toDate) return false;
        if (tiposFiltro && !tiposFiltro.includes(m.tipo)) return false;
        return true;
      });

    function calcularDelta(m) {
      const t = m.tipo;

      if (t === 'DEPOSITO') return +m.valor;
      if (t === 'VENDA') return +m.valor;
      if (t === 'LIQUIDACAO' || t === 'LIQUIDAÇÃO') return +m.valor;
      if (t === 'DIVIDENDO' || t === 'DIVIDENDOS') return +m.valor;

      if (t === 'SAQUE') return -m.valor;

      if (t.includes('COMPRA')) return -m.valor;
      if (t === 'IPO') return -m.valor;

      return 0;
    }

    function descricaoMov(m) {
      const nome = m.clubeNome ? ` - ${m.clubeNome}` : '';
      const qtd = m.quantidade
        ? ` (${m.quantidade} cota${m.quantidade > 1 ? 's' : ''})`
        : '';

      if (m.tipo === 'DEPOSITO') return 'Depósito';
      if (m.tipo === 'SAQUE') return 'Saque';
      if (m.tipo.includes('COMPRA') || m.tipo === 'IPO') return `Compra${nome}${qtd}`;
      if (m.tipo === 'VENDA') return `Venda${nome}${qtd}`;
      if (m.tipo.startsWith('LIQ')) return `Liquidação${nome}${qtd}`;
      if (m.tipo.startsWith('DIV')) return `Dividendos${nome}`;
      if (m.tipo === 'AJUSTE') return 'Ajuste de saldo (sincronização)';
      return `${m.tipo}${nome}${qtd}`;
    }

    let saldo = 0;
    const linhas = movimentos.map((m) => {
      const delta = calcularDelta(m);
      saldo = Number((saldo + delta).toFixed(2));

      return {
        data: m.data.toISOString(),
        tipo: m.tipo,
        descricao: descricaoMov(m),
        valor: Number(Math.abs(delta).toFixed(2)),
        direcao: delta >= 0 ? 'C' : 'D',
        saldoApos: saldo,
      };
    });

    const saldoCalcFinal = saldo;
    const diff = Number((saldoAtual - saldoCalcFinal).toFixed(2));

    if (Math.abs(diff) >= 0.01) {
      const dataAjuste =
        linhas.length > 0 ? linhas[0].data : new Date().toISOString();

      const linhasComAjuste = [
        {
          data: dataAjuste,
          tipo: 'AJUSTE',
          descricao: 'Ajuste de saldo (sincronização)',
          valor: Math.abs(diff),
          direcao: diff >= 0 ? 'C' : 'D',
          saldoApos: 0,
        },
        ...linhas,
      ];

      let s = 0;
      const recalculado = linhasComAjuste.map((l) => {
        const delta = l.direcao === 'C' ? l.valor : -l.valor;
        s = Number((s + delta).toFixed(2));
        return { ...l, saldoApos: s };
      });

      return res.json({
        saldoAtual,
        saldoCalculadoFinal: Number(s.toFixed(2)),
        itens: recalculado.sort((a, b) => new Date(b.data) - new Date(a.data)),
      });
    }

    return res.json({
      saldoAtual,
      saldoCalculadoFinal: Number(saldoCalcFinal.toFixed(2)),
      itens: linhas.sort((a, b) => new Date(b.data) - new Date(a.data)),
    });
  } catch (err) {
    console.error('Erro ao gerar extrato:', err);
    return res.status(500).json({ erro: 'Erro ao gerar extrato.' });
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