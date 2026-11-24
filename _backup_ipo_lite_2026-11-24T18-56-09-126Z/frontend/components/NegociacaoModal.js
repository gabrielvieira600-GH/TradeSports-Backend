import { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import Image from 'next/image';
import LivroDeOrdens from './LivroDeOrdens';
import { useToast } from '../components/ToastProvider';
import api from '../lib/api';
import PoliticaRiscoModal from './PoliticaRiscoModal';
import ClubBadge from '../components/ClubBadge';

function verificarTokenValido(token) {
  if (!token) return false;
  try {
    const payloadBase64 = token.split('.')[1];
    if (!payloadBase64) return false;
    const decodedPayload = JSON.parse(atob(payloadBase64));
    return !!decodedPayload && typeof decodedPayload === 'object';
  } catch (err) {
    return false;
  }
}

export default function NegociacaoModal({
  isOpen,
  clube,
  onClose,
  modoInicial = 'compra',
}) {
  const [quantidade, setQuantidade] = useState(1);
  const [precoAtual, setPrecoAtual] = useState(0);
  const [precoInput, setPrecoInput] = useState('');
  const [preco, setPreco] = useState(0);
  const [modo, setModo] = useState(modoInicial);
  const [mensagem, setMensagem] = useState('');
  const [resultadoOrdem, setResultadoOrdem] = useState(null);
  const [resultadoIpo, setResultadoIpo] = useState(null);
  const [poderCompra, setPoderCompra] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [ordensCompra, setOrdensCompra] = useState([]);
  const [ordensVenda, setOrdensVenda] = useState([]);
  const [ipoEncerrado, setIpoEncerrado] = useState(false);
  const [ligaFechada, setLigaFechada] = useState(false);
  const [marketMode, setMarketMode] = useState('UNIFIED_LIQUIDITY');
  const [cotasIPO, setCotasIPO] = useState(0);
  const [mostrarRisco, setMostrarRisco] = useState(false);
  const [resumoBook, setResumoBook] = useState({
    bestBid: null,
    bestAsk: null,
    mid: null,
    spreadPct: null,
  });
  const modoInicialAplicadoRef = useRef(null);
  const sincronizacaoRef = useRef(0);

  const [limiteOrdens, setLimiteOrdens] = useState({
  carregando: false,
  erro: '',
  temporadaAtiva: false,
  mercadoAberto: false,
  temporada: null,
  periodo: null,
  plano: null,
  ordensIlimitadas: false,
  limite: null,
  utilizadas: null,
  restantes: null,
  limiteAtingido: false,
});

  const { adicionarToast } = useToast();

  const TICK_SIZE = 0.05;

  const roundToTick = (value) => {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Number((Math.round(n / TICK_SIZE) * TICK_SIZE).toFixed(2));
  };

  const isValidTickPrice = (value) => {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return false;
    const steps = n / TICK_SIZE;
    return Math.abs(steps - Math.round(steps)) < 1e-9;
  };

  const handleSelecionarPreco = (p) => {
    if (Number.isFinite(p)) {
      const n = Number(p);
      setPrecoAtual(n);
      setPrecoInput(n.toFixed(2));
    }
  };

  const [usuario, setUsuario] = useState(() => {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem('usuario');
      return raw && raw !== 'undefined' ? JSON.parse(raw) : null;
    }
    return null;
  });

  const meuId = usuario?.id || usuario?._id || null;
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const clubeId = clube?.id || clube?._id || null;
  const precoMercado = Number(precoAtual || 0);

  const getAuthHeaders = () =>
    token ? { Authorization: `Bearer ${token}` } : {};

  const registrarAceite = async (tipo, versao) => {
    try {
      const tokenLocal =
        typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      if (!tokenLocal) return;

      await api.post(
        '/usuario/aceites',
        { tipo, versao },
        {
          headers: {
            Authorization: `Bearer ${tokenLocal}`,
          },
        }
      );
    } catch (err) {
      console.error('Erro ao registrar aceite:', err);
    }
  };

  useEffect(() => {
  if (!isOpen || !token || !verificarTokenValido(token)) return;

  atualizarUsuarioCompleto();
  carregarLimiteOrdens();
}, [isOpen, token]);

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return undefined;

    const overflowAnterior = document.body.style.overflow;
    const fecharComEscape = (event) => {
      if (event.key === 'Escape' && !mostrarRisco) {
        onClose?.();
      }
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', fecharComEscape);

    return () => {
      document.body.style.overflow = overflowAnterior;
      document.removeEventListener('keydown', fecharComEscape);
    };
  }, [isOpen, mostrarRisco, onClose]);

  useEffect(() => {
    const basePreco =
      clube?.precoMercado !== undefined && clube?.precoMercado !== null
        ? Number(clube.precoMercado)
        : clube?.precoAtual !== undefined && clube?.precoAtual !== null
        ? Number(clube.precoAtual)
        : clube?.preco !== undefined && clube?.preco !== null
        ? Number(clube.preco)
        : 0;

    if (Number.isFinite(basePreco) && basePreco > 0) {
      setPreco(basePreco);
      setPrecoAtual(basePreco);
      setPrecoInput(basePreco.toFixed(2));
    } else {
      setPreco(0);
      setPrecoAtual(0);
      setPrecoInput('');
    }
  }, [clube]);

  useEffect(() => {
    if (!isOpen || !clubeId) return;
    carregarOrdens();
    verificarIPO();
  }, [isOpen, clubeId, modo]);

  useEffect(() => {
  setMensagem('');
  setResultadoOrdem(null);
  setResultadoIpo(null);

  if (usuario?.saldo !== undefined) {
    setPoderCompra(Number(usuario.saldo) || 0);
  }
}, [clube, isOpen, usuario]);

  useEffect(() => {
    setMensagem('');
    setResultadoOrdem(null);
    setResultadoIpo(null);
  }, [modo]);

  useEffect(() => {
    if (!isOpen || !token || typeof window === 'undefined') return undefined;
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') atualizarSaldoDoUsuario();
    };
    const intervalo = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !carregando) {
        atualizarSaldoDoUsuario();
      }
    }, 3000);
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      window.clearInterval(intervalo);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [isOpen, token, carregando]);

  const carregarOrdens = async () => {
    try {
      if (!clubeId) return;

      const { data } = await api.get(
        `/mercado/livro/${clubeId}?visao=${encodeURIComponent(modo || '')}`,
        { headers: getAuthHeaders() }
      );

      setOrdensCompra(data?.compras || []);
      setOrdensVenda(data?.vendas || []);
    } catch (err) {
      console.error('Erro ao carregar ordens:', err);
      setOrdensCompra([]);
      setOrdensVenda([]);
    }
  };

  const buscarClubeInfo = async (id) => {
    const tentativas = [`/clube/${id}`, `/clube?id=${id}`];

    for (const url of tentativas) {
      try {
        const resp = await api.get(url, { headers: getAuthHeaders() });
        return resp?.data?.data ?? resp?.data ?? null;
      } catch (e) {}
    }

    return null;
  };

  const verificarIPO = async () => {
    try {
      if (!clubeId) return;

      const [clubeInfo, configResponse, marketStatusResponse] = await Promise.all([
        buscarClubeInfo(clubeId),
        api.get('/mercado/configuracao').catch(() => ({ data: { marketMode: 'IPO' } })),
        api.get('/api/market-status').catch(() => ({ data: { mercados: [] } })),
      ]);

      if (!clubeInfo) {
        console.error('Não foi possí­vel carregar clubeInfo para verificar IPO');
        setMensagem('Não foi possível verificar status do IPO.');
        return;
      }

      const mode = configResponse?.data?.marketMode || 'IPO';
      const ligaId = clubeInfo.metadata?.ligaId || clubeInfo.ligaId || clube?.metadata?.ligaId || clube?.ligaId;
      const mercadosFechados = marketStatusResponse?.data?.mercados || [];
      setLigaFechada(Boolean(ligaId && mercadosFechados.some((market) => market.ligaId === ligaId && market.fechado)));
      const unified = mode === 'UNIFIED_LIQUIDITY';
      const cotas = Number(clubeInfo.cotasDisponiveis ?? 0);
      const encerrado = unified || cotas === 0 || Boolean(clubeInfo.ipoEncerrado);

      setMarketMode(mode);
      setCotasIPO(cotas);
      setIpoEncerrado(encerrado);

      let precoBase = 0;

      if (!encerrado) {
        precoBase = Number(clubeInfo.precoIPO ?? clubeInfo.precoAtual ?? clubeInfo.preco ?? 0);
      } else {
        precoBase = Number(clubeInfo.precoAtual ?? clubeInfo.preco ?? 0);
      }

      setPreco(precoBase);
      setPrecoAtual(precoBase);
      setPrecoInput(precoBase > 0 ? Number(precoBase).toFixed(2) : '');
    } catch (err) {
      console.error('Erro ao verificar IPO:', err);
      setMensagem('Erro ao verificar status do IPO.');
    }
  };

  // Atualiza o preço oficial enquanto o IPO está aberto e o modal visível.
  useEffect(() => {
    if (!isOpen || !clubeId || ipoEncerrado) return undefined;
    const timer = window.setInterval(() => verificarIPO(), 15000);
    return () => window.clearInterval(timer);
  }, [isOpen, clubeId, ipoEncerrado]);

  const precoTotal = (
    Number(precoAtual || 0) * Number(quantidade || 0)
  ).toFixed(2);

  const tradeRolePreview = useMemo(() => {
    if (!ipoEncerrado) return { role: 'IPO', feePct: 0, feeValue: 0 };

    const bestBid =
      resumoBook?.bestBid != null ? Number(resumoBook.bestBid) : null;
    const bestAsk =
      resumoBook?.bestAsk != null ? Number(resumoBook.bestAsk) : null;
    const currentPrice = Number(precoAtual || 0);
    const qty = Number(quantidade || 0);

    let role = 'MAKER';

    if (modo === 'compra' && bestAsk != null && currentPrice >= bestAsk) {
      role = 'TAKER';
    }
    if (modo === 'venda' && bestBid != null && currentPrice <= bestBid) {
      role = 'TAKER';
    }

    const feePct = role === 'TAKER' ? 0.005 : 0.002;
    const feeValue = Number((currentPrice * qty * feePct).toFixed(2));

    return { role, feePct, feeValue };
  }, [ipoEncerrado, resumoBook, precoAtual, quantidade, modo]);

  const tickValidation = useMemo(() => {
    if (!ipoEncerrado) return { valid: true, suggested: null, message: '' };

    const typed = Number(precoAtual || 0);
    if (!Number.isFinite(typed) || typed <= 0) {
      const fallback = Number(preco || 0);
      return {
        valid: false,
        suggested:
          Number.isFinite(fallback) && fallback > 0 ? roundToTick(fallback) : null,
        message: 'Informe um preço válido.',
      };
    }

    const valid = isValidTickPrice(typed);
    const suggested = roundToTick(typed);

    return {
      valid,
      suggested,
      message: valid
        ? ''
        : `O preço deve respeitar o tick de T$ ${TICK_SIZE.toFixed(
            2
          )}. Sugestão: T$ ${suggested.toFixed(2)}.`,
    };
  }, [ipoEncerrado, precoAtual, preco]);

  const aplicarPrecoSugerido = () => {
    if (tickValidation?.suggested == null) return;
    const n = Number(tickValidation.suggested);
    setPrecoAtual(n);
    setPrecoInput(n.toFixed(2));
  };

  const melhorarPreco = () => {
    if (!ipoEncerrado) return;

    const bestBid =
      resumoBook?.bestBid != null ? Number(resumoBook.bestBid) : null;
    const bestAsk =
      resumoBook?.bestAsk != null ? Number(resumoBook.bestAsk) : null;

    if (modo === 'compra') {
      if (bestBid != null) {
        const suggested = Number((bestBid + TICK_SIZE).toFixed(2));
        const next =
          bestAsk != null && suggested >= bestAsk
            ? Number((bestAsk - TICK_SIZE).toFixed(2))
            : suggested;

        if (next > 0) {
          setPrecoAtual(next);
          setPrecoInput(next.toFixed(2));
        }
      }
      return;
    }

    if (modo === 'venda' && bestAsk != null) {
      const suggested = Number((bestAsk - TICK_SIZE).toFixed(2));
      const next =
        bestBid != null && suggested <= bestBid
          ? Number((bestBid + TICK_SIZE).toFixed(2))
          : Math.max(TICK_SIZE, suggested);

      if (next > 0) {
        setPrecoAtual(next);
        setPrecoInput(next.toFixed(2));
      }
    }
  };
 
  async function carregarLimiteOrdens() {
  if (!token || !verificarTokenValido(token)) {
    setLimiteOrdens((prev) => ({
      ...prev,
      carregando: false,
      erro: '',
    }));

    return null;
  }

  setLimiteOrdens((prev) => ({
    ...prev,
    carregando: true,
    erro: '',
  }));

  try {
    const { data } = await api.get('/mercado/limite-ordens', {
      headers: getAuthHeaders(),
    });

    const atualizado = {
  carregando: false,
  erro: '',
  temporadaAtiva: Boolean(data?.temporadaAtiva),
  mercadoAberto:
    Boolean(data?.temporadaAtiva) &&
    data?.mercadoAberto !== false,
  temporada: data?.temporada || null,
  periodo: data?.periodo || null,
  plano: data?.plano || 'lite',
  ordensIlimitadas: Boolean(data?.ordensIlimitadas),

  limite:
    data?.limite !== undefined && data?.limite !== null
      ? Number(data.limite)
      : null,

  utilizadas:
    data?.utilizadas !== undefined && data?.utilizadas !== null
      ? Number(data.utilizadas)
      : null,

  restantes:
    data?.restantes !== undefined && data?.restantes !== null
      ? Number(data.restantes)
      : null,

  limiteAtingido: Boolean(data?.limiteAtingido),
};

    setLimiteOrdens(atualizado);

    return atualizado;
  } catch (err) {
    console.error('Erro ao consultar limite de ordens:', err);

    const mensagemErro =
      err?.response?.data?.erro ||
      'Não foi possível consultar a franquia de ordens.';

    setLimiteOrdens((prev) => ({
      ...prev,
      carregando: false,
      erro: mensagemErro,
    }));

    return null;
  }
}

 // TradeSports: sincronizacao de negociacoes v2
 async function atualizarSaldoDoUsuario() {
   const requestId = ++sincronizacaoRef.current;
   try {
     const [respUsuario, respSaldo] = await Promise.all([
       api.get('/usuario', { headers: getAuthHeaders() }),
       api.get('/usuario/saldo', { headers: getAuthHeaders() }),
     ]);
     const dadosUsuario = respUsuario?.data?.usuario || respUsuario?.data;
     const valorSaldo = respSaldo?.data?.saldo;
     const saldoAtual = Number(valorSaldo);
     if (!dadosUsuario || typeof dadosUsuario !== 'object' ||
         valorSaldo === undefined || valorSaldo === null ||
         !Number.isFinite(saldoAtual) || requestId !== sincronizacaoRef.current) return null;

     const atualizado = { ...dadosUsuario, saldo: saldoAtual };
     setUsuario(atualizado);
     setPoderCompra(saldoAtual);
     localStorage.setItem('usuario', JSON.stringify(atualizado));
     localStorage.setItem('saldo', saldoAtual.toFixed(2));
     // O AuthProvider e a Topbar escutam estes eventos na mesma aba.
     window.dispatchEvent(new Event('tradesports-usuario-atualizado'));
     window.dispatchEvent(new Event('force-topbar-update'));
     return atualizado;
   } catch (err) {
     console.error('[TradeSports] Falha ao sincronizar carteira/saldo:', err);
     return null;
   }
 }

  async function enviarOrdem() {
  setCarregando(true);
  setMensagem('');
  setResultadoOrdem(null);
  setResultadoIpo(null);

    if (!token || !verificarTokenValido(token)) {
      setMensagem('Você precisa estar logado para enviar ordens.');
      adicionarToast('Efetue o login para enviar ordens.', 'erro');
      setCarregando(false);
      return;
    }

    if (!usuario || (!usuario.id && !usuario._id)) {
      setMensagem('Não foi possí­vel identificar o usuário logado.');
      adicionarToast('Usuário inválido.', 'erro');
      setCarregando(false);
      return;
    }

    if (ligaFechada) {
      setMensagem('As negociações desta liga estão fechadas no momento.');
      adicionarToast('Mercado fechado para esta liga.', 'erro');
      setCarregando(false);
      return;
    }
    
    if (ipoEncerrado) {
  if (limiteOrdens.carregando) {
    setMensagem(
      'Aguarde a verificação da franquia de ordens.'
    );

    setCarregando(false);
    return;
  }

  if (!limiteOrdens.temporadaAtiva) {
    setMensagem(
      'Não existe uma temporada ativa no momento.'
    );

    adicionarToast(
      'Não existe uma temporada ativa no momento.',
      'erro'
    );

    setCarregando(false);
    return;
  }

  if (!limiteOrdens.mercadoAberto) {
  setMensagem(
    'O mercado está temporariamente fechado para novas ordens.'
  );

  adicionarToast(
    'O mercado está temporariamente fechado.',
    'erro'
  );

  setCarregando(false);
  return;
}

if (
  limiteOrdens.plano === 'lite' &&
  limiteOrdens.limiteAtingido
) {
  setMensagem(
    'Você atingiu o limite semanal de ordens.'
  );

  adicionarToast(
    'Limite semanal de ordens atingido.',
    'erro'
  );

  setCarregando(false);
  return;
}
}

    try {
      let response;

      if (modo === 'venda') {
  const usuarioAtualizado = await atualizarSaldoDoUsuario();

  const carteiraAtualizada = Array.isArray(usuarioAtualizado?.carteira)
    ? usuarioAtualizado.carteira
    : Array.isArray(usuario?.carteira)
      ? usuario.carteira
      : [];

  const nomeClubeAtual = String(clube?.nome || '').trim().toLowerCase();

  const ativo =
    carteiraAtualizada.find((a) => String(a?.clubeId) === String(clube.id)) ||
    carteiraAtualizada.find((a) => String(a?.clubeLegacyId) === String(clube.id)) ||
    carteiraAtualizada.find((a) => String(a?.idClube) === String(clube.id)) ||
    carteiraAtualizada.find((a) => String(a?.clube?.id) === String(clube.id)) ||
    carteiraAtualizada.find((a) => String(a?.clube?.legacyId) === String(clube.id)) ||
    carteiraAtualizada.find(
      (a) =>
        String(a?.nomeClube || a?.clubeNome || a?.nome || a?.clube?.nome || '')
          .trim()
          .toLowerCase() === nomeClubeAtual
    );

  const qtdDisp = Number(ativo?.quantidade ?? ativo?.cotas ?? 0);

  if (quantidade > qtdDisp) {
    setMensagem('Quantidade acima do disponí­vel na carteira.');
    adicionarToast('Quantidade acima do disponível.', 'erro');
    setCarregando(false);
    return;
  }
}

      if (modo === 'compra' && !ipoEncerrado) {
        const { data } = await api.post(
          `/clube/${clube.id}/comprar`,
          {
            quantidade: Number(quantidade),
          },
          {
            headers: getAuthHeaders(),
          }
        );

        response = data;
        if (response?.erro) throw new Error(response.erro);
      } else if (modo === 'venda' && !ipoEncerrado) {
        const { data } = await api.post(
          `/clube/${clube.id}/devolver`,
          {
            quantidade: Number(quantidade),
          },
          {
            headers: getAuthHeaders(),
          }
        );

        response = data;
        if (response?.erro) throw new Error(response.erro);
      } else {
        if (!isValidTickPrice(Number(precoAtual || 0))) {
          setMensagem(`Preço inválido para o tick de T$ ${TICK_SIZE.toFixed(2)}.`);
          adicionarToast(
            `Preço inválido para o tick de T$ ${TICK_SIZE.toFixed(2)}.`,
            'erro'
          );
          setCarregando(false);
          return;
        }

        const payload = {
          tipo: modo,
          clubeId: clube.id,
          quantidade: Number(quantidade),
          preco: Number(precoAtual),
        };

        const { data } = await api.post('/mercado/ordem', payload, {
  headers: getAuthHeaders(),
});

response = data;

if (response?.franquiaOrdens) {
  setLimiteOrdens((prev) => ({
    ...prev,

    plano:
      response?.plano?.tipo ||
      prev.plano,

    ordensIlimitadas: Boolean(
      response?.plano?.ordensIlimitadas
    ),

    limite:
      response.franquiaOrdens.limite !== undefined
        ? response.franquiaOrdens.limite
        : prev.limite,

    utilizadas:
      response.franquiaOrdens.utilizadas !== undefined
        ? response.franquiaOrdens.utilizadas
        : prev.utilizadas,

    restantes:
      response.franquiaOrdens.restantes !== undefined
        ? response.franquiaOrdens.restantes
        : prev.restantes,

    limiteAtingido: Boolean(
      response.franquiaOrdens.limiteAtingido
    ),
  }));
}
      }

      if (!ipoEncerrado && response?.tipo === 'IPO_RETURN') {
        const quantidadeDevolvida = Number(
          response?.investimento?.quantidade || quantidade || 0
        );
        const precoUnitario = Number(
          response?.investimento?.precoUnitario || response?.clube?.preco || precoAtual || 0
        );
        const valorLiquido = Number(
          response?.valorLiquido ?? quantidadeDevolvida * precoUnitario
        );

        setResultadoIpo({
          tipo: 'devolucao',
          titulo: 'Venda ao sistema executada',
          quantidade: quantidadeDevolvida,
          precoUnitario,
          taxa: 0,
          valorLiquido,
        });

        setMensagem('Venda executada pelo preço atual da classificação, sem taxas.');
        adicionarToast('Venda ao sistema realizada sem taxas.', 'sucesso');
      } else if (ipoEncerrado && response?.ordem) {
  const execucoes = Array.isArray(response.execucoes)
    ? response.execucoes
    : [];

  const quantidadeOriginal = Number(
    response.ordem.quantidade || 0
  );

  const quantidadeRestante = Number(
    response.ordem.restante || 0
  );

  const quantidadeExecutada = execucoes.reduce(
    (total, execucao) =>
      total + Number(execucao.quantidade || 0),
    0
  );

  const valorExecutado = execucoes.reduce(
    (total, execucao) =>
      total +
      Number(execucao.quantidade || 0) *
        Number(execucao.preco || 0),
    0
  );

  const precoMedioExecutado =
    quantidadeExecutada > 0
      ? valorExecutado / quantidadeExecutada
      : null;

  const taxaTotal = execucoes.reduce(
    (total, execucao) =>
      total +
      Number(
        modo === 'compra'
          ? execucao.taxaBuyer
          : execucao.taxaSeller
      ),
    0
  );

  const status = response.ordem.status || 'aberta';

  const titulo =
    status === 'executada'
      ? 'Ordem executada integralmente'
      : status === 'parcial'
      ? 'Ordem executada parcialmente'
      : 'Ordem enviada para o livro';

  setResultadoOrdem({
    titulo,
    status,
    tipo: response.ordem.tipo || modo,
    clube:
      response?.clube?.nome ||
      clube?.nome ||
      'Clube',
    precoLimite: Number(
      response.ordem.preco || precoAtual || 0
    ),
    quantidadeOriginal,
    quantidadeExecutada,
    quantidadeRestante,
    precoMedioExecutado,
    taxaTotal,
    ordensIlimitadas: Boolean(
      response?.plano?.ordensIlimitadas
    ),
    ordensRestantes:
      response?.franquiaOrdens?.restantes ??
      null,
  });

  adicionarToast(`${titulo}.`, 'sucesso');
} else {
  const quantidadeComprada = Number(
    response?.investimento?.quantidade || quantidade || 0
  );
  const precoUnitario = Number(
    response?.investimento?.precoUnitario || response?.clube?.precoAtual || precoAtual || 0
  );

  setResultadoIpo({
    tipo: 'compra',
    titulo: 'Compra realizada no IPO',
    quantidade: quantidadeComprada,
    precoUnitario,
    taxa: 0,
    valorLiquido: Number(
      response?.investimento?.totalPago ?? quantidadeComprada * precoUnitario
    ),
  });

  setMensagem('Compra realizada com sucesso no IPO!');

  adicionarToast(
    'Compra realizada com sucesso no IPO!',
    'sucesso'
  );
}

      await carregarOrdens();
      await carregarLimiteOrdens();
      await verificarIPO();
      await atualizarSaldoDoUsuario();
      if (ipoEncerrado) {
  await carregarLimiteOrdens();
}
    } catch (error) {
  let erroMsg = 'Erro desconhecido';

  const codigoErro =
    error?.response?.data?.codigo;

  if (
    codigoErro ===
    'LIMITE_ORDENS_ATINGIDO'
  ) {
    const dados =
      error.response.data || {};

    setLimiteOrdens((prev) => ({
      ...prev,
      carregando: false,
      plano: 'lite',
      ordensIlimitadas: false,

      limite: Number(
        dados.limite ||
          prev.limite ||
          15
      ),

      utilizadas: Number(
        dados.utilizadas ||
          dados.limite ||
          prev.utilizadas ||
          15
      ),

      restantes: 0,
      limiteAtingido: true,
    }));
  }

  if (
    codigoErro ===
    'TEMPORADA_NAO_ATIVA'
  ) {
    setLimiteOrdens((prev) => ({
  ...prev,
  carregando: false,
  temporadaAtiva: false,
  mercadoAberto: false,
  temporada: null,
  periodo: null,
}));
  }

  if (codigoErro === 'MERCADO_FECHADO') {
  setLimiteOrdens((prev) => ({
    ...prev,
    carregando: false,
    mercadoAberto: false,
  }));
}

  if (error.response) {
        erroMsg =
          error.response.data?.erro ||
          error.response.data?.message ||
          'Erro no servidor';
      } else if (error.request) {
        erroMsg = 'Sem resposta do servidor';
      } else {
        erroMsg = error.message;
      }

      setMensagem(`${erroMsg}`);
      adicionarToast(`Erro: ${erroMsg}`, 'erro');
      console.error('[ERRO AO ENVIAR ORDEM]', erroMsg);
    } finally {
      setCarregando(false);
    }
  }

  async function atualizarUsuarioCompleto() {
  try {
    const resp = await api.get('/usuario', {
      headers: getAuthHeaders(),
    });

    const usuarioAtualizado = resp?.data || null;

    if (usuarioAtualizado) {
      setUsuario(usuarioAtualizado);
      localStorage.setItem('usuario', JSON.stringify(usuarioAtualizado));

      if (usuarioAtualizado.saldo !== undefined) {
        localStorage.setItem('saldo', Number(usuarioAtualizado.saldo || 0).toFixed(2));
        setPoderCompra(Number(usuarioAtualizado.saldo || 0));
      }

      window.dispatchEvent(new Event('force-topbar-update'));
    }

    return usuarioAtualizado;
  } catch (err) {
    console.error('Erro ao atualizar usuário completo:', err);
    return null;
  }
}

  async function cancelarMinhaOrdem(ordemOuId) {
    try {
      if (!token || !verificarTokenValido(token)) {
        adicionarToast('Você precisa estar logado para cancelar ordens.', 'erro');
        return;
      }

      const ordemId =
        typeof ordemOuId === 'string' || typeof ordemOuId === 'number'
          ? ordemOuId
          : ordemOuId?.id;

      if (!ordemId) {
        console.error('ID de ordem inválido ao tentar cancelar:', ordemOuId);
        adicionarToast(
          'Não foi possível identificar a ordem para cancelar.',
          'erro'
        );
        return;
      }

      await api.post(
  `/mercado/ordem/cancelar/${ordemId}`,
  {},
  {
    headers: getAuthHeaders(),
  }
);

      adicionarToast('Ordem cancelada com sucesso!', 'sucesso');

      await carregarOrdens();
      await verificarIPO();
      await atualizarSaldoDoUsuario();
    } catch (error) {
      console.error('Erro ao cancelar ordem:', error);

      const msg =
        error?.response?.data?.erro ||
        error?.response?.data?.message ||
        'Não foi possí­vel cancelar a ordem. Tente novamente.';

      adicionarToast(`${msg}`, 'erro');
    }
  }

  

  const cotasDisponiveisVenda = useMemo(() => {
  const carteira = Array.isArray(usuario?.carteira)
    ? usuario.carteira
    : [];

  const possiveisIdsClube = [
    clube?.id,
    clube?.legacyId,
    clube?.clubeId,
    clube?._id,
  ]
    .filter((v) => v !== undefined && v !== null)
    .map((v) => String(v));

  const ativo = carteira.find((a) => {
    const possiveisIdsAtivo = [
      a?.clubeId,
      a?.clubeLegacyId,
      a?.idClube,
      a?.clube?.id,
      a?.clube?.legacyId,
      a?.clube?._id,
    ]
      .filter((v) => v !== undefined && v !== null)
      .map((v) => String(v));

    return possiveisIdsAtivo.some((id) =>
      possiveisIdsClube.includes(id)
    );
  });

  if (ativo) {
    return Number(
      ativo.quantidade ?? ativo.cotas ?? 0
    );
  }

  const nomeClubeAtual = String(
    clube?.nome || ''
  )
    .trim()
    .toLowerCase();

  const ativoPorNome = carteira.find((a) => {
    const nomes = [
      a?.nomeClube,
      a?.clubeNome,
      a?.nome,
      a?.clube?.nome,
    ]
      .filter(Boolean)
      .map((v) =>
        String(v)
          .trim()
          .toLowerCase()
      );

    return nomes.includes(nomeClubeAtual);
  });

  return Number(
    ativoPorNome?.quantidade ||
      ativoPorNome?.cotas ||
      0
  );
}, [usuario, clube]);

