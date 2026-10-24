/**
 * Outgoing e-mail through any SMTP provider (Brevo, Gmail, the domain's own
 * mailbox…). Settings come from the environment / GitHub Secrets. Without them
 * nothing is sent: in development the message is printed to the console.
 */
import { randomUUID } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { getDb } from '@/server/db/client';
import { mailLog } from '@/server/db/schema';
import { t } from '@/i18n/t';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** For the delivery log: verify | reset | test. */
  kind?: string;
  userId?: string | null;
}

/** The address part of MAIL_FROM ("TransVerse <no-reply@x.com>" → no-reply@x.com). */
export function fromAddress(from = process.env.MAIL_FROM ?? '') {
  return (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
}
export const fromDomain = (from?: string) => fromAddress(from).split('@')[1] ?? '';

async function record(mail: Mail, status: 'sent' | 'rejected' | 'failed', messageId: string | null, response: string | null) {
  try {
    await getDb().insert(mailLog).values({ kind: mail.kind ?? 'other', recipient: mail.to.toLowerCase(), userId: mail.userId ?? null, subject: mail.subject, status, messageId, response: response?.slice(0, 500) ?? null });
  } catch (error) {
    console.error('[mail] could not write the log', error);
  }
}
export type MailSender = (mail: Mail) => Promise<void>;

export function mailConfig() {
  const env = process.env;
  const missing = [!env.SMTP_HOST && 'SMTP_HOST', !env.SMTP_USER && 'SMTP_USER', !env.SMTP_PASS && 'SMTP_PASS', !env.MAIL_FROM && 'MAIL_FROM'].filter((x): x is string => !!x);
  return { enabled: missing.length === 0, missing, from: env.MAIL_FROM ?? '' };
}

let transporter: Transporter | null = null;
let override: MailSender | null = null;

/** Tests replace the sender to capture messages. */
export function setMailSender(sender: MailSender | null) {
  override = sender;
}

export async function sendMail(input: Mail, kind?: string, userId?: string | null): Promise<boolean> {
  const mail: Mail = { ...input, kind: kind ?? input.kind, userId: userId ?? input.userId };
  if (override) {
    await override(mail);
    return true;
  }
  const config = mailConfig();
  if (!config.enabled) {
    if (process.env.NODE_ENV !== 'production') console.info(`[mail] (not configured) to ${mail.to}: ${mail.subject}\n${mail.text}`);
    return false;
  }
  const port = Number(process.env.SMTP_PORT ?? 587);
  transporter ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15_000,
  });
  // Strict mailboxes (abv.bg, mail.bg…) check that the message looks like a proper transactional mail:
  // a Message-ID on the sender's own domain, a reply address, a plain-text part and the auto-generated mark.
  const domain = fromDomain(config.from) || 'transverse-bg.com';
  const messageId = `<${randomUUID()}@${domain}>`;
  try {
    const info = await transporter.sendMail({
      from: config.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      messageId,
      replyTo: process.env.SUPPORT_EMAIL || undefined,
      headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All', 'X-Entity-Ref-ID': randomUUID() },
    });
    const rejected = (info.rejected ?? []).length > 0;
    await record(mail, rejected ? 'rejected' : 'sent', info.messageId ?? messageId, String(info.response ?? ''));
    if (rejected) throw new Error(t('Пощенският сървър отказа адреса: {0}', String(info.response ?? '')));
    return true;
  } catch (error) {
    if (!(error instanceof Error && error.message.startsWith('Пощенският сървър отказа'))) await record(mail, 'failed', messageId, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A simple branded e-mail with one button. */
export function layoutMail(input: { to: string; subject: string; heading: string; lines: string[]; button: { label: string; url: string }; footer: string }): Mail {
  const text = [input.heading, '', ...input.lines, '', `${input.button.label}: ${input.button.url}`, '', input.footer, '', '— TransVerse'].join('\n');
  const html = t('<!doctype html><html lang="bg"><body style="margin:0;background:#05070b;font-family:Arial,Helvetica,sans-serif;color:#e8eef7">\n<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#05070b;padding:24px 12px"><tr><td align="center">\n<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0e131b;border:1px solid #263347;border-radius:16px;padding:28px">\n<tr><td style="font-size:20px;font-weight:bold;color:#ffffff">Trans<span style="color:#22d3ee">Verse</span></td></tr>\n<tr><td style="padding-top:18px;font-size:18px;font-weight:bold;color:#ffffff">{0}</td></tr>\n{1}\n<tr><td style="padding-top:22px"><a href="{2}" style="display:inline-block;background:#2f7bff;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:12px">{3}</a></td></tr>\n<tr><td style="padding-top:18px;font-size:12px;line-height:1.5;color:#7c8aa0">{4}<br>Ако бутонът не работи, отвори: {5}</td></tr>\n</table></td></tr></table></body></html>', escape(input.heading), input.lines.map((l) => `<tr><td style="padding-top:10px;font-size:15px;line-height:1.5;color:#c8d3e1">${escape(l)}</td></tr>`).join(''), escape(input.button.url), escape(input.button.label), escape(input.footer), escape(input.button.url));
  return { to: input.to, subject: input.subject, text, html };
}
