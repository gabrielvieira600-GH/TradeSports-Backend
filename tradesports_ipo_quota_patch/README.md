# TradeSports — Franquia semanal Lite nas compras do IPO

Pacote Node.js (JavaScript), preparado com base nas branches `main` consultadas em 24/11/2026 dos repositórios `gabrielvieira600-GH/TradeSports-Backend` e `gabrielvieira600-GH/TradeSports-Frontend-OK`.

## Comportamento definido

- Cada **compra executada no IPO** consome **1 ordem semanal** do Plano Lite, independentemente de comprar 1 ou várias cotas.
- Uma **venda/devolução ao sistema durante o IPO não consome franquia** e continua permitida se o limite semanal estiver esgotado, respeitadas as demais regras da liga e da carteira.
- As **ordens executadas no secundário** continuam contando da maneira atual (cada ordem contabilizada na primeira execução, não por quantidade de cotas).
- IPO e secundário compartilham a **mesma franquia semanal por usuário e temporada**: o limite default é 15, mas o backend respeita o limite definido na temporada e bônus por anúncios.
- Premium permanece com ordens ilimitadas.
- A primeira compra IPO já consta da contagem após a transação e a atualização do modal. A reconciliação reconta as compras IPO (`Investment.tipo = 'IPO'`) **mais** ordens do secundário e evita o contador voltar atrás.
- Compras IPO agora verificam a existência de uma temporada de ranking ativa e o mercado global aberto — condições já existentes para o mercado secundário. Sem temporada ativa, a nova compra IPO fica indisponível.
- Tudo ocorre dentro da **mesma transação MongoDB**: não debita cotas/saldo nem consome franquia em caso de erro de validação/ledger.
- A franquia é exibida no modal de **compra IPO** (além do secundário); o botão Comprar é desabilitado quando a franquia se esgota. O backend também rejeita o POST independentemente da interface.

## Instalação no Windows — CMD do VS Code

Extraia a pasta `tradesports_ipo_quota_patch` **dentro da pasta `backend`** (aquela que contém `server.js`, `controllers/`, `routes/`, `utils/` e `frontend/`).

No terminal: `C:\Users\gvdea\bolsa-futebol\backend>`

**1. Verifique sem alterar nada:**

```cmd
node tradesports_ipo_quota_patch/aplicar_patch_ipo_lite.js --backend . --frontend ./frontend --check
```

**2. Aplique somente se o check mostrar OK nos três arquivos:**

```cmd
node tradesports_ipo_quota_patch/aplicar_patch_ipo_lite.js --backend . --frontend ./frontend --apply
```

O script cria automaticamente `_backup_ipo_lite_<data>` na pasta backend contendo os arquivos originais (inclusive o componente do frontend). Reexecutar `--apply` após uma aplicação bem-sucedida acusará que as âncoras não existem: **não rode duas vezes**.

**3. Valide a sintaxe:**

```cmd
node --check controllers/InvestimentoController.js
node --check utils/tradingQuota.js
```

**4. Testes do aplicador:**

```cmd
node --test tradesports_ipo_quota_patch/tests/test_patch.js
```

Os testes verificam o aplicador com **trechos simulados** e não substituem testes reais de integração no MongoDB.

## Homologação (banco de testes, não produção)

1. Habilite uma **temporada ativa** com limite Lite 15 e certifique-se de que o mercado e a liga estão abertos.
2. Abra clube em IPO com cotas disponíveis; confira card Lite `15 de 15`.
3. Comprar 1 cota -> `14 de 15`; depois comprar 10 cotas numa transação -> `13 de 15` (é por ordem, não por cota).
4. Executar uma ordem no secundário: também reduz a franquia em uma unidade.
5. Vender cotas ao sistema durante IPO: saldo/carteira atualizados, franquia não reduzida.
6. Completar o limite; a 16ª compra de IPO deve ser barrada pelo modal e retornar `403` com `codigo=LIMITE_ORDENS_ATINGIDO` ao chamar a API diretamente.
7. Tentar compra IPO com saldo insuficiente ou clube sem estoque: não deve consumir franquia.
8. Premium compra IPO sem consumir franquia Lite.
9. Simular renovação de semana (em ambiente de testes) e verificar contador zerado na segunda-feira, fuso de São Paulo.
10. Confirmar `Investment` e `UserTradingQuota` coerentes e ledger balanceado após compras, falhas e vendas.
11. Conferir efeitos dos anúncios premiados (bônus de ordens), caso habilitados na conta de testes.
12. Após homologação, faça commit de backend **e** frontend e publique Render e Vercel. Não basta publicar apenas um.

## Arquivos modificados

- **Backend** `utils/tradingQuota.js`: reconciliação da mesma franquia semanal soma ordens executadas + compras IPO registradas.
- **Backend** `controllers/InvestimentoController.js`: validação e consumo atômico na rota `POST /clube/:id/comprar`, erros padronizados e resposta de franquia.
- **Frontend** `components/NegociacaoModal.js`: mostra franquia na compra IPO, desabilita compra Lite sem saldo de ordens e preserva vendas IPO.

### Limitações e segurança

- Nenhum banco de dados é alterado pelo aplicador; ele só modifica **arquivos locais**.
- O aplicador só aceita as âncoras exatas dos arquivos inspecionados; se houver modificações locais incompatíveis, **o check falha e não grava nada**.
- Os testes incluídos não cobrem end-to-end da aplicação. **Não publicar diretamente em produção sem homologação**.
- Compras de IPO anteriores na mesma semana passam a integrar a contagem retrospectivamente, pois a reconciliação passa a contar investimentos `IPO` da semana vigente.
- Não modificamos `MARKET_MODE`, preços, estoque, taxas, recompra, badges, campeonatos, nem a regra de liquidação.
