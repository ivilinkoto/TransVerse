import { EventEmitter } from 'node:events';
import pg from 'pg';

/**
 * One shared LISTEN connection per server process fans out Postgres
 * notifications (sent by the API and by the world worker) to SSE clients.
 */
export interface WorldEvent {
  type: 'notification' | 'market' | 'leaderboard' | 'world';
  userId?: string;
}

const g = globalThis as unknown as { tvBus?: EventEmitter; tvListen?: Promise<void>; tvOnline?: Map<string, number> };

function bus(): EventEmitter {
  if (!g.tvBus) {
    g.tvBus = new EventEmitter();
    g.tvBus.setMaxListeners(10_000);
  }
  return g.tvBus;
}

function ensureListening() {
  g.tvListen ??= (async () => {
    const connect = async () => {
      const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
      client.on('notification', (msg) => {
        try {
          bus().emit('event', JSON.parse(msg.payload ?? '{}') as WorldEvent);
        } catch {
          /* ignore malformed payloads */
        }
      });
      client.on('error', () => {
        g.tvListen = undefined; // reconnect on next subscriber
      });
      await client.connect();
      await client.query('LISTEN tv_events');
    };
    await connect();
  })().catch((error) => {
    console.error('[realtime] listen failed', error);
    g.tvListen = undefined;
  });
  return g.tvListen;
}

export function subscribe(listener: (event: WorldEvent) => void): () => void {
  void ensureListening();
  bus().on('event', listener);
  return () => bus().off('event', listener);
}

/** Players with an open game tab (live connection) on this server process. */
function presence(): Map<string, number> {
  g.tvOnline ??= new Map();
  return g.tvOnline;
}

/** Marks a player online while their live connection is open; returns the cleanup. */
export function trackOnline(userId: string): () => void {
  const p = presence();
  p.set(userId, (p.get(userId) ?? 0) + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const n = (p.get(userId) ?? 1) - 1;
    if (n <= 0) p.delete(userId);
    else p.set(userId, n);
  };
}

export function onlineUserIds(): Set<string> {
  return new Set(presence().keys());
}
