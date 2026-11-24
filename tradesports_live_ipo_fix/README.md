# TradeSports — limite Lite para vendas IPO + classificação por partidas ao vivo

**Pacote de atualização manual (Node.js).** Base: repositórios TradeSports-Backend e TradeSports-Frontend-OK, branch `main` consultada em 24/11/2026.

## Problemas corrigidos

1. A franquia semanal Lite soma agora **IPO (compra) + IPO_RETURN (venda)** + ordens executadas no secundário, sempre uma ordem por execução, não por cota. Uma operação rejeitada não consome a franquia. Plano Premium permanece ilimitado. As regras de bônus e limite configurado pela administração são preservadas.
2. Para as ligas de futebol habilitadas, o backend **reconstrói a classificação pelos placares da temporada em `/fixtures?league=...&season=...`**, inclusive placares `1H`, `HT` e `2H`, e atualiza `Club.posicao` e `precoAtual` (somente enquanto o IPO está aberto). As partidas de outras fases da Champions são excluídas.
3. As telas de campeonato recarregam os dados sem piscar a cada 20 segundos enquanto visíveis; o modal confirma o preço enviado pelo usuário antes de executar, evitando aplicar silenciosamente um valor novo.
4. Novas compras/vendas de IPO e ordens P2P de clubes habilitados exigem uma sincronização recente; em caso de falha da fonte, a negociação é bloqueada (HTTP 503) enquanto a interface pode mostrar a última tabela sinalizada como desatualizada.

## Pastas

- `aplicar_patch.js`: aplicador com `--check`, backups e falha se as âncoras do código local não corresponderem.
- `patches.js`: transformações textuais de arquivos existentes.
- `files/services/liveFootballTable.js`: atualização e cálculo por jogos em andamento.
- `scripts/check_live_config.js`: diagnóstico de configuração, somente leitura.
- `tests/test_live_table.js`: testes unitários com placares simulados, sem usar API ou banco.

## Instalação (CMD do VS Code)

Extraia a pasta `tradesports_live_ipo_fix` dentro da sua pasta `backend`. Confirme que a pasta `frontend` é a versão que você publica na Vercel. Na raiz `C:\Users\gvdea\bolsa-futebol\backend`:

```bat
node tradesports_live_ipo_fix\aplicar_patch.js --backend . --frontend .\frontend --check
node tradesports_live_ipo_fix\tests\test_live_table.js
node tradesports_live_ipo_fix\aplicar_patch.js --backend . --frontend .\frontend --apply
node --check controllers\InvestimentoController.js
node --check utils\tradingQuota.js
node --check routes\sportsStandings.js
node --check routes\classificacao.js
node --check routes\mercado.js
node --check services\liveFootballTable.js
node scripts\check_live_config.js
```

O `--check` não altera arquivos. Se falhar, não execute `--apply`; envie o erro. O aplicador não executa seed/reset/migração do MongoDB nem publica no GitHub.

## Configuração Render

- Manter `MARKET_MODE=IPO` enquanto o modelo híbrido estiver ativo.
- Definir `LIVE_FOOTBALL_MARKETS=champions-league` (este é o padrão se a variável estiver ausente). O mecanismo suporta as demais ligas **de futebol** através de uma lista separada por vírgulas, como `LIVE_FOOTBALL_MARKETS=champions-league,brasileirao-a,premier-league,la-liga`.
- **Antes de habilitar outra liga**, verificar que `config/sportsMarkets.js` tem `season` e ID da liga realmente atuais, a coleção contém todos os clubes com `metadata.providerTeamId` corretos, os fixtures da temporada são completos e a API dispõe de cobertura. Várias ligas na base do GitHub têm temporadas-padrão antigas.
- Preservar `API_FOOTBALL_KEY` da assinatura Pro, não enviar seu `.env` a ninguém.
- O módulo é integrado ao processo do Render e atualiza por demanda (abertura da página, consulta do livro, compra/venda); **não é um job 24h**. Isto evita requisições constantes sem atividade de usuários.

