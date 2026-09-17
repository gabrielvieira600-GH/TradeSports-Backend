// QA PACK 1 — backend/routes/mercado.js
// No GET /minhas-ordens, após carregar `ordens`:
const orderIds = ordens.map((o) => String(o._id));
const execucoes = orderIds.length
  ? await Investment.find({
      usuarioId: req.usuario.id,
      'metadata.orderId': { $in: orderIds },
      tipo: { $in: ['COMPRA', 'VENDA'] },
    })
      .select('quantidade precoUnitario valorUnitario metadata.orderId')
      .lean()
  : [];

const execucaoPorOrdem = execucoes.reduce((mapa, execucao) => {
  const orderId = String(execucao?.metadata?.orderId || '');
  if (!orderId) return mapa;
  const quantidade = Number(execucao.quantidade || 0);
  const preco = Number(execucao.precoUnitario ?? execucao.valorUnitario ?? 0);
  if (!Number.isFinite(quantidade) || quantidade <= 0 ||
      !Number.isFinite(preco) || preco <= 0) return mapa;
  const atual = mapa.get(orderId) || { quantidade: 0, valor: 0 };
  atual.quantidade += quantidade;
  atual.valor += quantidade * preco;
  mapa.set(orderId, atual);
  return mapa;
}, new Map());

// Dentro de ordens.map, antes do objeto retornado:
const execucao = execucaoPorOrdem.get(String(o._id));
const precoExecutadoMedio = execucao?.quantidade > 0
  ? round2(execucao.valor / execucao.quantidade)
  : null;

// Inclua no JSON da ordem:
precoExecutadoMedio,
