'use strict';
function one(source,anchor,replacement,name) {
  const pieces=source.split(anchor);
  if(pieces.length!==2) throw new Error(`[${name}] âncora ${JSON.stringify(anchor.slice(0,80))} encontrada ${pieces.length-1} vez(es) (esperado 1).`);
  return pieces.join(replacement);
}
function all(source,anchor,replacement,expected,name){
  const n=source.split(anchor).length-1;
  if(n!==expected) throw new Error(`[${name}] âncora encontrada ${n} vez(es), esperado ${expected}`);
  return source.split(anchor).join(replacement);
}
function changeController(s){
 const name='controller IPO';
 s=one(s,"const Order = require('../models/Order');", "const Order = require('../models/Order');\nconst { assertFreshForClub } = require('../services/liveFootballTable');",name);
 // Ambas as operações precisam validar dados atuais antes da transação.
 s=all(s,"    let resposta;\n\n    await session.withTransaction(async () => {", `    let resposta;
    // Reavalia resultados e posições antes de permitir negociar pelo preço vigente.
    const clubePreflight = await Club.findOne({ legacyId: legacyClubeId }).lean();
    if (clubePreflight) await assertFreshForClub(clubePreflight);

    await session.withTransaction(async () => {`,2,name);
 // A verificação do preço enviado pelo frontend evita alteração silenciosa do preço entre visualizar e confirmar.
 s=all(s,"      const precoUnitario = getPrecoClube(clube);\n\n      if (!Number.isFinite(precoUnitario) || precoUnitario <= 0) {", `      const precoUnitario = getPrecoClube(clube);
      const precoEsperado = Number(req.body?.precoEsperado);
      if (!Number.isFinite(precoEsperado) || Math.abs(precoEsperado - precoUnitario) > 0.001) {
        throw new Error('PRECO_ATUALIZADO');
      }

      if (!Number.isFinite(precoUnitario) || precoUnitario <= 0) {`,2,name);
 // Recompra IPO: a franquia Lite precisa ser consumida DENTRO da transação antes de atualizar saldo.
 s=one(s,"      atualizarCarteiraDevolucao(usuario, clube, quantidade);\n\n      const total = round2(precoUnitario * quantidade);",`      // A venda ao sistema também é uma ordem executada e compartilha a franquia Lite.
      const temporadaIPO = await RankingSeason.findOne({ status: 'ativa' })
        .sort({ iniciadaEm: -1, createdAt: -1 }).session(session);
      if (!temporadaIPO) throw new Error('TEMPORADA_NAO_ATIVA');
      if (temporadaIPO.mercadoAberto === false) throw new Error('MERCADO_FECHADO');
      const planoIPO = obterPlanoEfetivo(usuario);
      let quotaIPO = null;
      let periodoQuotaIPO = null;
      if (planoIPO === 'lite') {
        const limiteLite = Number(temporadaIPO.limiteOrdensLiteSemanal ?? temporadaIPO.limiteOrdensLitePorRodada ?? LIMITE_SEMANAL_LITE_PADRAO);
        await reconciliarQuotaComOrdensExecutadas({ usuario, temporada: temporadaIPO, session, limiteLite });
        const consumida = await consumirOrdemQuotaSemanal({ usuario, temporada: temporadaIPO, session, limiteLite });
        quotaIPO = { limite: consumida.limite, utilizadas: consumida.utilizadas,
          restantes: consumida.restantes, limiteAtingido: consumida.limiteAtingido };
        periodoQuotaIPO = consumida.janela.periodoChave;
      }

      atualizarCarteiraDevolucao(usuario, clube, quantidade);

      const total = round2(precoUnitario * quantidade);`,name);
 s=one(s,"              operacao: 'DEVOLUCAO_IPO',", "              operacao: 'DEVOLUCAO_IPO',\n              quotaLiteContabilizada: planoIPO === 'lite',\n              quotaLitePeriodo: periodoQuotaIPO,",name);
 s=one(s,"        mensagem: 'Venda ao sistema executada pelo preço atual da classificação.',\n        tipo: 'IPO_RETURN',", "        mensagem: 'Venda ao sistema executada pelo preço atual da classificação.',\n        plano: { tipo: planoIPO, ordensIlimitadas: planoIPO === 'premium' },\n        franquiaOrdens: quotaIPO,\n        tipo: 'IPO_RETURN',",name);
 // Para as duas rotas, só a captura de erro de cada função é alterada.
 s=one(s,"    console.error('Erro ao devolver cotas ao IPO:', err);\n\n    const mapa = {",`    console.error('Erro ao devolver cotas ao IPO:', err);
    if (err?.message === 'LIMITE_SEMANAL_ORDENS_ATINGIDO') {
      return res.status(403).json({ codigo: 'LIMITE_ORDENS_ATINGIDO',
        erro: 'Você atingiu o limite semanal de ordens do Plano Lite.',
        limite: err.limite, utilizadas: err.utilizadas, restantes: 0, renovaEm: err.renovaEm });
    }
    if (err?.liveData) return res.status(503).json({ codigo: 'DADOS_ESPORTIVOS_INDISPONIVEIS',
      erro: 'Preço indisponível: não foi possível confirmar a classificação atualizada.' });
    const mapa = {
      PRECO_ATUALIZADO: [409, 'O preço mudou com a classificação. Confira o novo preço e confirme novamente.'],
      TEMPORADA_NAO_ATIVA: [409, 'Nenhuma temporada ativa para vender cotas IPO.'],
      MERCADO_FECHADO: [409, 'Mercado fechado para negociação.'],`,name);
 s=one(s,"    console.error('Erro ao comprar cota IPO:', err);\n\n    if (err?.message === 'LIMITE_SEMANAL_ORDENS_ATINGIDO')",`    console.error('Erro ao comprar cota IPO:', err);
    if (err?.liveData) return res.status(503).json({ codigo: 'DADOS_ESPORTIVOS_INDISPONIVEIS',
      erro: 'Preço indisponível: não foi possível confirmar a classificação atualizada.' });
    if (err?.message === 'PRECO_ATUALIZADO') return res.status(409).json({ codigo: 'PRECO_ATUALIZADO',
      erro: 'O preço mudou com a classificação. Confira o novo preço e confirme novamente.' });

    if (err?.message === 'LIMITE_SEMANAL_ORDENS_ATINGIDO')`,name);
 return s;
}
function changeQuota(s){
 return one(s,"  // Cada compra IPO já concluída conta uma ordem; devolução IPO não consome.\n  let consultaIPO = Investment.countDocuments({\n    usuarioId: usuario._id,\n    tipo: 'IPO',",`  // Toda compra ou venda IPO executada consome uma ordem. Conta cada operação uma vez.
  let consultaIPO = Investment.countDocuments({
    usuarioId: usuario._id,
    tipo: { $in: ['IPO', 'IPO_RETURN'] },`, 'quota');
}
function changeRoutes(s){
 const n='tabelas';
 s=one(s,"const { getMarketMode } = require('../config/marketMode');", "const { getMarketMode } = require('../config/marketMode');\nconst liveFootball = require('../services/liveFootballTable');",n);
 s=one(s,"  let config = { ...configBase };\n  let classificacao = [];",`  // Partidas atuais e concluídas governam o preço do IPO durante a fase de liga.
  // Em falha, exibimos a última tabela como contingência, mas o backend recusa
  // negociações sem dados frescos (assertFreshForClub).
  if (configBase.esporte === 'football' && liveFootball.enabled(configBase.id)) {
    res.set('Cache-Control', 'no-store, max-age=0');
    try {
      const status = await liveFootball.refreshCompetition(configBase);
      const data = await loadCachedTable(Club, configBase.id);
      return res.json({ data, mercado: configBase.id, nome: configBase.nome,
        temporada: configBase.season, participantes: configBase.participantes,
        atualizadoEm: new Date(status.at).toISOString(), live: status.live,
        origem: 'partidas', contingencia: false, precosAtualizados: true });
    } catch (erro) {
      console.error('[LIVE TABLE:'+configBase.id+']', erro.message);
      const data = await loadCachedTable(Club, configBase.id);
      return res.json({ data, mercado: configBase.id, nome: configBase.nome,
        temporada: configBase.season, contingencia: true,
        precosAtualizados: false, mercadoBloqueadoPorDados: true,
        aviso: 'Dados ao vivo indisponíveis. Negociações deste mercado temporariamente bloqueadas.' });
    }
  }
  let config = { ...configBase };
  let classificacao = [];`,n);
 return s;
}
function changeBrasil(s){
 const n='brasileirao';
 s=one(s,"const { getMarketMode } = require('../config/marketMode');", "const { getMarketMode } = require('../config/marketMode');\nconst liveFootball = require('../services/liveFootballTable');\nconst sportsMarkets = require('../config/sportsMarkets');",n);
 s=one(s,"router.get('/tabela-brasileirao', async (req, res) => {\n\n  try {",`router.get('/tabela-brasileirao', async (req, res) => {

  if (liveFootball.enabled('brasileirao-a')) {
    res.set('Cache-Control', 'no-store, max-age=0');
    try {
      const snapshot = await liveFootball.refreshCompetition(sportsMarkets['brasileirao-a']);
      const data = await loadCachedTable(Club,'brasileirao-a');
      return res.json({data,atualizadoEm:new Date(snapshot.at).toISOString(),live:snapshot.live,
        origem:'partidas',contingencia:false,precosAtualizados:true});
    } catch (erro) {
      console.error('[LIVE BRASILEIRAO]',erro.message);
      const data = await loadCachedTable(Club,'brasileirao-a');
      return res.json({data,contingencia:true,mercadoBloqueadoPorDados:true,
        precosAtualizados:false,aviso:'Dados ao vivo indisponíveis. Negociação bloqueada até atualização.'});
    }
  }

  try {`,n);
 return s;
}
function changeFrontendMarket(s){
 const n='mercado frontend';
 s=one(s,"  const fetchDados = async () => {\n    try {\n      setCarregando(true);\n      setErro('');",`  const fetchDados = async ({ silent = false } = {}) => {
    try {
      if (!silent) setCarregando(true);
      if (!silent) setErro('');`,n);
 s=one(s,"      const resTabela = await axios.get(`${API_BASE}${mercado.endpoint}`);",'      const resTabela = await axios.get(`${API_BASE}${mercado.endpoint}`, {headers:{"Cache-Control":"no-cache"}});',n);
 s=one(s,"      setClubes(clubesApi);",`      setClubes(clubesApi);
      setErro(resTabela?.data?.mercadoBloqueadoPorDados
        ? 'Dados esportivos indisponíveis: classificação pode estar desatualizada e as operações estão bloqueadas.'
        : '');`,n);
 s=one(s,'      setClubes([]);\n      setErro(`Não foi possível carregar os ${mercado.entidade === \'time\' ? \'times\' : \'clubes\'} deste mercado.`);\n    } finally {\n      setCarregando(false);',`      if (!silent) {
        setClubes([]);
        setErro('Não foi possível atualizar a classificação.');
      }
    } finally {
      if (!silent) setCarregando(false);`,n);
 s=one(s,"  const favoritosClubes = useMemo(",`  // Recarrega a tabela sem piscar o loading. Uma requisição apenas por aba.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchDados({ silent: true });
    }, 20_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [LIGA_ID]);

  const favoritosClubes = useMemo(`,n);
 return s;
}
function changeModal(s){
 const n='modal';
 s=one(s,"    // Compra IPO e operações secundárias compartilham a mesma franquia.\n    // A devolução ao sistema no IPO continua sem consumir ordens.\n    if (ipoEncerrado || modo === 'compra') {",`    // Compras e vendas executadas no IPO e no secundário consomem a mesma franquia.
    if (modo === 'compra' || modo === 'venda') {`,n);
 s=one(s,"const mercadoSecundarioBloqueado =\n  ligaFechada || ((ipoEncerrado || modo === 'compra') &&",`const mercadoSecundarioBloqueado =
  ligaFechada || ((ipoEncerrado || modo === 'compra' || modo === 'venda') &&`,n);
 s=one(s,"'Durante o IPO, você vende imediatamente ao sistema pelo preço atual da posição do clube, sem taxas. O resultado pode ser lucro ou prejuízo.'",`'Durante o IPO, você vende imediatamente ao sistema pelo preço atual da posição do clube, sem taxas. Cada venda executada consome 1 ordem da franquia semanal Lite.'`,n);
 s=one(s,"'No IPO, compra e venda seguem o preço atual da posição do clube na tabela. Sem taxas e sem livro de ofertas. Cada compra executada consome 1 ordem da franquia semanal Lite; vendas ao sistema não consomem.'",`'No IPO, compra e venda seguem o preço atual da classificação, sem taxas ou livro de ofertas. Cada compra ou venda consome 1 ordem semanal Lite.'`,n);
 s=one(s,"           {(ipoEncerrado || modo === 'compra') && usuario && (",`           {usuario && (`,n);
 // Botão e texto devem refletir o limite tanto em compra quanto em venda.
 s=all(s,"(ipoEncerrado || modo === 'compra') &&","(ipoEncerrado || modo === 'compra' || modo === 'venda') &&",4,n);
 // Aceitação explícita do preço para impedir slippage silencioso após um gol.
 s=all(s,"            quantidade: Number(quantidade),\n          },",`            quantidade: Number(quantidade),
            precoEsperado: Number(precoAtual),
          },`,2,n);
 s=one(s,"  const codigoErro =\n    error?.response?.data?.codigo;",`  const codigoErro =
    error?.response?.data?.codigo;
  if (codigoErro === 'PRECO_ATUALIZADO') {
    await verificarIPO();
  }`,n);
 return s;
}
function changeBook(s){
 const n='book secundario';
 s=one(s,"const { isUnifiedLiquidity, getMarketMode } = require('../config/marketMode');","const { isUnifiedLiquidity, getMarketMode } = require('../config/marketMode');\nconst { assertFreshForClub } = require('../services/liveFootballTable');",n);
 s=all(s,"    const clubeDocumento = await Club.findOne({ legacyId: clubeLegacyId });",`    let clubeDocumento = await Club.findOne({ legacyId: clubeLegacyId });
    if (clubeDocumento) {
      await assertFreshForClub(clubeDocumento);
      clubeDocumento = await Club.findOne({ legacyId: clubeLegacyId });
    }`,2,n);
 s=one(s,"    const usuariosParaVerificarMilestone =\n      new Set();\n\n    await session.withTransaction(async () => {",`    const usuariosParaVerificarMilestone =
      new Set();

    const clubeAntesDeNegociar = await Club.findOne({ legacyId: clubeLegacyId }).lean();
    if (clubeAntesDeNegociar) await assertFreshForClub(clubeAntesDeNegociar);

    await session.withTransaction(async () => {`,n);
 s=one(s,"      'Erro ao enviar ordem:',\n      err\n    );",`      'Erro ao enviar ordem:',
      err
    );
    if (err?.liveData) return res.status(503).json({
      codigo: 'DADOS_ESPORTIVOS_INDISPONIVEIS',
      erro: 'Classificação ao vivo indisponível. Ordens temporariamente bloqueadas.'
    });`,n);
 return s;
}
module.exports={
 'backend/controllers/InvestimentoController.js':changeController,
 'backend/routes/mercado.js':changeBook,
 'backend/utils/tradingQuota.js':changeQuota,
 'backend/routes/sportsStandings.js':changeRoutes,
 'backend/routes/classificacao.js':changeBrasil,
 'frontend/pages/brasileirao-a.js':changeFrontendMarket,
 'frontend/components/NegociacaoModal.js':changeModal,
};
