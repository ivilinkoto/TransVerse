import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { adminResetLink } from '@/server/admin';
import { authenticate } from '@/server/auth/accounts';
import { requestPasswordReset, resetLinkValid, resetPassword, sendVerification, verifyEmail } from '@/server/auth/email-links';
import { createSession, validateSession } from '@/server/auth/session';
import { closeDb } from '@/server/db/client';
import { emailTokens, jobState, pushSubscriptions, users } from '@/server/db/schema';
import { sendChatMessage } from '@/server/game/chat';
import { GameError } from '@/server/game/errors';
import { joinCompany, updateSettings } from '@/server/game/membership';
import { notify } from '@/server/game/notify';
import { organizations } from '@/server/db/schema';
import { setMailSender, type Mail } from '@/server/mail';
import { startPayment } from '@/server/payments/common';
import { categoryOf, dispatchPush, setPushPrefs, subscribe, unsubscribe, vapidKeys, wants, type PushSender } from '@/server/push';
import { db, newPlayer, playerWithCompany } from './helpers';

const sent: Mail[] = [];
setMailSender(async (m) => void sent.push(m));
afterAll(async () => {
  setMailSender(null);
  await closeDb();
});

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).name));
const BASE = 'https://transverse.example';
const tokenFrom = (m: Mail) => /token=([A-Za-z0-9_-]+)/.exec(m.text)![1]!;
const sub = (n: string) => ({ endpoint: `https://push.example.com/send/${n}`, keys: { p256dh: 'BPp256dh-test-key-value', auth: 'auth-secret-1' } });
const staff = async (role: 'admin' | 'support' | 'founder') => {
  const p = await newPlayer();
  await db().update(users).set({ role }).where(eq(users.id, p.userId));
  return { id: p.userId, role, username: p.username };
};

describe('push notifications', () => {
  it('maps notifications to categories the player can switch off', () => {
    expect(categoryOf('/game/contracts')).toBe('urgent');
    expect(categoryOf('/game/finance')).toBe('deliveries');
    expect(categoryOf('/game/events')).toBe('events');
    expect(categoryOf('/game/company/chat')).toBe('chat');
    expect(categoryOf('/game/company/missions')).toBe('company');
    expect(categoryOf(null)).toBe('general');
    expect(wants({}, 'urgent')).toBe(true);
    expect(wants({ urgent: false }, 'urgent')).toBe(false);
  });

  it('generates the keys once and keeps them', async () => {
    const a = await vapidKeys(db());
    const b = await vapidKeys(db());
    expect(a.publicKey).toBe(b.publicKey);
    expect(a.publicKey.length).toBeGreaterThan(40);
    const [stored] = await db().select().from(jobState).where(eq(jobState.key, 'vapid'));
    expect((stored!.value as { publicKey: string }).publicKey).toBe(a.publicKey);
  });

  it('sends new notifications to subscribed devices, as a summary when there are many, honouring the choices', async () => {
    const p = await newPlayer();
    const other = await newPlayer();
    expect(await code(subscribe(db(), p.userId, { ...sub('x'), endpoint: 'http://insecure.example/1' }))).toBe('ZodError');
    await subscribe(db(), p.userId, sub(`a-${p.userId}`));
    const deliveries: { endpoint: string; payload: { title: string; body: string; url: string } }[] = [];
    let status = 201;
    const fake: PushSender = async (s, payload) => {
      if (status === 410) throw Object.assign(new Error('gone'), { statusCode: 410 });
      deliveries.push({ endpoint: s.endpoint, payload: JSON.parse(payload) });
      return status;
    };
    // Start from "now": nothing older is pushed.
    await dispatchPush(db(), new Date(), fake);
    deliveries.length = 0;

    await notify(db(), p.userId, 'success', 'Доставено: Мебели в Пловдив', 'Нетен резултат 500 €', '/game/finance');
    await notify(db(), other.userId, 'info', 'Не е за теб', '—', '/game');
    await dispatchPush(db(), new Date(), fake);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.payload).toMatchObject({ title: 'Доставено: Мебели в Пловдив', url: '/game/finance' });

    deliveries.length = 0;
    await setPushPrefs(db(), p.userId, { urgent: false });
    await notify(db(), p.userId, 'warning', 'Спешна доставка: Лекарства', '…', '/game/contracts');
    await dispatchPush(db(), new Date(), fake);
    expect(deliveries).toHaveLength(0);

    for (const n of [1, 2, 3]) await notify(db(), p.userId, 'achievement', `Постижение ${n}`, '…', '/game/progress');
    await dispatchPush(db(), new Date(), fake);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.payload.title).toBe('3 нови известия в TransVerse');

    // A device that is gone is forgotten.
    status = 410;
    await notify(db(), p.userId, 'info', 'Още нещо', '…', '/game');
    await dispatchPush(db(), new Date(), fake);
    expect(await db().select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, p.userId))).toHaveLength(0);
  });

  it('pushes company chat to members who are not in the game', async () => {
    const owner = await playerWithCompany();
    const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, owner.userId));
    await updateSettings(db(), owner.userId, { recruitment: 'open', minJoinLevel: 1, contributionRate: 0.05 });
    const away = await newPlayer();
    await joinCompany(db(), away.userId, org!.id);
    await db().update(users).set({ lastSeenAt: new Date(Date.now() - 3_600_000) }).where(eq(users.id, away.userId));
    await subscribe(db(), away.userId, sub(`chat-${away.userId}`));
    await subscribe(db(), owner.userId, sub(`chat-${owner.userId}`));
    const got: { endpoint: string; title: string }[] = [];
    const fake: PushSender = async (s, payload) => (got.push({ endpoint: s.endpoint, title: JSON.parse(payload).title }), 201);
    await dispatchPush(db(), new Date(), fake);
    got.length = 0;
    await sendChatMessage(db(), owner.userId, 'Утре голям търг!');
    await dispatchPush(db(), new Date(), fake);
    const toAway = got.filter((g) => g.endpoint.endsWith(away.userId));
    expect(toAway).toHaveLength(1);
    expect(toAway[0]!.title).toContain(owner.username);
    // The author does not get their own message.
    expect(got.some((g) => g.endpoint.endsWith(owner.userId))).toBe(false);
    await unsubscribe(db(), away.userId, sub(`chat-${away.userId}`).endpoint);
  });
});

