import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { organizations } from '@/server/db/schema';
import { plotImage } from '@/server/discord/cards';

/** The company base picture for /участък in Discord (game data). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  const db = getDb();
  const [org] = await db.select({ name: organizations.name, tag: organizations.tag }).from(organizations).where(eq(organizations.id, id));
  if (!org) return new Response('Not found', { status: 404 });
  try {
    return (await plotImage(db, id, `${org.name}${org.tag ? ` [${org.tag}]` : ''}`)) ?? new Response('Not found', { status: 404 });
  } catch (error) {
    console.warn('[discord] plot picture failed', (error as Error).message);
    return new Response('Unavailable', { status: 503 });
  }
}
