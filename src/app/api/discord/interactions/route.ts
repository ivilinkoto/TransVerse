import { NextResponse } from 'next/server';
import { getDb } from '@/server/db/client';
import { runCommand } from '@/server/discord/commands';
import { discordConfig } from '@/server/discord/config';
import { verifyDiscordSignature } from '@/server/discord/verify';

export const dynamic = 'force-dynamic';

interface Interaction {
  type: number;
  data?: { name: string; options?: { name: string; value: string | number }[] };
  member?: { user?: { id: string } };
  user?: { id: string };
}

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
  const i = JSON.parse(body) as Interaction;
  // PING when the endpoint is saved in the Developer Portal.
  if (i.type === 1) return NextResponse.json({ type: 1 });
  if (i.type !== 2 || !i.data) return NextResponse.json({ type: 4, data: { content: 'Непозната команда.', flags: 64 } });
  const discordUserId = i.member?.user?.id ?? i.user?.id ?? '';
  const options = Object.fromEntries((i.data.options ?? []).map((o) => [o.name, String(o.value)]));
  try {
    const reply = await runCommand(getDb(), { name: i.data.name, options, discordUserId });
    return NextResponse.json({ type: 4, data: { content: reply.content, embeds: reply.embeds, flags: reply.ephemeral ? 64 : 0, allowed_mentions: { parse: [] } } });
  } catch (error) {
    console.error('[discord] command failed', i.data.name, error);
    return NextResponse.json({ type: 4, data: { content: 'Нещо се обърка — опитай пак след малко.', flags: 64 } });
  }
}
