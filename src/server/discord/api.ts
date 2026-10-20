import { discordConfig } from './config';

const BASE = 'https://discord.com/api/v10';

export class DiscordError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * A call to the Discord REST API with the bot token. Waits and retries once
 * when Discord says "too many requests" (429).
 */
export async function discord<T = unknown>(method: string, path: string, body?: unknown, opts: { auth?: string; form?: Record<string, string> } = {}): Promise<T> {
  const auth = opts.auth ?? `Bot ${discordConfig().token}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: opts.form ? { 'Content-Type': 'application/x-www-form-urlencoded', ...(opts.auth ? { Authorization: auth } : {}) } : { 'Content-Type': 'application/json', Authorization: auth },
      body: opts.form ? new URLSearchParams(opts.form).toString() : body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 429) {
      const data = (await res.json().catch(() => ({}))) as { retry_after?: number };
      await new Promise((r) => setTimeout(r, Math.min(10_000, (data.retry_after ?? 1) * 1000 + 100)));
      continue;
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!res.ok) throw new DiscordError(res.status, `Discord ${method} ${path.replace(/\/webhooks\/\d+\/[\w-]+/, '/webhooks/…')}: ${res.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }
  throw new DiscordError(429, `Discord ${method} ${path}: too many requests`);
}

export interface Embed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  thumbnail?: { url: string };
  footer?: { text: string };
  timestamp?: string;
}

export interface DiscordMessage {
  content?: string;
  embeds?: Embed[];
  /** Never ping @everyone or roles from game text. */
  allowed_mentions?: { parse: string[] };
}

export const noPings = { allowed_mentions: { parse: [] as string[] } };
