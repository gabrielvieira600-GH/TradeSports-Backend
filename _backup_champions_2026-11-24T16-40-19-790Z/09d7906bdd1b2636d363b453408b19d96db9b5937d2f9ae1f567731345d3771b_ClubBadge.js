// components/ClubBadge.js
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';

const CLUB_STYLES = {
  flamengo: {
    outer: '#050505',
    glow: '#ff1f2d',
    pattern: 'horizontal-stripes',
    colors: ['#f31222', '#050505'],
    center: null,
  },

  palmeiras: {
    outer: '#006b3f',
    glow: '#00c46a',
    pattern: 'rings',
    colors: ['#006b3f', '#ffffff'],
    center: '#ffffff',
  },

  saopaulo: {
    outer: '#e01822',
    glow: '#ff3340',
    pattern: 'spfc-bars',
    colors: ['#ffffff', '#e01822', '#050505'],
    center: null,
  },

  santos: {
    outer: '#050505',
    glow: '#ffffff',
    pattern: 'vertical-stripes-clean',
    colors: ['#050505', '#ffffff'],
    center: '#ffffff',
  },

  vasco: {
    outer: '#050505',
    glow: '#ffffff',
    pattern: 'diagonal',
    colors: ['#050505', '#ffffff'],
    center: '#e01822',
  },

  vascodagama: {
    outer: '#050505',
    glow: '#ffffff',
    pattern: 'diagonal',
    colors: ['#050505', '#ffffff'],
    center: '#e01822',
  },

  botafogo: {
    outer: '#050505',
    glow: '#ffffff',
    pattern: 'star',
    colors: ['#050505', '#ffffff'],
    center: null,
  },

  fluminense: {
    outer: '#00613a',
    glow: '#8b1232',
    pattern: 'flu-stripes',
    colors: ['#00613a', '#8b1232', '#ffffff'],
    center: null,
  },

  gremio: {
    outer: '#00a3e0',
    glow: '#00bfff',
    pattern: 'gremio-stripes',
    colors: ['#00a3e0', '#050505', '#ffffff'],
    center: null,
  },

  internacional: {
    outer: '#e30613',
    glow: '#ff3340',
    pattern: 'target',
    colors: ['#e30613', '#ffffff'],
    center: '#ffffff',
  },

  cruzeiro: {
    outer: '#003da5',
    glow: '#2f80ff',
    pattern: 'stars',
    colors: ['#003da5', '#ffffff'],
    center: '#ffffff',
  },

  bahia: {
    outer: '#0057b8',
    glow: '#e30613',
    pattern: 'bahia',
    colors: ['#0057b8', '#ffffff', '#e30613'],
    center: '#ffffff',
  },

  coritiba: {
    outer: '#006b3f',
    glow: '#00c46a',
    pattern: 'coritiba',
    colors: ['#006b3f', '#ffffff'],
    center: '#ffffff',
  },

  vitoria: {
    outer: '#050505',
    glow: '#e30613',
    pattern: 'half-horizontal',
    colors: ['#e30613', '#050505'],
    center: '#ffffff',
  },

  atleticomineiro: {
    outer: '#050505',
    glow: '#ffffff',
    pattern: 'vertical-stripes-clean',
    colors: ['#050505', '#ffffff'],
    center: null,
  },

  atletico: {
    outer: '#050505',
    glow: '#ffffff',
    pattern: 'vertical-stripes-clean',
    colors: ['#050505', '#ffffff'],
    center: null,
  },

  corinthians: {
    outer: '#050505',
    glow: '#e30613',
    pattern: 'corinthians',
    colors: ['#050505', '#ffffff', '#e30613'],
    center: '#ffffff',
  },

  mirassol: {
    outer: '#006b3f',
    glow: '#ffd400',
    pattern: 'mirassol',
    colors: ['#ffd400', '#006b3f'],
    center: '#ffd400',
  },

  remo: {
    outer: '#001f4e',
    glow: '#ffffff',
    pattern: 'horizontal-band',
    colors: ['#001f4e', '#ffffff'],
    center: '#001f4e',
  },

  chapecoense: {
    outer: '#007a3d',
    glow: '#ffffff',
    pattern: 'horizontal-band',
    colors: ['#007a3d', '#ffffff'],
    center: '#ffffff',
  },

  bragantino: {
    outer: '#001f4e',
    glow: '#e30613',
    pattern: 'bragantino',
    colors: ['#001f4e', '#ffffff', '#e30613', '#ffd400'],
    center: '#ffd400',
  },

  rbbragantino: {
    outer: '#001f4e',
    glow: '#e30613',
    pattern: 'bragantino',
    colors: ['#001f4e', '#ffffff', '#e30613', '#ffd400'],
    center: '#ffd400',
  },

  redbullbragantino: {
    outer: '#001f4e',
    glow: '#e30613',
    pattern: 'bragantino',
    colors: ['#001f4e', '#ffffff', '#e30613', '#ffd400'],
    center: '#ffd400',
  },

  athleticoparanaense: {
    outer: '#e30613',
    glow: '#ff3340',
    pattern: 'furacao-diagonal',
    colors: ['#e30613', '#050505', '#ffffff'],
    center: null,
  },

  atleticoparanaense: {
    outer: '#e30613',
    glow: '#ff3340',
    pattern: 'furacao-diagonal',
    colors: ['#e30613', '#050505', '#ffffff'],
    center: null,
  },
};

/*
 * Catálogo autoral TradeSports
 * ----------------------------
 * Estes badges são tokens gráficos próprios: combinam padrões abstratos,
 * placas geométricas e monogramas. Não utilizam arquivos, URLs, contornos,
 * mascotes ou elementos dos escudos oficiais dos clubes.
 *
 * Formato de cada item:
 * [chave, monograma, cor principal, cor secundária, cor do monograma,
 *  padrão, formato da placa, aliases]
 */
