import { getDb } from '@/server/db/client';
import { worldSnapshot } from '@/server/game/world-map';
import { handler } from '@/server/http';

export const dynamic = 'force-dynamic';

/** Shared world map: every player's trucks with their schedules (no money or contract terms). */
export const GET = handler({ perMinute: 30 }, async () => worldSnapshot(getDb()));
