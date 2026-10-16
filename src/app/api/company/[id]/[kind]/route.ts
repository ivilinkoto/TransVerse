import { getDb } from '@/server/db/client';
import { getAsset } from '@/server/game/membership';

/** Serves a company's logo or banner. Public: company profiles are visible to every player. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await params;
  if ((kind !== 'logo' && kind !== 'banner') || !/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  const asset = await getAsset(getDb(), id, kind);
  if (!asset) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(asset.data), {
    headers: {
      'content-type': asset.mime,
      // URLs carry ?v=brandingVersion, so a new upload gets a new URL.
      'cache-control': 'public, max-age=86400',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  });
}
