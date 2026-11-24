'use strict';
// Executar a partir da raiz do backend após instalar o patch.
require('dotenv').config();
const markets=require('../config/sportsMarkets');
const live=require('../services/liveFootballTable');
for(const m of Object.values(markets).filter(m=>m.esporte==='football')) {
 const active=live.enabled(m.id);
 console.log(`${active?'LIVE   ':'OFF    '} ${m.id.padEnd(20)} temporada=${m.season} participantes=${m.participantes}`);
 if(active && Number(m.season)<2025) console.warn('   ATENÇÃO: temporada antiga configurada; confira a fonte antes de permitir negociar.');
}
console.log('ATENÇÃO: este comando não consulta API nem MongoDB. Não confirma que os preços estão atualizados.');
