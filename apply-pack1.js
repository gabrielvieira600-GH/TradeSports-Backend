#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const backendRoot = path.resolve(process.argv[2] || './TradeSports-Backend');
const frontendRoot = path.resolve(process.argv[3] || './TradeSports-Frontend-OK');

function read(root, rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function write(root, rel, data) {
  const p = path.join(root, rel);
  fs.copyFileSync(p, p + '.pack1.bak');
  fs.writeFileSync(p, data, 'utf8');
  console.log('OK:', p);
}
function replaceOnce(src, oldText, newText, label) {
  const count = src.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: esperado 1 trecho, encontrado ${count}`);
  return src.replace(oldText, newText);
}

// 1) Backend: preço efetivamente executado em Minhas Ordens.
{
  const rel = 'routes/mercado.js';
  let s = read(backendRoot, rel);
  const oldBlock = `    return res.json(\n\n      ordens.map((o) => ({\n\n        id: String(o._id),\n\n        clubeId: o.clubeLegacyId,\n\n        tipo: o.tipo,\n\n        preco: round2(o.preco),\n\n        quantidade: Number(o.quantidade || 0),\n\n        restante: Number(o.restante || 0),\n\n        status: o.status,\n\n        criadoEm: o.criadoEm,\n\n        canceladoEm: o.canceladoEm,\n\n        executadoEm: o.executadoEm,\n\n      }))\n\n    );`;
  const newBlock = `    const orderIds = ordens.map((o) => String(o._id));\n\n    const execucoes = orderIds.length\n      ? await Investment.find({\n          usuarioId: req.usuario.id,\n          'metadata.orderId': { $in: orderIds },\n          tipo: { $in: ['COMPRA', 'VENDA', 'COMPRA_SECUNDARIO', 'VENDA_SECUNDARIO'] },\n        })\n          .select('quantidade precoUnitario valorUnitario totalPago data metadata.orderId')\n          .lean()\n      : [];\n\n    const execucaoPorOrdem = new Map();\n\n    for (const execucao of execucoes) {\n      const orderId = String(execucao?.metadata?.orderId || '');\n      if (!orderId) continue;\n\n      const quantidade = Number(execucao.quantidade || 0);\n      const precoExecutado = Number(\n        execucao.precoUnitario ?? execucao.valorUnitario ?? 0\n      );\n\n      if (quantidade <= 0 || !Number.isFinite(precoExecutado) || precoExecutado <= 0) {\n        continue;\n      }\n\n      const atual = execucaoPorOrdem.get(orderId) || {\n        quantidade: 0,\n        valorBruto: 0,\n        ultimaExecucaoEm: null,\n      };\n\n      atual.quantidade += quantidade;\n      atual.valorBruto += quantidade * precoExecutado;\n\n      if (\n        execucao.data &&\n        (!atual.ultimaExecucaoEm || new Date(execucao.data) > new Date(atual.ultimaExecucaoEm))\n      ) {\n        atual.ultimaExecucaoEm = execucao.data;\n      }\n\n      execucaoPorOrdem.set(orderId, atual);\n    }\n\n    return res.json(\n      ordens.map((o) => {\n        const exec = execucaoPorOrdem.get(String(o._id));\n        const quantidadeExecutada = exec?.quantidade ??\n          Math.max(0, Number(o.quantidade || 0) - Number(o.restante || 0));\n        const precoExecutadoMedio =\n          exec && exec.quantidade > 0\n            ? round2(exec.valorBruto / exec.quantidade)\n            : null;\n\n        return {\n          id: String(o._id),\n          clubeId: o.clubeLegacyId,\n          tipo: o.tipo,\n          preco: round2(o.preco),\n          precoLimite: round2(o.preco),\n          precoExecutadoMedio,\n          valorExecutado: exec ? round2(exec.valorBruto) : null,\n          quantidade: Number(o.quantidade || 0),\n          quantidadeExecutada,\n          restante: Number(o.restante || 0),\n          status: o.status,\n          criadoEm: o.criadoEm,\n          canceladoEm: o.canceladoEm,\n          executadoEm: o.executadoEm || exec?.ultimaExecucaoEm || null,\n        };\n      })\n    );`;
  s = replaceOnce(s, oldBlock, newBlock, 'mercado/minhas-ordens');

  // Mantém os campos públicos do Club coerentes com cotas em mãos de usuários reais.
  const anchor = `        if (buyerInstitutional) {\n          liquidityState.institutionHeldIssuedShares =\n            Number(liquidityState.institutionHeldIssuedShares) + qtdExec;\n          liquidityState.buybackGross = round2(Number(liquidityState.buybackGross) + bruto);\n          liquidityState.liquidationFund = round2(Math.max(0, Number(liquidityState.liquidationFund) - bruto));\n          await recordBuyback({ clubId: clube._id, userId: seller._id, quantity: qtdExec, session });\n        }`;
  const replacement = anchor + `\n\n        if (liquidityState) {\n          const cotasEmCirculacao = Math.max(\n            0,\n            Number(liquidityState.issuedShares || 0) -\n              Number(liquidityState.institutionHeldIssuedShares || 0)\n          );\n          clube.cotasEmitidas = cotasEmCirculacao;\n          clube.cotasDisponiveis = Math.max(\n            0,\n            Number(liquidityState.maxShares || 1000) - cotasEmCirculacao\n          );\n        }`;
  s = replaceOnce(s, anchor, replacement, 'mercado/circulacao-institucional');
  write(backendRoot, rel, s);
}

// 2) Backend: /clube sempre deriva disponibilidade/circulação do estado institucional.
{
  const rel = 'routes/clube.js';
  let s = read(backendRoot, rel);
  s = replaceOnce(s,
    `const Investment = require('../models/Investment');`,
    `const Investment = require('../models/Investment');\nconst InstitutionalLiquidity = require('../models/InstitutionalLiquidity');`,
    'clube/import-liquidez');

  s = replaceOnce(s,
    `function toClubResponse(clube) {`,
    `function toClubResponse(clube, liquidityState = null) {`,
    'clube/toClubResponse-signature');

  s = replaceOnce(s,
    `    cotasDisponiveis: Number(clube.cotasDisponiveis || 0),\n\n    cotasEmitidas: Number(clube.cotasEmitidas || 0),`,
    `    cotasDisponiveis: liquidityState\n      ? Math.max(\n          0,\n          Number(liquidityState.maxShares || 1000) -\n            Math.max(\n              0,\n              Number(liquidityState.issuedShares || 0) -\n                Number(liquidityState.institutionHeldIssuedShares || 0)\n            )\n        )\n      : Number(clube.cotasDisponiveis || 0),\n\n    cotasEmitidas: liquidityState\n      ? Math.max(\n          0,\n          Number(liquidityState.issuedShares || 0) -\n            Number(liquidityState.institutionHeldIssuedShares || 0)\n        )\n      : Number(clube.cotasEmitidas || 0),`,
    'clube/counters');

  s = replaceOnce(s,
    `    return res.json(clubes.map(toClubResponse));`,
    `    const states = await InstitutionalLiquidity.find({\n      clubId: { $in: clubes.map((clube) => clube._id) },\n    }).lean();\n\n    const stateByClub = new Map(\n      states.map((state) => [String(state.clubId), state])\n    );\n\n    return res.json(\n      clubes.map((clube) =>\n        toClubResponse(clube, stateByClub.get(String(clube._id)) || null)\n      )\n    );`,
    'clube/lista');

  // Há dois endpoints individuais; substitui ambos de forma controlada.
  const oldIndividual = `    return res.json(toClubResponse(clube));`;
  const newIndividual = `    const liquidityState = await InstitutionalLiquidity.findOne({\n      clubId: clube._id,\n    }).lean();\n\n    return res.json(toClubResponse(clube, liquidityState));`;
  const count = s.split(oldIndividual).length - 1;
  if (count !== 2) throw new Error(`clube/endpoints-individuais: esperado 2, encontrado ${count}`);
  s = s.replace(oldIndividual, newIndividual).replace(oldIndividual, newIndividual);
  write(backendRoot, rel, s);
}

// 3) Frontend: Minhas Ordens mostra preço limite e preço realmente executado.
{
  const rel = 'pages/minhas-ordens.js';
  let s = read(frontendRoot, rel);
  s = replaceOnce(s,
    `      preco: Number(o.preco || 0),\n      quantidade,`,
    `      preco: Number(o.preco || 0),\n      precoLimite: Number(o.precoLimite ?? o.preco ?? 0),\n      precoExecutadoMedio:\n        o.precoExecutadoMedio != null ? Number(o.precoExecutadoMedio) : null,\n      valorExecutado:\n        o.valorExecutado != null ? Number(o.valorExecutado) : null,\n      quantidade,`,
    'frontend/minhas-ordens-map');

  s = replaceOnce(s,
    `<th>Preço limite</th>\n              <th>Original</th>`,
    `<th>Preço limite</th>\n              <th>Preço executado</th>\n              <th>Original</th>`,
    'frontend/minhas-ordens-header');

  s = replaceOnce(s,
    `                  <td>\n                    <ValorOrdem>\n                      {formatTS(x.preco)}\n                    </ValorOrdem>\n                  </td>\n\n                  <td>{x.quantidade}</td>`,
    `                  <td>\n                    <ValorOrdem>\n                      {formatTS(x.precoLimite)}\n                    </ValorOrdem>\n                  </td>\n\n                  <td>\n                    <ValorOrdem>\n                      {x.precoExecutadoMedio != null\n                        ? formatTS(x.precoExecutadoMedio)\n                        : '—'}\n                    </ValorOrdem>\n                  </td>\n\n                  <td>{x.quantidade}</td>`,
    'frontend/minhas-ordens-desktop');

  s = replaceOnce(s,
    `                <InfoBloco>\n                  <span>Preço limite</span>\n                  <strong>{formatTS(x.preco)}</strong>\n                </InfoBloco>\n\n                <InfoBloco>\n                  <span>Quantidade original</span>`,
    `                <InfoBloco>\n                  <span>Preço limite enviado</span>\n                  <strong>{formatTS(x.precoLimite)}</strong>\n                </InfoBloco>\n\n                <InfoBloco>\n                  <span>Preço executado</span>\n                  <strong>\n                    {x.precoExecutadoMedio != null\n                      ? formatTS(x.precoExecutadoMedio)\n                      : '—'}\n                  </strong>\n                </InfoBloco>\n\n                <InfoBloco>\n                  <span>Quantidade original</span>`,
    'frontend/minhas-ordens-mobile');
  write(frontendRoot, rel, s);
}

// 4) Frontend: gráfico maior/legível no mobile.
{
  const rel = 'pages/clube/[id].js';
  let s = read(frontendRoot, rel);
  s = replaceOnce(s, `  const height = 318;\n  const padding = { top: 24, right: 24, bottom: 46, left: 72 };`,
    `  const height = 390;\n  const padding = { top: 28, right: 28, bottom: 58, left: 88 };`, 'chart-dimensions');
  s = s.replaceAll(`fontSize=\"12\"`, `fontSize=\"15\"`);
  s = replaceOnce(s,
    `const ChartBody = styled.div\`position: relative; min-height: 330px; padding: 0 12px;\`;\nconst ChartViewport = styled.div\`\n  position: relative;\n  width: 100%;\n  min-height: 318px;\n  svg { display: block; width: 100%; height: auto; min-height: 270px; touch-action: pan-y; }\n\`;`,
    `const ChartBody = styled.div\`\n  position: relative;\n  min-height: 390px;\n  padding: 0 12px;\n\n  @media (max-width: 720px) {\n    min-height: 420px;\n    padding: 0 4px;\n  }\n\`;\nconst ChartViewport = styled.div\`\n  position: relative;\n  width: 100%;\n  min-height: 390px;\n\n  svg {\n    display: block;\n    width: 100%;\n    height: auto;\n    min-height: 340px;\n    touch-action: pan-y;\n  }\n\n  @media (max-width: 720px) {\n    min-height: 410px;\n    overflow-x: auto;\n    overflow-y: hidden;\n    -webkit-overflow-scrolling: touch;\n\n    svg {\n      width: 720px;\n      max-width: none;\n      min-height: 390px;\n    }\n  }\n\`;`,
    'chart-css');
  write(frontendRoot, rel, s);
}

// 5) Frontend: Total alocado = valor atual das posições.
{
  const rel = 'pages/carteira.js';
  let s = read(frontendRoot, rel);
  const oldText = `<LabelResumo>Total alocado</LabelResumo>\n              <ValorSecundario>T$ {resumo.totalInvestido.toFixed(2)}</ValorSecundario>`;
  const newText = `<LabelResumo>Total alocado</LabelResumo>\n              <ValorSecundario>T$ {resumo.totalAtual.toFixed(2)}</ValorSecundario>`;
  s = replaceOnce(s, oldText, newText, 'carteira-total-alocado');
  write(frontendRoot, rel, s);
}

console.log('\nPack 1 aplicado com sucesso. Backups .pack1.bak foram criados ao lado dos arquivos alterados.');
