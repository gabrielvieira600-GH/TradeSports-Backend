const LEGAL_DOCUMENTS = Object.freeze({
  termosUso: Object.freeze({
    tipo: "termosUso",
    versao: "1.0",
    exigeAceite: true,
  }),
  politicaRisco: Object.freeze({
    tipo: "politicaRisco",
    versao: "1.0",
    exigeAceite: true,
  }),
  politicaPrivacidade: Object.freeze({
    tipo: "politicaPrivacidade",
    versao: "1.0",
    exigeAceite: true,
  }),
});

const LEGAL_DOCUMENT_TYPES = Object.freeze(Object.keys(LEGAL_DOCUMENTS));

function documentoLegal(tipo) {
  return LEGAL_DOCUMENTS[String(tipo || "")] || null;
}

function normalizarVersao(versao) {
  return String(versao || "")
    .trim()
    .replace(/^v(?=\d)/i, "");
}

function pendenciasAceite(aceitesAtuais = {}) {
  return LEGAL_DOCUMENT_TYPES.filter((tipo) => {
    const documento = LEGAL_DOCUMENTS[tipo];
    return (
      documento.exigeAceite &&
      normalizarVersao(aceitesAtuais?.[tipo]?.versao) !==
        normalizarVersao(documento.versao)
    );
  });
}

module.exports = {
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_TYPES,
  documentoLegal,
  normalizarVersao,
  pendenciasAceite,
};
