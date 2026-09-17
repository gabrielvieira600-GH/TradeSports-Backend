// QA PACK 1 — backend/routes/clube.js
const InstitutionalLiquidity = require('../models/InstitutionalLiquidity');
const { isUnifiedLiquidity } = require('../config/marketMode');

function toClubResponse(clube, liquidityState = null) {
  const maximoCotas = Number(liquidityState?.maxShares ?? 1000);
  const cotasEmitidas = Number(liquidityState?.issuedShares ?? clube.cotasEmitidas ?? 0);
  const cotasInstitucionais = Math.max(
    0,
    Number(liquidityState?.institutionHeldIssuedShares ?? 0)
  );
  const cotasEmCirculacao = Math.max(0, cotasEmitidas - cotasInstitucionais);
  const cotasDisponiveis = isUnifiedLiquidity()
    ? Math.max(0, maximoCotas - cotasEmCirculacao)
    : Number(clube.cotasDisponiveis || 0);

  return {
    id: clube.legacyId,
    nome: clube.nome,
    escudo: clube.escudo || '',
    posicao: clube.posicao ?? null,
    preco: Number(clube.preco || 0),
    precoAtual: clube.precoAtual != null ? Number(clube.precoAtual) : Number(clube.preco || 0),
    cotasDisponiveis,
    cotasEmitidas,
    cotasEmCirculacao,
    cotasInstitucionais,
    maximoCotas,
    ipoEncerrado: Boolean(clube.ipoEncerrado),
    splitFactorCumulativo: Number(clube.splitFactorCumulativo || 1),
    travadoAte: Number(clube.travadoAte || 0),
    metadata: clube.metadata || {},
  };
}

// GET /clubes: carregue todos os estados em uma única consulta:
const estados = isUnifiedLiquidity()
  ? await InstitutionalLiquidity.find({
      clubLegacyId: { $in: clubes.map((c) => c.legacyId) },
    }).lean()
  : [];
const porLegacyId = new Map(estados.map((e) => [Number(e.clubLegacyId), e]));
return res.json(
  clubes.map((clube) => toClubResponse(clube, porLegacyId.get(Number(clube.legacyId))))
);

// GET /clubes/:id e GET /:id, antes do return:
const liquidityState = isUnifiedLiquidity()
  ? await InstitutionalLiquidity.findOne({ clubLegacyId: legacyId }).lean()
  : null;
return res.json(toClubResponse(clube, liquidityState));
