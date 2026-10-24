import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '@/server/db/client';
import { companyMembers, companyMessages, jobState, organizations, users } from '@/server/db/schema';
import { discord } from './api';
import { discordConfig } from './config';
import { answerInteraction, type Interaction } from './interaction';
import { banChanged, memberJoined, memberLeft, memberUpdated, messageDeleted, messageEdited, rememberMessage } from './logs';
import { automod, type AutomodMessage } from './automod';
import { countCompanyMessage } from './company-life';
import { messageXp, resetVoice } from './levels';
import { starPhoto } from './photos';
import { voiceChanged } from './rooms';
import { ticketMessageFromDiscord } from './tickets';
import { t } from '@/i18n/t';

/**
 * GUILDS | GUILD_MEMBERS | GUILD_MODERATION | GUILD_MESSAGES | MESSAGE_CONTENT
 * (members and message content are privileged: turned on in the Developer Portal).
 */
const INTENTS = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 7) | (1 << 9) | (1 << 15);
/** Without the privileged intents: commands still work; no welcome, no message text for the bridge and the log. */
const BASIC_INTENTS = (1 << 0) | (1 << 2) | (1 << 7) | (1 << 9);
/** How often a connection without Message Content tries the full intents again. */
const RETRY_FULL_MS = 30 * 60_000;
const HELLO_TIMEOUT_MS = 30_000;
/** How often a connected worker refreshes its state (the admin panel calls it stale after `GATEWAY_STALE_MS`). */
const STATE_REFRESH_MS = 5 * 60_000;
export const GATEWAY_STALE_MS = 20 * 60_000;

interface DiscordMessageEvent {
  id: string;
  channel_id: string;
  guild_id?: string;
  content: string;
  webhook_id?: string;
  author: { id: string; bot?: boolean; username?: string; global_name?: string | null; avatar?: string | null };
  attachments?: { url: string; content_type?: string }[];
  member?: { roles?: string[]; joined_at?: string };
  mentions?: unknown[];
  mention_roles?: string[];
}

/**
 * Discord → game side of the company chat bridge: a message a member writes
 * in their company's Discord channel appears in the company chat in the game.
 * Only linked members of that company; every Discord message at most once.
 */