const AUTHORIAL_CLUB_BADGES = [
  // Brasileirão Série A — 2026 (os estilos já existentes são preservados).
  ['flamengo', 'FL', '#f31222', '#050505', '#ffffff', 'horizontal-stripes', 'hex', ['crflamengo', 'flamengorj']],
  ['palmeiras', 'PA', '#006b3f', '#ffffff', '#ffffff', 'rings', 'circle', ['sep', 'sociedadeesportivapalmeiras']],
  ['saopaulo', 'SP', '#ffffff', '#e01822', '#050505', 'cross', 'shield', ['saopaulofc', 'spfc']],
  ['santos', 'SA', '#ffffff', '#050505', '#050505', 'vertical-stripes-clean', 'diamond', ['santosfc']],
  ['vasco', 'VA', '#050505', '#ffffff', '#e01822', 'diagonal', 'shield', ['vascodagama', 'crvascodagama']],
  ['botafogo', 'BF', '#050505', '#ffffff', '#ffffff', 'radial-burst', 'circle', ['botafogorj', 'botafogofr']],
  ['fluminense', 'FLU', '#00613a', '#8b1232', '#ffffff', 'vertical-stripes', 'hex', ['fluminensefc']],
  ['gremio', 'GRE', '#00a3e0', '#050505', '#ffffff', 'vertical-stripes', 'circle', ['gremiofbpa']],
  ['internacional', 'INT', '#e30613', '#ffffff', '#ffffff', 'target', 'circle', ['scinternacional', 'internacionalrs']],
  ['cruzeiro', 'CRU', '#003da5', '#ffffff', '#ffffff', 'conic', 'diamond', ['cruzeiroec']],
  ['bahia', 'BAH', '#0057b8', '#e30613', '#ffffff', 'horizontal-band', 'hex', ['ecbahia']],
  ['coritiba', 'CFC', '#006b3f', '#ffffff', '#ffffff', 'horizontal-band', 'circle', ['coritibafc', 'coritibasaf']],
  ['vitoria', 'VIT', '#e30613', '#050505', '#ffffff', 'half-horizontal', 'shield', ['ecvitoria', 'vitoriaba']],
  ['atleticomineiro', 'CAM', '#050505', '#ffffff', '#ffffff', 'vertical-stripes-clean', 'hex', ['atleticomg', 'atleticomineiro', 'cam']],
  ['corinthians', 'COR', '#ffffff', '#050505', '#e30613', 'cross', 'circle', ['sccorinthians', 'corinthianspaulista']],
  ['mirassol', 'MIR', '#ffd400', '#006b3f', '#006b3f', 'chevron', 'diamond', ['mirassolfc']],
  ['remo', 'REM', '#001f4e', '#ffffff', '#ffffff', 'horizontal-band', 'shield', ['clubedoremo', 'remopa']],
  ['chapecoense', 'CHA', '#007a3d', '#ffffff', '#ffffff', 'waves', 'hex', ['associacaochapecoense', 'chapecoenseaf']],
  ['redbullbragantino', 'RBB', '#ffffff', '#e30613', '#001f4e', 'diagonal-stripes', 'circle', ['rbbragantino', 'bragantino']],
  ['athleticoparanaense', 'CAP', '#e30613', '#050505', '#ffffff', 'diagonal-stripes', 'shield', ['athleticopr', 'atleticopr', 'atleticoparanaense', 'cap']],

  // Brasileirão Série B — 2026.
  ['americamineiro', 'AMG', '#0b6b3a', '#111827', '#ffffff', 'diagonal', 'hex', ['americamg', 'americafutebolclubemg', 'americamineiro']],
  ['athleticclubmg', 'ATH', '#111827', '#f4f4f5', '#ffffff', 'quarters', 'diamond', ['athletic', 'athleticmg', 'athleticminasgerais']],
  ['atleticogoianiense', 'ACG', '#d71920', '#111111', '#ffffff', 'horizontal-stripes', 'shield', ['atleticogo', 'atleticogoianiense', 'atleticogoiás']],
  ['avai', 'AVA', '#1f66b1', '#ffffff', '#ffffff', 'vertical-stripes', 'circle', ['avaifc', 'avaisc']],
  ['botafogosp', 'BSP', '#d71920', '#111827', '#ffffff', 'horizontal-band', 'hex', ['botafogoribeiraopreto', 'botafogofcsp']],
  ['ceara', 'CEA', '#111111', '#f8fafc', '#ffffff', 'diagonal-stripes', 'diamond', ['cearasc', 'cearace']],
  ['crb', 'CRB', '#d71920', '#ffffff', '#ffffff', 'cross', 'circle', ['clubederegatasbrasil', 'crbal']],
  ['criciuma', 'CRI', '#f5c400', '#111111', '#111111', 'chevron', 'hex', ['criciumaec', 'criciumasc']],
  ['cuiaba', 'CUI', '#f3c600', '#0a6b3c', '#0a6b3c', 'conic', 'diamond', ['cuiabaec', 'cuiabamt']],
  ['fortaleza', 'FOR', '#1646a0', '#d71920', '#ffffff', 'vertical-stripes', 'shield', ['fortalezaec', 'fortalezasaf']],
  ['goias', 'GOI', '#0a7a3f', '#ffffff', '#ffffff', 'rings', 'hex', ['goiasec', 'goiasgo']],
  ['juventude', 'JUV', '#128047', '#ffffff', '#ffffff', 'quarters', 'circle', ['ecjuventude', 'juventuders']],
  ['londrina', 'LON', '#1771b8', '#ffffff', '#ffffff', 'diagonal', 'diamond', ['londrinaec', 'londrinapr']],
  ['nautico', 'NAU', '#d71920', '#ffffff', '#ffffff', 'waves', 'shield', ['nauticocapibaribe', 'nauticope']],
  ['novorizontino', 'NOV', '#f5b800', '#111111', '#111111', 'horizontal-stripes', 'hex', ['gremionovorizontino']],
  ['operariopr', 'OPE', '#111111', '#ffffff', '#ffffff', 'target', 'circle', ['operario', 'operarioferroviario', 'operarioferroviarioec']],
  ['pontepreta', 'PON', '#111111', '#ffffff', '#ffffff', 'vertical-stripes-clean', 'shield', ['associacaoatléticapontpreta', 'aacpontepreta']],
  ['saobernardo', 'SBE', '#f5c400', '#111827', '#111827', 'half-horizontal', 'diamond', ['saobernardofc', 'saobernardosp']],
  ['sportrecife', 'SCR', '#d71920', '#111111', '#ffffff', 'radial-burst', 'hex', ['sport', 'sportclubdorecife', 'sportpe']],
  ['vilanova', 'VNO', '#d71920', '#ffffff', '#ffffff', 'cross', 'circle', ['vilanovafc', 'vilanovago']],

  // Premier League — 2026/27.
  ['arsenal', 'ARS', '#d71920', '#f8fafc', '#ffffff', 'diagonal', 'shield', ['arsenalfc']],
  ['astonvilla', 'AVL', '#7a1740', '#73b9e6', '#ffffff', 'quarters', 'hex', ['astonvillafc']],
  ['bournemouth', 'BOU', '#d71920', '#111111', '#ffffff', 'diagonal-stripes', 'diamond', ['afcbournemouth']],
  ['brentford', 'BRE', '#d71920', '#ffffff', '#ffffff', 'vertical-stripes', 'circle', ['brentfordfc']],
  ['brighton', 'BHA', '#1769aa', '#ffffff', '#ffffff', 'waves', 'hex', ['brightonhovealbion', 'brightonandhovealbion']],
  ['chelsea', 'CHE', '#1346a0', '#f8fafc', '#ffffff', 'rings', 'shield', ['chelseafc']],
  ['coventrycity', 'COV', '#68b9df', '#15213a', '#ffffff', 'chevron', 'diamond', ['coventry', 'coventrycityfc']],
  ['crystalpalace', 'CRY', '#1e40af', '#d71920', '#ffffff', 'vertical-stripes', 'hex', ['palace', 'crystalpalacefc']],
  ['everton', 'EVE', '#1746a2', '#ffffff', '#ffffff', 'target', 'circle', ['evertonfc']],
  ['fulham', 'FUL', '#ffffff', '#111111', '#d71920', 'cross', 'shield', ['fulhamfc']],
  ['hullcity', 'HUL', '#f59e0b', '#111111', '#111111', 'diagonal-stripes', 'hex', ['hull', 'hullcityafc']],
  ['ipswichtown', 'IPS', '#1d4ed8', '#ffffff', '#ffffff', 'horizontal-band', 'diamond', ['ipswich', 'ipswichtownfc']],
  ['leedsunited', 'LEE', '#ffffff', '#1e3a8a', '#f4c430', 'chevron', 'shield', ['leeds', 'leedsunitedfc']],
  ['liverpool', 'LIV', '#c8102e', '#ffffff', '#ffffff', 'radial-burst', 'circle', ['liverpoolfc']],
  ['manchestercity', 'MCI', '#6cabdd', '#ffffff', '#193b6a', 'conic', 'hex', ['mancity', 'manchestercityfc']],
  ['manchesterunited', 'MUN', '#da291c', '#f4c430', '#ffffff', 'half-horizontal', 'shield', ['manunited', 'manutd', 'manchesterunitedfc']],
  ['newcastleunited', 'NEW', '#111111', '#ffffff', '#ffffff', 'vertical-stripes-clean', 'diamond', ['newcastle', 'nufc']],
  ['nottinghamforest', 'NFO', '#d71920', '#ffffff', '#ffffff', 'waves', 'circle', ['nottingham', 'forest', 'nottinghamforestfc']],
  ['sunderland', 'SUN', '#d71920', '#ffffff', '#ffffff', 'horizontal-stripes', 'hex', ['sunderlandafc']],
  ['tottenhamhotspur', 'TOT', '#ffffff', '#132257', '#132257', 'rings', 'shield', ['tottenham', 'spurs', 'tottenhamhotspurfc']],

  // La Liga — 2026/27.
  ['athleticclub', 'ATH', '#d71920', '#ffffff', '#ffffff', 'vertical-stripes', 'shield', ['athleticbilbao', 'athleticclubbilbao']],
  ['atleticomadrid', 'ATM', '#d71920', '#ffffff', '#ffffff', 'diagonal-stripes', 'hex', ['atleticodemadrid', 'clubatleticodemadrid']],
  ['osasuna', 'OSA', '#b5122b', '#14213d', '#ffffff', 'half-horizontal', 'diamond', ['caosasuna']],
  ['celtavigo', 'CEL', '#83c5e8', '#ffffff', '#9b1c31', 'cross', 'circle', ['celta', 'rcceltadevigo']],
  ['deportivoalaves', 'ALA', '#1769aa', '#ffffff', '#ffffff', 'vertical-stripes-clean', 'shield', ['alaves', 'deportivoalaves']],
  ['elche', 'ELC', '#ffffff', '#138a4b', '#138a4b', 'horizontal-band', 'hex', ['elchecf']],
  ['barcelona', 'BAR', '#1e3a8a', '#a50044', '#f4c430', 'quarters', 'diamond', ['fcbarcelona', 'barca']],
  ['getafe', 'GET', '#1646a0', '#ffffff', '#ffffff', 'target', 'circle', ['getafecf']],
  ['levante', 'LEV', '#1e3a8a', '#b5122b', '#ffffff', 'vertical-stripes', 'shield', ['levanteud']],
  ['malaga', 'MAL', '#69b6df', '#ffffff', '#ffffff', 'waves', 'hex', ['malagacf']],
  ['racingsantander', 'RAC', '#138a4b', '#ffffff', '#ffffff', 'chevron', 'diamond', ['racingclub', 'realracingsantander', 'rracingclub']],
  ['rayovallecano', 'RAY', '#ffffff', '#d71920', '#d71920', 'diagonal', 'circle', ['rayo', 'rayovallecanodemadrid']],
  ['deportivolacoruna', 'DEP', '#1769aa', '#ffffff', '#ffffff', 'diagonal-stripes', 'shield', ['deportivo', 'rcdeportivo', 'rcdeportivolacoruna']],
  ['espanyol', 'ESP', '#1769aa', '#ffffff', '#ffffff', 'vertical-stripes-clean', 'hex', ['rcdespanyol', 'espanyolbarcelona']],
  ['realbetis', 'BET', '#159447', '#ffffff', '#ffffff', 'vertical-stripes', 'diamond', ['betis', 'realbetisbalompie']],
  ['realmadrid', 'RMA', '#ffffff', '#d4af37', '#172554', 'rings', 'circle', ['realmadridcf']],
  ['realsociedad', 'RSO', '#1769aa', '#ffffff', '#ffffff', 'waves', 'shield', ['realsociedaddefootball']],
  ['sevilla', 'SEV', '#ffffff', '#d71920', '#d71920', 'cross', 'hex', ['sevillafc']],
  ['valencia', 'VAL', '#ffffff', '#111111', '#f59e0b', 'half-horizontal', 'diamond', ['valenciacf']],
  ['villarreal', 'VIL', '#f6d743', '#1e3a8a', '#1e3a8a', 'conic', 'circle', ['villarrealcf']],

  // Bundesliga — 2026/27.
  ['bayernmunich', 'FCB', '#d71920', '#1d4ed8', '#ffffff', 'conic', 'circle', ['bayernmunchen', 'fcbayern', 'fcbayernmunchen', 'fcbayernmunich']],
  ['borussiadortmund', 'BVB', '#facc15', '#111111', '#111111', 'rings', 'hex', ['dortmund', 'bvb09']],
  ['rbleipzig', 'RBL', '#ffffff', '#d71920', '#1e3a8a', 'diagonal', 'shield', ['rasenballsportleipzig', 'leipzig']],
  ['vfstuttgart', 'VFB', '#ffffff', '#d71920', '#d71920', 'horizontal-band', 'diamond', ['stuttgart']],
  ['hoffenheim', 'TSG', '#1769aa', '#ffffff', '#ffffff', 'diagonal-stripes', 'circle', ['tsghoffenheim', '1899hoffenheim']],
  ['bayerleverkusen', 'B04', '#d71920', '#111111', '#ffffff', 'quarters', 'hex', ['leverkusen', 'bayer04leverkusen']],
  ['freiburg', 'SCF', '#d71920', '#111111', '#ffffff', 'chevron', 'shield', ['scfreiburg']],
  ['eintrachtfrankfurt', 'SGE', '#111111', '#d71920', '#ffffff', 'radial-burst', 'diamond', ['frankfurt', 'eintracht']],
  ['augsburg', 'FCA', '#b5122b', '#0a7a3f', '#ffffff', 'vertical-stripes', 'circle', ['fcaugsburg']],
  ['mainz', 'M05', '#d71920', '#ffffff', '#ffffff', 'target', 'hex', ['mainz05', 'fsvmainz05']],
  ['unionberlin', 'FCU', '#d71920', '#facc15', '#ffffff', 'half-horizontal', 'shield', ['union', 'fcunionberlin', '1fcunionberlin']],
  ['borussiamonchengladbach', 'BMG', '#111111', '#ffffff', '#ffffff', 'diagonal-stripes', 'diamond', ['monchengladbach', 'mgladbach', 'borussiamgladbach']],
  ['hamburg', 'HSV', '#1769aa', '#ffffff', '#111111', 'rings', 'circle', ['hamburgersv', 'hsv']],
  ['cologne', 'KOE', '#ffffff', '#d71920', '#d71920', 'cross', 'hex', ['koln', 'fckoln', '1fckoln', 'colognefc']],
  ['werderbremen', 'SVW', '#0a7a3f', '#ffffff', '#ffffff', 'chevron', 'shield', ['bremen', 'werder']],
  ['schalke', 'S04', '#1769aa', '#ffffff', '#ffffff', 'waves', 'diamond', ['schalke04', 'fcschalke04']],
  ['elversberg', 'ELV', '#111111', '#ffffff', '#facc15', 'vertical-stripes-clean', 'circle', ['svelversberg']],
  ['paderborn', 'SCP', '#1769aa', '#111111', '#ffffff', 'horizontal-stripes', 'hex', ['scpaderborn', 'scpaderborn07']],

  // Ligue 1 — 2026/27.
  ['angers', 'ANG', '#111111', '#ffffff', '#ffffff', 'vertical-stripes-clean', 'shield', ['angerssco']],
  ['auxerre', 'AJA', '#ffffff', '#1769aa', '#1769aa', 'cross', 'diamond', ['ajauxerre']],
  ['brest', 'BRE', '#d71920', '#ffffff', '#ffffff', 'horizontal-band', 'circle', ['stadebrestois', 'stadebrestois29']],
  ['lehavre', 'HAC', '#6ab4df', '#14213d', '#ffffff', 'quarters', 'hex', ['lehavreac', 'havreac']],
  ['lens', 'RCL', '#facc15', '#d71920', '#111111', 'vertical-stripes', 'shield', ['rclens']],
  ['lille', 'LOSC', '#d71920', '#14213d', '#ffffff', 'diagonal', 'diamond', ['losc', 'losclille']],
  ['lorient', 'FCL', '#f97316', '#111111', '#ffffff', 'chevron', 'circle', ['fclorient']],
  ['lyon', 'OL', '#ffffff', '#1646a0', '#d71920', 'diagonal-stripes', 'hex', ['olympiquelyonnais', 'olympiquelyon']],
  ['lemans', 'LM', '#d71920', '#facc15', '#ffffff', 'half-horizontal', 'shield', ['lemansfc']],
  ['marseille', 'OM', '#60b7df', '#ffffff', '#ffffff', 'waves', 'diamond', ['olympiquemarseille', 'olympiquedemarseille']],
  ['monaco', 'ASM', '#ffffff', '#d71920', '#d71920', 'diagonal', 'circle', ['asmonaco']],
  ['nice', 'OGC', '#111111', '#d71920', '#ffffff', 'horizontal-stripes', 'hex', ['ogcnice']],
  ['parisfc', 'PFC', '#1f3a73', '#6ab4df', '#ffffff', 'rings', 'shield', ['parisfootballclub']],
  ['parissaintgermain', 'PSG', '#14213d', '#d71920', '#ffffff', 'target', 'diamond', ['psg', 'parissaintgermainfc']],
  ['rennes', 'REN', '#d71920', '#111111', '#ffffff', 'quarters', 'circle', ['staderennais', 'staderennaisfc']],
  ['strasbourg', 'RCS', '#1769aa', '#ffffff', '#ffffff', 'conic', 'hex', ['rcstrasbourg', 'rcstrasbourgalsace']],
  ['toulouse', 'TFC', '#6d28d9', '#ffffff', '#ffffff', 'chevron', 'shield', ['toulousefc']],
  ['troyes', 'EST', '#1769aa', '#ffffff', '#ffffff', 'radial-burst', 'diamond', ['estac', 'estactroyes']],

  // Serie A italiana — identidade inspirada nas cores tradicionais dos clubes.
  ['inter', 'INT', '#00529f', '#111111', '#ffffff', 'vertical-stripes', 'circle', ['internazionale', 'intermilan', 'fcinternazionale', 'fcinternazionalemilano']],
  ['acmilan', 'MIL', '#d71920', '#111111', '#ffffff', 'vertical-stripes', 'shield', ['milan', 'milanac', 'associazionecalciomilan']],
  ['juventus', 'JUV', '#ffffff', '#111111', '#111111', 'vertical-stripes-clean', 'diamond', ['juventusfc']],
  ['atalanta', 'ATA', '#1769aa', '#111111', '#ffffff', 'vertical-stripes', 'hex', ['atalantabc']],
  ['bologna', 'BOL', '#b5122b', '#14213d', '#ffffff', 'quarters', 'circle', ['bolognafc', 'bolognafc1909']],
  ['asroma', 'ROM', '#8e1f2d', '#f4a900', '#f4a900', 'half-horizontal', 'shield', ['roma', 'romafc', 'associazionesportivaroma']],
  ['lazio', 'LAZ', '#78b7e3', '#ffffff', '#1e3a8a', 'waves', 'diamond', ['sslazio']],
  ['fiorentina', 'FIO', '#5b2c83', '#ffffff', '#ffffff', 'chevron', 'hex', ['acfiorentina']],
  ['torino', 'TOR', '#7a1730', '#ffffff', '#ffffff', 'target', 'circle', ['torinofc']],
  ['napoli', 'NAP', '#159bd7', '#ffffff', '#ffffff', 'rings', 'shield', ['sscnapoli', 'napolifc']],
  ['genoa', 'GEN', '#b5122b', '#14213d', '#ffffff', 'quarters', 'diamond', ['genoacfc']],
  ['monza', 'MON', '#d71920', '#ffffff', '#ffffff', 'vertical-stripes', 'hex', ['acmonza']],
  ['verona', 'VER', '#163f8c', '#f4c430', '#ffffff', 'horizontal-band', 'circle', ['hellasverona', 'hellasveronafc']],
  ['lecce', 'LEC', '#d71920', '#facc15', '#111111', 'vertical-stripes', 'shield', ['uslecce']],
  ['udinese', 'UDI', '#111111', '#ffffff', '#ffffff', 'vertical-stripes-clean', 'diamond', ['udinesecalcio']],
  ['cagliari', 'CAG', '#b5122b', '#163f8c', '#ffffff', 'quarters', 'hex', ['cagliaricalcio']],
  ['empoli', 'EMP', '#1769aa', '#ffffff', '#ffffff', 'conic', 'circle', ['empolifc']],
  ['frosinone', 'FRO', '#f4c430', '#1769aa', '#1769aa', 'chevron', 'shield', ['frosinonecalcio']],
  ['sassuolo', 'SAS', '#168454', '#111111', '#ffffff', 'vertical-stripes', 'diamond', ['ussassuolocalcio']],
  ['salernitana', 'SAL', '#7a1730', '#ffffff', '#ffffff', 'radial-burst', 'hex', ['ussalernitana', 'salernitana1919']],

  // Eredivisie — 2026/27.
  ['adodenhaag', 'ADO', '#f6d743', '#168454', '#111111', 'half-horizontal', 'circle', ['ado', 'denhaag']],
  ['ajax', 'AJA', '#ffffff', '#d71920', '#d71920', 'vertical-stripes', 'hex', ['afcajax']],
  ['azalkmaar', 'AZ', '#d71920', '#ffffff', '#ffffff', 'diagonal', 'shield', ['az', 'alkmaar']],
  ['almerecity', 'ALM', '#d71920', '#111111', '#ffffff', 'diagonal-stripes', 'circle', ['almere', 'almerecityfc']],
  ['excelsiorrotterdam', 'EXC', '#111111', '#d71920', '#ffffff', 'horizontal-stripes', 'diamond', ['excelsior', 'sbvexcelsior']],
  ['fcgroningen', 'GRO', '#168454', '#ffffff', '#ffffff', 'vertical-stripes-clean', 'circle', ['groningen']],
  ['fctwente', 'TWE', '#d71920', '#ffffff', '#ffffff', 'target', 'hex', ['twente']],
  ['fcutrecht', 'UTR', '#d71920', '#ffffff', '#111111', 'diagonal-stripes', 'shield', ['utrecht']],
  ['feyenoord', 'FEY', '#d71920', '#ffffff', '#111111', 'quarters', 'diamond', ['feyenoordrotterdam']],
  ['fortunasittard', 'FOR', '#facc15', '#168454', '#111111', 'chevron', 'circle', ['fortuna']],
  ['goaheadeagles', 'GAE', '#d71920', '#facc15', '#ffffff', 'vertical-stripes', 'hex', ['goahead']],
  ['heracles', 'HER', '#111111', '#ffffff', '#ffffff', 'vertical-stripes-clean', 'hex', ['heraclesalmelo']],
  ['necnijmegen', 'NEC', '#d71920', '#168454', '#ffffff', 'half-horizontal', 'shield', ['nec', 'nijmegen']],
  ['peczwolle', 'PEC', '#1769aa', '#ffffff', '#ffffff', 'waves', 'diamond', ['zwolle']],
  ['psv', 'PSV', '#d71920', '#ffffff', '#ffffff', 'horizontal-stripes', 'circle', ['psveindhoven']],
  ['rkcwaalwijk', 'RKC', '#facc15', '#1769aa', '#111111', 'horizontal-band', 'shield', ['rkc', 'waalwijk']],
  ['sccambuur', 'CAM', '#facc15', '#1769aa', '#111111', 'cross', 'hex', ['cambuur']],
  ['scheerenveen', 'HEE', '#1769aa', '#ffffff', '#ffffff', 'radial-burst', 'shield', ['heerenveen']],
  ['spartarotterdam', 'SPA', '#d71920', '#ffffff', '#111111', 'rings', 'diamond', ['sparta']],
  ['telstar', 'TEL', '#ffffff', '#1769aa', '#1769aa', 'conic', 'circle', ['scTelstar']],
  ['vitesse', 'VIT', '#facc15', '#111111', '#ffffff', 'vertical-stripes', 'diamond', ['vitessearnhem']],
  ['volendam', 'VOL', '#f97316', '#111111', '#ffffff', 'half-horizontal', 'circle', ['fcvolendam']],
  ['willemii', 'WII', '#d71920', '#1769aa', '#ffffff', 'vertical-stripes', 'hex', ['willem2', 'willemiiTilburg']],

  // NBA — 30 franquias.
  ['atlantahawks', 'ATL', '#c8102e', '#fdb927', '#ffffff', 'radial-burst', 'circle', ['hawks']],
  ['bostonceltics', 'BOS', '#007a33', '#ffffff', '#ffffff', 'rings', 'hex', ['celtics']],
  ['brooklynnets', 'BKN', '#111111', '#ffffff', '#ffffff', 'cross', 'shield', ['nets']],
  ['charlottehornets', 'CHA', '#1d1160', '#00788c', '#ffffff', 'diagonal-stripes', 'diamond', ['hornets']],
  ['chicagobulls', 'CHI', '#ce1141', '#111111', '#ffffff', 'half-horizontal', 'circle', ['bulls']],
  ['clevelandcavaliers', 'CLE', '#6f263d', '#ffb81c', '#ffffff', 'chevron', 'hex', ['cavaliers', 'cavs']],
  ['dallasmavericks', 'DAL', '#00538c', '#b8c4ca', '#ffffff', 'waves', 'shield', ['mavericks', 'mavs']],
  ['denvernuggets', 'DEN', '#0e2240', '#fec524', '#ffffff', 'conic', 'diamond', ['nuggets']],
  ['detroitpistons', 'DET', '#c8102e', '#1d42ba', '#ffffff', 'target', 'circle', ['pistons']],
  ['goldenstatewarriors', 'GSW', '#1d428a', '#ffc72c', '#ffffff', 'rings', 'hex', ['warriors', 'goldenstate']],
  ['houstonrockets', 'HOU', '#ce1141', '#111111', '#ffffff', 'radial-burst', 'shield', ['rockets']],
  ['indianapacers', 'IND', '#002d62', '#fdbb30', '#ffffff', 'horizontal-band', 'diamond', ['pacers']],
  ['laclippers', 'LAC', '#c8102e', '#1d428a', '#ffffff', 'quarters', 'circle', ['losangelesclippers', 'clippers']],
  ['losangeleslakers', 'LAL', '#552583', '#fdb927', '#ffffff', 'diagonal', 'hex', ['lalakers', 'lakers']],
  ['memphisgrizzlies', 'MEM', '#5d76a9', '#12173f', '#ffffff', 'chevron', 'shield', ['grizzlies']],
  ['miamiheat', 'MIA', '#98002e', '#f9a01b', '#ffffff', 'half-horizontal', 'diamond', ['heat']],
  ['milwaukeebucks', 'MIL', '#00471b', '#eee1c6', '#ffffff', 'rings', 'circle', ['bucks']],
  ['minnesotatimberwolves', 'MIN', '#0c2340', '#78be20', '#ffffff', 'radial-burst', 'hex', ['timberwolves', 'wolves']],
  ['neworleanspelicans', 'NOP', '#0c2340', '#c8102e', '#ffffff', 'vertical-stripes', 'shield', ['pelicans']],
  ['newyorkknicks', 'NYK', '#006bb6', '#f58426', '#ffffff', 'conic', 'diamond', ['knicks']],
  ['oklahomacitythunder', 'OKC', '#007ac1', '#ef3b24', '#ffffff', 'diagonal-stripes', 'circle', ['thunder', 'oklahomacity']],
  ['orlandomagic', 'ORL', '#0077c0', '#c4ced4', '#ffffff', 'waves', 'hex', ['magic']],
  ['philadelphia76ers', 'PHI', '#006bb6', '#ed174c', '#ffffff', 'target', 'shield', ['sixers', '76ers', 'philadelphiaers']],
  ['phoenixsuns', 'PHX', '#1d1160', '#e56020', '#ffffff', 'radial-burst', 'diamond', ['suns']],
  ['portlandtrailblazers', 'POR', '#e03a3e', '#111111', '#ffffff', 'diagonal', 'circle', ['trailblazers', 'blazers']],
  ['sacramentokings', 'SAC', '#5a2d81', '#63727a', '#ffffff', 'rings', 'hex', ['kings']],
  ['sanantoniospurs', 'SAS', '#111111', '#c4ced4', '#ffffff', 'cross', 'shield', ['spurs']],
  ['torontoraptors', 'TOR', '#ce1141', '#111111', '#ffffff', 'chevron', 'diamond', ['raptors']],
  ['utahjazz', 'UTA', '#002b5c', '#f9a01b', '#ffffff', 'horizontal-band', 'circle', ['jazz']],
  ['washingtonwizards', 'WAS', '#002b5c', '#e31837', '#ffffff', 'quarters', 'hex', ['wizards']],

  // NFL — 32 franquias.
  ['arizonacardinals', 'ARI', '#97233f', '#111111', '#ffffff', 'diagonal', 'shield', ['cardinals']],
  ['atlantafalcons', 'ATL', '#a71930', '#111111', '#ffffff', 'chevron', 'diamond', ['falcons']],
  ['baltimoreravens', 'BAL', '#241773', '#9e7c0c', '#ffffff', 'radial-burst', 'circle', ['ravens']],
  ['buffalobills', 'BUF', '#00338d', '#c60c30', '#ffffff', 'horizontal-band', 'hex', ['bills']],
  ['carolinapanthers', 'CAR', '#0085ca', '#101820', '#ffffff', 'diagonal-stripes', 'shield', ['panthers']],
  ['chicagobears', 'CHI', '#0b162a', '#c83803', '#ffffff', 'half-horizontal', 'diamond', ['bears']],
  ['cincinnatibengals', 'CIN', '#fb4f14', '#111111', '#ffffff', 'diagonal-stripes', 'circle', ['bengals']],
  ['clevelandbrowns', 'CLE', '#311d00', '#ff3c00', '#ffffff', 'quarters', 'hex', ['browns']],
  ['dallascowboys', 'DAL', '#041e42', '#869397', '#ffffff', 'rings', 'shield', ['cowboys']],
  ['denverbroncos', 'DEN', '#fb4f14', '#002244', '#ffffff', 'chevron', 'diamond', ['broncos']],
  ['detroitlions', 'DET', '#0076b6', '#b0b7bc', '#ffffff', 'waves', 'circle', ['lions']],
  ['greenbaypackers', 'GB', '#203731', '#ffb612', '#ffffff', 'target', 'hex', ['packers']],
  ['houstontexans', 'HOU', '#03202f', '#a71930', '#ffffff', 'cross', 'shield', ['texans']],
  ['indianapoliscolts', 'IND', '#002c5f', '#ffffff', '#ffffff', 'rings', 'diamond', ['colts']],
  ['jacksonvillejaguars', 'JAX', '#006778', '#d7a22a', '#ffffff', 'conic', 'circle', ['jaguars', 'jags']],
  ['kansascitychiefs', 'KC', '#e31837', '#ffb81c', '#ffffff', 'radial-burst', 'hex', ['chiefs']],
  ['lasvegasraiders', 'LV', '#111111', '#a5acaf', '#ffffff', 'vertical-stripes-clean', 'shield', ['raiders', 'oaklandraiders']],
  ['losangeleschargers', 'LAC', '#0080c6', '#ffc20e', '#ffffff', 'diagonal', 'diamond', ['chargers', 'lachargers']],
  ['losangelesrams', 'LAR', '#003594', '#ffa300', '#ffffff', 'waves', 'circle', ['rams', 'larams']],
  ['miamidolphins', 'MIA', '#008e97', '#fc4c02', '#ffffff', 'conic', 'hex', ['dolphins']],
  ['minnesotavikings', 'MIN', '#4f2683', '#ffc62f', '#ffffff', 'chevron', 'shield', ['vikings']],
  ['newenglandpatriots', 'NE', '#002244', '#c60c30', '#ffffff', 'horizontal-band', 'diamond', ['patriots']],
  ['neworleanssaints', 'NO', '#101820', '#d3bc8d', '#ffffff', 'rings', 'circle', ['saints']],
  ['newyorkgiants', 'NYG', '#0b2265', '#a71930', '#ffffff', 'quarters', 'hex', ['giants']],
  ['newyorkjets', 'NYJ', '#125740', '#ffffff', '#ffffff', 'target', 'shield', ['jets']],
  ['philadelphiaeagles', 'PHI', '#004c54', '#a5acaf', '#ffffff', 'diagonal-stripes', 'diamond', ['eagles']],
  ['pittsburghsteelers', 'PIT', '#101820', '#ffb612', '#ffffff', 'radial-burst', 'circle', ['steelers']],
  ['sanfrancisco49ers', 'SF', '#aa0000', '#b3995d', '#ffffff', 'half-horizontal', 'hex', ['49ers', 'sanfranciscoers', 'niners']],
  ['seattleseahawks', 'SEA', '#002244', '#69be28', '#ffffff', 'waves', 'shield', ['seahawks']],
  ['tampabaybuccaneers', 'TB', '#d50a0a', '#34302b', '#ffffff', 'diagonal', 'diamond', ['buccaneers', 'bucs']],
  ['tennesseetitans', 'TEN', '#0c2340', '#4b92db', '#ffffff', 'cross', 'circle', ['titans']],
  ['washingtoncommanders', 'WAS', '#5a1414', '#ffb612', '#ffffff', 'chevron', 'hex', ['commanders', 'washingtonfootballteam']],
];

