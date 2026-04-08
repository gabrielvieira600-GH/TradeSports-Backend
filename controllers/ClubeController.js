const fs = require('fs');
const path = require('path');
const axios = require('axios');

const clubesPath = path.join(__dirname, '../public/data/clubes.json'); // Caminho para clubes.json
const API_KEY = process.env.API_FOOTBALL_KEY;
const API_BASE = 'https://v3.football.api-sports.io';
const ID_BRASILEIRAO = 140;
const TEMPORADA = 2024;

const BASE = 5;
const MULTIPLICADOR = 1.05;

// Funções auxiliares
function carregarClubes() {
  try {
    const data = fs.readFileSync(clubesPath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Erro ao carregar clubes:', err);
    return [];
  }
}

function salvarClubes(clubes) {
  try {
    fs.writeFileSync(clubesPath, JSON.stringify(clubes, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erro ao salvar clubes:', err);
  }
}

const ClubeController = {
  listarClubes: (req, res) => {
    try {
      const clubes = carregarClubes();
      res.status(200).json(clubes);
    } catch (error) {
      res.status(500).json({ message: 'Erro ao buscar clubes', error });
    }
  },

  criarClube: (req, res) => {
    try {
      const clubes = carregarClubes();
      const novoClube = { ...req.body };
      clubes.push(novoClube);
      salvarClubes(clubes);
      res.status(201).json(novoClube);
    } catch (error) {
      res.status(400).json({ message: 'Erro ao criar clube', error });
    }
  },

  atualizarClube: (req, res) => {
    try {
      const clubes = carregarClubes();
      const index = clubes.findIndex(c => c.id === Number(req.params.id));
      if (index === -1) {
        return res.status(404).json({ message: 'Clube não encontrado' });
      }
      clubes[index] = { ...clubes[index], ...req.body };
      salvarClubes(clubes);
      res.status(200).json(clubes[index]);
    } catch (error) {
      res.status(400).json({ message: 'Erro ao atualizar clube', error });
    }
  },

  removerClube: (req, res) => {
    try {
      let clubes = carregarClubes();
      const index = clubes.findIndex(c => c.id === Number(req.params.id));
      if (index === -1) {
        return res.status(404).json({ message: 'Clube não encontrado' });
      }
      clubes.splice(index, 1);
      salvarClubes(clubes);
      res.status(200).json({ message: 'Clube removido com sucesso' });
    } catch (error) {
      res.status(400).json({ message: 'Erro ao remover clube', error });
    }
  },

  buscarClubesDaApiFootball: async (req, res) => {
    try {
      const response = await axios.get(`${API_BASE}/standings`, {
        params: {
          league: ID_BRASILEIRAO,
          season: TEMPORADA
        },
        headers: {
          'x-apisports-key': API_KEY
        }
      });

      const standings = response.data.response[0].league.standings[0];
      const clubesExistentes = carregarClubes();
      const clubesAtualizados = [];

      for (const entry of standings) {
        const posicao = entry.rank;
        const nomeApi = entry.team.name;

        const existente = clubesExistentes.find(c => c.nomeApi === nomeApi);
        if (existente) {
          existente.posicao = posicao;
          clubesAtualizados.push(existente);
          continue;
        }

        const precoIPO = parseFloat((BASE * Math.pow(MULTIPLICADOR, 20 - posicao)).toFixed(2));

        const novoClube = {
          id: Number(entry.team.id),
          nome: nomeApi,
          nomeApi: nomeApi,
          escudo: entry.team.logo,
          posicao,
          preco: precoIPO,
          precoAtual: precoIPO
        };

        clubesExistentes.push(novoClube);
        clubesAtualizados.push(novoClube);
      }

      salvarClubes(clubesExistentes);
      res.status(200).json(clubesAtualizados);

    } catch (error) {
      console.error('Erro ao buscar clubes da API-Football:', error);
      res.status(500).json({ message: 'Erro ao buscar dados da API-Football', error });
    }
  }
};

module.exports = ClubeController;