useEffect(() => {
  if (!isOpen) {
    modoInicialAplicadoRef.current = null;
    return;
  }

  const chaveClube = String(clubeId || '');
  if (!chaveClube || modoInicialAplicadoRef.current === chaveClube) return;

  // Quando existe token, aguarda a carteira do usuário antes de decidir a
  // aba inicial. Depois de aplicada, a escolha manual não é sobrescrita.
  if (token && verificarTokenValido(token) && !usuario) return;

  setModo(Number(cotasDisponiveisVenda || 0) > 0 ? 'venda' : 'compra');
  modoInicialAplicadoRef.current = chaveClube;
}, [isOpen, clubeId, token, usuario, cotasDisponiveisVenda]);

const mercadoSecundarioBloqueado =
  ligaFechada || (ipoEncerrado &&
  Boolean(usuario) &&
  (
    limiteOrdens.carregando ||
    !limiteOrdens.temporadaAtiva ||
    !limiteOrdens.mercadoAberto ||
    (
      limiteOrdens.plano === 'lite' &&
      limiteOrdens.limiteAtingido
    )
  ));

if (!isOpen || !clube) return null;

return (
  <Overlay onClick={onClose}>
      <ModalContainer onClick={(e) => e.stopPropagation()}>
        <FecharX onClick={onClose}>x</FecharX>

        <ModalContentInner>
          <Header>
            <ClubBadge clube={clube.nome} size={30} />
            <div>
              <h2>{clube.nome}</h2>
              <PrecoAtualTexto>
                {precoMercado > 0 ? `Preço atual: T$ ${precoMercado.toFixed(2)}` : ''}
              </PrecoAtualTexto>
            </div>
          </Header>

          {mostrarRisco && (
            <PoliticaRiscoModal
              exigirAceite
              onAceitar={async () => {
                localStorage.setItem('leuPoliticaRisco', 'true');
                await registrarAceite('politica_risco', '1.0');
                setMostrarRisco(false);
              }}
            />
          )}

          {!usuario && (
            <div style={{ textAlign: 'center', margin: '1rem 0' }}>
              <BotaoLogin onClick={() => (window.location.href = '/login')}>
                Ir para Login
              </BotaoLogin>
            </div>
          )}

          <Acoes>
            <Aba $ativa={modo === 'compra'} onClick={() => setModo('compra')}>
              Compra
            </Aba>
            <Aba $ativa={modo === 'venda'} onClick={() => { setModo('venda'); atualizarSaldoDoUsuario(); }}>
              Venda
            </Aba>
          </Acoes>

          {!ipoEncerrado && (
            <IpoInfo>
              <strong>Oferta inicial em andamento</strong>
              <span>
                {modo === 'venda'
                  ? 'Durante o IPO, você vende imediatamente ao sistema pelo preço atual da posição do clube, sem taxas. O resultado pode ser lucro ou prejuízo.'
                  : 'No IPO, compra e venda seguem o preço atual da posição do clube na tabela. Sem taxas e sem livro de ofertas nesta fase.'}
              </span>
            </IpoInfo>
          )}

           {ipoEncerrado && usuario && (
  <FranquiaCard
    $alerta={
      limiteOrdens.plano === 'lite' &&
      Number(limiteOrdens.restantes) <= 3
    }
    $bloqueado={
      limiteOrdens.plano === 'lite' &&
      limiteOrdens.limiteAtingido
    }
  >
    <FranquiaTopo>
      <span>
        Plano{' '}
        {limiteOrdens.plano === 'premium'
          ? 'Premium'
          : 'Lite'}
      </span>

      <small>
  {limiteOrdens.mercadoAberto
    ? 'Mercado aberto'
    : 'Mercado fechado'}
</small>
    </FranquiaTopo>

    {limiteOrdens.carregando ? (
      <FranquiaTexto>
        Consultando franquia de ordens...
      </FranquiaTexto>
    ) : limiteOrdens.erro ? (
      <FranquiaTexto>
        {limiteOrdens.erro}
      </FranquiaTexto>
    ) : !limiteOrdens.temporadaAtiva ? (
      <FranquiaTexto>
        Nenhuma temporada está ativa. Novas ordens serão liberadas quando a
        próxima competição for publicada.
      </FranquiaTexto>
    ) : !limiteOrdens.mercadoAberto ? (
  <FranquiaTexto>
    O mercado está temporariamente fechado para novas ordens.
  </FranquiaTexto>
) : limiteOrdens.ordensIlimitadas ? (
  <FranquiaTexto>
    Ordens ilimitadas durante a temporada.
  </FranquiaTexto>
    ) : (
      <>
        <FranquiaTexto>
          <strong>
            {Number(
              limiteOrdens.restantes || 0
            )}
          </strong>{' '}
          de{' '}
          {Number(
            limiteOrdens.limite || 15
          )}{' '}
          ordens restantes
        </FranquiaTexto>

        <BarraFranquia>
          <BarraFranquiaPreenchimento
            $percentual={Math.min(
              100,
              Math.max(
                0,
                (
                  Number(
                    limiteOrdens.utilizadas || 0
                  ) /
                  Math.max(
                    1,
                    Number(
                      limiteOrdens.limite || 15
                    )
                  )
                ) * 100
              )
            )}
          />
        </BarraFranquia>

        {Number(
          limiteOrdens.restantes || 0
        ) <= 3 &&
          Number(
            limiteOrdens.restantes || 0
          ) > 0 && (
            <FranquiaAviso>
  Você está perto do limite semanal.
</FranquiaAviso>
          )}

        {limiteOrdens.limiteAtingido && (
          <FranquiaAviso>
  Limite semanal atingido.
  {limiteOrdens.periodo?.renovaEm && (
    <>
      {' '}
      A quota será renovada em{' '}
      {new Date(
        limiteOrdens.periodo.renovaEm
      ).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })}.
    </>
  )}
</FranquiaAviso>
        )}
      </>
    )}
  </FranquiaCard>
)}

          <Bloco>
            <label>{ipoEncerrado ? 'Preço da ordem (T$)' : 'Preço atual da classificação (T$)'}</label>
            <InputNumero
              type="text"
              inputMode="decimal"
              value={ipoEncerrado ? precoInput : Number(precoAtual || 0).toFixed(2)}
              readOnly={!ipoEncerrado}
              onChange={(e) => {
                if (!ipoEncerrado) return;

                const raw = e.target.value.replace(',', '.');
                if (!/^\d*(\.\d{0,2})?$/.test(raw)) return;

                setPrecoInput(raw);

                if (raw === '') {
                  setPrecoAtual(0);
                  return;
                }

                const v = Number(raw);
                setPrecoAtual(Number.isFinite(v) ? v : 0);
              }}
              onBlur={() => {
                if (!ipoEncerrado) return;
                if (precoInput === '') return;

                const v = Number(precoInput || 0);
                setPrecoAtual(Number.isFinite(v) ? v : 0);
              }}
            />

            {ipoEncerrado && (
              <>
                <TickMeta>
                  <span>Tick mínimo</span>
                  <strong>T$ {TICK_SIZE.toFixed(2)}</strong>
                </TickMeta>

                {!tickValidation.valid && (
                  <TickAlert>
                    <div>
                      <strong>Preço inválido para o mercado</strong>
                      <span>{tickValidation.message}</span>
                    </div>

                    {tickValidation.suggested != null && (
                      <BotaoCorrigirTick type="button" onClick={aplicarPrecoSugerido}>
                        Corrigir para T$ {Number(tickValidation.suggested).toFixed(2)}
                      </BotaoCorrigirTick>
                    )}
                  </TickAlert>
                )}

                {tickValidation.valid && Number(precoAtual || 0) > 0 && (
                  <TickOk>Preço válido para o tick do mercado.</TickOk>
                )}
              </>
            )}
          </Bloco>

          <Bloco>
            <label>Quantidade</label>
            <InputNumero
              type="number"
              min="1"
              step="1"
              max={
                !ipoEncerrado && modo === 'compra'
                  ? cotasIPO
                  : modo === 'venda'
                  ? cotasDisponiveisVenda
                  : undefined
              }
              value={quantidade || ''}
              onChange={(e) => {
                const valor = parseInt(e.target.value, 10);
                setQuantidade(isNaN(valor) ? 0 : valor);
              }}
            />
          </Bloco>

          <Bloco>
            <LinhaInfo>
              <span>
                {!ipoEncerrado
                  ? modo === 'compra'
                    ? 'Valor da compra'
                    : 'Valor da venda ao sistema'
                  : 'Valor da ordem'}
              </span>
              <strong>T$ {precoTotal}</strong>
            </LinhaInfo>

            <LinhaInfo>
              <span>{ipoEncerrado ? 'Preço de mercado' : 'Preço atual da tabela'}</span>
              <span>T$ {Number(precoMercado).toFixed(2)}</span>
            </LinhaInfo>

            {!ipoEncerrado && (
              <LinhaInfo>
                <span>Taxas</span>
                <span>T$ 0,00</span>
              </LinhaInfo>
            )}

            {ipoEncerrado && (
              <>
  
                <LinhaInfo>
                  <span>Você será</span>
                  <span>
                    {tradeRolePreview.role} taxa{' '}
                    {(tradeRolePreview.feePct * 100).toFixed(2)}%
                  </span>
                </LinhaInfo>

                <LinhaInfo>
                  <span>Taxa estimada</span>
                  <span>T$ {tradeRolePreview.feeValue.toFixed(2)}</span>
                </LinhaInfo>

                
              </>
            )}

            {modo === 'compra' ? (
              <LinhaInfo>
                <span>Poder de Compra</span>
                <span>
                  {usuario
                    ? `T$ ${Number(poderCompra || 0).toFixed(2)}`
                    : 'Faça login para visualizar'}
                </span>
              </LinhaInfo>
            ) : (
              <LinhaInfo>
                <span>Unidades disponíveis</span>
                <span>
                  {cotasDisponiveisVenda}
                </span>
              </LinhaInfo>
            )}

            {!ipoEncerrado && (
              <LinhaInfo>
                <span>Cotas disponíveis no IPO</span>
                <span>{cotasIPO}</span>
              </LinhaInfo>
            )}
          </Bloco>

          {resultadoIpo && (
            <ResultadoIpo>
              <ResultadoCabecalho>
                <ResultadoIcone $status="executada">✓</ResultadoIcone>
                <div>
                  <ResultadoTitulo>{resultadoIpo.titulo}</ResultadoTitulo>
                  <ResultadoSubtitulo>
                    Execução imediata pelo sistema
                  </ResultadoSubtitulo>
                </div>
              </ResultadoCabecalho>

              <ResultadoGrade>
                <ResultadoItem>
                  <span>Quantidade</span>
                  <strong>{resultadoIpo.quantidade}</strong>
                </ResultadoItem>
                <ResultadoItem>
                  <span>Preço unitário</span>
                  <strong>T$ {resultadoIpo.precoUnitario.toFixed(2)}</strong>
                </ResultadoItem>
                <ResultadoItem>
                  <span>Taxa</span>
                  <strong>T$ {resultadoIpo.taxa.toFixed(2)}</strong>
                </ResultadoItem>
                <ResultadoItem>
                  <span>{resultadoIpo.tipo === 'devolucao' ? 'Valor creditado' : 'Valor debitado'}</span>
                  <strong>T$ {resultadoIpo.valorLiquido.toFixed(2)}</strong>
                </ResultadoItem>
              </ResultadoGrade>
            </ResultadoIpo>
          )}

          {resultadoOrdem && (
  <ResultadoOrdem
    $status={resultadoOrdem.status}
  >
    <ResultadoCabecalho>
      <ResultadoIcone
        $status={resultadoOrdem.status}
      >
        {resultadoOrdem.status === 'executada'
          ? '✓'
          : resultadoOrdem.status === 'parcial'
          ? '◐'
          : '↗'}
      </ResultadoIcone>

      <div>
        <ResultadoTitulo>
          {resultadoOrdem.titulo}
        </ResultadoTitulo>

        <ResultadoSubtitulo>
          {resultadoOrdem.tipo === 'compra'
            ? 'Compra'
            : 'Venda'}{' '}
          de {resultadoOrdem.clube}
        </ResultadoSubtitulo>
      </div>
    </ResultadoCabecalho>

    <ResultadoGrade>
      <ResultadoItem>
        <span>Quantidade solicitada</span>
        <strong>
          {resultadoOrdem.quantidadeOriginal}
        </strong>
      </ResultadoItem>

      <ResultadoItem>
        <span>Quantidade executada</span>
        <strong>
          {resultadoOrdem.quantidadeExecutada}
        </strong>
      </ResultadoItem>

      <ResultadoItem>
        <span>Quantidade restante</span>
        <strong>
          {resultadoOrdem.quantidadeRestante}
        </strong>
      </ResultadoItem>

      <ResultadoItem>
        <span>Preço limite</span>
        <strong>
          T${' '}
          {resultadoOrdem.precoLimite.toLocaleString(
            'pt-BR',
            {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }
          )}
        </strong>
      </ResultadoItem>

      {resultadoOrdem.precoMedioExecutado !== null && (
        <ResultadoItem>
          <span>Preço médio executado</span>
          <strong>
            T${' '}
            {resultadoOrdem.precoMedioExecutado.toLocaleString(
              'pt-BR',
              {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }
            )}
          </strong>
        </ResultadoItem>
      )}

      {resultadoOrdem.quantidadeExecutada > 0 && (
        <ResultadoItem>
          <span>Taxa cobrada</span>
          <strong>
            T${' '}
            {resultadoOrdem.taxaTotal.toLocaleString(
              'pt-BR',
              {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }
            )}
          </strong>
        </ResultadoItem>
      )}
    </ResultadoGrade>

    <ResultadoFranquia>
      {resultadoOrdem.ordensIlimitadas
        ? 'Plano Premium: ordens ilimitadas.'
        : resultadoOrdem.ordensRestantes !== null
        ? `Você ainda pode enviar ${resultadoOrdem.ordensRestantes} ${
            Number(resultadoOrdem.ordensRestantes) === 1
              ? 'ordem'
              : 'ordens'
          } nesta semana.`
        : 'Consulte sua franquia semanal antes da próxima ordem.'}
    </ResultadoFranquia>

    {resultadoOrdem.quantidadeRestante > 0 && (
      <ResultadoAviso>
        A quantidade restante continua aberta no livro
        de ofertas e pode ser executada posteriormente.
      </ResultadoAviso>
    )}
  </ResultadoOrdem>
)}

