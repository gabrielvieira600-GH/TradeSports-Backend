# TradeSports — Ledger Contábil (Camada 13)

## Objetivo
Criar um **journal contábil append-only** (double-entry) que registre TODO evento financeiro do TradeSports
de modo auditável, idempotente e compatível com operação real (gateway + reconciliação + antifraude).

## Arquivos em /backend/data
- `ledger_journal.json` — array de lançamentos:
  - `id`, `at`, `action`, `lines[]`, `meta`
- `ledger_idem.json` — mapa de idempotência:
  - `idemKey` -> `{ entryId, at, action }`

## Estrutura de lançamento
```json
{
  "id": "je_...",
  "at": "2026-03-04T...",
  "action": "TRADE_EXEC",
  "lines": [
    { "account": "user:123", "credit": 82.50 },
    { "account": "user:999", "debit": 82.50 }
  ],
  "meta": {
    "clubeId": 19,
    "qty": 10,
    "price": 8.25,
    "total": 82.5
  }
}
```

## Convenções (simplificadas para MVP)
- Conta `user:<id>` representa o saldo do usuário.
- **Débito** em `user:<id>` => aumenta saldo do usuário.
- **Crédito** em `user:<id>` => diminui saldo do usuário.

> Em produção, o ideal é modelar `user:<id>` como **passivo** (liability) e `platform:cash` como ativo real.
> Mantivemos a convenção acima para compatibilidade com o sistema atual (usuarios.json.saldo).

## Integrações obrigatórias
1. **Matching/executar trade**
   - ao executar uma transação: gerar `TRADE_EXEC` com buyer/seller.
   - chamar `postJournal(..., applyToUsuarios: { usuariosPath })` para refletir saldo.

2. **Dividendos**
   - cada pagamento deve gerar um lançamento `DIVIDEND`.
   - idemKey recomendado: `dividend:<temporada>:<rodada>:<userId>:<clubeId>`.

3. **Liquidação final**
   - cada liquidação por usuário/clube deve gerar `LIQUIDATION`.
   - idemKey recomendado: `liq:<temporada>:<userId>:<clubeId>`.

4. **Depósito/Saque**
   - depósito confirmado pelo gateway -> `DEPOSIT`
   - saque confirmado -> `WITHDRAW`
   - idemKey = `gateway:<provider>:<eventId>`

## Benefícios imediatos
- Auditoria completa e trilha de eventos
- Idempotência forte (webhooks/retry safe)
- Reconciliação (somatório do ledger = verdade)
- Base para taxas da plataforma
