import SeoTradeSports from '../components/SeoTradeSports';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import styled from 'styled-components';
import axios from 'axios';
import NegociacaoModal from '../components/NegociacaoModal';
import ClubBadge, { LeagueBadge } from '../components/ClubBadge';
import EstadoInterface from '../components/EstadoInterface';
import AdSenseBanner from '../components/advertising/AdSenseBanner';
import mercados from '../Data/mercados';

const API_BASE = process.env.NEXT_PUBLIC_API_URL;
function calcularPrecoLiquidacao(posicao, totalParticipantes) {
  const precoBase = 5;
  const valor = precoBase * Math.pow(1.05, totalParticipantes - posicao);
  const centavos = Math.round(valor * 100);
  return Number(((Math.floor(centavos / 5) * 5) / 100).toFixed(2));
}

export function MercadoCompeticao({ mercado }) {
  const LIGA_ID = mercado.id;
  const LIGA_NOME = mercado.nome;
  const router = useRouter();
  const [clubes, setClubes] = useState([]);
  const [watchlist, setWatchlist] = useState({ clubes: [], ligas: [] });
  const [modalAberto, setModalAberto] = useState(false);
  const [clubeSelecionado, setClubeSelecionado] = useState(null);
  const [filtro, setFiltro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [mercadoFechado, setMercadoFechado] = useState(false);

  const token =
    typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  const abrirModal = (clube) => {
    setClubeSelecionado(clube);
    setModalAberto(true);
  };

  const fecharModal = () => {
    setModalAberto(false);
    setClubeSelecionado(null);
  };

  const abrirPaginaClube = (clubeId) => {
  if (!clubeId) {
    console.error('ID do clube ausente ao tentar abrir página.');
    return;
  }

  router.push(`/clube/${clubeId}`);
};

  const normalizeName = (txt = '') =>
    String(txt)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase()
      .trim();

  const aliases = {
    gremio: 'gremio',
    saopaulo: 'saopaulo',
    cuiaba: 'cuiaba',
    goias: 'goias',
    athleticoparanaense: 'atleticoparanaense',
    athletico: 'atleticoparanaense',
    fortaleza: 'fortalezaec',
    fortalezaec: 'fortalezaec',
    americamg: 'americamineiro',
    americamineiro: 'americamineiro',
    atleticomg: 'atleticomg',
    chapeconse: 'chapecoense-sc',
  };

  const canon = (nome = '') => {
    const base = normalizeName(nome);
    return aliases[base] || base;
  };

  const carregarWatchlist = async () => {
    try {
      if (!token || !API_BASE) return;
      const { data } = await axios.get(`${API_BASE}/watchlist`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setWatchlist(data?.watchlist || { clubes: [], ligas: [] });
    } catch (e) {
      console.warn('[WATCHLIST] erro ao carregar:', e?.response?.data || e.message);
    }
  };

  const toggleLiga = async () => {
    try {
      if (!token) {
        window.location.href = '/login';
        return;
      }

      const { data } = await axios.post(
        `${API_BASE}/watchlist/toggle`,
        { entityType: 'liga', entityId: LIGA_ID, nome: LIGA_NOME },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setWatchlist(data?.watchlist || { clubes: [], ligas: [] });
      window.dispatchEvent(new Event('watchlist-updated'));
      window.dispatchEvent(new Event('notifications-updated'));
    } catch (e) {
      console.warn('[WATCHLIST] erro ao favoritar liga:', e?.response?.data || e.message);
    }
  };

  const toggleClube = async (clube) => {
  try {
    if (!token) {
      window.location.href = '/login';
      return;
    }

    const clubeId = clube.id ?? clube.legacyId;

    if (!clubeId) {
      console.error('Clube sem ID para favoritar:', clube);
      return;
    }

    const { data } = await axios.post(
      `${API_BASE}/watchlist/toggle`,
      {
        entityType: 'clube',
        entityId: clubeId,
        nome: clube.nome,
        ligaId: LIGA_ID,
        ligaNome: LIGA_NOME,
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    setWatchlist(data?.watchlist || { clubes: [], ligas: [] });

    window.dispatchEvent(new Event('watchlist-updated'));
    window.dispatchEvent(new Event('notifications-updated'));
  } catch (e) {
    console.warn('[WATCHLIST] erro ao favoritar clube:', e?.response?.data || e.message);
  }
};

  useEffect(() => {
    const termoInicial =
      typeof router.query.search === 'string' ? router.query.search : '';
    if (termoInicial) setFiltro(termoInicial);
  }, [router.query.search]);

  const fetchDados = async () => {
    try {
      setCarregando(true);
      setErro('');

      if (!API_BASE) {
        throw new Error('Endereço da API não configurado.');
      }

      const resTabela = await axios.get(`${API_BASE}${mercado.endpoint}`);

      const clubesApi = Array.isArray(resTabela?.data?.data)
        ? resTabela.data.data
        : [];
      setClubes(clubesApi);
    } catch (e) {
      console.error('Erro ao buscar dados:', e);
      setClubes([]);
      setErro(`Não foi possível carregar os ${mercado.entidade === 'time' ? 'times' : 'clubes'} deste mercado.`);
    } finally {
      setCarregando(false);
    }
  };

  const fetchEstadoMercado = async () => {
    if (!API_BASE) return;
    try {
      const { data } = await axios.get(`${API_BASE}/api/market-status`);
      const fechados = Array.isArray(data?.mercados) ? data.mercados : [];
      setMercadoFechado(fechados.some((item) => item.ligaId === LIGA_ID && item.fechado));
    } catch (e) {
      console.warn('[MARKET STATUS] erro ao consultar:', e?.message);
    }
  };

  useEffect(() => {
    fetchDados();
    fetchEstadoMercado();
    carregarWatchlist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const favoritosClubes = useMemo(
    () => new Set((watchlist?.clubes || []).map((c) => String(c.id))),
    [watchlist]
  );

  const favoritasLigas = useMemo(
    () => new Set((watchlist?.ligas || []).map((l) => String(l.id))),
    [watchlist]
  );

  const clubesFiltrados = useMemo(() => {
    if (!filtro.trim()) return clubes;
    const termo = canon(filtro);
    return clubes.filter((clube) => canon(clube.nome).includes(termo));
  }, [clubes, filtro]);

  const limparBusca = () => {
    setFiltro('');
    router.replace(mercado.rota, undefined, { shallow: true });
  };

  return (
    <Container>
      <SeoTradeSports title={`${LIGA_NOME} — Classificação e Cotas Virtuais | TradeSports`} description={`Acompanhe a classificação da ${LIGA_NOME}, preços de referência, cotas virtuais e informações do mercado simulado na TradeSports.`} path={mercado.rota} />
      <Hero>
        <LeagueMain>
          <LeagueMark>
          <LeagueBadge liga={mercado.badge} size={38} />
          </LeagueMark>

          <LeagueCopy>
            <Titulo>{LIGA_NOME}</Titulo>
            <LeagueMeta>
              <span>{mercado.participantes} {mercado.entidade === 'time' ? 'times' : 'clubes'}</span>
              <span>•</span>
              <span>IPO + secundário</span>
            </LeagueMeta>
          </LeagueCopy>
        </LeagueMain>

        <LeagueActions>
          <LeagueStar
            type="button"
            onClick={toggleLiga}
            $active={favoritasLigas.has(LIGA_ID)}
            title="Favoritar liga"
          >
            {favoritasLigas.has(LIGA_ID) ? '★' : '☆'}
          </LeagueStar>
        </LeagueActions>
      </Hero>

      {mercadoFechado && <MarketClosedNotice>Mercado fechado temporariamente pelo administrador.</MarketClosedNotice>}

      <MarketAdBanner slotName="market" />

      <SearchInline>
        <SearchInlineIcon aria-hidden="true">⌕</SearchInlineIcon>
        <SearchInlineInput
          type="search"
          value={filtro}
          placeholder={`Buscar ${mercado.entidade} neste mercado`}
          onChange={(e) => setFiltro(e.target.value)}
          aria-label={`Buscar ${mercado.entidade} em ${LIGA_NOME}`}
        />
      </SearchInline>

      
      {modalAberto && clubeSelecionado && (
        <NegociacaoModal
          isOpen={modalAberto}
          onClose={fecharModal}
          clube={clubeSelecionado}
          modoInicial="compra"
        />
      )}

      {carregando ? (
        <EstadoInterface
          variante="carregando"
          titulo="Carregando o mercado"
          descricao={`Estamos reunindo ${mercado.entidade === 'time' ? 'times' : 'clubes'}, classificação e preços atuais em T$.`}
        />
      ) : erro ? (
        <EstadoInterface
          variante="erro"
          titulo="Não foi possível carregar este mercado"
          descricao={erro}
          acao="Tentar novamente"
          onAcao={fetchDados}
          acaoSecundaria="Voltar ao dashboard"
          hrefAcaoSecundaria="/dashboard"
        />
      ) : clubesFiltrados.length === 0 ? (
        filtro.trim() ? (
          <EstadoInterface
            variante="busca"
            titulo={`Nenhum ${mercado.entidade} corresponde à busca`}
            descricao={`Não encontramos resultados para “${filtro.trim()}” neste mercado.`}
            acao="Limpar busca"
            onAcao={limparBusca}
          />
        ) : (
          <EstadoInterface
            variante="indisponivel"
            titulo={`Nenhum ${mercado.entidade} está disponível neste mercado`}
            descricao={`A competição está cadastrada, mas ainda não possui ${mercado.entidade === 'time' ? 'times publicados' : 'clubes publicados'} para negociação.`}
            acao="Tentar novamente"
            onAcao={fetchDados}
            acaoSecundaria="Voltar ao dashboard"
            hrefAcaoSecundaria="/dashboard"
          />
        )
      ) : (
        <>
      <DesktopOnly>
        <TableSurface>
          <TableWrap>
            <Tabela>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{mercado.entidade === 'time' ? 'Time' : 'Clube'}</th>
                  <th>T$ p/ posição</th>
                  <th>Mercado</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>

              <tbody>
                {clubesFiltrados.map((clube) => {
                  const valorMercado = clube.precoAtual ?? clube.preco ?? 0;
                  const liquidation = calcularPrecoLiquidacao(clube.posicao, mercado.participantes);
                  const inWatchlist = favoritosClubes.has(String(clube.id));

                  return (
                    <tr key={clube.id}>
                      <td>
                        <Pos>{clube.posicao}</Pos>
                      </td>

                      <td>
                        <ClubeCell>
                          <StarButton
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleClube(clube);
                            }}
                            $active={inWatchlist}
                            title="Favoritar clube"
                          >
                            {inWatchlist ? '★' : '☆'}
                          </StarButton>

                          <ClubNameWrap onClick={() => abrirPaginaClube(clube.id)}>
                            <EscudoWrapDesktop>
                              <ClubBadge clube={clube.nome} escudo={clube.escudo} size={28} />
                            </EscudoWrapDesktop>

                            <ClubText>
                              <strong>{clube.nome}</strong>
                            </ClubText>
                          </ClubNameWrap>
                        </ClubeCell>
                      </td>

                      <td>
                        <NumberCol>
                          <span>{liquidation.toFixed(2)}</span>
                        </NumberCol>
                      </td>

                      <td>
                        <NumberCol>
                          <span>{valorMercado.toFixed(2)}</span>
                        </NumberCol>
                      </td>

                      <td>
                        <StatusText $ipo={!clube.ipoEncerrado}>
                          {mercadoFechado ? 'Mercado fechado' : !clube.ipoEncerrado ? 'Unidades Iniciais' : 'Negociação aberta'}
                        </StatusText>
                      </td>

                      <td>
                        <Botao disabled={mercadoFechado} onClick={() => abrirModal(clube)}>{mercadoFechado ? 'Mercado fechado' : 'Negociar'}</Botao>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Tabela>
          </TableWrap>
        </TableSurface>
      </DesktopOnly>

      <MobileOnly>
        <TableCard>
          <TableHeader>
            <HeaderCellSmall>#</HeaderCellSmall>
            <HeaderCellClub>{mercado.entidade === 'time' ? 'Time' : 'Clube'}</HeaderCellClub>
            <HeaderCellPrice>Liq./IPO</HeaderCellPrice>
            <HeaderCellPrice>Mercado</HeaderCellPrice>
            <HeaderCellTrade>Negociar</HeaderCellTrade>
          </TableHeader>

          <Rows>
            {clubesFiltrados.map((clube) => {
              const valorMercado = clube.precoAtual ?? clube.preco ?? 0;
              const liquidation = calcularPrecoLiquidacao(clube.posicao, mercado.participantes);
              const inWatchlist = favoritosClubes.has(String(clube.id));

              return (
                <Row key={clube.id}>
                  <ColSmall>
                    <PosMobile>{clube.posicao}</PosMobile>
                  </ColSmall>

                  <ColClub>
                    <StarButtonMobile
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleClube(clube);
                      }}
                      $active={inWatchlist}
                      title="Favoritar clube"
                    >
                      {inWatchlist ? '★' : '☆'}
                    </StarButtonMobile>

                    <ClubTap onClick={() => abrirPaginaClube(clube.id)}>
                      <EscudoWrapMobile>
                        <ClubBadge clube={clube.nome} escudo={clube.escudo} size={25} />
                      </EscudoWrapMobile>
                      <ClubName>{clube.nome}</ClubName>
                    </ClubTap>
                  </ColClub>

                  <ColPrice>
                    <PriceValue>{liquidation.toFixed(2)}</PriceValue>
                  </ColPrice>

                  <ColPrice>
                    <PriceValue>{valorMercado.toFixed(2)}</PriceValue>
                  </ColPrice>

                  <ColTrade>
                    <TradeButton disabled={mercadoFechado} onClick={() => abrirModal(clube)}>
                      {mercadoFechado ? 'Mercado fechado' : 'Negociar'}
                    </TradeButton>
                  </ColTrade>
                </Row>
              );
            })}
          </Rows>
        </TableCard>
      </MobileOnly>
        </>
      )}
    </Container>
  );
}

export default function BrasileiraoA() {
  return <MercadoCompeticao mercado={mercados['brasileirao-a']} />;
}

const Container = styled.div`
  padding: 0.2rem 0 1rem;
  color: white;
`;

const MarketAdBanner = styled(AdSenseBanner)`
  margin: 22px 0;

  @media (max-width: 640px) {
    margin: 18px 0;
  }
`;

const Hero = styled.div`
  margin-bottom: 14px;
  padding: 6px 2px 14px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
`;

const LeagueMain = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;

  @media (max-width: 640px) {
    gap: 10px;
  }
`;

const LeagueMark = styled.div`
  width: 56px;
  height: 56px;
  border-radius: 18px;
  display: grid;
  place-items: center;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.08),
    rgba(255, 255, 255, 0.03)
  );
  border: 1px solid rgba(148, 163, 184, 0.12);

  @media (max-width: 640px) {
    width: 46px;
    height: 46px;
    border-radius: 14px;
  }
`;

const LeagueCopy = styled.div``;

const Titulo = styled.h1`
  margin: 0;
  font-size: 1.55rem;
  color: #f8fafc;

  @media (max-width: 640px) {
    font-size: 1.18rem;
  }
`;

const LeagueMeta = styled.div`
  margin-top: 5px;
  color: #94a3b8;
  font-size: 0.82rem;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const LeagueActions = styled.div`
  display: flex;
  align-items: center;
`;

const LeagueStar = styled.button`
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: ${({ $active }) =>
    $active
      ? 'linear-gradient(180deg, rgba(250,204,21,0.22), rgba(250,204,21,0.06))'
      : 'rgba(255,255,255,0.04)'};
  color: ${({ $active }) => ($active ? '#fde68a' : '#cbd5e1')};
  width: 46px;
  height: 46px;
  border-radius: 14px;
  font-size: 1.45rem;
  cursor: pointer;

  @media (max-width: 640px) {
    width: 42px;
    height: 42px;
  }
`;

const SearchInline = styled.div`
  position: relative;
  margin-bottom: 14px;
`;

const SearchInlineIcon = styled.span`
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: #94a3b8;
`;

const SearchInlineInput = styled.input`
  width: 100%;
  height: 46px;
  padding: 0 14px 0 42px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(255, 255, 255, 0.05);
  color: #f8fafc;
  outline: none;

  &::placeholder {
    color: #94a3b8;
  }
`;

const DesktopOnly = styled.div`
  display: block;

  @media (max-width: 768px) {
    display: none;
  }
`;

const MobileOnly = styled.div`
  display: none;

  @media (max-width: 768px) {
    display: block;
  }
`;

const TableSurface = styled.div`
  background: transparent;
`;

const TableWrap = styled.div`
  overflow-x: auto;
`;

const Tabela = styled.table`
  width: 100%;
  border-collapse: collapse;
  color: white;
  min-width: 880px;

  th,
  td {
    padding: 14px 12px;
    text-align: left;
    vertical-align: middle;
  }

  th {
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 0.72rem;
    font-weight: 800;
    border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  }

  tbody tr {
    border-bottom: 1px solid rgba(148, 163, 184, 0.08);
    transition: background 0.16s ease;
  }

  tbody tr:hover {
    background: rgba(255, 255, 255, 0.025);
  }
`;

const Pos = styled.div`
  color: #dbeafe;
  font-weight: 800;
  font-size: 1rem;
`;

const ClubeCell = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const StarButton = styled.button`
  border: none;
  background: transparent;
  color: ${({ $active }) => ($active ? '#facc15' : '#64748b')};
  font-size: 1.75rem;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  width: 24px;
  flex: 0 0 auto;
`;

const ClubNameWrap = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
`;

const EscudoWrapDesktop = styled.div`
  width: 40px;
  height: 40px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(148, 163, 184, 0.08);
  flex: 0 0 auto;
`;

const ClubText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;

  strong {
    color: #f8fafc;
    font-size: 0.95rem;
  }
`;

const NumberCol = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;

  span {
    color: #f8fafc;
    font-size: 0.95rem;
    font-weight: 800;
  }
`;

const StatusText = styled.div`
  color: #86efac;
  font-size: 0.84rem;
  font-weight: 800;
`;

const MarketClosedNotice = styled.div`
  margin: 0 0 12px;
  padding: 11px 14px;
  border: 1px solid rgba(248, 113, 113, .28);
  border-radius: 12px;
  background: rgba(127, 29, 29, .17);
  color: #fca5a5;
  font-size: .82rem;
  font-weight: 750;
`;

const Botao = styled.button`
  background: linear-gradient(180deg, #3b82f6, #2563eb);
  color: white;
  border: none;
  padding: 0.6rem 1rem;
  border-radius: 10px;
  cursor: pointer;
  font-weight: 800;
  box-shadow: 0 10px 22px rgba(37, 99, 235, 0.22);

  &:hover {
    filter: brightness(1.05);
  }

  &:disabled { background: #334155; box-shadow: none; cursor: not-allowed; }
`;

const TableCard = styled.div`
  border-radius: 18px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.1);
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.75), rgba(11, 19, 36, 0.95));
`;

const TableHeader = styled.div`
  display: grid;
  grid-template-columns: 28px minmax(0, 1.6fr) 70px 70px 88px;
  gap: 6px;
  align-items: center;
  padding: 10px 8px;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
`;

const HeaderCellBase = styled.div`
  color: #94a3b8;
  font-size: 0.7rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const HeaderCellSmall = styled(HeaderCellBase)`
  text-align: center;
`;

const HeaderCellClub = styled(HeaderCellBase)``;

const HeaderCellPrice = styled(HeaderCellBase)`
  text-align: center;
`;

const HeaderCellTrade = styled(HeaderCellBase)`
  text-align: center;
`;

const Rows = styled.div`
  display: flex;
  flex-direction: column;
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 28px minmax(0, 1.6fr) 70px 70px 88px;
  gap: 6px;
  align-items: center;
  padding: 10px 8px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.08);

  &:last-child {
    border-bottom: none;
  }
`;

const ColSmall = styled.div`
  display: flex;
  justify-content: center;
`;

const ColClub = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const ColPrice = styled.div`
  display: flex;
  justify-content: center;
`;

const ColTrade = styled.div`
  display: flex;
  justify-content: center;
`;

const PosMobile = styled.div`
  width: 24px;
  text-align: center;
  font-weight: 800;
  color: #f8fafc;
  font-size: 0.92rem;
`;

const StarButtonMobile = styled.button`
  border: none;
  background: transparent;
  color: ${({ $active }) => ($active ? '#fde68a' : '#64748b')};
  font-size: 1.15rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  flex: 0 0 auto;
`;

const ClubTap = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  cursor: pointer;
`;

const EscudoWrapMobile = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(148, 163, 184, 0.08);
  overflow: hidden;
  flex: 0 0 auto;
`;

const ClubName = styled.div`
  color: #f8fafc;
  font-size: 0.84rem;
  font-weight: 700;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

const PriceValue = styled.div`
  color: #e2e8f0;
  font-weight: 800;
  font-size: 0.8rem;
`;

const TradeButton = styled.button`
  width: 100%;
  max-width: 112px;
  border: none;
  border-radius: 999px;
  padding: 9px 6px;
  background: #2563eb;
  color: white;
  font-weight: 800;
  font-size: 0.78rem;
  cursor: pointer;

  &:hover {
    background: #1d4ed8;
  }

  &:disabled { background: #334155; cursor: not-allowed; }
`;
