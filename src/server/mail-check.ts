import { resolveCname, resolveTxt } from 'node:dns/promises';
import { desc } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { mailLog } from '@/server/db/schema';
import { fromAddress, fromDomain, mailConfig } from '@/server/mail';
import { t as tr } from '@/i18n/t';

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
  const spfInclude = provider[0] ? `include:${provider[0]}` : tr('include:<на доставчика>');
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
  if (!config.enabled) problems.push(tr('Пощата не е настроена: липсват {0}.', config.missing.join(', ')));
  if (freeMailbox) problems.push(tr('MAIL_FROM е адрес в {0}. Писма „от“ {1}, пратени през друг сървър ({2}), не минават проверките на abv.bg, mail.bg и др. Използвай адрес на своя домейн, напр. no-reply@transverse-bg.com.', domain, domain, host || 'SMTP'));
  // Spacemail sends only as the mailbox that logs in.
  const user = (process.env.SMTP_USER ?? '').trim().toLowerCase();
  if (kind === 'spacemail' && from && user && from !== user) problems.push(tr('MAIL_FROM ({0}) е различен от SMTP_USER ({1}). Spacemail праща само от пощата, с която се влиза — сложи MAIL_FROM: TransVerse <{2}>.', from, user, user));
  if (!freeMailbox && domain && !spf) problems.push(tr('Няма SPF запис за {0}. Добави TXT запис на @: v=spf1 {1} ~all', domain, spfInclude));
  if (spf && spfCoversHost === false) problems.push(tr('SPF записът на {0} не разрешава сървъра {1}. Добави {2} в същия запис (трябва да има само един SPF запис).', domain, host, spfInclude));
  if (!freeMailbox && domain && !dkim.length)
    problems.push(
      kind === 'spacemail'
        ? tr('Не е намерен DKIM подпис за {0}. В Spaceship → Advanced DNS → Inactive records има запис spacemail._domainkey (TXT, започва с v=DKIM1; k=rsa;) — активирай го. Работи след няколко часа.', domain)
        : kind === 'brevo'
          ? tr('Не е намерен DKIM подпис за {0}. В Brevo: Senders, Domains & Dedicated IPs → Domains → удостовери домейна и добави показаните DNS записи (brevo1/brevo2._domainkey).', domain)
          : tr('Не е намерен DKIM подпис за {0}. Добави DKIM записа, който дава доставчикът на пощата.', domain),
    );
  if (!freeMailbox && domain && !dmarc) problems.push(tr('Няма DMARC запис. Добави TXT запис _dmarc.{0}: v=DMARC1; p=none; rua=mailto:{1}', domain, process.env.SUPPORT_EMAIL || `postmaster@${domain}`));
  return { enabled: config.enabled, provider: kind, missing: config.missing, host, from, domain, freeMailbox, spf, spfCoversHost, dmarc, dkim: dkim.sort(), problems };
}

export async function recentMail(db: DbOrTx, limit = 100) {
  return db.select().from(mailLog).orderBy(desc(mailLog.id)).limit(limit);
}
