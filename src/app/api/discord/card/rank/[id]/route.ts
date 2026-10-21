import { getDb } from '@/server/db/client';
import { rankCardImage } from '@/server/discord/cards';

/** The rank card picture for /ранг in Discord. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{5,25}$/.test(id)) return new Response('Not found', { status: 404 });
  try {
    return (await rankCardImage(getDb(), id)) ?? new Response('Not found', { status: 404 });
  } catch (error) {
    console.warn('[discord] rank card failed', (error as Error).message);
    return new Response('Unavailable', { status: 503 });
  }
}
