/**
 * TransVerse world worker — runs the persistent simulation independently of
 * any browser: settles deliveries, refreshes the freight market, pays wages,
 * rotates seasons. Run as a separate process: `pnpm worker`.
 */
import { closeDb, getDb } from '../server/db/client';
import { worldTick } from '../server/game/world';

const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 15_000);
let running = true;

async function loop() {
  const db = getDb();
  console.log(`[worker] started, tick every ${INTERVAL_MS} ms`);
  while (running) {
    const started = Date.now();
    try {
      const result = await worldTick(db);
      if (!result.skipped && result.settled) console.log(`[worker] settled ${result.settled} deliveries`);
    } catch (error) {
      console.error('[worker] tick failed', error);
    }
    await new Promise((r) => setTimeout(r, Math.max(1000, INTERVAL_MS - (Date.now() - started))));
  }
  await closeDb();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => (running = false));
void loop();
