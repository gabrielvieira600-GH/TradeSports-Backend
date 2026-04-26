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
    email: { type: String, required: true, unique: true, index: true },
    cpf: { type: String, unique: true, sparse: true, index: true },
    dataNascimento: { type: String, default: null },
    genero: { type: String, default: null },

    senha: { type: String, required: true },

    saldo: { type: Number, default: 0 },

    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    admin: { type: Boolean, default: false },

    carteira: { type: [CarteiraAtivoSchema], default: [] },
    dadosBancarios: { type: DadosBancariosSchema, default: null },

    aceitesFinanceiros: {
      deposito: { type: AceiteSchema, default: () => ({}) },
      saque: { type: AceiteSchema, default: () => ({}) },
    },

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

UserSchema.pre('save', function (next) {
  if (this.admin === true || this.role === 'admin') {
    this.role = 'admin';
    this.admin = true;
  } else {
    this.role = 'user';
    this.admin = false;
  }
  next();
});

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);