import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { rateLimit } from '@/server/auth/rate-limit';
import { SESSION_COOKIE, validateSession, type SessionUser } from '@/server/auth/session';
import { getDb } from '@/server/db/client';
import { GameError } from '@/server/game/errors';
import { recordServerError } from '@/server/error-log';
import { localeOfRequest, withLocale } from '@/i18n/server';
import { t, tx } from '@/i18n/t';

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'local';
}

/** Current signed-in user for server components and route handlers (null when anonymous). */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await validateSession(getDb(), token);
  return session?.user ?? null;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new GameError('unauthorized', t('Нужно е да влезете в профила си.'), 401);
  return user;
}

/** Same-origin check for state-changing requests (defence in depth on top of SameSite cookies). */
async function assertSameOrigin(request: Request) {
  if (request.method === 'GET' || request.method === 'HEAD') return;
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!origin || !host || new URL(origin).host !== host) throw new GameError('bad_origin', t('Невалиден произход на заявката.'), 403);
}

export function errorResponse(error: unknown, where = 'api') {
  // Messages are Bulgarian text keys: shown in the player's language (fixed schema messages too).
  if (error instanceof GameError) return NextResponse.json({ error: error.code, message: tx(error.message) }, { status: error.status });
  if (error instanceof ZodError) return NextResponse.json({ error: 'invalid_input', message: tx(error.issues[0]?.message ?? 'Невалидни данни.') }, { status: 400 });
  console.error('[api] unexpected error', error);
  // 1.1.4: the admin panel shows the last ones (Система).
  void recordServerError(where, error);
  return NextResponse.json({ error: 'internal', message: t('Възникна неочаквана грешка. Опитайте отново.') }, { status: 500 });
}

interface HandlerOptions<T> {
  schema?: ZodType<T>;
  /** Requests per minute per user (or per IP when anonymous). */
  perMinute?: number;
  auth?: boolean;
}

/** Wraps a route handler with origin check, auth, rate limiting, validation and error mapping. */
export function handler<T = undefined>(options: HandlerOptions<T>, fn: (ctx: { user: SessionUser; input: T; request: Request }) => Promise<unknown>) {
  // v2.0: the request runs in the player's language (cookie, else the browser's).
  return async (request: Request) => withLocale(localeOfRequest(request), async () => {
    try {
      await assertSameOrigin(request);
      const user = options.auth === false ? (null as unknown as SessionUser) : await requireUser();
      // Each endpoint has its own budget, so one busy route cannot lock a player out of another.
      await rateLimit(getDb(), `api:${new URL(request.url).pathname}:${user?.id ?? await clientIp()}`, options.perMinute ?? 120, 60);
      let input = undefined as T;
      if (options.schema) {
        const raw = request.method === 'GET' ? Object.fromEntries(new URL(request.url).searchParams) : await request.json().catch(() => ({}));
        input = options.schema.parse(raw);
      }
      const result = await fn({ user, input, request });
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (error) {
      return errorResponse(error, `${request.method} ${new URL(request.url).pathname}`);
    }
  });
}
