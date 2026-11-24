# TradeSports — Auditoria de temporadas e registros antigos (somente leitura)

Este pacote não corrige nem exclui registros automaticamente. Ele investiga as oito ligas com clubes antigos e os mercados com configuração de credencial ausente, sem alterar MongoDB, código de produção ou APIs externas.

## Instalação (VS Code / Node.js)

Copie `auditar_mercados.js` para a raiz da pasta `backend` (ao lado de `server.js`, `models/` e `config/`). No terminal dentro de `backend`, execute:

```cmd
node auditar_mercados.js --check
```

O script gera `relatorios_trade/auditoria_mercados_2026.json` na pasta do backend. A chave API, MongoDB URI e dados de usuários não são incluídos no relatório. Envie o resumo ou o relatório, após revisar seus dados, para a próxima etapa de reconciliação.

Não execute operações de arquivamento automático baseadas apenas em `cotasEmitidas: 0`: títulos históricos podem ter investimentos, ordens ou referências institucionais associadas. O relatório marca `SEM_VINCULOS_NAS_COLECOES_VERIFICADAS` apenas quando não há referências nas quatro fontes verificadas; isso **não é autorização de exclusão**.

## Critérios para uma reconciliação segura

1. Manter 2026 apenas com a quantidade correta de participantes e IDs de API não duplicados.
2. Arquivar antigos dados de forma reversível, nunca sobrescrever identidades antigas nem histórico de trades.
3. Validar previamente usuários, investimentos, ordens, conta institucional, dividendos e ledger.
4. Confirmar separadamente as permissões de acesso API-NBA e API-NFL. Uma mesma chave de conta API-Sports pode operar múltiplas APIs, dependendo das assinaturas, mas `API_FOOTBALL_KEY` não prova acesso aos outros esportes.
5. Testar as tabelas e transações em homologação antes de liberar LIVE em produção.