function compactClubKey(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
    .trim();
}

const CLUB_ALIASES = {};

AUTHORIAL_CLUB_BADGES.forEach(([
  canonical,
  mark,
  primary,
  secondary,
  markColor,
  pattern,
  markShape,
  aliases = [],
]) => {
  const key = compactClubKey(canonical);

  if (!CLUB_STYLES[key]) {
    CLUB_STYLES[key] = {
      outer: primary,
      glow: secondary,
      pattern,
      colors: [primary, secondary, markColor],
      center: null,
      mark,
      markColor,
      markShape,
    };
  }

  [canonical, ...aliases].forEach((alias) => {
    CLUB_ALIASES[compactClubKey(alias)] = key;
  });
});

const LEAGUE_STYLES = {
  brasil: {
  outer: '#0b7a3b',
  glow: '#22c55e',
  pattern: 'flag-brazil-premium',
  colors: ['#0b7a3b', '#f7d117', '#1f4ed8', '#ffffff'],
},

brasileirao: {
  outer: '#0b7a3b',
  glow: '#22c55e',
  pattern: 'flag-brazil-premium',
  colors: ['#0b7a3b', '#f7d117', '#1f4ed8', '#ffffff'],
},

brasileiraoseriea: {
  outer: '#0b7a3b',
  glow: '#22c55e',
  pattern: 'flag-brazil-premium',
  colors: ['#0b7a3b', '#f7d117', '#1f4ed8', '#ffffff'],
},

brasileiraoserieb: {
  outer: '#0b7a3b',
  glow: '#22c55e',
  pattern: 'flag-brazil-premium',
  colors: ['#0b7a3b', '#f7d117', '#1f4ed8', '#ffffff'],
},

nba: {
  outer: '#16327a',
  glow: '#ff9a1f',
  pattern: 'basketball-premium',
  colors: ['#f58220', '#1b1b1b', '#ffffff'],
},

nfl: {
  outer: '#4b2a18',
  glow: '#d18a39',
  pattern: 'american-football-premium',
  colors: ['#0f172a', '#7a4320', '#ffffff'],
},

  inglaterra: {
    outer: '#0f172a',
    glow: '#ef4444',
    pattern: 'flag-england',
    colors: ['#ffffff', '#ef4444'],
  },

  premierleague: {
    outer: '#0f172a',
    glow: '#ef4444',
    pattern: 'flag-england',
    colors: ['#ffffff', '#ef4444'],
  },

  espanha: {
    outer: '#dc2626',
    glow: '#facc15',
    pattern: 'flag-spain',
    colors: ['#dc2626', '#facc15'],
  },

  laliga: {
    outer: '#dc2626',
    glow: '#facc15',
    pattern: 'flag-spain',
    colors: ['#dc2626', '#facc15'],
  },

  alemanha: {
    outer: '#111827',
    glow: '#facc15',
    pattern: 'flag-germany',
    colors: ['#050505', '#dc2626', '#facc15'],
  },

  bundesliga: {
    outer: '#111827',
    glow: '#facc15',
    pattern: 'flag-germany',
    colors: ['#050505', '#dc2626', '#facc15'],
  },

  franca: {
    outer: '#1d4ed8',
    glow: '#ef4444',
    pattern: 'flag-france',
    colors: ['#1d4ed8', '#ffffff', '#ef4444'],
  },

  ligue1: {
    outer: '#1d4ed8',
    glow: '#ef4444',
    pattern: 'flag-france',
    colors: ['#1d4ed8', '#ffffff', '#ef4444'],
  },

  italia: {
    outer: '#166534',
    glow: '#ef4444',
    pattern: 'flag-italy',
    colors: ['#15803d', '#ffffff', '#dc2626'],
  },

  seriea: {
    outer: '#166534',
    glow: '#ef4444',
    pattern: 'flag-italy',
    colors: ['#15803d', '#ffffff', '#dc2626'],
  },

  holanda: {
    outer: '#1d4ed8',
    glow: '#f97316',
    pattern: 'flag-netherlands',
    colors: ['#ef4444', '#ffffff', '#1d4ed8'],
  },

  eredivisie: {
    outer: '#1d4ed8',
    glow: '#f97316',
    pattern: 'flag-netherlands',
    colors: ['#ef4444', '#ffffff', '#1d4ed8'],
  },

};

