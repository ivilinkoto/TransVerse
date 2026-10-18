import { headers } from 'next/headers';
import { cache } from 'react';

/** The live site, for link previews when APP_URL is not set. */
export const DEFAULT_SITE_URL = 'https://transverse-bg.com';

/** Link-preview card (public/og.png). Relative: resolved against metadataBase. */
export const OG_IMAGE = { url: '/og.png', width: 1200, height: 630, alt: 'TransVerse — транспортна стратегия върху реалната карта на Европа' };

/** APP_URL when it is a full address (no trailing slash). */
export function configuredSiteUrl(): string | null {
  const url = process.env.APP_URL?.trim();
  return url && /^https?:\/\/[^\s/]+/i.test(url) ? url.replace(/\/$/, '') : null;
}

/**
 * The address players use: APP_URL, else the host the proxy forwarded. Never
 * `request.url` — behind the proxy that is the internal 127.0.0.1:3000.
 */
export async function publicOrigin(): Promise<string> {
  const configured = configuredSiteUrl();
  if (configured) return configured;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!host) return DEFAULT_SITE_URL;
  return `${h.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'http'}://${host}`;
}

/** The request's time for public pages (outside the game's context). */
export const requestNow = cache(() => new Date());
