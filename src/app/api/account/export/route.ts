import { NextResponse } from 'next/server';
import { exportAccount } from '@/server/auth/account-data';
import { rateLimit } from '@/server/auth/rate-limit';
import { getDb } from '@/server/db/client';
import { requireFeature } from '@/server/features';
import { handler } from '@/server/http';

export const dynamic = 'force-dynamic';

/** 1.1.3: "Изтегли данните си" — a JSON file with everything the game keeps about the player. */
export const GET = handler({ perMinute: 3 }, async ({ user }) => {
  requireFeature('data_export', user);
  await rateLimit(getDb(), `export:${user.id}`, 5, 3600);
  const data = await exportAccount(getDb(), user.id);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="transverse-${user.username.replace(/[^\w.-]/g, '_')}.json"`, 'cache-control': 'no-store' },
  });
});
