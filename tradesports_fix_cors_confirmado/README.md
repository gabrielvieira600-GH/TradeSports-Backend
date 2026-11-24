# TradeSports — Hotfix CORS comprovado (24/11/2026)

## Causa comprovada
O console do navegador: `Request header field cache-control is not allowed by Access-Control-Allow-Headers in preflight response` para `GET /api/tabela-brasileirao`.
O frontend introduziu `headers:{"Cache-Control":"no-cache"}` em `pages/brasileirao-a.js`. O backend não incluía `Cache-Control` em `allowedHeaders`.
Os logs do Render também registraram duas URLs de preview Vercel legítimas rejeitadas na whitelist.

## Conteúdo e escopo
- Remove o cabeçalho customizado da chamada Axios de carregamento de tabelas em `frontend/pages/brasileirao-a.js`.
- Permite `Cache-Control` como defesa em profundidade no `backend/server.js` para clientes com versão antiga do frontend.
- Permite **somente** duas URLs de preview vistas nos logs do Render de 24/11/2026 (não libera todos os subdomínios Vercel).
- **NÃO** modifica MongoDB, IPO, ordens, dividendos, ledger ou cálculo de tabelas LIVE.
- A correção é aplicada ao componente compartilhado `pages/brasileirao-a.js`, que utiliza `Data/mercados.js` para 13 mercados.

## Como aplicar (CMD dentro da pasta backend)
1. Extrair `tradesports_fix_cors_confirmado/` dentro da pasta `backend`.
2. `node tradesports_fix_cors_confirmado/tests/test_hotfix.js`
3. `node tradesports_fix_cors_confirmado/aplicar_correcao_cors.js --backend . --frontend ./frontend --check`
4. Somente se CHECK APROVADO: `node tradesports_fix_cors_confirmado/aplicar_correcao_cors.js --backend . --frontend ./frontend --apply`
5. `node --check server.js`
6. Fazer commit/push de **ambos** os arquivos nos repositórios backend e frontend corretos; publicar no Render e na Vercel.

## Homologação
- Abrir `https://www.tradesports.com.br/brasileirao-a` com F12 > Network.
- A consulta `/api/tabela-brasileirao` não deve mais produzir `Request header field cache-control is not allowed`.
- Testar `/champions-league` e as outras ligas.
- A resposta deve ser HTTP 200 com `data` contendo o número correto de clubes. Se aparecer 500, é **outro** problema, do motor LIVE ou MongoDB, e precisa do log correspondente.
- Para previews Vercel adicionais, adicionar origens explicitamente verificadas no Render, não liberar `*.vercel.app` indiscriminadamente.

## Observações
O hotfix corrige o bloqueio CORS confirmado. Não comprova, sozinho, que a API esportiva LIVE e seu cache retornam tabelas válidas para todos os mercados. Se a API estiver indisponível, as operações devem permanecer protegidas pela validação de preço fresco já existente.
