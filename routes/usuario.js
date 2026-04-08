// routes/usuario.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Dividendo = require('../models/dividendos');
const Liquidacao = require('../models/Liquidacao');
const Usuario = require('../models/Usuario'); // ✅ Import necessário
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

// caminhos dos arquivos de dados
const invPath = path.join(__dirname, '../data/investimentos.json');
const usuariosPath = path.join(__dirname, '../data/usuarios.json');
const antifraudeLogsPath = path.join(__dirname, '../data/antifraude_logs.json');
const antifraudeStatePath = path.join(__dirname, '../data/antifraude_state.json');

function lerJSONSeguro(relPath, fallback = []) {
  try {
    const p = path.join(__dirname, '..', relPath);
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

// helpers específicos para usuários e investimentos
function lerUsuarios() {
  try {
    return JSON.parse(fs.readFileSync(usuariosPath, 'utf8') || '[]');
  } catch (e) {
    return [];
  }
}

function salvarUsuarios(lista) {
  fs.writeFileSync(usuariosPath, JSON.stringify(lista, null, 2));
}

function lerInvestimentos() {
  try {
    return JSON.parse(fs.readFileSync(invPath, 'utf8') || '[]');
  } catch (e) {
    return [];
  }
}

function salvarInvestimentos(lista) {
  fs.writeFileSync(invPath, JSON.stringify(lista, null, 2));
}

// ===================== ROTAS =====================

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

    const JWT_SECRET = process.env.JWT_SECRET; // ✅ Corrigido para vir do .env

    const decoded = jwt.verify(token, JWT_SECRET);
    const usuario = Usuario.buscarUsuarioPorId(decoded.id);

    if (!usuario) {
      return res.status(200).json({ usuario: null });
    }

    res.json(usuario);
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
    const usuario = req.usuario;
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
    const dividendos = await Dividendo.find({ usuarioId: req.usuario.id })
      .populate('clubeId', 'nome')
      .sort({ data: -1 });

    res.json(dividendos);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar dividendos.' });
  }
});

router.get('/historico', auth, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;

    const inv = JSON.parse(fs.readFileSync(invPath, 'utf-8') || '[]')
      .filter((i) => String(i.usuarioId) === String(usuarioId))
      .sort((a, b) => new Date(b.data) - new Date(a.data));

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
        clubeId: i.clubeId ?? null, // 🔹 incluímos o clubeId para cálculo de P/L realizado
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
    const usuario = await Usuario.buscarUsuarioPorId(req.usuario.id);
    if (!usuario) {
      return res.status(404).json({ erro: 'Usuário não encontrado' });
    }
    const clubesPath = path.join(__dirname, '..', 'data', 'clubes.json');
    const clubesData = JSON.parse(fs.readFileSync(clubesPath, 'utf8') || '[]');
    const carteiraUsuario = Array.isArray(usuario.carteira)
      ? usuario.carteira
      : [];
    const carteiraDetalhada = carteiraUsuario.map((ativo) => {
      const clube = clubesData.find((c) => c.id === ativo.clubeId);
      return {
        ...ativo,
        nome: clube?.nome || 'Desconhecido',
        escudo: clube?.escudo || '',
      };
    });

    res.json(carteiraDetalhada);
  } catch (err) {
    console.error('Erro ao buscar carteira:', err);
    res.status(500).json({ erro: 'Erro interno ao buscar carteira' });
  }
  console.log('Rota de carteira ativa');
});