function normalizeClubName(nome = '', liga = '') {
  const base = compactClubKey(nome);
  const leagueKey = compactClubKey(liga);

  // "Athletic Club" existe simultaneamente na Série B e na La Liga.
  // Quando o mercado é informado, a identificação permanece inequívoca.
  if (
    base === 'athleticclub' &&
    ['brasileiraob', 'brasileiraoserieb', 'brasilserieb', 'serieb'].includes(leagueKey)
  ) {
    return 'athleticclubmg';
  }

  const aliases = {
  sao: 'saopaulo',
  saopaulofc: 'saopaulo',
  spfc: 'saopaulo',

  gremio: 'gremio',
  gremiofbpa: 'gremio',
  gremiofootballportoalegrense: 'gremio',

  rbbragantino: 'rbbragantino',
  bragantino: 'bragantino',
  redbullbragantino: 'redbullbragantino',

  athletico: 'athleticoparanaense',
  athleticoparanaense: 'athleticoparanaense',
  athleticopr: 'athleticoparanaense',
  atleticoparanaense: 'athleticoparanaense',
  atleticopr: 'athleticoparanaense',
  cap: 'athleticoparanaense',

  vasco: 'vasco',
  vascodagama: 'vascodagama',

  atletico: 'atleticomineiro',
  atleticomg: 'atleticomineiro',
  atleticomineiro: 'atleticomineiro',
};

  return CLUB_ALIASES[base] || aliases[base] || base;
}

