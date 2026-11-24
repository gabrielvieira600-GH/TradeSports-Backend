# TradeSports — correção de mercados de futebol 2026 (Node.js)

## O que o diagnóstico do usuário mostrou

- NOVE mercados de futebol estão completos para 2026: Brasileirão A/B, Premier League, Champions League, La Liga, Bundesliga, Ligue 1, Serie A italiana e Eredivisie.
- O banco conserva clubes antigos de 2023/2024, inclusive 40 registros históricos na Serie A italiana. Eles **não são necessariamente erros**: podem carregar referências de ordens, investimentos, carteiras e resultados anteriores.
- O motor LIVE anterior buscava **todos** os clubes de `metadata.ligaId` e parava ao encontrar temporadas antigas. A leitura de contingência também podia misturar temporadas.
- NBA/NFL não têm chaves e **não são alteradas** por este pacote. A configuração LIVE anteriormente instalada permanece preparada para quando existirem credenciais; não publicar jogos desses mercados antes de validar assinaturas e dados.

## Mudança implementada

1. Filtra as leituras usadas pelo motor de cotação de futebol por **liga + temporada corrente**.
2. Verifica se o elenco atual tem exatamente 20/18/36 clubes e IDs `providerTeamId` e `legacyId` exclusivos; falha fechado caso contrário.
3. Filtra também a tabela de contingência, sem mostrar clubes antigos como participantes atuais.
4. Corrige a sincronização legada para **não sobrescrever nem criar automaticamente documentos de outros anos**.
5. Corrige o aviso duplicado do índice `nomeApi` no model `Club` (não elimina índices do banco).
6. Ajusta `check_live_all_markets.js`: 20 atuais + 5 históricos = `OK` para a liga atual, mantendo um aviso dos históricos preservados. A ausência de credenciais NBA/NFL continua sendo mostrada.

**Não apaga nem modifica registros antigos, saldos, carteiras, ordens, investimentos, cotas, dividendos ou ledger.** O aplicador não conecta ao MongoDB. O diagnóstico apenas lê o banco.

## Aplicar no VS Code (CMD, na pasta backend)

Extraia a pasta `tradesports_fix_futebol_2026` diretamente em `C:\Users\gvdea\bolsa-futebol\backend`.

```cmd
node tradesports_fix_futebol_2026/tests/test_current_season_scope.js
node tradesports_fix_futebol_2026/patches/aplicar_patch.js --backend . --check
```

Atenção: o aplicador foi feito para o backend **após os pacotes LIVE anteriores**. Se houver diferença local, ele abortará sem escrever. **Não remova essa proteção**.

Se o CHECK passar:

```cmd
node tradesports_fix_futebol_2026/patches/aplicar_patch.js --backend . --apply
node scripts/check_live_all_markets.js
```

Verifique a sintaxe:

```cmd
node --check services/liveFootballTable.js
node --check services/sportsTableCache.js
node --check routes/sportsStandings.js
node --check models/Club.js
node --check scripts/check_live_all_markets.js
node --check utils/currentSeasonScope.js
```

Resultado esperado no diagnóstico: todos os **nove** mercados de futebol com `OK TEMPORADA ATUAL`, e os registros antigos apenas contabilizados como históricos. NBA/NFL seguirão `SEM_CHAVE`; isso não é falha do futebol.

## Homologação antes de Render / Vercel

1. Rode localmente `GET /api/tabelas/champions-league` e `GET /api/tabelas/premier-league` e compare com os jogos reais da API-Football.
2. Confirme `origem: partidas`, `precosAtualizados: true`, `contingencia: false`, 36 clubes Champions e 20 Premier; confirme que Brasileirão A e B têm 20, Alemanha/França/Holanda 18.
3. Abra a página do mercado durante um jogo e confira se uma alteração de placar muda a posição e o preço após o polling, não apenas a posição visual.
4. Refaça teste de compra e venda IPO após mudança de preço: o backend deve exigir confirmação do novo preço e não executar usando o preço antigo.
5. Compare a carteira e o ledger de um usuário de teste antes e depois da sincronização. Eles não devem sofrer mutação pela simples atualização de tabela.
6. Revise quotas e custos de chamadas /fixtures da API-Football para os nove mercados, lembrando que a latência de atualização **não é instantânea**.

## Observações e limitações

- O script **não** migra automaticamente os participantes para uma nova temporada. Quando o ano mudar, será necessário criar/auditar o elenco da próxima edição separadamente.
- `--apply` modifica **arquivos locais** e cria um backup datado `_backup_football_scope_*`. Não altera o GitHub, Render, Vercel nem MongoDB por si só.
- Se uma liga responder `mercadoBloqueadoPorDados:true`, não desative a validação para forçar negociações: examine a resposta da API, o elenco, o identificador das equipes e a temporada.
- O cálculo de desempate ao vivo dos campeonatos nacionais deve ser conferido contra o regulamento de cada campeonato. O motor existente usa um desempate genérico e não foi reescrito neste patch. Isso pode gerar divergências nas posições em empates de pontuação mesmo com o escopo da temporada corrigido.
- O projeto utiliza temporadas 2026 por padrão. Se `.env`/Render definirem temporadas antigas, essas variáveis prevalecem: confirme seus valores antes do deploy.