router.get('/saldo', auth, async (req, res) => {
  try {
    const usuario = await Usuario.buscarUsuarioPorId(req.usuario.id);
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

/**
 * POST /usuario/deposito
 * Registra depósito em saldo + histórico (investimentos.json)
 */
router.post('/deposito', auth, async (req, res) => {
  try {
    const valor = Number(req.body.valor);

    if (!Number.isFinite(valor) || valor <= 0) {
      return res.status(400).json({ erro: 'Valor de depósito inválido.' });
    }

    const usuarioId = req.usuario.id;
    const usuarios = lerUsuarios();
    const idx = usuarios.findIndex((u) => String(u.id) === String(usuarioId));

    if (idx === -1) {
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }

    const usuario = usuarios[idx];
    const saldoAtual = Number(usuario.saldo || 0);
    const novoSaldo = saldoAtual + valor;
    usuario.saldo = novoSaldo;

    usuarios[idx] = usuario;
    salvarUsuarios(usuarios);

    // registra no histórico (investimentos.json)
    const investimentos = lerInvestimentos();
    investimentos.push({
      tipo: 'DEPOSITO',
      usuarioId,
      clubeId: null,
      clubeNome: '',
      quantidade: 0,
      valorUnitario: valor,
      totalPago: valor,
      data: new Date().toISOString(),
    });
    salvarInvestimentos(investimentos);

    return res.json({ usuario });
  } catch (err) {
    console.error('Erro ao processar depósito:', err);
    return res.status(500).json({ erro: 'Erro interno ao processar depósito.' });
  }
});

/**
 * POST /usuario/saque
 * Registra saque em saldo + histórico (investimentos.json)
 */
router.post('/saque', auth, async (req, res) => {
  try {
    const valor = Number(req.body.valor);

    if (!Number.isFinite(valor) || valor <= 0) {
      return res.status(400).json({ erro: 'Valor de saque inválido.' });
    }

    const usuarioId = req.usuario.id;
    const usuarios = lerUsuarios();
    const idx = usuarios.findIndex((u) => String(u.id) === String(usuarioId));

    if (idx === -1) {
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }

    const usuario = usuarios[idx];
    const saldoAtual = Number(usuario.saldo || 0);

    if (valor > saldoAtual) {
      return res
        .status(400)
        .json({ erro: 'Saldo insuficiente para realizar o saque.' });
    }

    const novoSaldo = saldoAtual - valor;
    usuario.saldo = novoSaldo;

    usuarios[idx] = usuario;
    salvarUsuarios(usuarios);

    // registra no histórico (investimentos.json)
    const investimentos = lerInvestimentos();
    investimentos.push({
      tipo: 'SAQUE',
      usuarioId,
      clubeId: null,
      clubeNome: '',
      quantidade: 0,
      valorUnitario: valor,
      totalPago: valor,
      data: new Date().toISOString(),
    });
    salvarInvestimentos(investimentos);

    return res.json({ usuario });
  } catch (err) {
    console.error('Erro ao processar saque:', err);
    return res.status(500).json({ erro: 'Erro interno ao processar saque.' });
  }
});

/**
 * GET /usuario/extrato
 * Extrato de movimentações do SALDO (depósitos, saques, compras, vendas, liquidação etc)
 *
 * Query params opcionais:
 *  - from=YYYY-MM-DD (data inicial)
 *  - to=YYYY-MM-DD (data final)
 *  - tipos=DEPOSITO,SAQUE,COMPRA,VENDA (lista separada por vírgula)
 */
router.get('/extrato', auth, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;

    // pega saldo atual (para sincronizar caso existam operações antigas sem registro)
    const usuarioAtual = await Usuario.buscarUsuarioPorId(usuarioId);
    const saldoAtual = Number(usuarioAtual?.saldo || 0);

    // filtros
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

    // carrega operações do investimentos.json (mesma fonte do /historico)
    let movimentos = JSON.parse(fs.readFileSync(invPath, 'utf-8') || '[]')
      .filter((i) => String(i.usuarioId) === String(usuarioId))
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
          clubeId: i.clubeId ?? null,
          clubeNome: i.clubeNome || '',
          quantidade: Number(i.quantidade || 0),
          valor: Number(total || 0), // valor da movimentação (absoluto)
          valorUnitario: unit,
          data: i.data ? new Date(i.data) : new Date(0),
        };
      })
      // ordena do mais antigo -> mais novo pra calcular saldo acumulado
      .sort((a, b) => a.data - b.data);

    // aplica filtro de datas/tipos (se houver)
    movimentos = movimentos.filter((m) => {
      if (fromDate && m.data < fromDate) return false;
      if (toDate && m.data > toDate) return false;
      if (tiposFiltro && !tiposFiltro.includes(m.tipo)) return false;
      return true;
    });

    // define se cada tipo soma ou subtrai saldo
    function calcularDelta(m) {
      const t = m.tipo;

      // créditos
      if (t === 'DEPOSITO') return +m.valor;
      if (t === 'VENDA') return +m.valor;
      if (t === 'LIQUIDACAO' || t === 'LIQUIDAÇÃO') return +m.valor;
      if (t === 'DIVIDENDO' || t === 'DIVIDENDOS') return +m.valor;

      // débitos
      if (t === 'SAQUE') return -m.valor;

      // compras (IPO/mercado)
      // Aceita variações comuns sem quebrar:
      if (t.includes('COMPRA')) return -m.valor;
      if (t === 'IPO') return -m.valor;

      // padrão: não altera saldo
      return 0;
    }

    function descricaoMov(m) {
      const nome = m.clubeNome ? ` - ${m.clubeNome}` : '';
      const qtd = m.quantidade ? ` (${m.quantidade} cota${m.quantidade > 1 ? 's' : ''})` : '';
      if (m.tipo === 'DEPOSITO') return 'Depósito';
      if (m.tipo === 'SAQUE') return 'Saque';
      if (m.tipo.includes('COMPRA') || m.tipo === 'IPO') return `Compra${nome}${qtd}`;
      if (m.tipo === 'VENDA') return `Venda${nome}${qtd}`;
      if (m.tipo.startsWith('LIQ')) return `Liquidação${nome}${qtd}`;
      if (m.tipo.startsWith('DIV')) return `Dividendos${nome}`;
      if (m.tipo === 'AJUSTE') return 'Ajuste de saldo (sincronização)';
      return `${m.tipo}${nome}${qtd}`;
    }

    // calcula saldo acumulado
    let saldo = 0;
    const linhas = movimentos.map((m) => {
      const delta = calcularDelta(m);
      saldo = Number((saldo + delta).toFixed(2));

      return {
        data: m.data.toISOString(),
        tipo: m.tipo,
        descricao: descricaoMov(m),
        valor: Number(Math.abs(delta).toFixed(2)),
        direcao: delta >= 0 ? 'C' : 'D', // C=crédito, D=débito
        saldoApos: saldo,
      };
    });

    // sincronização com saldo atual (caso existam “saldos antigos” sem registro no histórico)
    const saldoCalcFinal = saldo;
    const diff = Number((saldoAtual - saldoCalcFinal).toFixed(2));

    if (Math.abs(diff) >= 0.01) {
      const dataAjuste =
        linhas.length > 0 ? linhas[0].data : new Date().toISOString();

      // insere um AJUSTE no início e recalcula saldos para ficar profissional/consistente
      const linhasComAjuste = [
        {
          data: dataAjuste,
          tipo: 'AJUSTE',
          descricao: 'Ajuste de saldo (sincronização)',
          valor: Math.abs(diff),
          direcao: diff >= 0 ? 'C' : 'D',
          saldoApos: 0, // recalcula abaixo
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
        itens: recalculado.sort((a, b) => new Date(b.data) - new Date(a.data)), // entrega desc
      });
    }

    return res.json({
      saldoAtual,
      saldoCalculadoFinal: Number(saldoCalcFinal.toFixed(2)),
      itens: linhas.sort((a, b) => new Date(b.data) - new Date(a.data)), // entrega desc
    });
  } catch (err) {
    console.error('Erro ao gerar extrato:', err);
    return res.status(500).json({ erro: 'Erro ao gerar extrato.' });
  }
});