function normalizeLeagueName(nome = '') {
  const base = String(nome)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
    .trim();

  const aliases = {
    br: 'brasil',
    brazil: 'brasil',
    brasileiro: 'brasileirao',
    brasileiraoa: 'brasileiraoseriea',
    brasileiraob: 'brasileiraoserieb',

    premier: 'premierleague',
    england: 'inglaterra',
    englishpremierleague: 'premierleague',

    espanha: 'espanha',
    spain: 'espanha',
    laligasantander: 'laliga',

    germany: 'alemanha',
    alemanha: 'alemanha',

    france: 'franca',
    franca: 'franca',
    ligueone: 'ligue1',

    italy: 'italia',
    italiano: 'italia',
    italianseriea: 'seriea',

    netherlands: 'holanda',
    holland: 'holanda',
    holanda: 'holanda',

    nba: 'nba',
    nationalbasketballassociation: 'nba',

    nfl: 'nfl',
    nationalfootballleague: 'nfl',
  };

  return aliases[base] || base;
}

const Wrap = styled.div`
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  min-width: ${({ $size }) => $size}px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  background: ${({ $outer }) => $outer};
  box-shadow:
    0 0 0 1px rgba(255,255,255,0.14),
    0 0 12px ${({ $glow }) => `${$glow}66`},
    inset 0 0 10px rgba(255,255,255,0.14);
  overflow: hidden;
`;

