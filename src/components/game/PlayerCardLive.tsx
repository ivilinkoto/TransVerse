'use client';

import { useRouter } from 'next/navigation';
import type { PlayerCard as Card } from '@/server/game/social';
import { PlayerCardView } from './PlayerCard';

/** The player card on a page: actions refresh the page. */
export function PlayerCardLive({ card }: { card: Card }) {
  const router = useRouter();
  return <PlayerCardView card={card} careerLink={false} onChange={() => router.refresh()} />;
}
