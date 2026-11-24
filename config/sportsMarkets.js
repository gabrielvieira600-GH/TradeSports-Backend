const agora = new Date();
const anoAtual = agora.getFullYear();
const temporadaEuropeia = agora.getMonth() >= 6 ? anoAtual : anoAtual - 1;
const temporadaNBA = agora.getMonth() >= 8 ? anoAtual : anoAtual - 1;
const temporadaNFL = agora.getMonth() >= 7 ? anoAtual : anoAtual - 1;

module.exports = {
  'brasileirao-a': { id: 'brasileirao-a', nome: 'Brasileirão Série A', esporte: 'football', league: 71, season: Number(process.env.API_FOOTBALL_SEASON_BR_A || process.env.API_FOOTBALL_SEASON || anoAtual), participantes: 20, namespace: 7100000 },
  'brasileirao-b': { id: 'brasileirao-b', nome: 'Brasileirão Série B', esporte: 'football', league: 72, season: Number(process.env.API_FOOTBALL_SEASON_BR_B || anoAtual), participantes: 20, namespace: 7200000 },
  'premier-league': { id: 'premier-league', nome: 'Premier League', esporte: 'football', league: 39, season: Number(process.env.API_FOOTBALL_SEASON_PREMIER || temporadaEuropeia), participantes: 20, namespace: 3900000 },
  'champions-league': { id: 'champions-league', nome: 'UEFA Champions League — Fase de Liga', esporte: 'football', league: 2, season: Number(process.env.API_FOOTBALL_SEASON_UCL || temporadaEuropeia), participantes: 36, namespace: 220000000, fase: 'league', rodadas: 8 },
  'la-liga': { id: 'la-liga', nome: 'La Liga', esporte: 'football', league: 140, season: Number(process.env.API_FOOTBALL_SEASON_LALIGA || temporadaEuropeia), participantes: 20, namespace: 14000000 },
  bundesliga: { id: 'bundesliga', nome: 'Bundesliga', esporte: 'football', league: 78, season: Number(process.env.API_FOOTBALL_SEASON_BUNDESLIGA || temporadaEuropeia), participantes: 18, namespace: 7800000 },
  'ligue-1': { id: 'ligue-1', nome: 'Ligue 1', esporte: 'football', league: 61, season: Number(process.env.API_FOOTBALL_SEASON_LIGUE1 || temporadaEuropeia), participantes: 18, namespace: 6100000 },
  'serie-a': { id: 'serie-a', nome: 'Serie A', esporte: 'football', league: 135, season: Number(process.env.API_FOOTBALL_SEASON_SERIEA || temporadaEuropeia), participantes: 20, namespace: 13500000 },
  eredivisie: { id: 'eredivisie', nome: 'Eredivisie', esporte: 'football', league: 88, season: Number(process.env.API_FOOTBALL_SEASON_EREDIVISIE || temporadaEuropeia), participantes: 18, namespace: 8800000 },
  'nba-oeste': { id: 'nba-oeste', nome: 'NBA — Conferência Oeste', esporte: 'nba', conference: 'west', league: 'standard', season: String(process.env.API_NBA_SEASON || temporadaNBA), participantes: 15, namespace: 100000000 },
  'nba-leste': { id: 'nba-leste', nome: 'NBA — Conferência Leste', esporte: 'nba', conference: 'east', league: 'standard', season: String(process.env.API_NBA_SEASON || temporadaNBA), participantes: 15, namespace: 110000000 },
  'nfl-afc': { id: 'nfl-afc', nome: 'NFL — AFC', esporte: 'nfl', conference: 'afc', league: Number(process.env.API_NFL_LEAGUE_ID || 1), season: Number(process.env.API_NFL_SEASON || temporadaNFL), participantes: 16, namespace: 200000000 },
  'nfl-nfc': { id: 'nfl-nfc', nome: 'NFL — NFC', esporte: 'nfl', conference: 'nfc', league: Number(process.env.API_NFL_LEAGUE_ID || 1), season: Number(process.env.API_NFL_SEASON || temporadaNFL), participantes: 16, namespace: 210000000 },
};
anoAtual
