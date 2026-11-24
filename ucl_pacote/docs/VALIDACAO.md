# Checklist de homologação — Champions League 2026/27

- [ ] `GET /api/tabelas/champions-league` retorna precisamente 36 times, sem duplicidade de posições e com `id` na faixa 220000001–220000036.
- [ ] O endpoint não utiliza temporada 2025 como substituta quando 2026 estiver indisponível.
- [ ] Todos os 36 clubes aparecem com badges; os clubes existentes nas ligas nacionais preservam suas cores/monogramas.
- [ ] O clube da Champions possui ID de cota distinto daquele da Premier League, La Liga etc.
- [ ] O IPO inicia com 1.000 cotas disponíveis, ou preserva o estoque histórico se já existia na Champions.
- [ ] A cotação IPO muda quando a posição esportiva muda, inclusive no MongoDB e na carteira/ranking.
- [ ] Sem alteração de posição, compra e devolução pelo mesmo preço e sem taxas no IPO.
- [ ] O mercado secundário se abre individualmente quando `ipoEncerrado=true` após distribuição de 1.000 cotas.
- [ ] Após migração, o book institucional aparece no secundário e o saldo/carteira/ledger permanece correto.
- [ ] A liga está fechada inicialmente; abertura controlada no painel administrativo.
- [ ] A prévia de liquidação por liga reconhece 36 posições finais distintas em janeiro/2027.
- [ ] Não há dividendos da Champions cobrados/pagos automaticamente sem implementação dedicada homologada.
