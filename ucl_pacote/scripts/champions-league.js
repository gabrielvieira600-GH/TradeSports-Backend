import { MercadoCompeticao } from './brasileirao-a';
import mercados from '../Data/mercados';
export default function ChampionsLeague() {
  return <MercadoCompeticao mercado={mercados['champions-league']} />;
}
