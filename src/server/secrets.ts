import { readFileSync } from 'node:fs';

/**
 * Payment (and HTTPS cookie) settings managed from GitHub Secrets: the Deploy workflow writes them
 * to a file only the deploy user can read, and both the web app and the worker
 * load it at start. Only these names are accepted; values are never logged.
 */
const MANAGED = /^(PAYPAL_(CLIENT_ID|CLIENT_SECRET|ENV|WEBHOOK_ID)|STRIPE_(SECRET_KEY|WEBHOOK_SECRET|AUTOMATIC_TAX)|APP_URL|COOKIE_SECURE|SELLER_(NAME|ID|ADDRESS)|SUPPORT_EMAIL|SMTP_(HOST|PORT|USER|PASS|SECURE)|MAIL_FROM|VAPID_(PUBLIC_KEY|PRIVATE_KEY|SUBJECT)|DISCORD_(BOT_TOKEN|CLIENT_SECRET|PUBLIC_KEY|APPLICATION_ID|GUILD_ID))$/;
export const DEFAULT_SECRETS_FILE = '/var/www/transverse/shared/secrets.env';

/** Parses KEY=value lines (no shell expansion); returns how many settings were applied. */
export function loadSecretsFile(path = process.env.SECRETS_FILE ?? DEFAULT_SECRETS_FILE): number {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return 0; // no file — settings come from the normal environment only
  }
  let applied = 0;
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq < 1 || line.trimStart().startsWith('#')) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!MANAGED.test(key) || !value) continue;
    process.env[key] = value;
    applied++;
  }
  return applied;
}