{mensagem && <Mensagem>{mensagem}</Mensagem>}

<BotaoComprar
            onClick={enviarOrdem}
            disabled={
  ligaFechada ||
  (ipoEncerrado && !tickValidation.valid) ||
  mercadoSecundarioBloqueado ||
  carregando ||
  precoAtual <= 0 ||
  quantidade < 1 ||
  !usuario ||
  (
    modo === 'venda' &&
    quantidade > cotasDisponiveisVenda
  )
}
          >
            {!usuario
  ? 'Faça login para negociar'
  : carregando
  ? 'Enviando...'
  : ligaFechada
  ? 'Mercado fechado'
  : ipoEncerrado &&
    limiteOrdens.carregando
  ? 'Verificando franquia...'
  : ipoEncerrado &&
    !limiteOrdens.temporadaAtiva
  ? 'Temporada indisponível'
  : ipoEncerrado &&
  !limiteOrdens.mercadoAberto
? 'Mercado fechado'
  : ipoEncerrado &&
    limiteOrdens.plano === 'lite' &&
    limiteOrdens.limiteAtingido
  ? 'Limite de ordens atingido'
  : modo === 'compra'
  ? 'Comprar'
  : !ipoEncerrado
  ? 'Vender ao sistema'
  : 'Vender'}
          </BotaoComprar>

          {ipoEncerrado ? (
            <LivroDeOrdens
              clubeId={clube.id}
              lado={modo}
              onSelecionarPreco={handleSelecionarPreco}
              onResumoChange={setResumoBook}
              ordensCompra={ordensCompra}
              ordensVenda={ordensVenda}
              meuId={meuId}
              onCancelar={cancelarMinhaOrdem}
            />
          ) : (
            <IpoBookNotice>
              O livro de ofertas e o tick de T$ {TICK_SIZE.toFixed(2)} serão
              ativados quando o IPO for encerrado.
            </IpoBookNotice>
          )}
        </ModalContentInner>
      </ModalContainer>
    </Overlay>
  );
}

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  min-height: 100vh;
  min-height: 100dvh;
  background: rgba(2, 6, 23, 0.76);
  z-index: 999;
  display: flex;
  justify-content: flex-end;

  @media (max-width: 900px) {
    justify-content: center;
    align-items: stretch;
    height: 100dvh;
  }
