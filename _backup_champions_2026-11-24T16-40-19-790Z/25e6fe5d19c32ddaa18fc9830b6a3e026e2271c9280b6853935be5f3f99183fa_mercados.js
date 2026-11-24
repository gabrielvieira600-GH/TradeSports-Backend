const mercados = {
  'brasileirao-a': { id: 'brasileirao-a', nome: 'Brasileirão Série A', badge: 'brasileirao-serie-a', rota: '/brasileirao-a', endpoint: '/api/tabela-brasileirao', participantes: 20, entidade: 'clube' },
  'brasileirao-b': { id: 'brasileirao-b', nome: 'Brasileirão Série B', badge: 'brasileirao-serie-b', rota: '/brasileirao-b', endpoint: '/api/tabelas/brasileirao-b', participantes: 20, entidade: 'clube' },
  'premier-league': { id: 'premier-league', nome: 'Premier League', badge: 'premier-league', rota: '/premierleague-a', endpoint: '/api/tabelas/premier-league', participantes: 20, entidade: 'clube' },
  'la-liga': { id: 'la-liga', nome: 'La Liga', badge: 'la-liga', rota: '/laliga-a', endpoint: '/api/tabelas/la-liga', participantes: 20, entidade: 'clube' },
  bundesliga: { id: 'bundesliga', nome: 'Bundesliga', badge: 'bundesliga', rota: '/bundesliga', endpoint: '/api/tabelas/bundesliga', participantes: 18, entidade: 'clube' },
  'ligue-1': { id: 'ligue-1', nome: 'Ligue 1', badge: 'ligue-1', rota: '/ligue-1', endpoint: '/api/tabelas/ligue-1', participantes: 18, entidade: 'clube' },
  'serie-a': { id: 'serie-a', nome: 'Serie A', badge: 'serie-a', rota: '/serie-a', endpoint: '/api/tabelas/serie-a', participantes: 20, entidade: 'clube' },
  eredivisie: { id: 'eredivisie', nome: 'Eredivisie', badge: 'eredivisie', rota: '/eredivisie', endpoint: '/api/tabelas/eredivisie', participantes: 18, entidade: 'clube' },
  'nba-oeste': { id: 'nba-oeste', nome: 'NBA — Conferência Oeste', badge: 'nba', rota: '/nbaoeste', endpoint: '/api/tabelas/nba-oeste', participantes: 15, entidade: 'time' },
  'nba-leste': { id: 'nba-leste', nome: 'NBA — Conferência Leste', badge: 'nba', rota: '/nbaleste', endpoint: '/api/tabelas/nba-leste', participantes: 15, entidade: 'time' },
  'nfl-afc': { id: 'nfl-afc', nome: 'NFL — AFC', badge: 'nfl', rota: '/nfloeste', endpoint: '/api/tabelas/nfl-afc', participantes: 16, entidade: 'time' },
  'nfl-nfc': { id: 'nfl-nfc', nome: 'NFL — NFC', badge: 'nfl', rota: '/nflleste', endpoint: '/api/tabelas/nfl-nfc', participantes: 16, entidade: 'time' },
};

export default mercados;
