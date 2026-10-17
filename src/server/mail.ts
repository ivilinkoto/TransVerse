/**
 * Outgoing e-mail through any SMTP provider (Brevo, Gmail, the domain's own
 * mailbox…). Settings come from the environment / GitHub Secrets. Without them
 * nothing is sent: in development the message is printed to the console.
 */
import nodemailer, { type Transporter } from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
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

export async function sendMail(mail: Mail): Promise<boolean> {
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
  await transporter.sendMail({ from: config.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
  return true;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A simple branded e-mail with one button. */
export function layoutMail(input: { to: string; subject: string; heading: string; lines: string[]; button: { label: string; url: string }; footer: string }): Mail {
  const text = [input.heading, '', ...input.lines, '', `${input.button.label}: ${input.button.url}`, '', input.footer, '', '— TransVerse'].join('\n');
  const html = `<!doctype html><html lang="bg"><body style="margin:0;background:#05070b;font-family:Arial,Helvetica,sans-serif;color:#e8eef7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#05070b;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0e131b;border:1px solid #263347;border-radius:16px;padding:28px">
<tr><td style="font-size:20px;font-weight:bold;color:#ffffff">Trans<span style="color:#22d3ee">Verse</span></td></tr>
<tr><td style="padding-top:18px;font-size:18px;font-weight:bold;color:#ffffff">${escape(input.heading)}</td></tr>
${input.lines.map((l) => `<tr><td style="padding-top:10px;font-size:15px;line-height:1.5;color:#c8d3e1">${escape(l)}</td></tr>`).join('')}
<tr><td style="padding-top:22px"><a href="${escape(input.button.url)}" style="display:inline-block;background:#2f7bff;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:12px">${escape(input.button.label)}</a></td></tr>
<tr><td style="padding-top:18px;font-size:12px;line-height:1.5;color:#7c8aa0">${escape(input.footer)}<br>Ако бутонът не работи, отвори: ${escape(input.button.url)}</td></tr>
</table></td></tr></table></body></html>`;
  return { to: input.to, subject: input.subject, text, html };
}
