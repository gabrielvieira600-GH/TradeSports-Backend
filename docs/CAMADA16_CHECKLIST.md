# Camada 16 — Fechamento operacional pré-lançamento

## Variáveis recomendadas
- `BETA_MODE=true`
- `ENABLE_DEPOSITS=true`
- `ENABLE_WITHDRAWALS=true`
- `MAX_DEPOSIT_VALUE=1000`
- `MAX_WITHDRAW_VALUE=1000`
- `MAX_ORDER_NOTIONAL=1000`
- `MAX_USER_BALANCE_BETA=5000`

## Rotas novas
- `GET /health`
- `GET /admin/system/check`
- `GET /admin/system/checklist`

## Objetivos cobertos
- Health operacional real
- Checagem de invariantes financeiros
- Flags beta/produção
- Limites operacionais de depósito, saque e ordem
