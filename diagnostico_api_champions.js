'use strict';
// Diagnóstico SOMENTE LEITURA: não altera MongoDB nem publica arquivos.
require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');

const BASE = 'https://v3.football.api-sports.io';
const raw = process.env.API_FOOTBALL_KEY;
const key = typeof raw === 'string' ? raw.trim() : '';
const mask = (v) => v == null ? null : String(v);
function printResponse(label, result) {
  const body = result?.data || {};
  const errors = body.errors;
  console.log(`\n[${label}] HTTP ${result.status}`);
  if (errors && (typeof errors !== 'object' || Object.keys(errors).length)) {
    console.log('Erros API:', JSON.stringify(errors));
  }
  return body;
}
async function req(label, path, params = {}) {
  try {
    const result = await axios.get(`${BASE}/${path}`, {
      params,
      headers: { 'x-apisports-key': key, Accept: 'application/json' },
      timeout: 18000,
      validateStatus: () => true,
    });
    return printResponse(label, result);
  } catch (error) {
    console.error(`[${label}] Falha de rede: ${error.code || error.message}`);
    return null;
  }
}
(async () => {
  if (!key) {
    console.error('ERRO: API_FOOTBALL_KEY não definida no .env (ou no ambiente do processo).');
    process.exitCode = 1;
    return;
  }
  console.log('Verificação da API-Football — somente leitura');
  console.log('Chave carregada: SIM (conteúdo oculto)');
  console.log('Tamanho:', key.length, '| Identificador SHA-256:', crypto.createHash('sha256').update(key).digest('hex').slice(0, 12));
  if (raw !== key) console.warn('ATENÇÃO: espaços ou quebras de linha removidos da chave.');
  const status = await req('STATUS DA ASSINATURA', 'status');
  if (status) {
    const info = status.response || {};
    console.log('Plano identificado pela API:', mask(info.subscription?.plan) || '(não informado)');
    console.log('Término da assinatura:', mask(info.subscription?.end) || '(não informado)');
    console.log('Limite diário:', mask(info.requests?.limit_day) || '(não informado)');
    console.log('Requisições diárias usadas:', mask(info.requests?.current) || '(não informado)');
  }
  const leagues = await req('CHAMPIONS LIGA 2 2026', 'leagues', { id: 2, season: 2026 });
  if (leagues) {
    console.log('Ligas retornadas:', Array.isArray(leagues.response) ? leagues.response.length : '(resposta inválida)');
  }
  const standings = await req('CHAMPIONS CLASSIFICAÇÃO', 'standings', { league: 2, season: 2026 });
  if (standings) {
    const groups = standings.response?.[0]?.league?.standings;
    const positions = Array.isArray(groups) ? groups.flat() : [];
    console.log('Clubes na classificação:', positions.length);
    console.log('Temporada retornada:', mask(standings.response?.[0]?.league?.season) || '(não informada)');
  }
  console.log('\nNão compartilhe a API-KEY nem o arquivo .env. O relatório acima omite a chave.');
})().catch((error) => {
  console.error('Falha inesperada:', error.message);
  process.exitCode = 1;
});
