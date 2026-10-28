import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createGzip } from 'node:zlib';
import { eq } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { jobState } from '@/server/db/schema';

/**
 * 1.1.4: a nightly copy of the database (pg_dump, gzip) on the server, the
 * last BACKUP.keep days kept. The folder is BACKUP_DIR, or `backups` in the
 * shared folder of a deploy (/var/www/transverse/shared); without either, no
 * copy is made (local development, tests). A copy away from the server is
 * still worth having — see docs/DEPLOYMENT.md.
 */
export const BACKUP = { keep: 14, sharedDir: '/var/www/transverse/shared' } as const;
const KEY = 'backup:last';

export function backupDir(): string | null {
  if (process.env.BACKUP_DIR) return process.env.BACKUP_DIR;
  return existsSync(BACKUP.sharedDir) ? join(BACKUP.sharedDir, 'backups') : null;
}

export interface BackupState {
  at: string;
  ok: boolean;
  file?: string;
  bytes?: number;
  error?: string;
}

export async function lastBackup(db: DbOrTx): Promise<BackupState | null> {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, KEY));
  return (row?.value as BackupState | undefined) ?? null;
}

/** pg_dump of DATABASE_URL into `file` (gzip). Rejects with pg_dump's message. */
function dump(url: string, file: string) {
  return new Promise<void>((resolve, reject) => {
    // The connection goes in the environment, not the arguments (the password would show in `ps`).
    const u = new URL(url);
    const env = { ...process.env, PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: u.pathname.replace(/^\//, '') };
    const child = spawn('pg_dump', [], { stdio: ['ignore', 'pipe', 'pipe'], env });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)));
    const out = createWriteStream(file);
    child.stdout.pipe(createGzip()).pipe(out);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `pg_dump exited with ${code}`));
      out.on('close', () => resolve());
      if (out.closed) resolve();
    });
  });
}

export async function runBackup(db: DbOrTx, now: Date) {
  const dir = backupDir();
  const url = process.env.DATABASE_URL;
  if (!dir || !url) return null;
  const state: BackupState = { at: now.toISOString(), ok: false };
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, `transverse-${now.toISOString().slice(0, 10)}.sql.gz`);
    await dump(url, file);
    state.ok = true;
    state.file = file;
    state.bytes = statSync(file).size;
    // The oldest copies go.
    const copies = readdirSync(dir).filter((f) => /^transverse-\d{4}-\d{2}-\d{2}\.sql\.gz$/.test(f)).sort();
    for (const old of copies.slice(0, Math.max(0, copies.length - BACKUP.keep))) unlinkSync(join(dir, old));
  } catch (error) {
    state.error = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  }
  await db.insert(jobState).values({ key: KEY, value: state }).onConflictDoUpdate({ target: jobState.key, set: { value: state, updatedAt: now } });
  // A failure is shown in the admin panel (Система); the next try is the next night.
  if (!state.ok) console.error('[backup] failed', state.error);
  return state;
}