`;

const ModalContainer = styled.div`
  background-color: #0f172a;
  padding: 18px;
  width: 380px;
  max-width: 100%;
  height: 100%;
  position: relative;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;

  @media (max-width: 900px) {
    width: 100vw;
    height: 100vh;
    height: 100dvh;
    min-height: 0;
    padding:
      max(14px, env(safe-area-inset-top))
      max(12px, env(safe-area-inset-right))
      max(14px, env(safe-area-inset-bottom))
      max(12px, env(safe-area-inset-left));
    border-radius: 0;
  }
`;

const ModalContentInner = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 6px;
  padding-bottom: 18px;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: #1e293b;
  }

  &::-webkit-scrollbar-thumb {
    background-color: #475569;
    border-radius: 8px;
  }
`;

const FecharX = styled.button`
  position: absolute;
  top: max(8px, env(safe-area-inset-top));
  right: max(8px, env(safe-area-inset-right));
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  font-size: 1.5rem;
  color: #94a3b8;
  background: none;
  border: none;
  cursor: pointer;
  z-index: 3;

  &:hover {
    color: white;
  }
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding-right: 48px;

  h2 {
    font-size: 1.12rem;
    color: white;
    margin: 0;
  }
`;

const PrecoAtualTexto = styled.div`
  font-weight: bold;
  color: #ffffff;
  font-size: 0.9rem;
  margin-top: 0.2rem;
`;