// Registrar aceite de documentos (termos/políticas) - por tipo + versão
router.post('/aceites', auth, (req, res) => {
  try {
    const { tipo, versao } = req.body || {};
    if (!tipo || !versao) {
      return res.status(400).json({ erro: 'tipo e versao são obrigatórios' });
    }

    const usuarios = lerUsuarios();
    const idx = usuarios.findIndex((u) => String(u.id) === String(req.usuario.id));
    if (idx === -1) return res.status(404).json({ erro: 'Usuário não encontrado' });

    const nowIso = new Date().toISOString();
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.ip;
    const userAgent = req.headers['user-agent'] || '';

    usuarios[idx].aceites = usuarios[idx].aceites || {};
    usuarios[idx].aceites[tipo] = {
      versao,
      aceitoEm: nowIso,
      ip,
      userAgent,
    };

    salvarUsuarios(usuarios);
    return res.json({ ok: true, tipo, versao, aceitoEm: nowIso });
  } catch (err) {
    console.error('Erro ao registrar aceite:', err);
    return res.status(500).json({ erro: 'Erro ao registrar aceite' });
  }
});


/**
 * GET /usuario/admin/antifraude/logs
 * Retorna logs de antifraude (apenas admin)
 * Query: limit (max 1000, default 200)
 */