const Inner = styled.div`
  width: 76%;
  height: 76%;
  border-radius: 999px;
  position: relative;
  overflow: hidden;
  background: ${({ $bg }) => $bg};
  box-shadow:
    inset 0 0 12px rgba(0,0,0,0.35),
    0 0 0 2px rgba(255,255,255,0.82);
`;

const Center = styled.div`
  position: absolute;
  width: 34%;
  height: 34%;
  border-radius: 999px;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  background: ${({ $color }) => $color};
  box-shadow:
    0 0 0 2px rgba(0,0,0,0.35),
    inset 0 0 8px rgba(255,255,255,0.24);
  z-index: 3;
`;

const MarkPlate = styled.div`
  position: absolute;
  left: 50%;
  top: 50%;
  width: 54%;
  height: 54%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 4;
  color: ${({ $color }) => $color};
  background: rgba(3, 8, 20, 0.7);
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,0.52),
    0 2px 8px rgba(0,0,0,0.38);
  backdrop-filter: blur(1px);
  clip-path: ${({ $shape }) => {
    switch ($shape) {
      case 'diamond':
        return 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';
      case 'hex':
        return 'polygon(25% 7%, 75% 7%, 100% 50%, 75% 93%, 25% 93%, 0% 50%)';
      case 'shield':
        return 'polygon(10% 8%, 90% 8%, 86% 67%, 50% 100%, 14% 67%)';
      default:
        return 'circle(50% at 50% 50%)';
    }
  }};
`;

const MarkText = styled.span`
  display: block;
  max-width: 88%;
  overflow: hidden;
  color: inherit;
  font-size: ${({ $size, $length }) =>
    Math.max(7, Math.floor($size * ($length > 2 ? 0.19 : 0.22)))}px;
  line-height: 1;
  font-weight: 900;
  letter-spacing: ${({ $length }) => ($length > 2 ? '-0.07em' : '-0.02em')};
  text-align: center;
  text-shadow: 0 1px 3px rgba(0,0,0,0.8);
`;

const OfficialLogo = styled.img`
  position: absolute;
  z-index: 5;
  inset: 2px;
  width: calc(100% - 4px);
  height: calc(100% - 4px);
  object-fit: contain;
  border-radius: 999px;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,.55));
`;

const Star = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: ${({ $size }) => Math.floor($size * 0.42)}px;
  font-weight: 900;
  text-shadow: 0 0 8px rgba(255,255,255,0.45);
  z-index: 2;

  &::before {
    content: '★';
  }
`;

const StarsRing = styled.div`
  position: absolute;
  inset: 0;
  z-index: 2;

  span {
    position: absolute;
    color: #fff;
    font-size: ${({ $size }) => Math.max(7, Math.floor($size * 0.16))}px;
    line-height: 1;
    text-shadow: 0 0 6px rgba(255,255,255,0.35);
  }

  span:nth-child(1) {
    left: 50%;
    top: 14%;
    transform: translateX(-50%);
  }

  span:nth-child(2) {
    left: 22%;
    top: 40%;
    transform: translate(-50%, -50%);
  }

  span:nth-child(3) {
    right: 22%;
    top: 40%;
    transform: translate(50%, -50%);
  }

  span:nth-child(4) {
    left: 34%;
    bottom: 16%;
    transform: translateX(-50%);
  }

  span:nth-child(5) {
    right: 34%;
    bottom: 16%;
    transform: translateX(50%);
  }
`;

const BrazilDiamond = styled.div`
  position: absolute;
  width: 62%;
  height: 62%;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%) rotate(45deg);
  border-radius: 8px;
  background: ${({ $color }) => $color};
  z-index: 1;
  box-shadow: inset 0 0 10px rgba(255, 255, 255, 0.18);