## Desempenho, integridade e limites

- Durante partidas ao vivo, a origem é consultada a cada ~20 segundos por competição ativa **por processo do backend**, com *single-flight* entre requisições. Perto de jogos, ~30 segundos; fora da janela de jogos, até 10 minutos. O frontend consulta a tabela a cada 20 segundos enquanto a aba estiver aberta.
- **Não existe garantia de latência zero**: transmissão, provider e HTTP podem atrasar a mudança em dezenas de segundos. A documentação API-Football anuncia atualização dos fixtures em torno de 15 segundos, mas a disponibilidade varia.
- O ranking usa pontos, saldo, gols marcados e, na Champions, gols fora, vitórias e critérios coletivos dos adversários. Critérios finais regulamentares (disciplina, coeficientes) e desempates específicos em algumas ligas nacionais podem requerer outra fonte. É obrigatório comparar empates com a tabela oficial antes de operar com dinheiro virtual competitivo.
- A Champions exige **36 clubes e ao menos 144 partidas agendadas da fase de liga**. API incompleta não é usada para definir preço.
- Em falhas da API, alterações de preço não são feitas. Os endpoints retornam tabela em modo contingência com aviso; negociações de ligas habilitadas são bloqueadas até uma sincronização válida. NÃO elimine essa proteção para “destravar”.
- Cada execução IPO exige `precoEsperado`, conferido dentro da transação. Se o resultado mudou, HTTP 409 requer nova confirmação do jogador.
- O patch atualiza todos os 36 `Club` da liga em **transação MongoDB** e valida IDs, evitando duplicação de cotas. O banco deve oferecer transações (Atlas replica set).
- A reconciliação da franquia considera também vendas IPO **históricas da semana corrente**. Elas podem aumentar o contador exibido imediatamente após a atualização. Isso é consequência da regra de contar todas as ordens executadas.
- A taxa de API pode subir quando múltiplas ligas são ativadas; monitore consumo no painel API-Sports.

## Homologação obrigatória

1. Com a Champions **fechada ao público**, abra `/api/tabelas/champions-league` e confira 36 entradas, `origem: "partidas"`, `contingencia: false`, horário `atualizadoEm` recente e ausência de erro no Render. Se retornar `mercadoBloqueadoPorDados`, examine `API_FOOTBALL_KEY`, fixtures e logs. **Não abra o mercado nessa situação.**
2. Com jogos reais em andamento, compare posição e placar de três times com a UEFA (inclusive empate e mudança de posição). Confira preço esperado para 36 participantes e atualização da carteira.
3. Em conta Lite com 14 ordens executadas, execute **uma venda IPO**. Deve chegar a 15; a próxima compra e venda devem ser negadas com `LIMITE_ORDENS_ATINGIDO` e sem alterar saldo/cotas/ledger. Uma compra ou venda recusada não deve gastar franquia. No Premium deve permanecer ilimitada.
4. Simule mudança de preço entre abertura do modal e confirmação: deve ocorrer HTTP 409 `PRECO_ATUALIZADO`, com mensagem para confirmar novamente.
5. Derrube a API em ambiente de homologação: transações devem falhar com HTTP 503, **não** executar a preço obsoleto.
6. No secundário, confirme que a liquidez institucional continua operando, que o tick e taxas permanecem intactos e que nenhuma ordem duplica cotas.
7. Teste Next.js build do frontend e publique frontend/backend somente após esses resultados.

## Reversão

O aplicador guarda os arquivos originais em `backend/_backup_live_ipo_.../backend/...` e `.../frontend/...`. Para reverter, restaure os arquivos nos respectivos repositórios; exclua `services/liveFootballTable.js` e `scripts/check_live_config.js` criados pelo patch. **Uma reversão de código não reverte negociações já realizadas.** Não restaure snapshots antigos do banco indiscriminadamente.