const Acoes = styled.div`
  display: flex;
  margin-top: 1.25rem;
`;

const Aba = styled.button`
  flex: 1;
  min-height: 48px;
  text-align: center;
  padding: 0.8rem;
  background-color: ${({ $ativa }) => ($ativa ? '#1d4ed8' : '#1e293b')};
  color: white;
  font-weight: 700;
  cursor: pointer;
  border: none;

  &:first-child {
    border-right: 1px solid #334155;
  }
`;

const IpoInfo = styled.div`
  margin-top: 1rem;
  padding: 0.85rem;
  border: 1px solid rgba(250, 204, 21, 0.28);
  border-radius: 12px;
  background: linear-gradient(
    180deg,
    rgba(250, 204, 21, 0.11),
    rgba(250, 204, 21, 0.05)
  );

  strong,
  span {
    display: block;
  }

  strong {
    color: #fde68a;
    font-size: 0.86rem;
  }

  span {
    margin-top: 0.3rem;
    color: #cbd5e1;
    font-size: 0.8rem;
    line-height: 1.45;
  }
`;

const Bloco = styled.div`
  margin-top: 1.2rem;

  label {
    color: #cbd5e1;
    display: block;
    margin-bottom: 0.35rem;
    font-size: 0.92rem;
  }
`;

