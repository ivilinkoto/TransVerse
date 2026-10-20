import type { DbOrTx } from '@/server/db/client';
import { runCommand } from './commands';

export interface Interaction {
  id?: string;
  token?: string;
  type: number;
  data?: { name: string; options?: { name: string; value: string | number }[] };
  member?: { user?: { id: string } };
  user?: { id: string };
}

/** The answer to a slash command (the same for the HTTP endpoint and the gateway). */
export async function answerInteraction(db: DbOrTx, i: Interaction) {
  // PING when the endpoint is saved in the Developer Portal.
  if (i.type === 1) return { type: 1 };
  if (i.type !== 2 || !i.data) return { type: 4, data: { content: 'Непозната команда.', flags: 64 } };
  const discordUserId = i.member?.user?.id ?? i.user?.id ?? '';
  const options = Object.fromEntries((i.data.options ?? []).map((o) => [o.name, String(o.value)]));
  try {
    const reply = await runCommand(db, { name: i.data.name, options, discordUserId });
    return { type: 4, data: { content: reply.content, embeds: reply.embeds, flags: reply.ephemeral ? 64 : 0, allowed_mentions: { parse: [] } } };
  } catch (error) {
    console.error('[discord] command failed', i.data.name, error);
    return { type: 4, data: { content: 'Нещо се обърка — опитай пак след малко.', flags: 64 } };
  }
}
