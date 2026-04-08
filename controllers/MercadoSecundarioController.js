// controllers/MercadoSecundarioController.js
const fs = require('fs');
const path = require('path');
const antifraude = require('../utils/antifraude');

const ordensPath = path.join(__dirname, '../data/ordens.json');
const usuariosPath = path.join(__dirname, '../data/usuarios.json');
const investimentosPath = path.join(__dirname, '../data/investimentos.json');
const clubesPath = path.join(__dirname, '../data/clubes.json'); // <-- para travar mercado

function lerJSON(p) { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : []; }
function salvarJSON(p, d) { fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

function getUsuarioById(id) {
  const usuarios = lerJSON(usuariosPath);
  const u = usuarios.find(u => String(u.id) === String(id));
  return [usuarios, u];
}

function registrarInvestimento(entry) {
  const investimentos = lerJSON(investimentosPath);
  investimentos.push({ id: Date.now(), ...entry });
  salvarJSON(investimentosPath, investimentos);
}

function atualizarCarteiraAposVenda(usuario, clubeId, qtd, preco) {
  const ativo = usuario.carteira.find(a => String(a.clubeId) === String(clubeId));
  if (!ativo) return;

  ativo.quantidade -= qtd;
  ativo.totalInvestido = Number((ativo.precoMedio * ativo.quantidade).toFixed(2));

  // remove ativo zerado
  if (ativo.quantidade <= 0) {
    usuario.carteira = usuario.carteira.filter(a => String(a.clubeId) !== String(clubeId));
  }
  // saldo credita
  usuario.saldo = Number((Number(usuario.saldo) + (qtd * preco)).toFixed(2));
}

function atualizarCarteiraAposCompra(usuario, clubeId, qtd, preco) {
  let ativo = usuario.carteira.find(a => String(a.clubeId) === String(clubeId));
  if (!ativo) {
    ativo = { clubeId, nomeClube: '', quantidade: 0, precoMedio: 0, totalInvestido: 0 };
    usuario.carteira.push(ativo);
  }
  const novoTotal = ativo.totalInvestido + (qtd * preco);
  const novaQtd = ativo.quantidade + qtd;
  ativo.precoMedio = Number((novoTotal / novaQtd).toFixed(2));
  ativo.quantidade = novaQtd;
  ativo.totalInvestido = Number(novoTotal.toFixed(2));

  // saldo debita
  usuario.saldo = Number((Number(usuario.saldo) - (qtd * preco)).toFixed(2));
}

function ordenarLivro(ordens, tipo) {
  // venda: menor preço primeiro; compra: maior preço primeiro
  return ordens
    .filter(o => o.tipo === tipo)
    .sort((a, b) => {
      if (tipo === 'venda') return a.preco - b.preco || a.criadoEm - b.criadoEm;
      return b.preco - a.preco || a.criadoEm - b.criadoEm;
    });
}

function mercadoAtivoPara(clubeId) {
  const clubes = lerJSON(clubesPath);
  const c = clubes.find(c => String(c.id) === String(clubeId));
  if (!c) return false;
  // Só libera se não houver mais cotas no IPO:
  return Number(c.cotasDisponiveis) === 0;
}

async function criarOuCasarOrdem(req, res) {
  try {
    const { tipo, clubeId, quantidade, preco } = req.body;
    const usuarioId = req.usuario.id;
    // -------- CAMADA 2: Cooldown/Risk --------
    const cd = antifraude.evaluateCooldown({ req, userId: usuarioId });
    if (!cd.ok) return res.status(cd.status).json(cd.body);

    // -------- CAMADA 2: Velocity limits (ordem) --------
    const ip = antifraude.getClientIp(req);
    const vUser = antifraude.checkVelocity({ key: `uid:${usuarioId}`, action: 'ORDER_CREATE', limit: 20, windowMs: 60_000 });
    if (!vUser.ok) {
      antifraude.logEvent({ userId: String(usuarioId), ip, action: 'ORDER_CREATE', decision: 'BLOCK', reason: 'rate limit user', retryAfterMs: vUser.retryAfterMs });
      return res.status(429).json({ error: 'BLOQUEADO_ANTIFRAUDE', motivo: 'muitas ordens em pouco tempo', cooldownMs: vUser.retryAfterMs });
    }
    const vIp = antifraude.checkVelocity({ key: `ip:${ip}`, action: 'ORDER_CREATE', limit: 60, windowMs: 60_000 });
    if (!vIp.ok) {
      antifraude.logEvent({ userId: String(usuarioId), ip, action: 'ORDER_CREATE', decision: 'BLOCK', reason: 'rate limit ip', retryAfterMs: vIp.retryAfterMs });
      return res.status(429).json({ error: 'BLOQUEADO_ANTIFRAUDE', motivo: 'muitas ordens (IP) em pouco tempo', cooldownMs: vIp.retryAfterMs });
    }

    // -------- CAMADA 2: Circuit breaker (se travado) --------
    const clubesTmp = lerJSON(clubesPath);
    const clubeTmp = clubesTmp.find(c => String(c.id) === String(clubeId));
    if (clubeTmp && Number(clubeTmp.travadoAte || 0) > Date.now()) {
      const ms = Number(clubeTmp.travadoAte) - Date.now();
      antifraude.logEvent({ userId: String(usuarioId), ip, action: 'CIRCUIT_BREAKER_BLOCK', decision: 'BLOCK', clubeId: String(clubeId), cooldownMs: ms });
      return res.status(429).json({ error: 'BLOQUEADO_ANTIFRAUDE', motivo: 'clube temporariamente travado (circuit breaker)', cooldownMs: ms });
    }
    if (!mercadoAtivoPara(clubeId)) {
      return res.status(400).json({ erro: 'Mercado secundário ainda não está ativo para este clube (IPO não zerou).' });
    }
    if (!['compra','venda'].includes(tipo)) return res.status(400).json({ erro: 'Tipo inválido' });
    if (!clubeId || !quantidade || !preco) return res.status(400).json({ erro: 'Dados incompletos' });

    const ordens = lerJSON(ordensPath);
    const [usuarios, user] = getUsuarioById(usuarioId);
    if (!user) return res.status(404).json({ erro: 'Usuário não encontrado' });

    // validações básicas
    if (tipo === 'venda') {
      const ativo = user.carteira.find(a => String(a.clubeId) === String(clubeId));
      if (!ativo || ativo.quantidade < quantidade) {
        return res.status(400).json({ erro: 'Quantidade indisponível para venda' });
      }
    } else { // compra
      const custo = quantidade * preco;
      if (Number(user.saldo) < custo) return res.status(400).json({ erro: 'Saldo insuficiente' });
    }

    const novaOrdem = {
      id: Date.now(),
      usuarioId,
      tipo, // 'compra' | 'venda'
      clubeId: Number(clubeId),
      quantidade: Number(quantidade),
      preco: Number(preco),
      criadoEm: Date.now(),
      aberto: true
    };

    // matching simples
    let restante = novaOrdem.quantidade;
    let ultimoPrecoNegociado = null;

    const contraparteTipo = tipo === 'venda' ? 'compra' : 'venda';
    const livro = ordenarLivro(ordens, contraparteTipo);

    for (const cp of livro) {
      if (!cp.aberto || String(cp.clubeId) !== String(clubeId)) continue;

      // regra de preço: compra >= venda
      const atendePreco = tipo === 'venda' ? (cp.preco >= novaOrdem.preco) : (cp.preco <= novaOrdem.preco);
      if (!atendePreco) continue;

      const tradeQtd = Math.min(restante, cp.quantidade);
      const tradePreco = cp.preco; // usa preço da contraparte (time/price priority)
      ultimoPrecoNegociado = tradePreco;

      // atualiza usuários
      const [usuariosAll, vendedor] = getUsuarioById(tipo === 'venda' ? usuarioId : cp.usuarioId);
      const [usuariosAll2, comprador] = getUsuarioById(tipo === 'venda' ? cp.usuarioId : usuarioId);

      // -------- CAMADA 2: SELF-TRADE (bloqueia execução) --------
      const buyerId  = (tipo === 'venda' ? cp.usuarioId : usuarioId);
      const sellerId = (tipo === 'venda' ? usuarioId : cp.usuarioId);
      if (String(buyerId) === String(sellerId)) {
        antifraude.blockSelfTrade({ req, userId: usuarioId, clubeId, ordemPassivaId: cp.id, makerUserId: cp.usuarioId });
        continue;
      }

      // vendedor sai de carteira, recebe saldo
      atualizarCarteiraAposVenda(vendedor, clubeId, tradeQtd, tradePreco);
      // comprador entra na carteira, paga saldo
      atualizarCarteiraAposCompra(comprador, clubeId, tradeQtd, tradePreco);

      // persiste usuários
      salvarJSON(usuariosPath, usuariosAll); // vendedores
      salvarJSON(usuariosPath, usuariosAll2); // compradores (mesmo arquivo, mas garantimos última gravação)

      // registra operações (auditoria)
      registrarInvestimento({
        usuarioId: vendedor.id, clubeId, quantidade: tradeQtd,
        precoUnitario: tradePreco, tipo: 'VENDA', data: new Date().toISOString()
      });
      registrarInvestimento({
        usuarioId: comprador.id, clubeId, quantidade: tradeQtd,
        precoUnitario: tradePreco, tipo: 'COMPRA', data: new Date().toISOString()
      });

      // atualiza ordens
      cp.quantidade -= tradeQtd;
      if (cp.quantidade <= 0) cp.aberto = false;
      restante -= tradeQtd;

      if (restante <= 0) break;
    }

    // atualiza preço de mercado (precoAtual) no clubes.json + circuit breaker
    if (ultimoPrecoNegociado != null) {
      const clubesAtual = lerJSON(clubesPath);
      const idxClube = clubesAtual.findIndex(c => String(c.id) === String(clubeId));
      if (idxClube >= 0) {
        const oldPrice = Number(clubesAtual[idxClube].precoAtual || clubesAtual[idxClube].precoIPO || 0);
        const newPrice = Number(ultimoPrecoNegociado);
        const trip = antifraude.shouldTripCircuitBreaker({ oldPrice, newPrice, maxPct: 15 });
        if (trip) {
          clubesAtual[idxClube].travadoAte = Date.now() + 180_000;
          antifraude.logEvent({
            userId: String(usuarioId),
            ip: antifraude.getClientIp(req),
            action: 'CIRCUIT_BREAKER_TRIP',
            decision: 'ALLOW',
            clubeId: String(clubeId),
            oldPrice,
            newPrice,
            travadoAte: clubesAtual[idxClube].travadoAte,
          });
        }
        clubesAtual[idxClube].precoAtual = newPrice;
        salvarJSON(clubesPath, clubesAtual);
      }
    }

    // se sobrou quantidade, entra no livro
    if (restante > 0) {
      novaOrdem.quantidade = restante;
      ordens.push(novaOrdem);
    }

    salvarJSON(ordensPath, ordens);

    return res.json({
      ok: true,
      preenchido: novaOrdem.quantidade - restante,
      emAberto: restante,
    });
  } catch (err) {
    console.error('Erro ao criar/casar ordem:', err);
    return res.status(500).json({ erro: 'Erro no livro de ordens' });
  }
}
// NOVO: listar livro do clube (separado por compra/venda)
function getLivro(req, res) {
  try {
    const { clubeId } = req.params;
    const ordens = lerJSON(ordensPath).filter(o => String(o.clubeId) === String(clubeId) && o.aberto);

    const compras = ordens
      .filter(o => o.tipo === 'compra')
      .sort((a, b) => (b.preco - a.preco) || (a.criadoEm - b.criadoEm)); // maior preço primeiro

    const vendas = ordens
      .filter(o => o.tipo === 'venda')
      .sort((a, b) => (a.preco - b.preco) || (a.criadoEm - b.criadoEm)); // menor preço primeiro

    res.json({ compras, vendas });
  } catch (err) {
    console.error('Erro ao obter livro:', err);
    res.status(500).json({ erro: 'Erro ao obter livro de ordens.' });
  }
}

module.exports = { criarOuCasarOrdem, getLivro };

