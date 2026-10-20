import { NextResponse } from 'next/server';
import { getDb } from '@/server/db/client';
import { discordConfig } from '@/server/discord/config';
import { answerInteraction, type Interaction } from '@/server/discord/interaction';
import { verifyDiscordSignature } from '@/server/discord/verify';

export const dynamic = 'force-dynamic';

/**
 * Discord's "Interactions Endpoint URL": slash commands of the bot. Every
 * request is signed by Discord (Ed25519); unsigned ones are refused.
 */
export async function POST(req: Request) {
  const body = await req.text();
  const { publicKey } = discordConfig();
  if (!verifyDiscordSignature(publicKey, req.headers.get('x-signature-ed25519'), req.headers.get('x-signature-timestamp'), body)) {
    return new NextResponse('invalid request signature', { status: 401 });
  }
  return NextResponse.json(await answerInteraction(getDb(), JSON.parse(body) as Interaction));
}
