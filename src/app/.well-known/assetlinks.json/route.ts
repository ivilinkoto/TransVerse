import { NextResponse } from 'next/server';
import { assetLinks } from '@/server/payments';

export const dynamic = 'force-dynamic';

/** Digital Asset Links: proves the Google Play app belongs to this site (it then opens without an address bar). */
export function GET() {
  return NextResponse.json(assetLinks(), { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
