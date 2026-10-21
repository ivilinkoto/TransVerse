import { getDb } from '@/server/db/client';
import { truckMapImage } from '@/server/discord/cards';
import { mapCardValid } from '@/server/discord/map-token';

/** The /карта picture in Discord: a player's trucks. Only with the token the bot puts in the link. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = new URL(request.url).searchParams.get('k') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(id) || !mapCardValid(id, token)) return new Response('Not found', { status: 404 });
  try {
    return (await truckMapImage(getDb(), id)) ?? new Response('Not found', { status: 404 });
  } catch (error) {
    console.warn('[discord] map card failed', (error as Error).message);
    return new Response('Unavailable', { status: 503 });
  }
}
