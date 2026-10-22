import { timingSafeEqual } from 'node:crypto';
import { getDb } from '@/server/db/client';
import { companyReportImage } from '@/server/discord/cards';
import { reportToken } from '@/server/discord/map-token';

/** The weekly report picture of a company (only with the bot's token from its channel; game data). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const from = Number(url.searchParams.get('f'));
  const k = url.searchParams.get('k') ?? '';
  const expected = /^[0-9a-f-]{36}$/i.test(id) && Number.isFinite(from) ? reportToken(id, from) : '';
  if (!expected || k.length !== expected.length || !timingSafeEqual(Buffer.from(k), Buffer.from(expected))) return new Response('Not found', { status: 404 });
  try {
    return (await companyReportImage(getDb(), id, new Date(from))) ?? new Response('Not found', { status: 404 });
  } catch (error) {
    console.warn('[discord] report picture failed', (error as Error).message);
    return new Response('Unavailable', { status: 503 });
  }
}
