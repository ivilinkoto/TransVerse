import { getDb } from '@/server/db/client';
import { truckCardImage } from '@/server/discord/cards';

/** The picture of a player's truck (/камион in Discord). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
  try {
    return (await truckCardImage(getDb(), id)) ?? new Response('Not found', { status: 404 });
  } catch (error) {
    console.warn('[discord] truck card failed', (error as Error).message);
    return new Response('Unavailable', { status: 503 });
  }
}
