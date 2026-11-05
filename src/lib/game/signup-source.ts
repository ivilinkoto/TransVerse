/**
 * 1.2.4 „Откъде идват играчите“: a link with `?src=fb-shipka` (a Facebook
 * post, a video, a forum) leaves a cookie on the first visit; the sign-up
 * stores it on the account, and the admin page counts the players per source.
 */
export const SOURCE_COOKIE = 'tv_src';
export const SOURCE_DAYS = 30;

/** Lower-case letters, digits, dashes and underscores, up to 40; anything else is ignored. */
export function normalizeSource(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim().toLowerCase();
  return /^[a-z0-9_-]{2,40}$/.test(s) ? s : null;
}

/** The source from a Cookie header. */
export function sourceFromCookie(header: string | null | undefined): string | null {
  const m = (header ?? '').match(new RegExp(`(?:^|;\\s*)${SOURCE_COOKIE}=([^;]+)`));
  return normalizeSource(m ? decodeURIComponent(m[1]!) : null);
}