describe('e-mail links', () => {
  it('confirms the address once', async () => {
    const p = await newPlayer();
    sent.length = 0;
    await sendVerification(db(), p.userId, BASE);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain(`${BASE}/verify-email?token=`);
    const token = tokenFrom(sent[0]!);
    await verifyEmail(db(), token);
    expect((await db().select().from(users).where(eq(users.id, p.userId)))[0]!.emailVerifiedAt).not.toBeNull();
    expect(await code(verifyEmail(db(), token))).toBe('invalid_link');
    expect(await code(sendVerification(db(), p.userId, BASE))).toBe('already_verified');
    // Only a hash of the token is stored.
    const rows = await db().select().from(emailTokens).where(eq(emailTokens.userId, p.userId));
    expect(rows.every((r) => r.tokenHash !== token && r.tokenHash.length === 64)).toBe(true);
  });

  it('resets a forgotten password without revealing who is registered', async () => {
    const p = await newPlayer();
    const [u] = await db().select().from(users).where(eq(users.id, p.userId));
    sent.length = 0;
    const unknown = await requestPasswordReset(db(), { email: 'nobody-here@example.com' }, `ip-${p.userId}`, BASE);
    const known = await requestPasswordReset(db(), { email: u!.email.toUpperCase() }, `ip-${p.userId}`, BASE);
    expect(unknown).toEqual(known);
    expect(sent).toHaveLength(1);
    const token = tokenFrom(sent[0]!);
    expect(await resetLinkValid(db(), token)).toBe(true);

    const session = await createSession(db(), p.userId, 'test');
    await resetPassword(db(), { token, password: 'нова-парола-123' });
    expect(await validateSession(db(), session.token)).toBeNull();
    expect(await authenticate(db(), { login: u!.email, password: 'нова-парола-123' })).toBe(p.userId);
    expect(await code(resetPassword(db(), { token, password: 'друга-парола' }))).toBe('invalid_link');
    // Resetting by e-mail also proves the address.
    expect((await db().select().from(users).where(eq(users.id, p.userId)))[0]!.emailVerifiedAt).not.toBeNull();

    // An expired link does not work.
    await requestPasswordReset(db(), { email: u!.email }, `ip2-${p.userId}`, BASE);
    const late = tokenFrom(sent.at(-1)!);
    await db().update(emailTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(emailTokens.userId, p.userId));
    expect(await resetLinkValid(db(), late)).toBe(false);
    expect(await code(resetPassword(db(), { token: late, password: 'още-една-парола' }))).toBe('invalid_link');
  });

  it('administrators can create a reset link; founders are protected', async () => {
    const admin = await staff('admin');
    const support = await staff('support');
    const founder = await staff('founder');
    const p = await newPlayer();
    expect(await code(adminResetLink(db(), support, p.userId, BASE))).toBe('forbidden');
    const url = await adminResetLink(db(), admin, p.userId, BASE);
    expect(url).toMatch(/^https:\/\/transverse\.example\/reset-password\?token=/);
    expect(await resetLinkValid(db(), new URL(url).searchParams.get('token')!)).toBe(true);
    expect(await code(adminResetLink(db(), admin, founder.id, BASE))).toBe('forbidden');
  });

  it('purchases need a confirmed address once e-mail is switched on', async () => {
    const p = await newPlayer();
    const env = { SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u', SMTP_PASS: 'p', MAIL_FROM: 'TransVerse <no-reply@example.com>' };
    Object.assign(process.env, env);
    try {
      expect(await code(startPayment(db(), p.userId, { productId: 'tc_100', provider: 'paypal', consent: true }, new Date()))).toBe('email_unverified');
      await db().update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, p.userId));
      expect((await startPayment(db(), p.userId, { productId: 'tc_100', provider: 'paypal', consent: true }, new Date())).payment.status).toBe('pending');
    } finally {
      for (const k of Object.keys(env)) delete process.env[k];
    }
  });
});

describe('mail sender address', () => {
  it('reads the address and domain from MAIL_FROM', async () => {
    const { fromAddress, fromDomain } = await import('@/server/mail');
    expect(fromAddress('TransVerse <No-Reply@Transverse-BG.com>')).toBe('no-reply@transverse-bg.com');
    expect(fromDomain('TransVerse <no-reply@transverse-bg.com>')).toBe('transverse-bg.com');
    expect(fromDomain('someone@gmail.com')).toBe('gmail.com');
    expect(fromDomain('')).toBe('');
  });
});

