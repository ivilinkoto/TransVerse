import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '@/server/db/client';
import { companyMembers, companyMessages, organizations, users } from '@/server/db/schema';
import { discord } from './api';
import { discordConfig } from './config';

/** GUILDS | GUILD_MEMBERS | GUILD_MESSAGES | MESSAGE_CONTENT */
const INTENTS = (1 << 0) | (1 << 1) | (1 << 9) | (1 << 15);

interface DiscordMessageEvent {
  id: string;
  channel_id: string;
  guild_id?: string;
  content: string;
  webhook_id?: string;
  author: { id: string; bot?: boolean };
  attachments?: unknown[];
}

/**
 * Discord → game side of the company chat bridge: a message a member writes
 * in their company's Discord channel appears in the company chat in the game.
 * Only linked members of that company; every Discord message at most once.
 */
export async function messageFromDiscord(db: Database, m: DiscordMessageEvent) {
  if (m.author.bot || m.webhook_id || m.guild_id !== discordConfig().guildId) return false;
  const body = `${m.content ?? ''}${m.attachments?.length ? `${m.content ? ' ' : ''}[прикачен файл в Discord]` : ''}`.trim().slice(0, 500);
  if (!body) return false;
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.discordChannelId, m.channel_id));
  if (!org) return false;
  const [member] = await db
    .select({ userId: users.id, mutedUntil: users.chatMutedUntil })
    .from(users)
    .innerJoin(companyMembers, and(eq(companyMembers.userId, users.id), eq(companyMembers.companyId, org.id)))
    .where(eq(users.discordId, m.author.id));
  if (!member || (member.mutedUntil && member.mutedUntil > new Date())) return false;
  const inserted = await db.insert(companyMessages).values({ companyId: org.id, userId: member.userId, body, discordMessageId: m.id }).onConflictDoNothing().returning({ id: companyMessages.id });
  if (inserted.length) await db.execute(sql`select pg_notify('tv_events', ${JSON.stringify({ type: 'chat', companyId: org.id })})`);
  return inserted.length > 0;
}

/**
 * A minimal Discord gateway connection (in the worker): heartbeats, resume
 * after a drop, and MESSAGE_CREATE for the chat bridge. Starts only when the
 * bot is configured.
 */
export function startGateway(db: Database) {
  if (!discordConfig().bot) return { stop: () => undefined };
  let ws: WebSocket | null = null;
  let beat: ReturnType<typeof setInterval> | null = null;
  let seq: number | null = null;
  let session: { id: string; url: string } | null = null;
  let stopped = false;
  let acked = true;

  const send = (op: number, d: unknown) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ op, d }));
  const reconnect = (delay = 5000) => {
    if (beat) clearInterval(beat);
    beat = null;
    try {
      ws?.close();
    } catch {
      /* already closed */
    }
    ws = null;
    if (!stopped) setTimeout(() => void connect(), delay);
  };

  async function connect() {
    try {
      const url = session?.url ?? (await discord<{ url: string }>('GET', '/gateway/bot')).url;
      ws = new WebSocket(`${url}?v=10&encoding=json`);
    } catch (error) {
      console.warn('[discord] gateway url failed', (error as Error).message);
      return reconnect(30_000);
    }
    ws.onmessage = (event) => {
      const p = JSON.parse(String(event.data)) as { op: number; d: unknown; s: number | null; t: string | null };
      if (p.s !== null) seq = p.s;
      if (p.op === 10) {
        const interval = (p.d as { heartbeat_interval: number }).heartbeat_interval;
        acked = true;
        beat = setInterval(() => {
          // No answer to the last heartbeat: the connection is dead.
          if (!acked) return reconnect(1000);
          acked = false;
          send(1, seq);
        }, interval);
        if (session) send(6, { token: discordConfig().token, session_id: session.id, seq });
        else send(2, { token: discordConfig().token, intents: INTENTS, properties: { os: 'linux', browser: 'transverse', device: 'transverse' } });
      } else if (p.op === 11) acked = true;
      else if (p.op === 1) send(1, seq);
      else if (p.op === 7) reconnect(500);
      else if (p.op === 9) {
        if (!p.d) session = null;
        reconnect(3000);
      } else if (p.op === 0) {
        if (p.t === 'READY') {
          const d = p.d as { session_id: string; resume_gateway_url: string };
          session = { id: d.session_id, url: d.resume_gateway_url };
          console.log('[discord] gateway ready');
        } else if (p.t === 'MESSAGE_CREATE') {
          void messageFromDiscord(db, p.d as DiscordMessageEvent).catch((e) => console.warn('[discord] bridge failed', (e as Error).message));
        }
      }
    };
    ws.onclose = (event) => {
      // 4004: wrong token, 4013/4014: intents not allowed — no point retrying fast.
      if ([4004, 4013, 4014].includes(event.code)) {
        console.error(`[discord] gateway closed (${event.code}) — check the bot token and the intents in the Developer Portal`);
        session = null;
        return reconnect(10 * 60_000);
      }
      if ([4007, 4009].includes(event.code)) session = null;
      reconnect(5000);
    };
    ws.onerror = () => undefined;
  }

  void connect();
  return {
    stop: () => {
      stopped = true;
      reconnect(0);
    },
  };
}
