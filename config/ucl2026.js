'use strict';
/**
 * Official list: UEFA, 2026/27 league phase (36 participants).
 * Team identities are fixed by slot, not by the API-Football IDs. This
 * prevents duplicated holdings when the same club participates in two leagues.
 */
const roster = require('../data/participantes-2026-27.json');
const LEAGUE_ID = 'champions-league';
const SEASON = 2026;
const NAMESPACE = 220000000;

function normalize(value = '') {
  return String(value).toLowerCase().normalize('NFKD')
    .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}
const byAlias = new Map();
for (const item of roster) {
  for (const alias of [item.nome, ...item.aliases]) {
    const key = normalize(alias);
    if (byAlias.has(key) && byAlias.get(key).slot !== item.slot) {
      throw new Error(`Alias UEFA ambíguo: ${alias}`);
    }
    byAlias.set(key, item);
  }
}
function identify(teamName) {
  return byAlias.get(normalize(teamName)) || null;
}
function selectStandings(standings) {
  const groups = Array.isArray(standings) ? standings.filter(Array.isArray) : [];
  const full = groups.find(group => group.length === roster.length);
  if (full) return full;
  const combined = groups.flat();
  if (combined.length === roster.length) return combined;
  throw new Error(`UEFA 2026/27 exige 36 clubes; API retornou ${combined.length}. Nenhuma atualização aplicada.`);
}
function validateStandings(items) {
  if (!Array.isArray(items) || items.length !== roster.length) {
    throw new Error(`A fase de liga deve conter 36 clubes, recebidos: ${items?.length ?? 'inválido'}`);
  }
  const found = new Set();
  const positions = new Set();
  const mapped = [];
  for (const item of items) {
    const name = item?.nome || item?.team?.name;
    const position = Number(item?.posicao ?? item?.rank);
    const providerTeamId = Number(item?.apiId ?? item?.team?.id);
    const team = identify(name);
    if (!team) throw new Error(`Clube da API não reconhecido na lista oficial: ${name}`);
    if (!Number.isInteger(position) || position < 1 || position > 36) throw new Error(`Posição inválida: ${name} (${position})`);
    if (!Number.isInteger(providerTeamId) || providerTeamId <= 0) throw new Error(`ID da API inválido: ${name}`);
    if (found.has(team.slot)) throw new Error(`Clube repetido: ${name}`);
    if (positions.has(position)) throw new Error(`Posição repetida: ${position}`);
    found.add(team.slot); positions.add(position);
    mapped.push({ ...team, apiId: providerTeamId, posicao: position, escudo: item?.escudo || item?.team?.logo || '',
      pontos: Number(item?.pontos ?? item?.points ?? 0), jogos: Number(item?.jogos ?? item?.all?.played ?? 0),
      vitorias: Number(item?.vitorias ?? item?.all?.win ?? 0), empates: Number(item?.empates ?? item?.all?.draw ?? 0),
      derrotas: Number(item?.derrotas ?? item?.all?.lose ?? 0), saldo: Number(item?.saldo ?? item?.goalsDiff ?? 0) });
  }
  if (found.size !== 36 || positions.size !== 36) throw new Error('Classificação incompleta.');
  return mapped.sort((a,b) => a.posicao - b.posicao);
}
function toLegacyId(item) { return NAMESPACE + Number(item.slot); }
module.exports = { roster, LEAGUE_ID, SEASON, NAMESPACE, normalize, identify, selectStandings, validateStandings, toLegacyId };
