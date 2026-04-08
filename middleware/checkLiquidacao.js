// middleware/checkLiquidacao.js
// middleware/checkLiquidacao.js
const fs = require('fs');
const path = require('path');

const storage = require('../utils/storage');
const audit = require('../utils/audit');
const { runTx } = require('../utils/tx');

// Caminhos dos arquivos JSON principais
const configPath        = path.join(__dirname, '..', 'data', 'configCampeonato.json');
const usuariosPath      = path.join(__dirname, '..', 'data', 'usuarios.json');
const clubesPath        = path.join(__dirname, '..', 'data', 'clubes.json');
const investimentosPath = path.join(__dirname, '..', 'data', 'investimentos.json');
const classificacaoPath = path.join(__dirname, '..', 'data', 'classificacaoFinal.json');
const ledgerJournalPath = path.join(__dirname, '..', 'data', 'ledger_journal.json');
const ledgerIdemPath    = path.join(__dirname, '..', 'data', 'ledger_idem.json');

function ledgerNormalizeLine(line) {
  const account = String(line.account || '').trim();
  const debit = Number(line.debit || 0);
  const credit = Number(line.credit || 0);

  if (!account) {
    throw Object.assign(new Error('Ledger: linha sem account'), {
      code: 'LEDGER_BAD_LINE',
    });
  }

  if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
    throw Object.assign(new Error('Ledger: linha deve ter debit OU credit'), {
      code: 'LEDGER_BAD_LINE',
    });
  }

  if (debit < 0 || credit < 0) {
    throw Object.assign(new Error('Ledger: valores negativos'), {
      code: 'LEDGER_BAD_LINE',
    });
  }

  return { account, debit, credit };
}

function ledgerEnsureBalanced(lines) {
  let deb = 0;
  let cred = 0;

  for (const l of lines) {
    deb += Number(l.debit || 0);
    cred += Number(l.credit || 0);
  }

  deb = Math.round(deb * 100) / 100;
  cred = Math.round(cred * 100) / 100;

  if (deb !== cred) {
    const e = new Error(`Ledger desbalanceado deb=${deb} cred=${cred}`);
    e.code = 'LEDGER_UNBALANCED';
    e.meta = { deb, cred };
    throw e;
  }
}

