const mongoose = require('mongoose');

const LoginHistorySchema = new mongoose.Schema(
  {
    at: { type: Date },
    ip: { type: String, default: null },
    ua: { type: String, default: null },
  },
  { _id: false }
);

const AceiteSchema = new mongoose.Schema(
  {
    versao: { type: String, default: null },
    aceitoEm: { type: Date, default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { _id: false }
);

const CarteiraAtivoSchema = new mongoose.Schema(
  {
    clubeId: { type: Number, required: true, index: true },
    nomeClube: { type: String, default: '' },
    quantidade: { type: Number, default: 0 },
    precoMedio: { type: Number, default: 0 },
    totalInvestido: { type: Number, default: 0 },
  },
  { _id: false }
);

const WatchlistEntitySchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    nome: { type: String, default: '' },
    ligaId: { type: String, default: null },
    ligaNome: { type: String, default: null },
  },
  { _id: false }
);

const NotificacaoSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    title: { type: String, default: '' },
    body: { type: String, default: '' },
    read: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const DadosBancariosSchema = new mongoose.Schema(
  {
    banco: { type: String, default: null },
    agencia: { type: String, default: null },
    conta: { type: String, default: null },
    tipoConta: { type: String, default: null },
    pixTipo: { type: String, default: null },
    pixChave: { type: String, default: null },
    favorecido: { type: String, default: null },
    cpfFavorecido: { type: String, default: null },
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema(
  {
    legacyId: { type: Number, index: true, unique: true, sparse: true },

    nome: { type: String, required: true },
    sobrenome: { type: String, default: '' },
    nomeUsuario: { type: String, required: true, unique: true, index: true },
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    cpf: { type: String, unique: true, sparse: true, index: true },
    dataNascimento: { type: String, default: null },
    genero: { type: String, default: null },

    senha: { type: String, required: true },

    capitalInicial: { type: Number, default: 1000 },
saldo: { type: Number, default: 1000 },

temporadaRanking: {
  type: String,
  default: null,
  index: true,
},

patrimonioInicialTemporada: {
  type: Number,
  default: null,
},

saldoInicialTemporada: {
  type: Number,
  default: null,
},

inicioTemporadaRanking: {
  type: Date,
  default: null,
},

rankingAtivo: {
  type: Boolean,
  default: true,
},

plano: {
  type: String,
  enum: ['lite', 'premium'],
  default: 'lite',
  index: true,
},

premiumAtivo: {
  type: Boolean,
  default: false,
},

premiumInicio: {
  type: Date,
  default: null,
},

premiumFim: {
  type: Date,
  default: null,
},

    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    admin: { type: Boolean, default: false },

    carteira: { type: [CarteiraAtivoSchema], default: [] },

    historico: { type: [mongoose.Schema.Types.Mixed], default: [] },
    transacoes: { type: [mongoose.Schema.Types.Mixed], default: [] },

    dadosBancarios: { type: DadosBancariosSchema, default: null },

    aceites: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    aceitesFinanceiros: {
      deposito: { type: AceiteSchema, default: () => ({}) },
      saque: { type: AceiteSchema, default: () => ({}) },
    },

    aceitouTermos: { type: Boolean, default: false },
    aceitouTermosEm: { type: Date, default: null },
    versaoTermosAceita: { type: String, default: null },

    emailVerificado: { type: Boolean, default: false },
    tokenVerificacao: { type: String, default: null, index: true },
    emailVerificadoEm: { type: Date, default: null },

    resetSenhaToken: { type: String, default: null, index: true },
    resetSenhaExpiraEm: { type: Number, default: null },
    senhaAlteradaEm: { type: Date, default: null },

    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },

    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null },
    lastLoginUserAgent: { type: String, default: null },

    loginHistory: { type: [LoginHistorySchema], default: [] },

    watchlist: {
      clubes: { type: [WatchlistEntitySchema], default: [] },
      ligas: { type: [WatchlistEntitySchema], default: [] },
    },

    notificacoes: { type: [NotificacaoSchema], default: [] },

    alertState: {
      type: mongoose.Schema.Types.Mixed,
      default: { clubPrices: {} },
    },

    ledgerMirror: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  {
    timestamps: true,
    collection: 'users',
  }
);

function normalizarAtivoCarteira(ativo) {
  if (!ativo) return null;

  const obj = ativo.toObject ? ativo.toObject() : ativo;

  const clubeIdRaw =
    obj.clubeId ??
    obj.clubeLegacyId ??
    obj.idClube ??
    obj.clube?.id ??
    obj.clube?.legacyId ??
    obj.clube?._id;

  const clubeId = Number(clubeIdRaw);

  if (!Number.isFinite(clubeId) || clubeId <= 0) {
    return null;
  }

  const quantidade = Number(obj.quantidade ?? obj.cotas ?? 0);

  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    return null;
  }

  const precoMedio = Number(obj.precoMedio ?? obj.valorUnitario ?? obj.preco ?? 0);
  const totalInvestidoRaw =
    obj.totalInvestido != null
      ? Number(obj.totalInvestido)
      : Number(quantidade) * Number(precoMedio || 0);

  return {
    clubeId,
    nomeClube: obj.nomeClube || obj.clubeNome || obj.nome || obj.clube?.nome || '',
    quantidade,
    precoMedio: Number(Number(precoMedio || 0).toFixed(2)),
    totalInvestido: Number(Number(totalInvestidoRaw || 0).toFixed(2)),
  };
}

function normalizarCarteira(carteira) {
  const arr = Array.isArray(carteira) ? carteira : [];
  const mapa = new Map();

  for (const ativo of arr) {
    const normalizado = normalizarAtivoCarteira(ativo);
    if (!normalizado) continue;

    const key = String(normalizado.clubeId);
    const atual = mapa.get(key);

    if (!atual) {
      mapa.set(key, normalizado);
      continue;
    }

    const qtdTotal = Number(atual.quantidade || 0) + Number(normalizado.quantidade || 0);
    const totalInvestido =
      Number(atual.totalInvestido || 0) + Number(normalizado.totalInvestido || 0);

    mapa.set(key, {
      clubeId: normalizado.clubeId,
      nomeClube: atual.nomeClube || normalizado.nomeClube,
      quantidade: qtdTotal,
      totalInvestido: Number(totalInvestido.toFixed(2)),
      precoMedio: qtdTotal > 0 ? Number((totalInvestido / qtdTotal).toFixed(2)) : 0,
    });
  }

  return Array.from(mapa.values());
}

UserSchema.pre('validate', function (next) {
  this.carteira = normalizarCarteira(this.carteira);
  next();
});

UserSchema.pre('save', function (next) {
  if (this.admin === true || this.role === 'admin') {
    this.role = 'admin';
    this.admin = true;
  } else {
    this.role = 'user';
    this.admin = false;
  }

  if (this.email) {
    this.email = String(this.email).trim().toLowerCase();
  }

  next();
});

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);

