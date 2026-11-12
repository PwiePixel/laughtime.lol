import Matchmaking from '@/components/Matchmaking';
import { PUBLIC_GAME_IDS as GAME_IDS } from '@/lib/shared';

export const metadata = { title: 'Quick play', robots: { index: false } };

export default async function PlayPage({ searchParams }) {
  const sp = await searchParams;
  const game = GAME_IDS.includes(sp?.game) ? sp.game : 'classic';
  return <Matchmaking key={game} game={game} />;
}
