import { getDb } from '@/server/db/client';
import { companyCardImage } from '@/server/discord/cards';

/** The public card of a company for /статистика in Discord (game data, no money). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  try {
    return (await companyCardImage(getDb(), id)) ?? new Response('Not found', { status: 404 });
  } catch (error) {
    console.warn('[discord] company card failed', (error as Error).message);
    return new Response('Unavailable', { status: 503 });
  }
}
