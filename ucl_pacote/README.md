# TradeSports | UEFA Champions League 2026/27 — fase de liga

**Base consultada:** `gabrielvieira600-GH/TradeSports-Backend` e `gabrielvieira600-GH/TradeSports-Frontend-OK`, branch `main`, em 24/11/2026.

## O que está incluído

- **36 clubes oficiais** da fase de liga (UEFA), com os nomes/aliases validados e **IDs próprios exclusivos da Champions** (`220000001` a `220000036`). Assim, cotas de um clube da Champions não se confundem com as cotas do mesmo clube na liga nacional.
- Configuração da liga: `league=2`, `season=2026`, 36 participantes, 8 rodadas, rota `/api/tabelas/champions-league`.
- **Cadastro seguro no MongoDB** usando a API-Football da temporada 2026 para obter os IDs e escudos oficiais e as posições atuais. Sem API válida, NÃO cria posições fictícias nem realiza mudanças no banco.
- Menu lateral, página `/champions-league`, badge exclusivo da competição e badges dos clubes. Reutiliza badges já existentes; os 14 novos recebem moldura autoral baseada em suas cores e escudo oficial da API (se carregado).
- Controle de atualização da classificação: valida 36 clubes/36 posições distintas antes de gravar, não recua para a temporada 2025; com `MARKET_MODE=IPO`, o preço de referência acompanha a posição e é persistido no MongoDB.
- Reutiliza **modal, IPO, mercado secundário, carteira, ledger e liquidação por liga** já existentes na aplicação. A liga nasce **FECHADA** no painel até você autorizar abertura.

## Instalar com Node.js no VS Code (Windows)

Coloque a pasta descompactada dentro de seu `backend`, supondo esta estrutura:

```
bolsa-futebol/backend/
  controllers/
  config/
  frontend/                  # aqui ficam pages/ e components/
  ucl_pacote/
    scripts/aplicar_champions.js
    scripts/ucl2026.js
    scripts/seedChampions2026.js
    data/participantes-2026-27.json
```

No terminal do VS Code **na raiz do backend**:

```powershell
node ucl_pacote/scripts/aplicar_champions.js --backend . --frontend ./frontend --check
```

**ATENÇÃO:** `--check` é apenas validação e não escreve arquivos. Primeiro use:

```powershell
node ucl_pacote/scripts/aplicar_champions.js --backend . --frontend ./frontend --check
```

Se retornar `VALIDAÇÃO CONCLUÍDA`, execute:

```powershell
node ucl_pacote/scripts/aplicar_champions.js --backend . --frontend ./frontend --apply
```

O aplicador valida todas as âncoras **antes** de alterar qualquer arquivo; em caso de divergência, interrompe sem gravar. Na aplicação, gera backups dos arquivos existentes dentro de `backend/_backup_champions_<timestamp>/`.

Se seu frontend estiver em outra pasta, altere apenas o caminho `--frontend`.

### Verificações

```powershell
node --check config/ucl2026.js
node --check scripts/seedChampions2026.js
node --check routes/sportsStandings.js
node --test ucl_pacote/tests/ucl2026.test.js
```

### Cadastrar os 36 clubes (banco MongoDB)

Configure a `.env` do backend com:

```
MONGODB_URI=<seu URI existente>
API_FOOTBALL_KEY=<sua chave existente>
API_FOOTBALL_SEASON_UCL=2026
MARKET_MODE=IPO
```

**Não copie credenciais para o ZIP nem para o GitHub.** Antes de executar os comandos de cadastro, faça snapshot/backup do MongoDB e valide a API.

Primeiro diagnóstico, sem gravar:

```powershell
node scripts/seedChampions2026.js --check
```

Apenas após confirmar os **36 clubes, 36 posições distintas e nenhuma colisão de ID**, execute:

```powershell
node scripts/seedChampions2026.js --apply --confirm=CHAMPIONS_2026_27
```