`;

const BrazilBlueCircle = styled.div`
  position: absolute;
  width: 38%;
  height: 38%;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  border-radius: 999px;
  background: ${({ $color }) => $color};
  z-index: 2;
  box-shadow: inset 0 0 8px rgba(255, 255, 255, 0.18);
`;

const BrazilBand = styled.div`
  position: absolute;
  width: 44%;
  height: 9%;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%) rotate(-12deg);
  border-radius: 999px;
  background: ${({ $color }) => $color};
  z-index: 3;
  box-shadow: 0 0 4px rgba(255, 255, 255, 0.22);
`;

const BasketballSeams = styled.div`
  position: absolute;
  inset: 0;
  z-index: 2;

  .line-v,
  .line-h {
    position: absolute;
    background: ${({ $color }) => $color};
    opacity: 0.88;
  }

  .line-v {
    left: 50%;
    top: 0;
    bottom: 0;
    width: 3px;
    transform: translateX(-50%);
  }

  .line-h {
    top: 50%;
    left: 0;
    right: 0;
    height: 3px;
    transform: translateY(-50%);
  }

  .arc-left,
  .arc-right {
    position: absolute;
    top: -10%;
    bottom: -10%;
    width: 40%;
    border: 3px solid ${({ $color }) => $color};
    border-top: 0;
    border-bottom: 0;
    border-radius: 999px;
    opacity: 0.88;
  }

  .arc-left {
    left: 8%;
  }

  .arc-right {
    right: 8%;
  }
`;

const FootballBall = styled.div`
  position: absolute;
  left: 18%;
  right: 18%;
  top: 28%;
  bottom: 28%;
  border-radius: 999px / 70%;
  transform: rotate(-18deg);
  background: ${({ $color }) => $color};
  border: 2px solid rgba(255, 255, 255, 0.9);
  z-index: 2;
  box-shadow:
    inset 0 0 10px rgba(0, 0, 0, 0.28),
    0 0 8px rgba(0, 0, 0, 0.18);

  &::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 18%;
    bottom: 18%;
    width: 2px;
    transform: translateX(-50%);
    background: ${({ $laceColor }) => $laceColor};
  }

  &::after {
    content: '';
    position: absolute;
    left: 32%;
    right: 32%;
    top: 50%;
    height: 2px;
    transform: translateY(-50%);
    background: ${({ $laceColor }) => $laceColor};
    box-shadow:
      0 -6px 0 ${({ $laceColor }) => $laceColor},
      0 6px 0 ${({ $laceColor }) => $laceColor};
  }
`;

const BallLine = styled.div`
  position: absolute;
  inset: 0;
  border-radius: 999px;

  &::before,
  &::after {
    content: '';
    position: absolute;
    top: -12%;
    bottom: -12%;
    width: 34%;
    border: 3px solid rgba(17, 24, 39, 0.9);
    border-top: 0;
    border-bottom: 0;
    border-radius: 999px;
  }

  &::before {
    left: 13%;
  }

  &::after {
    right: 13%;
  }
`;

const FootballShape = styled.div`
  position: absolute;
  left: 17%;
  right: 17%;
  top: 25%;
  bottom: 25%;
  border-radius: 999px / 70%;
  border: 2px solid rgba(255, 255, 255, 0.9);
  transform: rotate(-22deg);
  box-shadow: inset 0 0 10px rgba(0,0,0,0.28);

  &::before {
    content: '';
    position: absolute;
    left: 48%;
    top: 17%;
    bottom: 17%;
    width: 2px;
    background: rgba(255,255,255,0.95);
  }

  &::after {
    content: '';
    position: absolute;
    left: 34%;
    right: 34%;
    top: 50%;
    height: 2px;
    background: rgba(255,255,255,0.95);
    box-shadow:
      0 -6px 0 rgba(255,255,255,0.95),
      0 6px 0 rgba(255,255,255,0.95);
  }
