import { getDb } from '@/server/db/client';
import { getAvatar } from '@/server/game/avatars';

/** Serves a player's profile picture. URLs carry ?v=avatarVersion, so a new upload gets a new URL. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  const avatar = await getAvatar(getDb(), id);
  if (!avatar) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(avatar.data), {
    headers: { 'content-type': avatar.mime, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" },
  });
}
