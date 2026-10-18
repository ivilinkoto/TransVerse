import { resolveCname, resolveTxt } from 'node:dns/promises';
import { desc } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { mailLog } from '@/server/db/schema';
import { fromAddress, fromDomain, mailConfig } from '@/server/mail';

/** Free mailbox domains: a game cannot send "from" them through another server — strict providers reject it. */
const FREE_MAILBOXES = ['gmail.com', 'googlemail.com', 'abv.bg', 'mail.bg', 'dir.bg', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'yandex.com', 'gmx.com'];
/** DKIM selectors used by common providers (Brevo, Google Workspace, Microsoft, Mailgun, SendGrid…). */
const DKIM_SELECTORS = ['spacemail', 'brevo1', 'brevo2', 'mail', 'default', 'google', 'selector1', 'selector2', 'k1', 's1', 's2', 'smtp', 'mx', 'dkim'];

async function txt(name: string): Promise<string[]> {
  try {
    return (await resolveTxt(name)).map((parts) => parts.join(''));
  } catch {
    return [];
  }
}

export interface MailCheck {
  enabled: boolean;
  provider: string;
  missing: string[];
  host: string;
  from: string;
  domain: string;
  freeMailbox: boolean;
  spf: string | null;
  spfCoversHost: boolean | null;
  dmarc: string | null;
  dkim: string[];
  problems: string[];
}

/** What a strict mailbox (abv.bg, mail.bg) checks before it accepts our mail, and what is missing. */
export async function checkMailSetup(): Promise<MailCheck> {
  const config = mailConfig();
  const host = process.env.SMTP_HOST ?? '';
  const from = fromAddress(config.from);
  const domain = fromDomain(config.from);
  const freeMailbox = FREE_MAILBOXES.includes(domain);
  const spf = domain ? ((await txt(domain)).find((t) => t.toLowerCase().startsWith('v=spf1')) ?? null) : null;
  // Which SPF include authorises the SMTP server: Spacemail (Spaceship), Brevo, Google.
  const kind = host.includes('spacemail') ? 'spacemail' : host.includes('brevo') || host.includes('sendinblue') ? 'brevo' : host.includes('gmail') || host.includes('google') ? 'google' : 'other';
  const provider = kind === 'spacemail' ? ['spf.spacemail.com'] : kind === 'brevo' ? ['spf.brevo.com', 'sendinblue.com'] : kind === 'google' ? ['_spf.google.com'] : [];
  const spfInclude = provider[0] ? `include:${provider[0]}` : 'include:<на доставчика>';
  const spfCoversHost = spf && provider.length ? provider.some((p) => spf.toLowerCase().includes(p)) : null;
  const dmarc = domain ? ((await txt(`_dmarc.${domain}`)).find((t) => t.toLowerCase().startsWith('v=dmarc1')) ?? null) : null;
  const dkim: string[] = [];
  if (domain && !freeMailbox) {
    await Promise.all(
      DKIM_SELECTORS.map(async (sel) => {
        const name = `${sel}._domainkey.${domain}`;
        const records = await txt(name);
        let found = records.some((r) => r.toLowerCase().includes('p='));
        if (!found) found = await resolveCname(name).then((c) => c.length > 0).catch(() => false);
        if (found) dkim.push(sel);
      }),
    );
  }
  const problems: string[] = [];
  if (!config.enabled) problems.push(`Пощата не е настроена: липсват ${config.missing.join(', ')}.`);
  if (freeMailbox) problems.push(`MAIL_FROM е адрес в ${domain}. Писма „от“ ${domain}, пратени през друг сървър (${host || 'SMTP'}), не минават проверките на abv.bg, mail.bg и др. Използвай адрес на своя домейн, напр. no-reply@transverse-bg.com.`);
  // Spacemail sends only as the mailbox that logs in.
  const user = (process.env.SMTP_USER ?? '').trim().toLowerCase();
  if (kind === 'spacemail' && from && user && from !== user) problems.push(`MAIL_FROM (${from}) е различен от SMTP_USER (${user}). Spacemail праща само от пощата, с която се влиза — сложи MAIL_FROM: TransVerse <${user}>.`);
  if (!freeMailbox && domain && !spf) problems.push(`Няма SPF запис за ${domain}. Добави TXT запис на @: v=spf1 ${spfInclude} ~all`);
  if (spf && spfCoversHost === false) problems.push(`SPF записът на ${domain} не разрешава сървъра ${host}. Добави ${spfInclude} в същия запис (трябва да има само един SPF запис).`);
  if (!freeMailbox && domain && !dkim.length)
    problems.push(
      kind === 'spacemail'
        ? `Не е намерен DKIM подпис за ${domain}. В Spaceship → Advanced DNS → Inactive records има запис spacemail._domainkey (TXT, започва с v=DKIM1; k=rsa;) — активирай го. Работи след няколко часа.`
        : kind === 'brevo'
          ? `Не е намерен DKIM подпис за ${domain}. В Brevo: Senders, Domains & Dedicated IPs → Domains → удостовери домейна и добави показаните DNS записи (brevo1/brevo2._domainkey).`
          : `Не е намерен DKIM подпис за ${domain}. Добави DKIM записа, който дава доставчикът на пощата.`,
    );
  if (!freeMailbox && domain && !dmarc) problems.push(`Няма DMARC запис. Добави TXT запис _dmarc.${domain}: v=DMARC1; p=none; rua=mailto:${process.env.SUPPORT_EMAIL || `postmaster@${domain}`}`);
  return { enabled: config.enabled, provider: kind, missing: config.missing, host, from, domain, freeMailbox, spf, spfCoversHost, dmarc, dkim: dkim.sort(), problems };
}

export async function recentMail(db: DbOrTx, limit = 100) {
  return db.select().from(mailLog).orderBy(desc(mailLog.id)).limit(limit);
}
