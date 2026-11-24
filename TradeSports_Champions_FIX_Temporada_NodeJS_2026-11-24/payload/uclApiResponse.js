'use strict';
/**
 * Retorna standings apenas quando a API-Football fornece uma lista completa.
 * Erros, cobertura ausente e temporadas incorretas bloqueiam o cadastro.
 */
function parseApiFootballStandings(json, ucl) {
  const errors = json?.errors;
  const apiErrors = Array.isArray(errors) ? errors : (errors && typeof errors === 'object' ? Object.values(errors) : []);
  if (apiErrors.length) {
    throw new Error(`API-Football recusou a consulta: ${apiErrors.map(String).join('; ').slice(0, 500)}. Confirme acesso à liga 2, temporada 2026.`);
  }
  const response = json?.response;
  if (!Array.isArray(response) || response.length === 0) {
    throw new Error(`API-Football não retornou classificação para Champions League (league=2, season=2026; results=${json?.results ?? 'não informado'}). A temporada pode estar indisponível no plano. Nenhuma gravação feita.`);
  }
  if (response.length !== 1) {
    throw new Error(`Resposta inesperada: ${response.length} ligas no retorno da API-Football.`);
  }
  const league = response[0]?.league;
  if (!league || Number(league.id) !== 2) {
    throw new Error(`ID de competição inesperado na API-Football: ${league?.id ?? 'ausente'}; esperado 2.`);
  }
  const reportedSeason = league.season;
  // Em algumas respostas, season pode não vir preenchido. Não confundir ausência com temporada errada.
  if (reportedSeason !== undefined && reportedSeason !== null && String(reportedSeason).trim() !== '') {
    const year = Number(reportedSeason);
    if (!Number.isInteger(year) || year !== 2026) {
      throw new Error(`Temporada da API inesperada: ${reportedSeason}; esperado 2026.`);
    }
  }
  const standings = league.standings;
  if (!Array.isArray(standings) || !standings.length) {
    throw new Error('API-Football retornou liga 2/2026 sem classificação. Não criar posições artificiais.');
  }
  return ucl.selectStandings(standings); // exige 36 clubes
}
module.exports = { parseApiFootballStandings };
