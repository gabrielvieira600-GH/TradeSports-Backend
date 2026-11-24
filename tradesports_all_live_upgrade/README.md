# TradeSports — atualização ao vivo em TODOS os mercados

**Destinatário:** projeto TradeSports • Node.js • MongoDB Atlas • frontend Next.js
**Base:** código instalado após `TradeSports_FIX_Live_Standings_Lite_IPO_2026-11-24.zip`.

## Objetivo e alcance

- Todos os mercados configurados em `config/sportsMarkets.js` participam do pipeline esportivo: Brasileirão A/B, Premier League, Champions League, La Liga, Bundesliga, Ligue 1, Serie A italiana, Eredivisie, NBA Oeste/Leste e NFL AFC/NFC.
- Futebol: reutiliza `services/liveFootballTable.js` — reconstrói classificação com resultados e placares de partidas. Conta gols de partidas em andamento e atualiza os preços das cotas em IPO.
- NBA/NFL: novo `services/liveAmericanTable.js` — consulta a classificação oficial + partidas ao vivo. Enquanto há jogos, projeta a posição com vitórias, derrotas e empates (NFL). Identifica como **provisória** a classificação com jogos em andamento. Critérios avançados de desempate específicos de cada esporte não são integralmente reproduzidos.
- Rejeita dados incompatíveis com a temporada ou os IDs cadastrados. Não faz migração automática de posições financeiras entre temporadas.
- Atualizações de interface continuam a cada 20 segundos com o patch anterior; o backend controla chamadas compartilhadas e valida preços antes das negociações.
- Persistência no MongoDB atualiza posição, preço da cota em IPO e classificação, preservando estoques e carteiras.

## Instalação VS Code / CMD

Extraia `tradesports_all_live_upgrade` dentro de `C:\Users\gvdea\bolsa-futebol\backend`, mantendo o backend atual e sua pasta `frontend`.

**1. Checagem sem modificar arquivos**

```cmd
node tradesports_all_live_upgrade/aplicar_patch.js --backend . --frontend ./frontend --check
```

**2. Teste unitário de projeções NBA/NFL**

```cmd
node tradesports_all_live_upgrade/tests/test_live_american.js
```

**3. Aplicação com backups**

```cmd
node tradesports_all_live_upgrade/aplicar_patch.js --backend . --frontend ./frontend --apply
```

**4. Diagnóstico das temporadas, das chaves e dos clubes (somente leitura)**

```cmd
node scripts/check_live_all_markets.js
```

**5. Sintaxe**

```cmd
node --check config/sportsMarkets.js
node --check services/liveFootballTable.js
node --check services/liveAmericanTable.js
node --check services/liveSportsTable.js
node --check routes/sportsStandings.js
node --check routes/classificacao.js
node --check controllers/InvestimentoController.js
node --check routes/mercado.js
```

## MUITO IMPORTANTE: temporadas e mercado já cadastrado

- Antes, o projeto usava temporadas antigas (2023/2024) em várias ligas. Agora os valores *padrão* das temporadas seguem o calendário atual (ex.: 2026 em novembro/2026). Variáveis no `.env` e no Render **continuam prevalecendo** — podem estar apontando para temporadas antigas.
- A nova validação interrompe atualização/negociação em qualquer liga cujo `metadata.temporada` no MongoDB não coincida com `config.season` ou cujos IDs de equipes não correspondam às respostas atuais.
- **Não apague cotas, dividendos, saldos, carteiras ou investimentos para atualizar o elenco de outra temporada.** Migração de temporada é uma operação administrativa separada, com encerramento, liquidação e verificação do estado do clube.
- Chaves necessárias para cada fonte: `API_FOOTBALL_KEY`, `API_NBA_KEY`, `API_NFL_KEY`. Cada provedor tem plano, franquia e assinatura próprios. A assinatura Football Pro não implica acesso Pro à NBA ou NFL.
- A consulta NBA/NFL usa `games?live=all`. O ranqueamento ao vivo é **provisório**, não substitui os desempates oficiais completos. Em situações de empate na posição, a prioridade utiliza a ordem oficial anterior; **não garanta que seja a colocação oficial exata** antes da atualização da fonte.
- Cuidado especial com mercados sem partidas já cadastradas na temporada: o sistema retorna contingência e impede a negociação em vez de exibir preço antigo como se fosse atual.

## Publicação e homologação

- Não publique diretamente em produção sem passar o diagnóstico, validar APIs e testar ao menos um mercado de cada esporte.
- Durante as partidas, confirme se `GET /api/tabelas/<mercadoId>` responde `origem: partidas`, `precosAtualizados: true`, `classificacaoProvisoria` para NBA/NFL quando cabível.
- Em erros, o endpoint pode mostrar cache, mas retorna `mercadoBloqueadoPorDados: true` e o motor de ordens rejeita a execução por falta de atualização.
- Revise a franquia diária de requisições por API. O cache é por esporte+temporada para NBA/NFL, e por competição para futebol. Não hospede cron independente em cada instância do Render sem coordenação.
- As alterações não incluem feed de preço via WebSocket; a interface utiliza polling de 20 segundos. O tempo real **não** é instantâneo, pois depende da atualização do fornecedor, consulta e navegador.

## Arquivos alterados

`config/sportsMarkets.js`, `services/liveFootballTable.js`, `routes/sportsStandings.js`, `routes/classificacao.js`, `controllers/InvestimentoController.js`, `routes/mercado.js`.

## Arquivos novos

`services/liveSportsTable.js`, `services/liveAmericanTable.js`, `scripts/check_live_all_markets.js`.

Não altera o frontend (o polling de 20s foi incluído pelo pacote imediatamente anterior).
