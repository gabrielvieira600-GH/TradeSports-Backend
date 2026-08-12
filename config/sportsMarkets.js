const anoAtual = new Date().getFullYear();

module.exports = {
  'brasileirao-b': { id: 'brasileirao-b', nome: 'Brasileirão Série B', esporte: 'football', league: 72, season: Number(process.env.API_FOOTBALL_SEASON_BR_B || 2024), participantes: 20, namespace: 7200000 },
  'premier-league': { id: 'premier-league', nome: 'Premier League', esporte: 'football', league: 39, season: Number(process.env.API_FOOTBALL_SEASON_PREMIER || 2023), participantes: 20, namespace: 3900000 },
  'la-liga': { id: 'la-liga', nome: 'La Liga', esporte: 'football', league: 140, season: Number(process.env.API_FOOTBALL_SEASON_LALIGA || 2023), participantes: 20, namespace: 14000000 },
  bundesliga: { id: 'bundesliga', nome: 'Bundesliga', esporte: 'football', league: 78, season: Number(process.env.API_FOOTBALL_SEASON_BUNDESLIGA || 2023), participantes: 18, namespace: 7800000 },
  'ligue-1': { id: 'ligue-1', nome: 'Ligue 1', esporte: 'football', league: 61, season: Number(process.env.API_FOOTBALL_SEASON_LIGUE1 || 2023), participantes: 18, namespace: 6100000 },
  'serie-a': { id: 'serie-a', nome: 'Serie A', esporte: 'football', league: 135, season: Number(process.env.API_FOOTBALL_SEASON_SERIEA || 2023), participantes: 20, namespace: 6100000 },
  eredivisie: { id: 'eredivisie', nome: 'Eredivisie', esporte: 'football', league: 88, season: Number(process.env.API_FOOTBALL_SEASON_EREDIVISIE || 2023), participantes: 18, namespace: 8800000 },
  'nba-oeste': { id: 'nba-oeste', nome: 'NBA — Conferência Oeste', esporte: 'nba', conference: 'west', league: 'standard', season: String(process.env.API_NBA_SEASON || 2023), participantes: 15, namespace: 100000000 },
  'nba-leste': { id: 'nba-leste', nome: 'NBA — Conferência Leste', esporte: 'nba', conference: 'east', league: 'standard', season: String(process.env.API_NBA_SEASON || 2023), participantes: 15, namespace: 110000000 },
  'nfl-afc': { id: 'nfl-afc', nome: 'NFL — AFC', esporte: 'nfl', conference: 'afc', league: Number(process.env.API_NFL_LEAGUE_ID || 1), season: Number(process.env.API_NFL_SEASON || 2023), participantes: 16, namespace: 200000000 },
  'nfl-nfc': { id: 'nfl-nfc', nome: 'NFL — NFC', esporte: 'nfl', conference: 'nfc', league: Number(process.env.API_NFL_LEAGUE_ID || 1), season: Number(process.env.API_NFL_SEASON || 2023), participantes: 16, namespace: 210000000 },
};
anoAtual