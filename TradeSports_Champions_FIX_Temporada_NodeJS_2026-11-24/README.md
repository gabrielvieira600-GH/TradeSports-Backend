# Correção UCL — erro "Temporada da API inesperada: NaN"

O aplicador anterior modificou corretamente os arquivos; **não execute novamente o aplicador completo**. Este pacote corrige exclusivamente o tratamento da resposta da API-Football no cadastro dos clubes e na atualização de tabelas.

Extraia esta pasta na raiz do backend (dentro de `backend/`), ficando `backend/TradeSports_Champions_FIX_Temporada_NodeJS_2026-11-24/`.

No terminal, dentro de `backend/`:

```cmd
node TradeSports_Champions_FIX_Temporada_NodeJS_2026-11-24/scripts/aplicar_correcao_ucl.js --check
node TradeSports_Champions_FIX_Temporada_NodeJS_2026-11-24/scripts/aplicar_correcao_ucl.js --apply
node scripts/seedChampions2026.js --check
```

O --apply só modifica **arquivos locais**, gera `_backup_ucl_api_*` e não altera MongoDB.

**Se o último comando reportar que a API-Football não retornou dados**, NÃO execute `--apply` do cadastro. Confirme no painel do fornecedor se a liga `2`, temporada `2026`, possui a classificação de **36 participantes** e está disponível na sua assinatura. A alternativa `--input=...` aceita JSON real da API-Football (não posições inventadas). Somente depois de receber 36 clubes válidos, aplicar o cadastro:

```cmd
node scripts/seedChampions2026.js --apply --confirm=CHAMPIONS_2026_27
```

**Nota:** aviso `Duplicate schema index ...` é separado deste erro e não é a causa da falha no cadastro.
