/**
 * TransVerse world worker — runs the persistent simulation independently of
 * any browser: settles deliveries, refreshes the freight market, pays wages,
 * rotates seasons. Run as a separate process: `pnpm worker`.
 */
import { closeDb, getDb } from '../server/db/client';
import { loadSecretsFile } from '../server/secrets';
import { worldTick } from '../server/game/world';
import { startGateway } from '../server/discord/gateway';
import { registerCommands } from '../server/discord/register';

const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 15_000);
let running = true;

async function loop() {
  loadSecretsFile();
  const db = getDb();
  console.log(`[worker] started, tick every ${INTERVAL_MS} ms`);
  // The Discord bot (when its secrets are set): slash commands and the live connection for the chat bridge.
  registerCommands().then((n) => n && console.log(`[discord] ${n} commands registered`)).catch((e) => console.warn('[discord] commands failed', (e as Error).message));
  const gateway = startGateway(db);
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
  gateway.stop();
  await closeDb();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => (running = false));
void loop();
