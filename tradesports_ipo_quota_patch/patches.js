'use strict';
const p=(label,before,after)=>({label,before,after});
function makePatches(){
 const backendController = [
   p('imports quota',
`const Order = require('../models/Order');`,
`const Order = require('../models/Order');
const RankingSeason = require('../models/RankingSeason');
const { obterPlanoEfetivo } = require('../utils/planFeatures');
const {
  LIMITE_SEMANAL_LITE_PADRAO,
  reconciliarQuotaComOrdensExecutadas,
  consumirOrdemQuotaSemanal,
} = require('../utils/tradingQuota');`),
   p('resumo quota do IPO',
`    let resposta;

    await session.withTransaction(async () => {`,
`    let resposta;

    await session.withTransaction(async () => {`), // replaced below removing no-op
   p('consulta temporada e franquia dentro da transação',
`      if (saldoAtual < total) {
        throw new Error('SALDO_INSUFICIENTE');
      }

      usuario.saldo = round2(saldoAtual - total);`,
`      if (saldoAtual < total) {
        throw new Error('SALDO_INSUFICIENTE');
      }

      // Mesmo limite semanal do secundário: uma COMPRA IPO executada = 1 ordem.
      // Em transação: se qualquer lançamento falhar, a quota volta atrás.
      const temporada = await RankingSeason.findOne({ status: 'ativa' })
        .sort({ iniciadaEm: -1, createdAt: -1 }).session(session);
      if (!temporada) throw new Error('TEMPORADA_NAO_ATIVA');
      if (temporada.mercadoAberto === false) throw new Error('MERCADO_FECHADO');

      const planoIPO = obterPlanoEfetivo(usuario);
      let quotaIPO = null;
      let periodoQuotaIPO = null;
      if (planoIPO === 'lite') {
        const limiteLite = Number(
          temporada.limiteOrdensLiteSemanal ??
          temporada.limiteOrdensLitePorRodada ??
          LIMITE_SEMANAL_LITE_PADRAO
        );
        // Reconcilia execução do secundário + compras anteriores no IPO.
        await reconciliarQuotaComOrdensExecutadas({
          usuario, temporada, session, limiteLite,
        });
        const consumida = await consumirOrdemQuotaSemanal({
          usuario, temporada, session, limiteLite,
        });
        quotaIPO = {
          limite: consumida.limite,
          utilizadas: consumida.utilizadas,
          restantes: consumida.restantes,
          limiteAtingido: consumida.limiteAtingido,
        };
        periodoQuotaIPO = consumida.janela.periodoChave;
      }

      usuario.saldo = round2(saldoAtual - total);`),
   p('metadata para auditar compra',
`              rota: '/clube/:id/comprar',
            },`,
`              rota: '/clube/:id/comprar',
              quotaLiteContabilizada: planoIPO === 'lite',
              quotaLitePeriodo: periodoQuotaIPO,
            },`),
   p('resposta de franquia',
`        mensagem: 'Compra de IPO executada pelo preço atual da classificação.',
        investimento,`,
`        mensagem: 'Compra de IPO executada pelo preço atual da classificação.',
        plano: { tipo: planoIPO, ordensIlimitadas: planoIPO === 'premium' },
        franquiaOrdens: quotaIPO,
        investimento,`),
   p('erro de limite semanal IPO',
`    console.error('Erro ao comprar cota IPO:', err);

    const mapa = {
      USUARIO_NAO_ENCONTRADO: [404, 'Usuário não encontrado.'],`,
`    console.error('Erro ao comprar cota IPO:', err);

    if (err?.message === 'LIMITE_SEMANAL_ORDENS_ATINGIDO') {
      return res.status(403).json({
        codigo: 'LIMITE_ORDENS_ATINGIDO',
        erro: 'Você atingiu o limite semanal de ordens do Plano Lite.',
        limite: err.limite,
        utilizadas: err.utilizadas,
        restantes: 0,
        renovaEm: err.renovaEm,
      });
    }

    const mapa = {
      TEMPORADA_NAO_ATIVA: [409, 'Nenhuma temporada ativa para realizar compras IPO.'],
      USUARIO_NAO_ENCONTRADO: [404, 'Usuário não encontrado.'],`),
 ];
 backendController.splice(1,1); // no-op removal
 const tradingQuota = [
   p('import Investment',
`const Order = require('../models/Order');`,
`const Order = require('../models/Order');
const Investment = require('../models/Investment');`),
   p('reconciliação IPO e secundário',
`  if (session) consulta = consulta.session(session);
  const executadas = await consulta;

  quota.ordensUtilizadas = Math.max(0, Number(executadas || 0));`,
`  if (session) consulta = consulta.session(session);
  const ordensSecundario = await consulta;

  // Cada compra IPO já concluída conta uma ordem; devolução IPO não consome.
  let consultaIPO = Investment.countDocuments({
    usuarioId: usuario._id,
    tipo: 'IPO',
    data: { $gte: janela.periodoInicio, $lt: janela.periodoFim },
  });
  if (session) consultaIPO = consultaIPO.session(session);
  const comprasIPO = await consultaIPO;
  const executadas = Number(ordensSecundario || 0) + Number(comprasIPO || 0);

  quota.ordensUtilizadas = Math.max(0, executadas);`),
 ];
 const frontend = [
   p('aplicar quota no IPO de compra',
`    if (ipoEncerrado) {
  if (limiteOrdens.carregando) {`,
`    // Compra IPO e operações secundárias compartilham a mesma franquia.
    // A devolução ao sistema no IPO continua sem consumir ordens.
    if (ipoEncerrado || modo === 'compra') {
  if (limiteOrdens.carregando) {`),
   p('bloqueio fail closed em consulta da franquia',
`  if (!limiteOrdens.temporadaAtiva) {
    setMensagem(`,
`  if (limiteOrdens.erro) {
    setMensagem(limiteOrdens.erro);
    adicionarToast(limiteOrdens.erro, 'erro');
    setCarregando(false);
    return;
  }

  if (!limiteOrdens.temporadaAtiva) {
    setMensagem(`),
   p('franquia visível no IPO de compra',
`           {ipoEncerrado && usuario && (
  <FranquiaCard`,
`           {(ipoEncerrado || modo === 'compra') && usuario && (
  <FranquiaCard`),
   p('mensagem explicativa IPO compra',
`'No IPO, compra e venda seguem o preço atual da posição do clube na tabela. Sem taxas e sem livro de ofertas nesta fase.'`,
`'No IPO, compra e venda seguem o preço atual da posição do clube na tabela. Sem taxas e sem livro de ofertas. Cada compra executada consome 1 ordem da franquia semanal Lite; vendas ao sistema não consomem.'`),
   p('botão bloqueado na compra IPO',
`const mercadoSecundarioBloqueado =
  ligaFechada || (ipoEncerrado &&
  Boolean(usuario) &&
  (
    limiteOrdens.carregando ||`,
`const mercadoSecundarioBloqueado =
  ligaFechada || ((ipoEncerrado || modo === 'compra') &&
  Boolean(usuario) &&
  (
    limiteOrdens.carregando ||
    Boolean(limiteOrdens.erro) ||`),
   p('label carregando franquia IPO',
`  : ipoEncerrado &&
    limiteOrdens.carregando
  ? 'Verificando franquia...'`,
`  : (ipoEncerrado || modo === 'compra') &&
    limiteOrdens.carregando
  ? 'Verificando franquia...'`),
   p('label temporada IPO',
`  : ipoEncerrado &&
    !limiteOrdens.temporadaAtiva
  ? 'Temporada indisponível'`,
`  : (ipoEncerrado || modo === 'compra') &&
    !limiteOrdens.temporadaAtiva
  ? 'Temporada indisponível'`),
   p('label mercado IPO',
`  : ipoEncerrado &&
  !limiteOrdens.mercadoAberto
? 'Mercado fechado'`,
`  : (ipoEncerrado || modo === 'compra') &&
  !limiteOrdens.mercadoAberto
? 'Mercado fechado'`),
   p('label limite atingido IPO',
`  : ipoEncerrado &&
    limiteOrdens.plano === 'lite' &&
    limiteOrdens.limiteAtingido
  ? 'Limite de ordens atingido'`,
`  : (ipoEncerrado || modo === 'compra') &&
    limiteOrdens.plano === 'lite' &&
    limiteOrdens.limiteAtingido
  ? 'Limite de ordens atingido'`),
 ];
 return [
  {repo:'backend',file:'utils/tradingQuota.js',replacements:tradingQuota},
  {repo:'backend',file:'controllers/InvestimentoController.js',replacements:backendController},
  {repo:'frontend',file:'components/NegociacaoModal.js',replacements:frontend},
 ];
}
module.exports={makePatches};
