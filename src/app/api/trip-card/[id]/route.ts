import { getDb } from '@/server/db/client';
import { tripCardImage } from '@/server/discord/cards';

/** The picture of a shared trip (Бордови дневник): for Facebook, Discord and the public page. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
  try {
    return (await tripCardImage(getDb(), id)) ?? new Response('Not found', { status: 404 });
  } catch (error) {
    console.warn('[trip] card failed', (error as Error).message);
    return new Response('Unavailable', { status: 503 });
  }
}