Esse comando faz UPSERT dos 36 clubes, **não zera saldo nem carteira**, preserva IPO e ordens existentes dos clubes eventualmente já cadastrados. A liga é criada inicialmente `fechado: true` para evitar negociações antes da conferência. Se o serviço API não retornar uma classificação íntegra, o script encerra sem criar ou inventar participantes.

Você pode usar `--input=arquivo.json` para ler um JSON previamente exportado da API em vez de chamar a API-Football. Esse JSON deve ter os dados verdadeiros de 36 clubes da temporada 2026; NÃO use dados de outra temporada.

### Publicação

1. Publique alterações do backend no **TradeSports-Backend**, e do frontend no **TradeSports-Frontend-OK** (não troque um repositório pelo outro).
2. Render: `MARKET_MODE=IPO`, `API_FOOTBALL_SEASON_UCL=2026`, `API_FOOTBALL_KEY` e `MONGODB_URI` configurados.
3. Verifique `GET /api/tabelas/champions-league`: deve ter **36 clubes** com posição e `escudo`.
4. Verifique `GET /clube/<legacyId>` de um clube da Champions: seu `metadata.ligaId` deve ser `champions-league`, e suas cotas devem ser 1000 disponíveis quando ainda não houver negócios.
5. Verifique `/champions-league` no frontend e todos os 36 badges.
6. No painel administrativo, abra **somente** a Champions e teste compra IPO, venda IPO no preço da posição, saldo, extrato, ranking, livros e ordens institucionais após esgotamento de um clube em ambiente de teste.
7. Ao encerrar a fase de liga, feche a competição pelo painel e use **Prévia de Liquidação por Liga** para conferir as 36 posições, todas únicas, antes de confirmar a liquidação final. Não use a classificação da fase eliminatória para isso.

## Escopo e limites importantes

**Operação de compra/venda:** este pacote integra a nova competição ao motor de IPO/mercado secundário já existente. **Não reinventa** o livro institucional e não troca o modal atual.

**Dividendos:** o código existente de dividendos é específico do Brasileirão. Este pacote **não cria pagamento automático de dividendos da Champions**; essa funcionalidade exige definir janelas de posse/rodadas da Champions, separar as chaves de idempotência e homologar os lançamentos no ledger. Não habilite dividendos para a Champions supondo que o motor do Brasileirão vá processá-los.

**Dados em tempo real:** a fonte para a classificação é a API-Football, não a imagem fornecida. Não foi possível testar o acesso à sua chave nem executar operações no seu MongoDB/Render/Vercel. As chamadas API podem requerer cobertura contratada para `league=2` / `season=2026`.

**Aparência dos badges:** o padrão existente da TradeSports utiliza monogramas e formas autorais. Os 14 clubes ainda sem badges nesse catálogo ganham novas identidades nesse padrão; a imagem do escudo oficial vinda da API-Football é exibida dentro do badge novo sempre que disponível. Não são arquivos de marcas comerciais redistribuídos no pacote.

**Limite temporal:** fase de liga: 08/09/2026 a 27/01/2027. A data 07/07/2026 na imagem se refere ao início das fases qualificatórias, não ao início da fase de liga. A publicação da liga NÃO agenda automaticamente liquidação nem a abre automaticamente.

**Fonte de participantes:** https://www.uefa.com/uefachampionsleague/news/02a8-2171a88881a0-c70193b972c6-1000--meet-the-2026-27-champions-league-league-phase-teams/

## Arquivos envolvidos

**Existentes, alterados pelo aplicador:**

- `backend/config/sportsMarkets.js`
- `backend/routes/sportsStandings.js`
- `frontend/Data/mercados.js`
- `frontend/components/Sidebar.js`
- `frontend/components/ClubBadge.js`
- `frontend/pages/brasileirao-a.js` (propaga o ID da liga aos badges; protege a identificação de clubes homônimos)

**Novos, copiados pelo aplicador:**

- `backend/config/ucl2026.js`
- `backend/data/participantes-2026-27.json`
- `backend/scripts/seedChampions2026.js`
- `frontend/pages/champions-league.js`