`;
function getBackground(style) {
  const [a, b, c, d] = style.colors;

  switch (style.pattern) {
    case 'horizontal-stripes':
      return `repeating-linear-gradient(
        0deg,
        ${a} 0%,
        ${a} 16%,
        ${b} 16%,
        ${b} 32%
      )`;

    case 'vertical-stripes':
      return `repeating-linear-gradient(
        90deg,
        ${a} 0%,
        ${a} 16%,
        ${b} 16%,
        ${b} 32%,
        ${c || a} 32%,
        ${c || a} 48%
      )`;

    case 'vertical-stripes-clean':
      return `repeating-linear-gradient(
        90deg,
        ${a} 0%,
        ${a} 15%,
        ${b} 15%,
        ${b} 30%
      )`;

    case 'flu-stripes':
      return `repeating-linear-gradient(
        90deg,
        ${a} 0%,
        ${a} 18%,
        ${c} 18%,
        ${c} 26%,
        ${b} 26%,
        ${b} 44%,
        ${c} 44%,
        ${c} 52%
      )`;

    case 'gremio-stripes':
      return `repeating-linear-gradient(
        90deg,
        ${a} 0%,
        ${a} 16%,
        ${c} 16%,
        ${c} 24%,
        ${b} 24%,
        ${b} 40%,
        ${c} 40%,
        ${c} 48%
      )`;

    case 'diagonal':
      return `linear-gradient(
        135deg,
        ${a} 0%,
        ${a} 36%,
        ${b} 36%,
        ${b} 64%,
        ${a} 64%,
        ${a} 100%
      )`;

    case 'furacao-diagonal':
      return `repeating-linear-gradient(
        135deg,
        ${a} 0%,
        ${a} 24%,
        ${c} 24%,
        ${c} 29%,
        ${b} 29%,
        ${b} 53%,
        ${c} 53%,
        ${c} 58%
      )`;

    case 'half-horizontal':
      return `linear-gradient(
        180deg,
        ${a} 0%,
        ${a} 50%,
        ${b} 50%,
        ${b} 100%
      )`;

    case 'horizontal-band':
      return `linear-gradient(
        180deg,
        ${a} 0%,
        ${a} 38%,
        ${b} 38%,
        ${b} 62%,
        ${a} 62%,
        ${a} 100%
      )`;

    case 'bahia':
      return `linear-gradient(
        180deg,
        ${a} 0%,
        ${a} 36%,
        ${b} 36%,
        ${b} 50%,
        ${c} 50%,
        ${c} 66%,
        ${b} 66%,
        ${b} 78%,
        ${a} 78%,
        ${a} 100%
      )`;

    case 'coritiba':
      return `linear-gradient(
        180deg,
        ${b} 0%,
        ${b} 38%,
        ${a} 38%,
        ${a} 62%,
        ${b} 62%,
        ${b} 100%
      )`;

    case 'corinthians':
      return `
        linear-gradient(
          180deg,
          transparent 0%,
          transparent 42%,
          ${c} 42%,
          ${c} 58%,
          transparent 58%,
          transparent 100%
        ),
        repeating-linear-gradient(
          90deg,
          ${a} 0%,
          ${a} 15%,
          ${b} 15%,
          ${b} 30%
        )
      `;

    case 'bragantino':
      return `linear-gradient(
        180deg,
        ${b} 0%,
        ${b} 38%,
        ${c} 38%,
        ${c} 62%,
        ${b} 62%,
        ${b} 100%
      )`;

    case 'spfc-bars':
      return `linear-gradient(
        180deg,
        ${a} 0%,
        ${a} 32%,
        ${c} 32%,
        ${c} 38%,
        ${b} 38%,
        ${b} 58%,
        ${a} 58%,
        ${a} 64%,
        ${c} 64%,
        ${c} 84%,
        ${a} 84%,
        ${a} 100%
      )`;

    case 'mirassol':
      return `linear-gradient(
        180deg,
        ${a} 0%,
        ${a} 38%,
        ${b} 38%,
        ${b} 62%,
        ${a} 62%,
        ${a} 100%
      )`;

    case 'rings':
      return `radial-gradient(
        circle at center,
        ${b} 0%,
        ${b} 34%,
        ${a} 35%,
        ${a} 48%,
        ${b} 49%,
        ${b} 55%,
        ${a} 56%,
        ${a} 100%
      )`;

    case 'target':
      return `radial-gradient(
        circle at center,
        ${b} 0%,
        ${b} 32%,
        ${a} 33%,
        ${a} 100%
      )`;

    case 'star':
    case 'stars':

        case 'flag-brazil':
      return `
        radial-gradient(circle at center, ${c} 0%, ${c} 24%, ${d} 25%, ${d} 31%, transparent 32%),
        linear-gradient(135deg, transparent 22%, ${b} 22%, ${b} 50%, transparent 50%),
        linear-gradient(45deg, transparent 22%, ${b} 22%, ${b} 50%, transparent 50%),
        ${a}
      `;

    case 'flag-england':
      return `
        linear-gradient(90deg, transparent 0%, transparent 42%, ${b} 42%, ${b} 58%, transparent 58%, transparent 100%),
        linear-gradient(180deg, transparent 0%, transparent 42%, ${b} 42%, ${b} 58%, transparent 58%, transparent 100%),
        ${a}
      `;

    case 'flag-spain':
      return `linear-gradient(
        180deg,
        ${a} 0%,
        ${a} 28%,
        ${b} 28%,
        ${b} 72%,
        ${a} 72%,
        ${a} 100%
      )`;

    case 'flag-germany':
      return `linear-gradient(
        180deg,
        ${a} 0%,
        ${a} 33.33%,
        ${b} 33.33%,
        ${b} 66.66%,
        ${c} 66.66%,
        ${c} 100%
      )`;

    case 'flag-france':
      return `linear-gradient(
        90deg,
        ${a} 0%,
        ${a} 33.33%,
        ${b} 33.33%,
        ${b} 66.66%,
        ${c} 66.66%,
        ${c} 100%
      )`;

    case 'flag-italy':
      return `linear-gradient(
        90deg,
        ${a} 0%,
        ${a} 33.33%,
        ${b} 33.33%,
        ${b} 66.66%,
        ${c} 66.66%,
        ${c} 100%
      )`;

    case 'flag-netherlands':
      return `linear-gradient(
        180deg,
        ${a} 0%,
        ${a} 33.33%,
        ${b} 33.33%,
        ${b} 66.66%,
        ${c} 66.66%,
        ${c} 100%
      )`;

    case 'basketball':
      return `
        radial-gradient(circle at center, transparent 0%, transparent 48%, ${b} 49%, ${b} 54%, transparent 55%),
        linear-gradient(90deg, transparent 0%, transparent 46%, ${b} 47%, ${b} 53%, transparent 54%),
        linear-gradient(180deg, transparent 0%, transparent 46%, ${b} 47%, ${b} 53%, transparent 54%),
        ${a}
      `;

    case 'american-football':
      return `
        linear-gradient(90deg, transparent 0%, transparent 47%, ${b} 47%, ${b} 53%, transparent 53%, transparent 100%),
        repeating-linear-gradient(
          180deg,
          transparent 0%,
          transparent 12%,
          ${b} 12%,
          ${b} 17%,
          transparent 17%,
          transparent 29%
        ),
        ${a}
      `;
    case 'flag-brazil-premium':
  return `
    radial-gradient(circle at 30% 25%, rgba(255,255,255,0.16), transparent 32%),
    ${a}
  `;

    case 'basketball-premium':
  return `
    radial-gradient(circle at 28% 24%, rgba(255,255,255,0.20), transparent 32%),
    ${a}
  `;

    case 'american-football-premium':
  return `
    radial-gradient(circle at 30% 25%, rgba(255,255,255,0.10), transparent 32%),
    linear-gradient(180deg, ${a}, #0b1220)
  `;

    case 'split-vertical':
      return `linear-gradient(90deg, ${a} 0%, ${a} 50%, ${b} 50%, ${b} 100%)`;

    case 'diagonal-stripes':
      return `repeating-linear-gradient(
        135deg,
        ${a} 0%,
        ${a} 18%,
        ${b} 18%,
        ${b} 35%,
        ${c || a} 35%,
        ${c || a} 42%
      )`;

    case 'quarters':
      return `conic-gradient(
        from 45deg,
        ${a} 0deg 90deg,
        ${b} 90deg 180deg,
        ${a} 180deg 270deg,
        ${b} 270deg 360deg
      )`;

    case 'chevron':
      return `
        linear-gradient(135deg, transparent 0 38%, ${b} 38% 54%, transparent 54%),
        linear-gradient(225deg, transparent 0 38%, ${b} 38% 54%, transparent 54%),
        ${a}
      `;

    case 'conic':
      return `conic-gradient(
        from 18deg,
        ${a} 0deg 72deg,
        ${b} 72deg 144deg,
        ${a} 144deg 216deg,
        ${b} 216deg 288deg,
        ${a} 288deg 360deg
      )`;

    case 'cross':
      return `
        linear-gradient(90deg, transparent 0 40%, ${b} 40% 60%, transparent 60%),
        linear-gradient(180deg, transparent 0 40%, ${b} 40% 60%, transparent 60%),
        ${a}
      `;

    case 'waves':
      return `
        radial-gradient(circle at 15% 100%, transparent 0 30%, ${b} 31% 39%, transparent 40%),
        radial-gradient(circle at 85% 0%, transparent 0 30%, ${b} 31% 39%, transparent 40%),
        ${a}
      `;

    case 'radial-burst':
      return `repeating-conic-gradient(
        from 8deg,
        ${a} 0deg 28deg,
        ${b} 28deg 43deg
      )`;

    default:
      return a;
  }
}

export default function ClubBadge({ clube, liga, mercado, escudo, size = 34 }) {
  const [logoFalhou, setLogoFalhou] = useState(false);
  useEffect(() => setLogoFalhou(false), [escudo]);
  const clubName =
    clube && typeof clube === 'object'
      ? clube.nome || clube.name || clube.nomeApi || clube.clubeNome || 'Clube'
      : clube;
  const leagueName =
    liga ||
    mercado ||
    (clube && typeof clube === 'object'
      ? clube.ligaId ||
        clube.liga ||
        clube.mercadoId ||
        clube.campeonato ||
        clube.metadata?.ligaId ||
        clube.metadata?.ligaNome
      : '');
  const key = normalizeClubName(clubName, leagueName);
  const hasAuthorialBadge = Boolean(CLUB_STYLES[key]);

  const style = CLUB_STYLES[key] || {
    outer: '#1f2937',
    glow: '#3b82f6',
    pattern: 'target',
    colors: ['#1f2937', '#ffffff'],
    center: '#ffffff',
  };

  const bg = getBackground(style);

  return (
    <Wrap
      $size={size}
      $outer={style.outer}
      $glow={style.glow}
      title={clubName}
      aria-label={`Símbolo de ${clubName || 'clube'}`}
    >
      <Inner $bg={bg}>
        {escudo && !hasAuthorialBadge && !logoFalhou ? (
          <OfficialLogo
            src={String(escudo).replace(/^http:\/\//i, 'https://')}
            alt={`Escudo do ${clubName}`}
            loading="lazy"
            onError={() => setLogoFalhou(true)}
          />
        ) : (
          <>
        {style.pattern === 'star' && <Star $size={size} />}

        {style.pattern === 'stars' && (
          <StarsRing $size={size}>
            <span>★</span>
            <span>★</span>
            <span>★</span>
            <span>★</span>
            <span>★</span>
          </StarsRing>
        )}

        {style.center && <Center $color={style.center} />}

        {style.mark && (
          <MarkPlate $shape={style.markShape} $color={style.markColor || '#ffffff'}>
            <MarkText $size={size} $length={style.mark.length}>
              {style.mark}
            </MarkText>
          </MarkPlate>
        )}
          </>
        )}
      </Inner>
    </Wrap>
  );

}

export function LeagueBadge({ liga, size = 28 }) {
  const key = normalizeLeagueName(liga);

  const style = LEAGUE_STYLES[key] || {
    outer: '#1f2937',
    glow: '#3b82f6',
    pattern: 'target',
    colors: ['#1f2937', '#ffffff'],
  };

  const bg = getBackground(style);

  return (
    <Wrap
      $size={size}
      $outer={style.outer}
      $glow={style.glow}
      title={liga}
      aria-label={`Símbolo de ${liga || 'liga'}`}
    >
      <Inner $bg={bg}>
        {style.pattern === 'flag-brazil-premium' && (
          <>
            <BrazilDiamond $color={style.colors[1]} />
            <BrazilBlueCircle $color={style.colors[2]} />
            <BrazilBand $color={style.colors[3]} />
          </>
        )}

        {style.pattern === 'basketball-premium' && (
          <BasketballSeams $color={style.colors[1]}>
            <div className="arc-left" />
            <div className="arc-right" />
            <div className="line-v" />
            <div className="line-h" />
          </BasketballSeams>
        )}

        {style.pattern === 'american-football-premium' && (
          <FootballBall
            $color={style.colors[1]}
            $laceColor={style.colors[2]}
          />
        )}
      </Inner>
    </Wrap>
  );
}
