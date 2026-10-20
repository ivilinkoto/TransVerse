import { getDb } from '@/server/db/client';
import { playerCardImage } from '@/server/discord/cards';

/** The player card picture for /профил in Discord (game data). */
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const username = decodeURIComponent(name).slice(0, 40);
  try {
    return (await playerCardImage(getDb(), username)) ?? new Response('Not found', { status: 404 });
  } catch (error) {
    console.warn('[discord] player card failed', (error as Error).message);
    return new Response('Unavailable', { status: 503 });
  }
}
