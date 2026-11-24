'use strict';
const markets=require('../config/sportsMarkets');
const football=require('./liveFootballTable');
const american=require('./liveAmericanTable');
function enabled(id){return Boolean(markets[id]&&['football','nba','nfl'].includes(markets[id].esporte));}
async function refreshCompetition(config,options){
  if(!enabled(config?.id))return null;
  return config.esporte==='football'?football.refreshCompetition(config,options):american.refreshCompetition(config,options);
}
async function assertFreshForClub(club){
  if(!enabled(club?.metadata?.ligaId))return;
  const config=markets[club.metadata.ligaId];
  if(String(club.metadata?.temporada)!==String(config.season)){
    const e=new Error('TEMPORADA_CLUBE_DIVERGENTE');e.liveData=true;throw e;
  }
  return config.esporte==='football'?football.assertFreshForClub(club):american.assertFreshForClub(club);
}
module.exports={enabled,refreshCompetition,assertFreshForClub};
