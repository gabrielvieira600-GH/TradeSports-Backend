import Link from 'next/link';
import styled from 'styled-components';
import { useMemo, useState } from 'react';
import { LeagueBadge } from './ClubBadge';

const mercados = [
  {
    href: '/brasileirao-a',
    nome: 'Brasileirão Série A',
    badge: 'brasileirao-serie-a',
  },
  {
    href: '/brasileirao-b',
    nome: 'Brasileirão Série B',
    badge: 'brasileirao-serie-b',
  },
  {
    href: '/premierleague-a',
    nome: 'Premier League',
    badge: 'premier-league',
  },
  {
    href: '/laliga-a',
    nome: 'La Liga',
    badge: 'la-liga',
  },
  {
    href: '/bundesliga',
    nome: 'Bundesliga',
    badge: 'bundesliga',
  },
  {
    href: '/ligue-1',
    nome: 'Ligue 1',
    badge: 'ligue-1',
  },
  {
    href: '/serie-a',
    nome: 'Serie A',
    badge: 'serie-a',
  },
  {
    href: '/eredivisie',
    nome: 'Eredivisie',
    badge: 'eredivisie',
  },
  {
    href: '/nbaoeste',
    nome: 'NBA Oeste',
    badge: 'nba',
  },
  {
    href: '/nbaleste',
    nome: 'NBA Leste',
    badge: 'nba',
  },
  {
    href: '/nfloeste',
    nome: 'NFL — AFC',
    badge: 'nfl',
  },
  {
    href: '/nflleste',
    nome: 'NFL — NFC',
    badge: 'nfl',
  },
];

export default function Sidebar() {
  const [minimizado, setMinimizado] = useState(false);
  const mercadoCount = useMemo(() => mercados.length, []);

  return (
    <SidebarShell $minimizado={minimizado}>
      <SidebarContainer $minimizado={minimizado}>
        <Header>
          <BrandWrap>
            {!minimizado && (
              <BrandText>
                <Title>⚽ Mercados</Title>
                <Subtitle>{mercadoCount} ligas disponíveis</Subtitle>
              </BrandText>
            )}
          </BrandWrap>

          <ToggleButton
            type="button"
            onClick={() => setMinimizado((v) => !v)}
            aria-label={minimizado ? 'Expandir sidebar' : 'Minimizar sidebar'}
            title={minimizado ? 'Expandir sidebar' : 'Minimizar sidebar'}
          >
            {minimizado ? '»' : '«'}
          </ToggleButton>
        </Header>

        {!minimizado && <SectionLabel>Todos os mercados</SectionLabel>}

        <Nav>
          {mercados.map((item) => (
            <NavItem key={item.href}>
              <StyledLink href={item.href} title={item.nome}>
                <LinkInner $minimizado={minimizado}>
                  <LeagueIconWrap>
                    <LeagueBadge liga={item.badge} size={28} />
                  </LeagueIconWrap>

                  {!minimizado && (
                    <>
                      <Label>{item.nome}</Label>
                      <Arrow>›</Arrow>
                    </>
                  )}
                </LinkInner>
              </StyledLink>
            </NavItem>
          ))}
        </Nav>
      </SidebarContainer>
    </SidebarShell>
  );
}

const SidebarShell = styled.div`
  position: relative;
  align-self: stretch;
  display: flex;
  width: ${({ $minimizado }) => ($minimizado ? '86px' : '272px')};
  transition: width 0.22s ease;
  flex: 0 0 auto;
  background: linear-gradient(180deg, #0f172a 0%, #0b1324 100%);
  border-right: 1px solid rgba(148, 163, 184, 0.12);

  @media (max-width: 960px) {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  }
`;

const SidebarContainer = styled.aside`
  flex: 1 1 auto;
  width: 100%;
  min-height: calc(100vh - 73px);
  padding: ${({ $minimizado }) => ($minimizado ? '18px 12px' : '20px 16px')};
  color: white;
  transition: padding 0.22s ease;
  box-sizing: border-box;

  @media (max-width: 960px) {
    min-height: auto;
    padding: 10px 10px 12px;
  }
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;

  @media (max-width: 960px) {
    margin-bottom: 10px;
  }
`;

const BrandWrap = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
`;

const BrandText = styled.div`
  min-width: 0;
`;

const Title = styled.h2`
  color: #f8fafc;
  margin: 0;
  font-size: 1.02rem;
  font-weight: 800;
`;

const Subtitle = styled.div`
  margin-top: 2px;
  color: #94a3b8;
  font-size: 0.78rem;
`;

const ToggleButton = styled.button`
  width: 36px;
  height: 36px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(255, 255, 255, 0.04);
  color: #e5e7eb;
  cursor: pointer;
  font-size: 1rem;
  font-weight: 800;
  flex: 0 0 auto;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  @media (max-width: 960px) {
    display: none;
  }
`;

const SectionLabel = styled.div`
  color: #00ff95;
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  margin-bottom: 10px;
  padding-left: 2px;

  @media (max-width: 960px) {
    margin-bottom: 8px;
  }
`;

const Nav = styled.nav`
  display: flex;
  flex-direction: column;
  gap: 2px;

  @media (max-width: 960px) {
    flex-direction: row;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 2px;

    &::-webkit-scrollbar {
      height: 6px;
    }
  }
`;

const NavItem = styled.div`
  width: 100%;

  @media (max-width: 960px) {
    width: auto;
    flex: 0 0 auto;
  }
`;

const StyledLink = styled(Link)`
  text-decoration: none;
`;

const LinkInner = styled.div`
  min-height: 46px;
  display: flex;
  align-items: center;
  justify-content: ${({ $minimizado }) =>
    $minimizado ? 'center' : 'flex-start'};
  gap: 12px;
  padding: ${({ $minimizado }) => ($minimizado ? '8px 4px' : '8px 10px')};
  border-radius: 14px;
  color: #f8fafc;
  transition: all 0.16s ease;
  white-space: nowrap;

  &:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  @media (max-width: 960px) {
    min-height: 40px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(148, 163, 184, 0.08);
  }
`;

const LeagueIconWrap = styled.div`
  width: 34px;
  height: 34px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(148, 163, 184, 0.08);
  flex: 0 0 auto;

  @media (max-width: 960px) {
    width: 30px;
    height: 30px;
    border-radius: 10px;
  }
`;

const Label = styled.span`
  flex: 1;
  min-width: 0;
  font-size: 0.94rem;
  font-weight: 600;
  color: #e2e8f0;
`;

const Arrow = styled.span`
  color: #64748b;
  font-size: 1.15rem;
  flex: 0 0 auto;

  @media (max-width: 960px) {
    display: none;
  }
`;
