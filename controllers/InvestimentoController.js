const fs = require('fs');
const path = require('path');
const storage = require('../utils/storage');
const audit = require('../utils/audit');
const { runTx } = require('../utils/tx');

const clubesPath = path.join(__dirname, '../data/clubes.json');
const investimentosPath = path.join(__dirname, '../data/investimentos.json');

// -------- CAMADA 5: Limites econômicos (IPO também) --------
const TOTAL_COTAS_CLUBE = 1000;
const MAX_PCT_COTAS_CLUBE = 0.20; // 20% do float
const MAX_EXPOSICAO_CLUBE = 0.30; // 30% do patrimônio


// Funções auxiliares
function salvarJSON(caminho, dados) {
  // escrita atômica
  return storage.writeJSON(caminho, dados);
}

function lerJSON(caminho) {
  if (!fs.existsSync(caminho)) return [];
  return JSON.parse(fs.readFileSync(caminho, 'utf-8'));
}

function buscarClubePorId(id) {
  const clubes = lerJSON(clubesPath);
  // Converta ambos para número para garantir comparação correta
  const idNum = Number(id);
  return clubes.find(c => Number(c.id) === idNum);
}

function atualizarClube(clubeAtualizado) {
  const clubes = lerJSON(clubesPath);
  const index = clubes.findIndex(c => String(c.id) === String(clubeAtualizado.id));
  if (index !== -1) {
    clubes[index] = clubeAtualizado;
    salvarJSON(clubesPath, clubes);
  }
}

async function comprarCota(req, res) {
  try {
    const { clubeId, quantidade, usuarioId } = req.body;

    console.log('BODY RECEBIDO:', req.body);

    if (!clubeId || !quantidade || quantidade <= 0 || !usuarioId) {
      return res.status(400).json({ erro: 'Dados inválidos para compra.' });
    }

    const clube = buscarClubePorId(clubeId);
    if (!clube) {
      return res.status(404).json({ erro: 'Clube não encontrado.' });
    }
    const preco = clube.preco;

    if (clube.cotasDisponiveis < quantidade) {
      return res.status(400).json({ erro: 'Cotas insuficientes no IPO.' });
    }

    const usuariosPath = path.join(__dirname, '../data/usuarios.json');
    const dataDir = path.join(__dirname, '../data');

    const meta = { usuarioId, clubeId: clube.id, quantidade, preco };

    const result = await runTx({
      files: [clubesPath, usuariosPath, investimentosPath],
      dataDir,
      action: 'IPO_COMPRA',
      meta,
      fallbacks: { clubes: [], usuarios: [], investimentos: [] },
      mutate: (state) => {
        const clubesAll = state.clubes;
        const usuarios = state.usuarios;
        const investimentos = state.investimentos;

        const idxClube = clubesAll.findIndex(c => Number(c.id) === Number(clube.id));
        if (idxClube < 0) { const e = new Error('Clube não encontrado.'); e.code='CLUBE_NAO_ENCONTRADO'; throw e; }

        if (Number(clubesAll[idxClube].cotasDisponiveis || 0) < quantidade) { const e = new Error('Cotas insuficientes no IPO.'); e.code='COTAS_INSUF'; throw e; }

        const usuarioIndex = usuarios.findIndex(u => String(u.id) === String(usuarioId));
        if (usuarioIndex === -1) { const e = new Error('Usuário não encontrado.'); e.code='USER_NAO_ENCONTRADO'; throw e; }

        // Limites econômicos (Camada 5)
        if (!usuarios[usuarioIndex].carteira) usuarios[usuarioIndex].carteira = [];
        const carteira = usuarios[usuarioIndex].carteira;
        const cotaExistente = carteira.find(c => String(c.clubeId) === String(clube.id));
        const qtdAtual = Number(cotaExistente?.quantidade || 0);
        const qtdApos = qtdAtual + Number(quantidade);
        const LIMITE_QTD = TOTAL_COTAS_CLUBE * MAX_PCT_COTAS_CLUBE;
        if (qtdApos > LIMITE_QTD) { const e = new Error('Limite de concentração atingido.'); e.code='CAP_HOLDING'; throw e; }

        const total = quantidade * preco;
        const saldoAtual = Number(usuarios[usuarioIndex].saldo || 0);
        if (saldoAtual < total) { const e = new Error('Saldo insuficiente.'); e.code='SALDO_INSUF'; throw e; }

        const patrimonio = saldoAtual + carteira.reduce((s, a) => s + Number(a.totalInvestido || 0), 0);
        const exposicaoAtual = Number(cotaExistente?.totalInvestido || 0);
        const exposicaoApos = exposicaoAtual + total;
        if (patrimonio > 0 && (exposicaoApos / patrimonio) > MAX_EXPOSICAO_CLUBE) { const e = new Error('Limite de exposição atingido.'); e.code='CAP_EXPOSURE'; throw e; }

        // Debita saldo
        usuarios[usuarioIndex].saldo = saldoAtual - total;

        // Carteira
        if (cotaExistente) {
          cotaExistente.quantidade += quantidade;
          cotaExistente.totalInvestido = Number(cotaExistente.totalInvestido || 0) + total;
        } else {
          carteira.push({
            clubeId: clubesAll[idxClube].id,
            nomeClube: clubesAll[idxClube].nome,
            quantidade,
            precoMedio: preco,
            totalInvestido: total
          });
        }

        // Clube: decrementa cotas
        clubesAll[idxClube].cotasDisponiveis = Number(clubesAll[idxClube].cotasDisponiveis || 0) - quantidade;
        if (Number(clubesAll[idxClube].cotasDisponiveis) <= 0) {
          clubesAll[idxClube].cotasDisponiveis = 0;
          clubesAll[idxClube].ipoEncerrado = true;
        }

        investimentos.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          usuarioId,
          clubeId: clubesAll[idxClube].id,
          quantidade,
          precoUnitario: preco,
          tipo: 'IPO',
          data: new Date().toISOString()
        });

        state.clubes = clubesAll;
        state.usuarios = usuarios;
        state.investimentos = investimentos;
        return state;
      }
    });

    audit.logEvent({ kind: 'IPO', action: 'IPO_COMPRA_OK', usuarioId, clubeId: clube.id, quantidade, preco });

return res.status(201).json({
      mensagem: 'Compra realizada com sucesso!',
      usuario: (result.usuarios || []).find(u => String(u.id) === String(usuarioId))
    });

  } catch (err) {
    console.error('Erro ao comprar cota:', err);
    res.status(500).json({ erro: 'Saldo insuficiente.' });
  }
}


async function venderCota(req, res) {
  try {
    const { clubeId, quantidade, precoDesejado } = req.body;
    const usuarioId = req.usuario?.id;

    if (!clubeId || !quantidade || quantidade <= 0 || !precoDesejado) {
      return res.status(400).json({ erro: 'Dados inválidos para venda.' });
    }

    const investimentos = lerJSON(investimentosPath);
    investimentos.push({
      id: Date.now(),
      usuarioId,
      clubeId,
      quantidade: -Math.abs(quantidade),
      precoUnitario: precoDesejado,
      tipo: 'mercado_secundario',
      data: new Date().toISOString()
    });

    salvarJSON(investimentosPath, investimentos);

    res.status(201).json({ mensagem: 'Oferta de venda registrada com sucesso!' });
  } catch (err) {
    console.error('Erro ao vender cota:', err);
    res.status(500).json({ erro: 'Erro interno ao vender cota.' });
  }
}

module.exports = {
  comprarCota,
  venderCota
};
