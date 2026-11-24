'use strict';

// Scoping of ACTIVE clubs by competition+season; retains historical documents untouched.
function seasonValues(season) {
  const string = String(season ?? '').trim();
  if (!string || !/^\d{4}$/.test(string)) throw new Error('TEMPORADA_INVALIDA');
  const year = Number(string);
  return [year, string];
}
function currentSeasonFilter(config) {
  if (!config || !config.id) throw new Error('LIGA_INVALIDA');
  return { 'metadata.ligaId': config.id, 'metadata.temporada': { $in: seasonValues(config.season) } };
}
function assertCurrentRoster(clubs, config) {
  if (!Array.isArray(clubs) || !config) throw new Error('CADASTRO_ATUAL_INVALIDO');
  const expected = Number(config.participantes);
  if (!Number.isInteger(expected) || expected <= 0) throw new Error('TOTAL_CLUBES_INVALIDO');
  if (clubs.length !== expected) throw new Error(`ELENCO_ATUAL_INCOMPLETO_${config.id}:${clubs.length}/${expected}`);
  const api = new Set(), legacy = new Set();
  for (const club of clubs) {
    if (String(club?.metadata?.ligaId) !== String(config.id) ||
        String(club?.metadata?.temporada) !== String(config.season)) {
      throw new Error(`CLUBE_FORA_TEMPORADA_${config.id}`);
    }
    const provider = Number(club?.metadata?.providerTeamId);
    const oldId = Number(club?.legacyId);
    if (!Number.isSafeInteger(provider) || provider <= 0 ||
        !Number.isSafeInteger(oldId) || oldId <= 0 ||
        api.has(provider) || legacy.has(oldId)) {
      throw new Error(`IDS_ATUAIS_INVALIDOS_OU_DUPLICADOS_${config.id}`);
    }
    api.add(provider); legacy.add(oldId);
  }
  return true;
}
module.exports={seasonValues,currentSeasonFilter,assertCurrentRoster};
