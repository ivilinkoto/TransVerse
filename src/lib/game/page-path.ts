/**
 * 1.2.1.1: a game page's path as it is counted — without the query and with
 * ids (uuids, numbers, plates) folded into [id], so every truck's page is one row.
 * Null for anything outside the game.
 */
export function normalizePagePath(raw: string): string | null {
  const path = raw.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/';
  if (path !== '/game' && !path.startsWith('/game/')) return null;
  const parts = path.split('/').map((p, i) => {
    if (i < 2) return p;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p) || /^\d+$/.test(p) || /[0-9]/.test(p)) return '[id]';
    return /^[a-z][a-z0-9-]*$/.test(p) ? p : '[id]';
  });
  return parts.join('/').slice(0, 80);
}
