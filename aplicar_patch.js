// Execute com Node.js na raiz do respectivo projeto: node aplicar_patch.js
const fs = require('fs');
const path = require('path');
const root = process.cwd();
const isBackend = fs.existsSync(path.join(root, 'routes', 'api', 'admin.js'));
const isFrontend = fs.existsSync(path.join(root, 'pages', 'admin-painel.js'));
if (isBackend === isFrontend) { console.error('Execute na raiz do backend OU do frontend (não na pasta que contém os dois).'); process.exit(1); }
function modify(relative, fn) {
 const file = path.join(root, relative), original = fs.readFileSync(file, 'utf8'), next = fn(original);
 if (next === original) { console.log(`${relative}: já aplicado ou sem mudanças`); return; }
 const backup = `${file}.bak-initial-prices`; if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
 fs.writeFileSync(file, next, 'utf8'); console.log(`${relative}: atualizado (backup salvo)`);
}
if (isBackend) {
 const code = String.raw`
// PREÇOS INICIAIS — administração antes da abertura do IPO
router.get('/initial-prices/markets', async (_req, res) => {
  try {
    const controls = await MarketControl.find({}).lean();
    const byId = new Map(controls.map(c => [c.ligaId, c]));
    res.json({ ok: true, mercados: Object.values(sportsMarkets).map(m => ({ id: m.id, nome: m.nome, fechado: byId.get(m.id)?.fechado === true })) });
  } catch (err) { res.status(500).json({ erro: 'Erro ao consultar mercados.' }); }
});
router.get('/initial-prices/:ligaId', async (req, res) => {
  try {
    const ligaId = req.params.ligaId;
    if (!sportsMarkets[ligaId]) return res.status(404).json({ erro: 'Liga inválida.' });
    const clubs = await Club.find({ 'metadata.ligaId': ligaId }).sort({ nome: 1 }).lean();
    const ids = clubs.map(c => c._id);
    const Order = require('../../models/Order');
    const orders = await Order.distinct('clubeId', { clubeId: { $in: ids } });
    const blocked = new Set(orders.map(String));
    res.json({ ok: true, clubes: clubs.map(c => ({ id: c.legacyId, nome: c.nome, precoInicial: c.preco, precoAtual: c.precoAtual, cotasDisponiveis: c.cotasDisponiveis, editavel: c.cotasEmitidas === 0 && c.cotasDisponiveis === 1000 && !c.ipoEncerrado && !blocked.has(String(c._id)) })) });
  } catch (err) { console.error('[INITIAL PRICES]', err); res.status(500).json({ erro: 'Erro ao consultar preços.' }); }
});
router.patch('/initial-prices/:ligaId', async (req, res) => {
  try {
    const ligaId = req.params.ligaId;
    if (!sportsMarkets[ligaId]) return res.status(404).json({ erro: 'Liga inválida.' });
    const control = await MarketControl.findOne({ ligaId }).lean();
    if (control?.fechado !== true) return res.status(409).json({ erro: 'Feche a liga antes de alterar os preços.' });
    const entries = req.body?.clubes;
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 50) return res.status(400).json({ erro: 'Informe de 1 a 50 clubes.' });
    const ids = entries.map(e => Number(e.id));
    if (new Set(ids).size !== ids.length || entries.some(e => !Number.isSafeInteger(Number(e.id)) || !Number.isFinite(Number(e.preco)) || Number(e.preco) <= 0 || Math.abs(Number(e.preco)*100 - Math.round(Number(e.preco)*100)) > 1e-7)) return res.status(400).json({ erro: 'IDs e preços inválidos (até duas casas decimais).' });
    const clubs = await Club.find({ legacyId: { $in: ids }, 'metadata.ligaId': ligaId });
    if (clubs.length !== entries.length) return res.status(404).json({ erro: 'Algum clube não pertence à liga.' });
    const Order = require('../../models/Order');
    const Investment = require('../../models/Investment');
    for (const c of clubs) {
      const [orders, investments] = await Promise.all([Order.exists({ clubeId: c._id }), Investment.exists({ clubeId: c._id })]);
      if (orders || investments || c.cotasEmitidas !== 0 || c.cotasDisponiveis !== 1000 || c.ipoEncerrado || (c.splits || []).length) return res.status(409).json({ erro: 'O clube ' + c.nome + ' já possui operações, split ou IPO iniciado.' });
    }
    // Atualiza preço-base e preço atual, sem alterar a tabela de liquidação.
    for (const c of clubs) {
      const preco = Number(entries.find(e => Number(e.id) === c.legacyId).preco);
      await Club.updateOne({ _id: c._id, cotasEmitidas: 0, cotasDisponiveis: 1000, ipoEncerrado: false }, { $set: { preco, precoAtual: preco, 'metadata.precoInicialDefinidoPorAdmin': true, 'metadata.precoInicialAtualizadoEm': new Date() } });
    }
    await audit.logEvent({ kind: 'ADMIN', action: 'INITIAL_PRICES_UPDATED', userId: req.usuario?.id, meta: { ligaId, quantidade: entries.length, clubes: entries } });
    res.json({ ok: true, atualizados: entries.length });
  } catch (err) { console.error('[INITIAL PRICES SAVE]', err); res.status(500).json({ erro: 'Não foi possível atualizar os preços.' }); }
});
`;
 modify('routes/api/admin.js', s => { if (s.includes("router.get('/initial-prices/markets'")) return s; const anchor="router.get('/market-controls'"; if (!s.includes(anchor)) throw new Error('Âncora de rotas não encontrada'); return s.replace(anchor, code+'\n'+anchor); });
} else {
 const target = path.join(root, 'components', 'PrecificacaoInicialAdmin.js');
 const src = path.join(__dirname, 'PrecificacaoInicialAdmin.js');
 if (!fs.existsSync(src)) throw new Error('PrecificacaoInicialAdmin.js não está ao lado do aplicar_patch.js');
 if (!fs.existsSync(target)) fs.copyFileSync(src, target); else if (fs.readFileSync(target,'utf8') !== fs.readFileSync(src,'utf8')) { const backup=target+'.bak-initial-prices';if(!fs.existsSync(backup)) fs.copyFileSync(target,backup);fs.copyFileSync(src,target); }
 modify('pages/admin-painel.js', s => {
   if (s.includes('<PrecificacaoInicialAdmin />')) return s;
   const importAnchor='import AdminMarketControls from "../components/AdminMarketControls";';
   if (!s.includes(importAnchor)) throw new Error('Import do painel não encontrado');
   s=s.replace(importAnchor,importAnchor+'\nimport PrecificacaoInicialAdmin from "../components/PrecificacaoInicialAdmin";');
   const anchor='<section style={{ ...styles.card, ...styles.maintenanceCard }}>';
   if (!s.includes(anchor)) throw new Error('Seção de manutenção não encontrada');
   return s.replace(anchor,'<PrecificacaoInicialAdmin />\n\n      '+anchor);
 });
}
console.log('Patch aplicado. Execute npm run build e teste em ambiente de homologação.');
