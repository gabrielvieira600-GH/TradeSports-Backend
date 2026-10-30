'use strict';
const fs=require('fs');const path=require('path');
const file=path.join(process.cwd(),'routes','api','admin.js');
if(!fs.existsSync(file)){console.error('Execute na raiz do BACKEND: routes/api/admin.js não encontrado.');process.exit(1)}
let src=fs.readFileSync(file,'utf8');
const marker='// TRADE SPORTS: PRECIFICACAO POS-LIQUIDACAO V3';
if(src.includes(marker)){console.log('Patch já aplicado.');process.exit(0)}
const helper=`${marker}
// Operações históricas permanecem no banco. Uma liquidação concluída inicia
// novo ciclo: somente negociações humanas posteriores à liquidação bloqueiam.
async function clubeTemOperacaoDoCiclo(clube, OrderModel, InvestmentModel) {
  const dataLiberacao = clube.metadata?.precificacaoLiberadaEm;
  if (!dataLiberacao) {
    const [ordem, investimento] = await Promise.all([
      OrderModel.exists({ clubeId: clube._id, isInstitutional: { $ne: true } }),
      InvestmentModel.exists({ clubeId: clube._id })
    ]);
    return Boolean(ordem || investimento);
  }
  const inicio = new Date(dataLiberacao);
  if (Number.isNaN(inicio.getTime())) return true;
  const [ordem, investimento] = await Promise.all([
    OrderModel.exists({ clubeId: clube._id, isInstitutional: { $ne: true }, criadoEm: { $gt: inicio }, status: { $in: ['aberta', 'parcial', 'executada'] } }),
    InvestmentModel.exists({ clubeId: clube._id, data: { $gt: inicio }, tipo: { $nin: ['LIQUIDACAO', 'DIVIDENDO'] } })
  ]);
  return Boolean(ordem || investimento);
}
function clubeProntoParaPrecificar(clube) {
  return clube.cotasEmitidas === 0 && clube.cotasDisponiveis === 1000 &&
    !clube.ipoEncerrado && !(clube.splits || []).length;
}
`;
const begin=src.indexOf("router.get('/initial-prices/:ligaId'");
const end=src.indexOf("router.get('/market-controls'",begin);
if(begin<0||end<0){console.error('Estrutura da rota de precificação mudou; nenhum arquivo alterado.');process.exit(1)}
const newRoutes=`router.get('/initial-prices/:ligaId', async (req, res) => {
  try {
    const ligaId = req.params.ligaId;
    if (!sportsMarkets[ligaId]) return res.status(404).json({ erro: 'Liga inválida.' });
    const clubs = await Club.find({ 'metadata.ligaId': ligaId }).sort({ nome: 1 }).lean();
    const Order = require('../../models/Order');
    const clubes = await Promise.all(clubs.map(async c => {
      const operacoes = await clubeTemOperacaoDoCiclo(c, Order, Investment);
      return { id: c.legacyId, nome: c.nome, precoInicial: c.preco,
        precoAtual: c.precoAtual, cotasDisponiveis: c.cotasDisponiveis,
        editavel: clubeProntoParaPrecificar(c) && !operacoes,
        motivoBloqueio: !clubeProntoParaPrecificar(c) ? 'Existem cotas emitidas, IPO encerrado ou split pendente.' :
          operacoes ? 'Existem operações de usuários no ciclo atual.' : null };
    }));
    res.json({ ok: true, clubes });
  } catch (err) { console.error('[INITIAL PRICES]', err); res.status(500).json({ erro: 'Erro ao consultar preços.' }); }
});
router.patch('/initial-prices/:ligaId', async (req, res) => {
  try {
    const ligaId = req.params.ligaId;
    if (!sportsMarkets[ligaId]) return res.status(404).json({ erro: 'Liga inválida.' });
    const control = await MarketControl.findOne({ ligaId }).lean();
    if (control?.fechado !== true) return res.status(409).json({ erro: 'Feche a liga antes de alterar os preços.' });
    const entries = req.body?.clubes;
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 50)
      return res.status(400).json({ erro: 'Informe de 1 a 50 clubes.' });
    const ids = entries.map(e => Number(e.id));
    if (new Set(ids).size !== ids.length || entries.some(e =>
      !Number.isSafeInteger(Number(e.id)) || !Number.isFinite(Number(e.preco)) ||
      Number(e.preco) <= 0 || Math.abs(Number(e.preco)*100-Math.round(Number(e.preco)*100)) > 1e-7))
      return res.status(400).json({ erro: 'IDs e preços inválidos (até duas casas decimais).' });
    const clubs = await Club.find({ legacyId: { $in: ids }, 'metadata.ligaId': ligaId });
    if (clubs.length !== entries.length) return res.status(404).json({ erro: 'Algum clube não pertence à liga.' });
    const Order = require('../../models/Order');
    for (const c of clubs) {
      if (!clubeProntoParaPrecificar(c) || await clubeTemOperacaoDoCiclo(c, Order, Investment))
        return res.status(409).json({ erro: 'O clube ' + c.nome + ' possui cotas, split ou operações do ciclo atual.' });
    }
    for (const c of clubs) {
      const preco = Number(entries.find(e => Number(e.id) === c.legacyId).preco);
      const result = await Club.updateOne({ _id: c._id, cotasEmitidas: 0,
        cotasDisponiveis: 1000, ipoEncerrado: false },
        { $set: { preco, precoAtual: preco,
          'metadata.precoInicialDefinidoPorAdmin': true,
          'metadata.precoInicialAtualizadoEm': new Date() } });
      if (result.matchedCount !== 1) return res.status(409).json({ erro: 'Estado do clube mudou durante a atualização. Atualize a página.' });
    }
    await audit.logEvent({ kind: 'ADMIN', action: 'INITIAL_PRICES_UPDATED', userId: req.usuario?.id,
      meta: { ligaId, quantidade: entries.length, clubes: entries } });
    res.json({ ok: true, atualizados: entries.length });
  } catch (err) { console.error('[INITIAL PRICES SAVE]', err); res.status(500).json({ erro: 'Não foi possível atualizar os preços.' }); }
});

`;
const out=src.slice(0,begin)+helper+'\n'+newRoutes+src.slice(end);
const backup=file+'.bak-precificacao-'+new Date().toISOString().replace(/[:.]/g,'-');
fs.copyFileSync(file,backup);fs.writeFileSync(file,out);
console.log('Correção aplicada ao backend. Backup:',backup);
console.log('Valide com: node --check routes/api/admin.js');
