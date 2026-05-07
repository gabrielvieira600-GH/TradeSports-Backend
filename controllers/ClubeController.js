// controllers/ClubeController.js
const axios = require('axios');
const Club = require('../models/Club');

const API_KEY = process.env.API_FOOTBALL_KEY;
const API_BASE = 'https://v3.football.api-sports.io';
const ID_BRASILEIRAO = Number(process.env.API_FOOTBALL_LEAGUE_ID || process.env.ID_BRASILEIRAO || 71);
const TEMPORADA = Number(process.env.API_FOOTBALL_SEASON || process.env.TEMPORADA || new Date().getFullYear());

const BASE = 5;
const MULTIPLICADOR = 1.05;

function round2(n) {
  return Number(Number(n || 0).toFixed(2));
}

function calcularPrecoIPO(posicao) {
  const pos = Number(posicao || 20);
  return round2(BASE * Math.pow(MULTIPLICADOR, 20 - pos));
}

function normalizarNome(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function toClubResponse(clube) {
  return {
    id: clube.legacyId,
    legacyId: clube.legacyId,
    mongoId: String(clube._id),
    nome: clube.nome,
    nomeApi: clube.nomeApi || clube.nome,
    escudo: clube.escudo || '',
    posicao: clube.posicao ?? null,
    preco: Number(clube.preco || 0),
    precoAtual: clube.precoAtual != null ? Number(clube.precoAtual) : Number(clube.preco || 0),
    cotasDisponiveis: Number(clube.cotasDisponiveis || 0),
    cotasEmitidas: Number(clube.cotasEmitidas || 0),
    ipoEncerrado: Boolean(clube.ipoEncerrado),
    splitFactorCumulativo: Number(clube.splitFactorCumulativo || 1),
    travadoAte: Number(clube.travadoAte || 0),
    metadata: clube.metadata || {},
    createdAt: clube.createdAt,
    updatedAt: clube.updatedAt,
  };
}

function montarPayloadClube(body = {}, existente = null) {
  const legacyId = body.legacyId != null
    ? Number(body.legacyId)
    : body.id != null
      ? Number(body.id)
      : existente?.legacyId != null
        ? Number(existente.legacyId)
        : Date.now();

  const nome = String(body.nome || body.nomeApi || existente?.nome || '').trim();
  const posicao = body.posicao != null ? Number(body.posicao) : existente?.posicao ?? null;
  const precoBase = body.preco != null ? Number(body.preco) : posicao ? calcularPrecoIPO(posicao) : Number(existente?.preco || BASE);

  return {
    legacyId,
    nome,
    nomeApi: String(body.nomeApi || existente?.nomeApi || nome).trim(),
    escudo: body.escudo || existente?.escudo || '',
    posicao,
    preco: round2(precoBase),
    precoAtual: body.precoAtual != null ? round2(body.precoAtual) : existente?.precoAtual != null ? round2(existente.precoAtual) : round2(precoBase),
    cotasDisponiveis: body.cotasDisponiveis != null ? Number(body.cotasDisponiveis) : Number(existente?.cotasDisponiveis ?? 1000),
    cotasEmitidas: body.cotasEmitidas != null ? Number(body.cotasEmitidas) : Number(existente?.cotasEmitidas ?? 0),
    ipoEncerrado: body.ipoEncerrado != null ? Boolean(body.ipoEncerrado) : Boolean(existente?.ipoEncerrado || false),
    splitFactorCumulativo: body.splitFactorCumulativo != null ? Number(body.splitFactorCumulativo) : Number(existente?.splitFactorCumulativo || 1),
    travadoAte: body.travadoAte != null ? Number(body.travadoAte) : Number(existente?.travadoAte || 0),
    metadata: {
      ...(existente?.metadata || {}),
      ...(body.metadata || {}),
    },
  };
}

const ClubeController = {
  listarClubes: async (req, res) => {
    try {
      const clubes = await Club.find({}).sort({ posicao: 1, nome: 1 }).lean();
      return res.status(200).json(clubes.map(toClubResponse));
    } catch (error) {
      console.error('[CLUBE] Erro ao buscar clubes:', error);
      return res.status(500).json({ message: 'Erro ao buscar clubes', error: String(error.message || error) });
    }
  },

  criarClube: async (req, res) => {
    try {
      const payload = montarPayloadClube(req.body || {});
      if (!payload.nome) return res.status(400).json({ message: 'Nome do clube é obrigatório.' });
      if (!Number.isFinite(payload.legacyId) || payload.legacyId <= 0) return res.status(400).json({ message: 'ID do clube inválido.' });

      const jaExiste = await Club.findOne({ legacyId: payload.legacyId }).lean();
      if (jaExiste) return res.status(409).json({ message: 'Clube já cadastrado.', clube: toClubResponse(jaExiste) });

      const novoClube = await Club.create(payload);
      return res.status(201).json(toClubResponse(novoClube.toObject()));
    } catch (error) {
      console.error('[CLUBE] Erro ao criar clube:', error);
      if (error?.code === 11000) return res.status(409).json({ message: 'Clube já cadastrado.' });
      return res.status(400).json({ message: 'Erro ao criar clube', error: String(error.message || error) });
    }
  },

  atualizarClube: async (req, res) => {
    try {
      const legacyId = Number(req.params.id);
      if (!Number.isFinite(legacyId) || legacyId <= 0) return res.status(400).json({ message: 'ID do clube inválido.' });

      const existente = await Club.findOne({ legacyId });
      if (!existente) return res.status(404).json({ message: 'Clube não encontrado' });

      const payload = montarPayloadClube({ ...req.body, legacyId }, existente.toObject());
      Object.assign(existente, payload);
      await existente.save();

      return res.status(200).json(toClubResponse(existente.toObject()));
    } catch (error) {
      console.error('[CLUBE] Erro ao atualizar clube:', error);
      return res.status(400).json({ message: 'Erro ao atualizar clube', error: String(error.message || error) });
    }
  },

  removerClube: async (req, res) => {
    try {
      const legacyId = Number(req.params.id);
      if (!Number.isFinite(legacyId) || legacyId <= 0) return res.status(400).json({ message: 'ID do clube inválido.' });

      const removido = await Club.findOneAndDelete({ legacyId }).lean();
      if (!removido) return res.status(404).json({ message: 'Clube não encontrado' });

      return res.status(200).json({ message: 'Clube removido com sucesso', clube: toClubResponse(removido) });
    } catch (error) {
      console.error('[CLUBE] Erro ao remover clube:', error);
      return res.status(400).json({ message: 'Erro ao remover clube', error: String(error.message || error) });
    }
  },

  buscarClubesDaApiFootball: async (req, res) => {
    try {
      if (!API_KEY) return res.status(500).json({ message: 'API_FOOTBALL_KEY não configurada.' });

      const response = await axios.get(`${API_BASE}/standings`, {
        params: { league: ID_BRASILEIRAO, season: TEMPORADA },
        headers: { 'x-apisports-key': API_KEY },
      });

      const standings = response?.data?.response?.[0]?.league?.standings?.[0] || [];
      if (!Array.isArray(standings) || !standings.length) {
        return res.status(404).json({ message: 'Nenhum clube retornado pela API-Football.' });
      }

      const existentes = await Club.find({}).lean();
      const porLegacy = new Map(existentes.map((c) => [Number(c.legacyId), c]));
      const porNomeApi = new Map(existentes.map((c) => [normalizarNome(c.nomeApi || c.nome), c]));

      const clubesAtualizados = [];

      for (const entry of standings) {
        const posicao = Number(entry.rank);
        const apiTeamId = Number(entry.team?.id);
        const nomeApi = entry.team?.name || '';
        const escudo = entry.team?.logo || '';
        if (!apiTeamId || !nomeApi) continue;

        const existente = porLegacy.get(apiTeamId) || porNomeApi.get(normalizarNome(nomeApi));
        const precoIPO = calcularPrecoIPO(posicao);

        const update = {
          legacyId: existente?.legacyId ?? apiTeamId,
          nome: existente?.nome || nomeApi,
          nomeApi,
          escudo,
          posicao,
          preco: existente?.preco != null ? existente.preco : precoIPO,
          precoAtual: existente?.precoAtual != null ? existente.precoAtual : precoIPO,
          cotasDisponiveis: existente?.cotasDisponiveis != null ? existente.cotasDisponiveis : 1000,
          cotasEmitidas: existente?.cotasEmitidas != null ? existente.cotasEmitidas : 0,
          ipoEncerrado: existente?.ipoEncerrado != null ? Boolean(existente.ipoEncerrado) : false,
          splitFactorCumulativo: Number(existente?.splitFactorCumulativo || 1),
          travadoAte: Number(existente?.travadoAte || 0),
          metadata: {
            ...(existente?.metadata || {}),
            apiFootballId: apiTeamId,
            ultimaAtualizacaoApi: new Date().toISOString(),
            campeonato: 'Brasileirao',
            temporada: TEMPORADA,
          },
        };

        const salvo = await Club.findOneAndUpdate(
          { legacyId: update.legacyId },
          { $set: update },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean();

        clubesAtualizados.push(toClubResponse(salvo));
      }

      return res.status(200).json(clubesAtualizados);
    } catch (error) {
      console.error('Erro ao buscar clubes da API-Football:', error?.response?.data || error);
      return res.status(500).json({ message: 'Erro ao buscar dados da API-Football', error: String(error.message || error) });
    }
  },
};

module.exports = ClubeController;