function ledgerAppend({ action, lines, meta = {}, idemKey = null }) {
  const journal = storage.readJSON(ledgerJournalPath, []);
  const idem = storage.readJSON(ledgerIdemPath, {});

  if (idemKey) {
    const k = String(idemKey);
    if (idem[k]) return { idemHit: true, existing: idem[k] };
  }

  const entryId = `je_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const normalized = (lines || []).map(ledgerNormalizeLine);
  ledgerEnsureBalanced(normalized);

  const entry = {
    id: entryId,
    at: new Date().toISOString(),
    action: String(action),
    lines: normalized,
    meta,
  };

  journal.push(entry);
  storage.writeJSON(ledgerJournalPath, journal);

  if (idemKey) {
    idem[String(idemKey)] = {
      entryId,
      at: entry.at,
      action: entry.action,
    };
    storage.writeJSON(ledgerIdemPath, idem);
  }

  return { idemHit: false, entry };
}

function lerJSON(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('[LER JSON]', p, e.message);
    return fallback;
  }
}

function salvarJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Calcula o preço-base de liquidação por posição final.
 * 20º = R$ 5,00
 * Cada posição acima aumenta 5%.
 */
function calcularPrecoPorPosicao(posicao) {
  const basePosicao = 20;
  const basePreco20 = 5.0;
  const fatorAumento = 1.05;

  if (!posicao || posicao < 1 || posicao > 20) {
    return basePreco20;
  }

  const passos = basePosicao - posicao;
  const preco = basePreco20 * Math.pow(fatorAumento, passos);

  return Number(preco.toFixed(2));
}

/**
 * Ajusta o preço por cota para considerar splits acumulados.
 * Exemplo:
 * - preço-base liquidação = 10,00
 * - splitFactorCumulativo = 2
 * - preço ajustado por cota = 5,00
 *
 * Isso preserva o patrimônio total, já que a quantidade em carteira foi multiplicada.
 */
function ajustarPrecoLiquidacaoPorSplit(precoBase, splitFactorCumulativo) {
  const fator = Number(splitFactorCumulativo || 1);
  if (!fator || fator <= 1) return Number(precoBase || 0);
  return Number((Number(precoBase || 0) / fator).toFixed(2));
}

/**
 * Lê data/classificacaoFinal.json e monta um mapa { clubeId: posicao }.
 */
function obterMapaPosicoesFinais() {
  const tabela = lerJSON(classificacaoPath, null);

  if (!Array.isArray(tabela)) {
    console.warn(
      '[LIQ] classificação final não encontrada em classificacaoFinal.json. Usando fallback de preco dos clubes.'
    );
    return null;
  }

  const mapa = {};

  for (const item of tabela) {
    if (!item) continue;

    const id = item.clubeId ?? item.id ?? item.timeId;
    const pos = item.posicao ?? item.pos ?? item.position;

    if (id == null || pos == null) continue;
    mapa[id] = Number(pos);
  }

  return mapa;
}

/**
 * Liquida todas as cotas em carteira.
 *
 * Versão split-aware:
 * - calcula o preço-base da cota pela posição final;
 * - ajusta esse preço por splitFactorCumulativo;
 * - usa a quantidade já existente na carteira do usuário (que já foi ajustada por split).
 */
async function liquidarBrasileirao() {
  const config = lerJSON(configPath, {
    campeonato: 'Brasileirao',
    temporada: 2023,
    dispararLiquidacao: false,
    liquidado: false,
  });

  if (config.liquidado) {
    console.log('🔵 [LIQ] Campeonato já liquidado. Nenhuma ação tomada.');
    return { ok: true, totalGeral: 0, jaLiquidado: true };
  }

  const clubes = lerJSON(clubesPath, []);
  const usuarios = lerJSON(usuariosPath, []);
  const investimentosAnt = lerJSON(investimentosPath, []);

  const mapaClubePorId = {};
  for (const c of clubes) {
    if (!c || c.id == null) continue;
    mapaClubePorId[c.id] = c;
  }

  const mapaPosicoes = obterMapaPosicoesFinais();

  const novosLancamentos = [];
  let totalGeral = 0;
  const agoraISO = new Date().toISOString();

  for (const usuario of usuarios) {
    const carteira = Array.isArray(usuario.carteira) ? usuario.carteira : [];
    if (!carteira.length) continue;

    for (const ativo of carteira) {
      const clube = mapaClubePorId[ativo.clubeId];

      if (!clube) {
        console.warn('[LIQ] Clube não encontrado em clubes.json para ativo:', ativo.clubeId);
        continue;
      }

      const qtd = Number(ativo.quantidade || 0);
      if (!qtd || qtd <= 0) continue;

      const splitFactorCumulativo = Number(clube.splitFactorCumulativo || 1);

      let valorUnitarioBase;
      if (mapaPosicoes && mapaPosicoes[ativo.clubeId] != null) {
        const posicaoFinal = mapaPosicoes[ativo.clubeId];
        valorUnitarioBase = calcularPrecoPorPosicao(posicaoFinal);
      } else {
        // fallback: usa preco atual/base do clube e ainda respeita split
        const fallbackPreco = Number(clube.preco || clube.precoAtual || 0);
        valorUnitarioBase = fallbackPreco > 0 ? Number((fallbackPreco * splitFactorCumulativo).toFixed(2)) : 0;
      }

      if (!valorUnitarioBase) {
        console.warn('[LIQ] Valor unitário base nulo para clube', ativo.clubeId, '- pulando ativo.');
        continue;
      }

      const valorUnitario = ajustarPrecoLiquidacaoPorSplit(
        valorUnitarioBase,
        splitFactorCumulativo
      );

      if (!valorUnitario || valorUnitario <= 0) {
        console.warn('[LIQ] Valor unitário ajustado inválido para clube', ativo.clubeId, '- pulando ativo.');
        continue;
      }

      const total = Number((qtd * valorUnitario).toFixed(2));

      usuario.saldo = Number((Number(usuario.saldo || 0) + total).toFixed(2));
      totalGeral = Number((totalGeral + total).toFixed(2));

      novosLancamentos.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        usuarioId: usuario.id,
        tipo: 'Liquidação',
        clubeId: ativo.clubeId,
        clubeNome: ativo.nome || ativo.nomeClube || clube.nome || '',
        quantidade: qtd,
        valorUnitario,
        valorUnitarioBase,
        splitFactorCumulativo,
        totalPago: total,
        data: agoraISO,
      });

      // Ledger da liquidação por ativo
      try {
        ledgerAppend({
          action: 'LIQUIDACAO_FINAL',
          idemKey: `liq:${config.campeonato}:${config.temporada}:${usuario.id}:${ativo.clubeId}`,
          lines: [
            {
              account: `passivo.usuarios.${usuario.id}.saldo`,
              debit: total,
              credit: 0,
            },
            {
              account: `passivo.carteira_liquidacao.${ativo.clubeId}`,
              debit: 0,
              credit: total,
            },
          ],
          meta: {
            campeonato: config.campeonato,
            temporada: config.temporada,
            usuarioId: usuario.id,
            clubeId: ativo.clubeId,
            quantidade: qtd,
            valorUnitario,
            valorUnitarioBase,
            splitFactorCumulativo,
            totalPago: total,
          },
        });
      } catch (e) {
        console.error('[LIQ][LEDGER] erro ao registrar liquidação:', e);
        throw e;
      }
    }

    // zera a carteira após liquidar tudo
    usuario.carteira = [];
  }

  salvarJSON(usuariosPath, usuarios);
  salvarJSON(investimentosPath, [...investimentosAnt, ...novosLancamentos]);

  config.dispararLiquidacao = false;
  config.liquidado = true;
  salvarJSON(configPath, config);

  console.log('🟢 [LIQ] Liquidação concluída. Total pago:', totalGeral);

  return { ok: true, totalGeral };
}

// --------- MIDDLEWARE ----------
function checkLiquidacao(req, res, next) {
  (async () => {
    try {
      const config = lerJSON(configPath, {
        dispararLiquidacao: false,
        liquidado: false,
      });

      if (config.dispararLiquidacao && !config.liquidado) {
        await liquidarBrasileirao();
      }
    } catch (e) {
      console.error('[LIQ] Erro na verificação de liquidação:', e);
    } finally {
      next();
    }
  })();
}

const mongoose = require('mongoose');

const LiquidacaoSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Usuario',
      required: true,
      index: true,
    },

    clubeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clube',
      required: true,
      index: true,
    },

    campeonato: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    temporada: {
      type: Number,
      required: true,
      index: true,
    },

    posicaoFinal: {
      type: Number,
      required: true,
      min: 1,
      max: 100,
    },

    quantidade: {
      type: Number,
      required: true,
      min: 0,
    },

    /**
     * Preço-base da liquidação antes de qualquer ajuste por split.
     * Exemplo:
     * 1º lugar = 12.63
     */
    precoLiquidacaoBase: {
      type: Number,
      required: true,
      min: 0,
    },

    /**
     * Fator acumulado de split aplicado ao clube no momento da liquidação.
     * Ex.: 1, 2, 4 etc.
     */
    splitFactorCumulativo: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },

    /**
     * Preço efetivamente pago por cota após ajuste por split.
     * Exemplo:
     * precoLiquidacaoBase = 12.63
     * splitFactorCumulativo = 2
     * precoLiquidacao = 6.315
     */
    precoLiquidacao: {
      type: Number,
      required: true,
      min: 0,
    },

    /**
     * Valor total recebido pelo usuário nesta liquidação.
     * quantidade * precoLiquidacao
     */
    totalRecebido: {
      type: Number,
      required: true,
      min: 0,
    },

    /**
     * Saldo do usuário antes da liquidação.
     */
    saldoAntes: {
      type: Number,
      min: 0,
      default: 0,
    },

    /**
     * Saldo do usuário após a liquidação.
     */
    saldoDepois: {
      type: Number,
      min: 0,
      default: 0,
    },

    /**
     * Quantidade de cotas do usuário antes da liquidação.
     * Serve para auditoria/conferência.
     */
    quantidadeAntesLiquidacao: {
      type: Number,
      min: 0,
      default: 0,
    },

    /**
     * Quantidade após liquidação.
     * Normalmente será 0.
     */
    quantidadeDepoisLiquidacao: {
      type: Number,
      min: 0,
      default: 0,
    },

    /**
     * Referência opcional ao lançamento no ledger/journal.
     */
    ledgerEntryId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },

    /**
     * Chave idempotente para impedir duplicidade de liquidação.
     */
    idemKey: {
      type: String,
      trim: true,
      required: true,
      unique: true,
      index: true,
    },

    /**
     * Status da liquidação para auditoria operacional.
     */
    status: {
      type: String,
      enum: ['processada', 'revertida'],
      default: 'processada',
      index: true,
    },

    /**
     * Metadados livres para rastreabilidade futura.
     */
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    /**
     * Momento lógico/econômico da liquidação.
     */
    dataLiquidacao: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

/**
 * Índice útil para consultas por campeonato/temporada/clube/usuário
 */
LiquidacaoSchema.index({
  campeonato: 1,
  temporada: 1,
  clubeId: 1,
  usuarioId: 1,
});

/**
 * Índice útil para relatórios operacionais
 */
LiquidacaoSchema.index({
  dataLiquidacao: -1,
  status: 1,
});
mongoose.model('Liquidacao', LiquidacaoSchema)


module.exports = {
  checkLiquidacao,
  liquidarBrasileirao,
  calcularPrecoPorPosicao,
  ajustarPrecoLiquidacaoPorSplit,
};