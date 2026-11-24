# Champions League 2026/27 — corrigir correspondência Sabah FA

Esta correção é para o erro `Clube da API não reconhecido na lista oficial: Sabah FA`.

**Importante**: existe um Sabah FA da Malásia e um Sabah FC do Azerbaijão. A API deve retornar o ID do clube do Azerbaijão. A correção exige confirmar o país usando `/teams?id=...` antes do seed. Se a API retornar Malásia, o script bloqueia o cadastro: não basta alterar o nome.

## Instalação

Extraia a pasta `corrigir_sabah` dentro de `backend`, mantendo a estrutura:

```
backend/
  corrigir_sabah/
    aplicar_correcao_sabah.js
  scripts/seedChampions2026.js
  config/ucl2026.js
  data/participantes-2026-27.json
```

Abra o terminal na raiz do backend:

```
node corrigir_sabah/aplicar_correcao_sabah.js --check
node corrigir_sabah/aplicar_correcao_sabah.js --apply
node --check scripts/seedChampions2026.js
node --check routes/sportsStandings.js
node scripts/seedChampions2026.js --check
```

Apenas quando a verificação listar 36 clubes e os IDs estiverem confirmados:

```
node scripts/seedChampions2026.js --apply --confirm=CHAMPIONS_2026_27
```

O patch não altera o MongoDB. O seed só grava com `--apply` e confirmação.

## Se a API retornar Malaysia

Interrompa. O ID informado na classificação corresponde a um Sabah diferente do clube da UEFA. Nesse caso será necessário corrigir os dados/identidade com o provedor API-Sports ou usar uma fonte validada para os 36 participantes. Não forçar a associação.

## Outras observações

O aviso Mongoose `Duplicate schema index on {nomeApi: 1}` é independente deste bloqueio e não impede a validação do nome.