router.get('/admin/antifraude/logs', auth, (req, res) => {
  try {
    const usuario = req.usuario;

    if (!usuario || usuario.role !== 'admin') {
      return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
    }

    const limit = Math.min(Number(req.query.limit || 200), 1000);

    if (!fs.existsSync(antifraudeLogsPath)) {
      return res.json({ total: 0, logs: [] });
    }

    const logs = JSON.parse(fs.readFileSync(antifraudeLogsPath, 'utf8') || '[]');

    const recentes = logs
      .slice()
      .sort((a, b) => new Date(b.ts) - new Date(a.ts))
      .slice(0, limit);

    return res.json({ total: logs.length, logs: recentes });
  } catch (err) {
    console.error('Erro ao buscar logs antifraude:', err);
    return res.status(500).json({ erro: 'Erro interno ao buscar logs antifraude.' });
  }
});

/**
 * GET /usuario/admin/antifraude/state
 * Retorna o estado antifraude (scores/cooldowns) - apenas admin
 */
router.get('/admin/antifraude/state', auth, (req, res) => {
  try {
    const usuario = req.usuario;
    if (!usuario || usuario.role !== 'admin') {
      return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
    }

    if (!fs.existsSync(antifraudeStatePath)) {
      return res.json({ users: {}, ips: {} });
    }

    const state = JSON.parse(fs.readFileSync(antifraudeStatePath, 'utf8') || '{}');
    return res.json(state);
  } catch (err) {
    console.error('Erro ao buscar antifraude state:', err);
    return res.status(500).json({ erro: 'Erro interno ao buscar antifraude state.' });
  }
});


/**
 * POST /usuario/admin/freeze-user
 */
router.post('/admin/freeze-user', auth, (req, res) => {
  if (req.usuario.role !== 'admin') return res.status(403).json({ erro: 'Admin only' });
  const { userId, minutos = 10, motivo = 'freeze manual' } = req.body;
  const antifraude = require('../utils/antifraude');
  const state = antifraude.loadState();
  antifraude.freezeUser(state, userId, Number(minutos) * 60_000, motivo);
  antifraude.logEvent({ userId: String(userId), action: 'ADMIN_FREEZE', decision: 'BLOCK', reason: motivo });
  res.json({ ok: true });
});

router.post('/admin/unfreeze-user', auth, (req, res) => {
  if (req.usuario.role !== 'admin') return res.status(403).json({ erro: 'Admin only' });
  const { userId } = req.body;
  const antifraude = require('../utils/antifraude');
  const state = antifraude.loadState();
  antifraude.unfreezeUser(state, userId);
  antifraude.logEvent({ userId: String(userId), action: 'ADMIN_UNFREEZE', decision: 'ALLOW' });
  res.json({ ok: true });
});


/**
 * GET /usuario/admin/dashboard/antifraude
 * Resumo (Camada 5): top users por score, congelados, sinais recentes
 */