const InputNumero = styled.input`
  width: 100%;
  min-height: 48px;
  padding: 0.75rem;
  background-color: #1e293b;
  border: none;
  color: white;
  font-size: 1rem;
  border-radius: 10px;
  box-sizing: border-box;
`;

const LinhaInfo = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 0.42rem 0;
  color: #cbd5e1;
  font-size: 0.93rem;

  > :last-child {
    min-width: 0;
    text-align: right;
    overflow-wrap: anywhere;
  }

  @media (max-width: 380px) {
    align-items: flex-start;
    font-size: 0.86rem;
  }
`;

const FranquiaCard = styled.div`
  margin-top: 1rem;
  padding: 0.85rem;
  border-radius: 12px;

  background: ${({ $bloqueado, $alerta }) =>
    $bloqueado
      ? 'rgba(239, 68, 68, 0.12)'
      : $alerta
      ? 'rgba(245, 158, 11, 0.12)'
      : 'rgba(37, 99, 235, 0.1)'};

  border: 1px solid
    ${({ $bloqueado, $alerta }) =>
      $bloqueado
        ? 'rgba(239, 68, 68, 0.3)'
        : $alerta
        ? 'rgba(245, 158, 11, 0.3)'
        : 'rgba(59, 130, 246, 0.25)'};
