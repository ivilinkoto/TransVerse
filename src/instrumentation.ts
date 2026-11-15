/** Runs once when the Next.js server starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { loadSecretsFile } = await import('@/server/secrets');
  loadSecretsFile();
  // Starts, memory and uncaught errors of the web process for Админ → Система (the 502s).
  if (process.env.NODE_ENV === 'production') {
    const [{ watchProcess }, { getDb }] = await Promise.all([import('@/server/process-health'), import('@/server/db/client')]);
    watchProcess(getDb, 'web');
  }
}

/** 1.1.4: an error while rendering a page or a route is also kept for the admin panel. */
export async function onRequestError(error: unknown, request: { path: string; method: string }) {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // A redirect or "not found" is not an error.
  const digest = (error as { digest?: string } | null)?.digest ?? '';
  if (digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_HTTP_ERROR_FALLBACK') || digest === 'NEXT_NOT_FOUND') return;
  // The browser leaving mid-stream (recordServerError skips it) is not one either.
  const { recordServerError } = await import('@/server/error-log');
  await recordServerError(`${request.method} ${request.path}`, error);
}