router.get('/admin/dashboard/antifraude', auth, (req, res) => {
  try {
    const usuario = req.usuario;
    if (!usuario || usuario.role !== 'admin') {
      return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
    }

    const state = fs.existsSync(antifraudeStatePath)
      ? JSON.parse(fs.readFileSync(antifraudeStatePath, 'utf8') || '{}')
      : { users: {}, ips: {}, clubes: {} };

    const usersArr = Object.entries(state.users || {}).map(([userId, u]) => ({
      userId,
      score: Number(u.score || 0),
      cooldownUntil: Number(u.cooldownUntil || 0),
      frozenUntil: Number(u.frozenUntil || 0),
      last: u.last || {}
    }));

    usersArr.sort((a, b) => b.score - a.score);

    const frozenUsers = usersArr.filter(u => u.frozenUntil > Date.now()).slice(0, 50);

    const clubesArr = Object.entries(state.clubes || {}).map(([clubeId, c]) => ({
      clubeId,
      frozenUntil: Number(c.frozenUntil || 0),
      last: c.last || {},
      trades5m: Array.isArray(c.stats?.trades) ? c.stats.trades.length : null,
      cancels10m: Array.isArray(c.stats?.cancels) ? c.stats.cancels.length : null
    }));
    const frozenClubes = clubesArr.filter(c => c.frozenUntil > Date.now());

    const logs = fs.existsSync(antifraudeLogsPath)
      ? JSON.parse(fs.readFileSync(antifraudeLogsPath, 'utf8') || '[]')
      : [];
    const recent = logs
      .slice()
      .sort((a, b) => new Date(b.ts) - new Date(a.ts))
      .filter(l => ['CANCEL_RATIO_SIGNAL','CLUBE_VOLUME_SPIKE','ADMIN_FREEZE','ADMIN_FREEZE_CLUBE','WASH_TRADING_SIGNAL','SPOOFING_SIGNAL','SELF_TRADE_BLOCK'].includes(String(l.action || '')))
      .slice(0, 100);

    return res.json({
      topUsers: usersArr.slice(0, 20),
      frozenUsers,
      frozenClubes,
      recentSignals: recent
    });
  } catch (err) {
    console.error('Erro dashboard antifraude:', err);
    return res.status(500).json({ erro: 'Erro interno ao montar dashboard antifraude.' });
  }
});

/**
 * GET /usuario/admin/dashboard/mercado
 * Resumo (Camada 5): clubes travados/circuit breaker, ordens abertas por clube, etc.
 */
router.get('/admin/dashboard/mercado', auth, (req, res) => {
  try {
    const usuario = req.usuario;
    if (!usuario || usuario.role !== 'admin') {
      return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
    }

    const clubesPath = path.join(__dirname, '..', 'data', 'clubes.json');
    const ordensPath = path.join(__dirname, '..', 'data', 'ordens.json');

    const clubes = fs.existsSync(clubesPath) ? JSON.parse(fs.readFileSync(clubesPath, 'utf8') || '[]') : [];
    const ordens = fs.existsSync(ordensPath) ? JSON.parse(fs.readFileSync(ordensPath, 'utf8') || '[]') : [];

    const agora = Date.now();
    const travados = clubes
      .filter(c => Number(c.travadoAte || 0) > agora)
      .map(c => ({ clubeId: c.id, nome: c.nome, travadoAte: c.travadoAte, precoAtual: c.precoAtual }));

    const ordensAbertasPorClube = {};
    ordens.filter(o => Number(o.restante || 0) > 0).forEach(o => {
      const k = String(o.clubeId);
      ordensAbertasPorClube[k] = (ordensAbertasPorClube[k] || 0) + 1;
    });

    const topClubesPorOrdens = Object.entries(ordensAbertasPorClube)
      .map(([clubeId, count]) => ({ clubeId, ordensAbertas: count }))
      .sort((a, b) => b.ordensAbertas - a.ordensAbertas)
      .slice(0, 20);

    return res.json({
      travadosCircuitBreaker: travados,
      topClubesPorOrdens
    });
  } catch (err) {
    console.error('Erro dashboard mercado:', err);
    return res.status(500).json({ erro: 'Erro interno ao montar dashboard mercado.' });
  }
});

module.exports = router;