`;

const FranquiaTopo = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: #e2e8f0;
  font-size: 0.82rem;
  font-weight: 800;

  small {
    color: #94a3b8;
    font-size: 0.76rem;
    font-weight: 700;
  }
`;

const FranquiaTexto = styled.div`
  margin-top: 0.45rem;
  color: #cbd5e1;
  font-size: 0.84rem;
  line-height: 1.4;

  strong {
    color: #ffffff;
    font-size: 1rem;
  }
`;

const BarraFranquia = styled.div`
  width: 100%;
  height: 6px;
  margin-top: 0.65rem;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(148, 163, 184, 0.18);
`;

const BarraFranquiaPreenchimento = styled.div`
  width: ${({ $percentual }) =>
    `${$percentual}%`};

  height: 100%;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    #2563eb,
    #60a5fa
  );
  transition: width 0.2s ease;
`;

const FranquiaAviso = styled.div`
  margin-top: 0.55rem;
  color: #fbbf24;
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1.35;
`;

const ResultadoOrdem = styled.section`
  margin-top: 1rem;
  padding: 14px;
  border-radius: 14px;

  border: 1px solid
    ${({ $status }) =>
      $status === 'executada'
        ? 'rgba(34, 197, 94, 0.3)'
        : $status === 'parcial'
        ? 'rgba(250, 204, 21, 0.3)'
        : 'rgba(59, 130, 246, 0.3)'};

  background:
    ${({ $status }) =>
      $status === 'executada'
        ? 'rgba(34, 197, 94, 0.08)'
        : $status === 'parcial'
        ? 'rgba(250, 204, 21, 0.07)'
        : 'rgba(59, 130, 246, 0.08)'};
`;

