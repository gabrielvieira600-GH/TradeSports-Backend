const mongoose = require("mongoose");

const LegalAcceptanceSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
      immutable: true,
    },
    tipo: {
      type: String,
      enum: ["termosUso", "politicaRisco", "politicaPrivacidade"],
      required: true,
      immutable: true,
    },
    versao: {
      type: String,
      required: true,
      immutable: true,
    },
    aceitoEm: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
    },
    ip: {
      type: String,
      default: null,
      immutable: true,
    },
    userAgent: {
      type: String,
      default: null,
      immutable: true,
    },
    origem: {
      type: String,
      enum: ["cadastro", "reaceite"],
      required: true,
      immutable: true,
    },
  },
  {
    collection: "legal_acceptances",
    versionKey: false,
  },
);

LegalAcceptanceSchema.index(
  { usuarioId: 1, tipo: 1, versao: 1 },
  { unique: true },
);

module.exports =
  mongoose.models.LegalAcceptance ||
  mongoose.model("LegalAcceptance", LegalAcceptanceSchema);
