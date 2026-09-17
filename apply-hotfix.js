#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
function fail(msg){ console.error("\n[HOTFIX] ERRO:", msg); process.exit(1); }
function backup(file){ const bak=file+'.hotfix-cors-api-football.bak'; if(!fs.existsSync(bak)) fs.copyFileSync(file,bak); }
function replaceOnce(text,oldText,newText,label){
  const count=text.split(oldText).length-1;
  if(count!==1) fail(`${label}: esperado 1 bloco, encontrado ${count}.`);
  return text.replace(oldText,newText);
}
const serverPath=path.resolve('server.js');
const classificacaoPath=path.resolve('routes/classificacao.js');
if(!fs.existsSync(serverPath)||!fs.existsSync(classificacaoPath)) fail('Execute na raiz do TradeSports-Backend.');
backup(serverPath); backup(classificacaoPath);
let server=fs.readFileSync(serverPath,'utf8');

const oldCors=`const allowedOrigins = [
  process.env.FRONTEND_ORIGIN,
  "https://www.tradesports.com.br",
  "https://tradesports.com.br",
  "https://trade-sports-frontend-ok.vercel.app",
  "https://trade-sports-frontend-ok-om3a.vercel.app",
  "http://localhost:3000",
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(\`CORS bloqueado para origin: \${origin}\`));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    credentials: false,
  }),
);

`;

const earlyCors=`// CORS deve preceder rate-limit, parsers e rotas para que inclusive
// respostas antecipadas recebam os headers CORS corretos.
const allowedOrigins = [
  process.env.FRONTEND_ORIGIN,
  "https://www.tradesports.com.br",
  "https://tradesports.com.br",
  "https://trade-sports-frontend-ok.vercel.app",
  "https://trade-sports-frontend-ok-om3a.vercel.app",
  "http://localhost:3000",
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(\`CORS bloqueado para origin: \${origin}\`));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
  credentials: false,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));

`;

server=replaceOnce(server,oldCors,'','remoção do CORS tardio');
server=replaceOnce(server,'app.set("trust proxy", 1);\n\n','app.set("trust proxy", 1);\n\n'+earlyCors,'inserção do CORS antecipado');
fs.writeFileSync(serverPath,server,'utf8');

let cls=fs.readFileSync(classificacaoPath,'utf8');
cls=replaceOnce(cls,'season: Number(process.env.API_FOOTBALL_SEASON || 2024),','season: Number(process.env.API_FOOTBALL_SEASON || new Date().getFullYear()),','temporada API-Football');
const oldInvalid=`    if (!Array.isArray(standings)) {
      throw new Error('Resposta inválida da API-Football.');
    }`;
const newInvalid=`    if (!Array.isArray(standings)) {
      const apiErrors = response?.data?.errors;
      const apiMessage =
        response?.data?.message ||
        (apiErrors && typeof apiErrors === 'object'
          ? JSON.stringify(apiErrors)
          : String(apiErrors || ''));

      console.error('[CLASSIFICACAO] API-Football sem standings:', {
        season: Number(process.env.API_FOOTBALL_SEASON || new Date().getFullYear()),
        results: response?.data?.results,
        errors: apiErrors || null,
        message: response?.data?.message || null,
      });

      throw new Error(
        apiMessage
          ? \`API-Football não retornou classificação: \${apiMessage}\`
          : 'API-Football não retornou classificação para a temporada configurada.'
      );
    }`;
cls=replaceOnce(cls,oldInvalid,newInvalid,'diagnóstico API-Football');
fs.writeFileSync(classificacaoPath,cls,'utf8');
console.log('[HOTFIX] Aplicado: server.js + routes/classificacao.js');
console.log('[HOTFIX] Confirme no Render: API_FOOTBALL_SEASON=2026 e faça deploy.');