export async function messageFromDiscord(db: Database, m: DiscordMessageEvent) {
  if (m.author.bot || m.webhook_id || m.guild_id !== discordConfig().guildId) return false;
  const body = `${m.content ?? ''}${m.attachments?.length ? t('{0}[прикачен файл в Discord]', m.content ? ' ' : '') : ''}`.trim().slice(0, 500);
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

export const GATEWAY_STATE = 'discord-gateway';
export interface GatewayState {
  state: 'connecting' | 'ready' | 'closed';
  at: number;
  /** Connected without Message Content (not turned on in the Developer Portal). */
  limited?: boolean;
  code?: number;
  error?: string;
}

/** What the worker's gateway connection is doing (shown in the admin panel). */
async function saveState(db: Database, value: GatewayState) {
  await db
    .insert(jobState)
    .values({ key: GATEWAY_STATE, value })
    .onConflictDoUpdate({ target: jobState.key, set: { value, updatedAt: new Date() } })
    .catch(() => undefined);
}

/** A slash command that came through the gateway (when no Interactions Endpoint URL is set). */
async function interactionFromGateway(db: Database, i: Interaction) {
  if (!i.id || !i.token) return;
  const { response, later } = await answerInteraction(db, i);
  await discord('POST', `/interactions/${i.id}/${i.token}/callback`, response);
  if (later) await later();
}

/** Server events: the chat bridges (company channels, tickets), the welcome and the team's log. */
function onEvent(db: Database, type: string, d: unknown) {
  const run = (what: string, p: Promise<unknown>) => void p.catch((e) => console.warn(`[discord] ${what} failed`, (e as Error).message));
  const guildId = discordConfig().guildId;
  const inGuild = (d as { guild_id?: string }).guild_id === guildId;
  switch (type) {
    case 'MESSAGE_CREATE': {
      const m = d as DiscordMessageEvent;
      if (!inGuild) break;
      rememberMessage(m);
      // Automatic moderation first: a removed message counts for nothing else.
      run('message', (async () => {
        if (await automod(db, m as AutomodMessage)) return;
        await messageFromDiscord(db, m);
        await ticketMessageFromDiscord(db, m);
        await messageXp(db, m);
        await countCompanyMessage(db, m.channel_id);
        await starPhoto(db, m);
      })());
      break;
    }
    case 'GUILD_CREATE':
      // After (re)connecting Discord sends the server with who is in which voice channel.
      if ((d as { id?: string }).id === guildId) run('voice', resetVoice(db, (d as { voice_states?: { user_id: string; channel_id: string | null }[] }).voice_states ?? []));
      break;
    case 'VOICE_STATE_UPDATE':
      if (inGuild) run('voice', voiceChanged(db, d as Parameters<typeof voiceChanged>[1]));
      break;
    case 'MESSAGE_UPDATE':
      if (inGuild) run('log', messageEdited(db, d as Parameters<typeof messageEdited>[1]));
      break;
    case 'MESSAGE_DELETE':
      if (inGuild) run('log', messageDeleted(db, d as Parameters<typeof messageDeleted>[1]));
      break;
    case 'GUILD_MEMBER_ADD':
      if (inGuild) run('welcome', memberJoined(db, d as Parameters<typeof memberJoined>[1]));
      break;
    case 'GUILD_MEMBER_REMOVE':
      if (inGuild) run('log', memberLeft(db, d as Parameters<typeof memberLeft>[1]));
      break;
    case 'GUILD_MEMBER_UPDATE':
      if (inGuild) run('log', memberUpdated(db, d as Parameters<typeof memberUpdated>[1]));
      break;
    case 'GUILD_BAN_ADD':
    case 'GUILD_BAN_REMOVE':
      if (inGuild) run('log', banChanged(db, d as Parameters<typeof banChanged>[1], type === 'GUILD_BAN_ADD'));
      break;
    case 'INTERACTION_CREATE':
      run('command', interactionFromGateway(db, d as Interaction));
      break;
  }
}

/**
 * A minimal Discord gateway connection (in the worker): heartbeats, resume
 * after a drop, MESSAGE_CREATE for the chat bridge and slash commands when
 * Discord sends them here. Starts only when the bot is configured.
 */
export function startGateway(db: Database) {
  if (!discordConfig().bot) return { stop: () => undefined };
  let ws: WebSocket | null = null;
  let beat: ReturnType<typeof setInterval> | null = null;
  let seq: number | null = null;
  let session: { id: string; url: string } | null = null;
  let stopped = false;
  let acked = true;
  let limited = false;
  let retryFull: ReturnType<typeof setTimeout> | null = null;
  let helloTimer: ReturnType<typeof setTimeout> | null = null;
  let ready = false;
  let savedAt = 0;
  // One write after another: a late 'connecting' must never land over 'ready'.
  let saving = Promise.resolve();
  const save = (value: GatewayState) => {
    saving = saving.then(() => saveState(db, value));
  };

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

  const markReady = () => {
    ready = true;
    savedAt = Date.now();
    save({ state: 'ready', at: savedAt, limited });
  };

  async function connect() {
    ready = false;
    if (helloTimer) clearTimeout(helloTimer);
    try {
      const url = session?.url ?? (await discord<{ url: string }>('GET', '/gateway/bot')).url;
      ws = new WebSocket(`${url}?v=10&encoding=json`);
      save({ state: 'connecting', at: Date.now(), limited });
      // A socket that never says hello (stuck network, proxy): start again instead of waiting forever.
      const pending = ws;
      helloTimer = setTimeout(() => {
        if (ws === pending && !beat) {
          console.warn('[discord] no hello from the gateway in 30 s — reconnecting');
          reconnect(5000);
        }
      }, HELLO_TIMEOUT_MS);
    } catch (error) {
      console.warn('[discord] gateway url failed', (error as Error).message);
      save({ state: 'closed', at: Date.now(), error: (error as Error).message.slice(0, 300) });
      return reconnect(30_000);
    }
    const sock = ws;
    ws.onmessage = (event) => {
      // A socket that was already replaced.
      if (sock !== ws) return;
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
        else send(2, { token: discordConfig().token, intents: limited ? BASIC_INTENTS : INTENTS, properties: { os: 'linux', browser: 'transverse', device: 'transverse' } });
      } else if (p.op === 11) {
        acked = true;
        // While connected, refresh the state now and then: the admin panel tells a live worker from a stopped one.
        if (ready && Date.now() - savedAt > STATE_REFRESH_MS) markReady();
      }
      else if (p.op === 1) send(1, seq);
      else if (p.op === 7) reconnect(500);
      else if (p.op === 9) {
        if (!p.d) session = null;
        reconnect(3000);
      } else if (p.op === 0) {
        if (p.t === 'READY') {
          const d = p.d as { session_id: string; resume_gateway_url: string };
          session = { id: d.session_id, url: d.resume_gateway_url };
          console.log(`[discord] gateway ready${limited ? ' (without Message Content)' : ''}`);
          markReady();
          // Now and then try again with Message Content, in case it was turned on meanwhile.
          if (limited && !retryFull) {
            retryFull = setTimeout(() => {
              retryFull = null;
              limited = false;
              session = null;
              reconnect(0);
            }, RETRY_FULL_MS);
          }
        } else if (p.t === 'RESUMED') {
          // A resumed session (after Discord asked to reconnect) sends RESUMED, not READY.
          markReady();
        } else if (p.t) onEvent(db, p.t, p.d);
      }
    };
    ws.onclose = (event) => {
      // Closed by reconnect(): a new socket is already on its way.
      if (sock !== ws) return;
      save({ state: 'closed', at: Date.now(), code: event.code, limited });
      // 4014: Message Content is not allowed — connect without it (commands keep working).
      if (event.code === 4014 && !limited) {
        console.warn('[discord] Message Content intent is off in the Developer Portal — connecting without it');
        limited = true;
        session = null;
        return reconnect(2000);
      }
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
      if (retryFull) clearTimeout(retryFull);
      if (helloTimer) clearTimeout(helloTimer);
      reconnect(0);
    },
  };
}