const ResultadoIpo = styled(ResultadoOrdem)`
  border-color: rgba(34, 197, 94, 0.3);
  background: rgba(34, 197, 94, 0.08);
`;

const ResultadoCabecalho = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const ResultadoIcone = styled.div`
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  border-radius: 999px;
  display: grid;
  place-items: center;

  background:
    ${({ $status }) =>
      $status === 'executada'
        ? 'rgba(34, 197, 94, 0.18)'
        : $status === 'parcial'
        ? 'rgba(250, 204, 21, 0.18)'
        : 'rgba(59, 130, 246, 0.18)'};

  color:
    ${({ $status }) =>
      $status === 'executada'
        ? '#86efac'
        : $status === 'parcial'
        ? '#fde68a'
        : '#93c5fd'};

  font-size: 1rem;
  font-weight: 900;
`;

const ResultadoTitulo = styled.strong`
  display: block;
  color: #f8fafc;
  font-size: 0.9rem;
`;

const ResultadoSubtitulo = styled.span`
  display: block;
  margin-top: 2px;
  color: #94a3b8;
  font-size: 0.75rem;
`;

const ResultadoGrade = styled.div`
  margin-top: 13px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
`;

const ResultadoItem = styled.div`
  min-width: 0;
  padding: 9px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.52);

  span {
    display: block;
    margin-bottom: 4px;
    color: #94a3b8;
    font-size: 0.66rem;
    line-height: 1.25;
  }

  strong {
    display: block;
    overflow: hidden;
    color: #f8fafc;
    font-size: 0.79rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 640px) {
    span {
      font-size: 0.75rem;
    }

    strong {
      font-size: 0.86rem;
    }
  }
`;

const ResultadoFranquia = styled.div`
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(148, 163, 184, 0.13);
  color: #bfdbfe;
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1.4;

  @media (max-width: 640px) {
    font-size: 0.8rem;
  }
`;

const ResultadoAviso = styled.div`
  margin-top: 8px;
  color: #fde68a;
  font-size: 0.72rem;
  line-height: 1.4;

  @media (max-width: 640px) {
    font-size: 0.78rem;
  }
`;

const Mensagem = styled.p`
  color: #22c55e;
  margin-top: 1rem;
  font-weight: 600;
  white-space: pre-wrap;
`;

const BotaoComprar = styled.button`
  margin-top: 1.3rem;
  width: 100%;
  min-height: 48px;
  background-color: #16a34a;
  color: white;
  border: none;
  padding: 0.9rem;
  font-size: 1rem;
  font-weight: bold;
  border-radius: 10px;
  cursor: pointer;

  &:hover {
    background-color: #15803d;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

const IpoBookNotice = styled.div`
  margin-top: 1rem;
  padding: 0.8rem;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 10px;
  background: rgba(30, 41, 59, 0.55);
  color: #94a3b8;
  font-size: 0.78rem;
  line-height: 1.45;
  text-align: center;
`;

const BotaoLogin = styled.button`
  min-height: 44px;
  background-color: #2563eb;
  color: white;
  border: none;
  padding: 0.7rem 1rem;
  border-radius: 10px;
  cursor: pointer;
`;

const TickMeta = styled.div`
  margin-top: 0.55rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #94a3b8;
  font-size: 0.8rem;
  padding: 0.55rem 0.7rem;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(148, 163, 184, 0.1);

  strong {
    color: #e5e7eb;
    font-weight: 800;
  }
`;

const TickAlert = styled.div`
  margin-top: 0.6rem;
  display: flex;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
  border-radius: 12px;
  padding: 0.75rem;
  background: linear-gradient(
    180deg,
    rgba(239, 68, 68, 0.16),
    rgba(239, 68, 68, 0.08)
  );
  border: 1px solid rgba(239, 68, 68, 0.28);

  div {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  strong {
    color: #fecaca;
    font-size: 0.84rem;
  }

  span {
    color: #fca5a5;
    font-size: 0.78rem;
    line-height: 1.35;
  }

  @media (max-width: 640px) {
    flex-direction: column;
    align-items: stretch;
  }
`;

const TickOk = styled.div`
  margin-top: 0.6rem;
  border-radius: 10px;
  padding: 0.65rem 0.75rem;
  background: linear-gradient(
    180deg,
    rgba(22, 163, 74, 0.14),
    rgba(22, 163, 74, 0.06)
  );
  border: 1px solid rgba(22, 163, 74, 0.24);
  color: #bbf7d0;
  font-size: 0.8rem;
  font-weight: 700;
`;

const BotaoCorrigirTick = styled.button`
  min-height: 44px;
  border: none;
  border-radius: 10px;
  padding: 0.7rem 0.8rem;
  cursor: pointer;
  background: linear-gradient(180deg, #2563eb, #1d4ed8);
  color: white;
  font-weight: 800;
  white-space: nowrap;
`;

const BotaoMelhorarPreco = styled.button`
  margin-top: 0.75rem;
  width: 100%;
  min-height: 44px;
  padding: 0.7rem 0.75rem;
  border-radius: 8px;
  border: 1px solid rgba(59, 130, 246, 0.35);
  background: rgba(59, 130, 246, 0.08);
  color: #e5e7eb;
  font-weight: 700;
  cursor: pointer;
`;
