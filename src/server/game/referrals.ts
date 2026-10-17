import { createHash, randomBytes } from 'node:crypto';
import { and, count, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { REFERRAL, REFERRAL_CODE } from '@/lib/game/referrals';
import type { DbOrTx, Tx } from '@/server/db/client';
import { companies, deliveries, jobState, users } from '@/server/db/schema';
import { mailConfig } from '@/server/mail';
import { postCoins } from './coins';
import { post } from './finance';
import { logActivity, notify } from './notify';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** The player's invite code, created on first use. */
export async function ensureReferralCode(db: DbOrTx, userId: string): Promise<string> {
  const [u] = await db.select({ code: users.referralCode }).from(users).where(eq(users.id, userId));
  if (u?.code) return u.code;
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const set = await db
      .update(users)
      .set({ referralCode: code })
      .where(and(eq(users.id, userId), sql`${users.referralCode} is null`, sql`not exists (select 1 from ${users} u2 where u2.referral_code = ${code})`))
      .returning({ code: users.referralCode });
    if (set[0]?.code) return set[0].code;
    const [again] = await db.select({ code: users.referralCode }).from(users).where(eq(users.id, userId));
    if (again?.code) return again.code;
  }
  throw new Error('could not create a referral code');
}

let salt: string | null = null;
/** Random server salt (stored once) so sign-up IPs are kept only as hashes. */
async function ipSalt(db: DbOrTx): Promise<string> {
  if (salt) return salt;
  const [row] = await db.select().from(jobState).where(eq(jobState.key, 'ip-salt'));
  if (row) return (salt = (row.value as { salt: string }).salt);
  await db.insert(jobState).values({ key: 'ip-salt', value: { salt: randomBytes(24).toString('hex') } }).onConflictDoNothing();
  const [stored] = await db.select().from(jobState).where(eq(jobState.key, 'ip-salt'));
  return (salt = (stored!.value as { salt: string }).salt);
}

export async function hashIp(db: DbOrTx, ip: string): Promise<string | null> {
  if (!ip || ip === 'local') return null;
  return createHash('sha256').update(`${await ipSalt(db)}:${ip}`).digest('hex');
}

/** At sign-up: remembers who invited the player (unknown codes are ignored). */
export async function attachReferral(db: DbOrTx, userId: string, code: string | null | undefined, ipHash: string | null) {
  const clean = code?.trim().toUpperCase();
  const [inviter] = clean && REFERRAL_CODE.test(clean) ? await db.select({ id: users.id }).from(users).where(eq(users.referralCode, clean)) : [];
  await db
    .update(users)
    .set({ signupIpHash: ipHash, referredById: inviter && inviter.id !== userId ? inviter.id : null })
    .where(eq(users.id, userId));
  if (inviter && inviter.id !== userId) await logActivity(db, userId, 'referred', { inviterId: inviter.id });
}

async function deliveriesOf(tx: DbOrTx, userId: string) {
  const [row] = await tx
    .select({ n: count() })
    .from(deliveries)
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .where(and(eq(companies.ownerId, userId), eq(deliveries.status, 'completed')));
  return row?.n ?? 0;
}

/**
 * After each delivery of an invited player: once they reach the required number
 * of deliveries (and confirmed their e-mail when mail is on), both players are
 * paid once. Invites from the same network or over the monthly limit are closed
 * without a reward.
 */
export async function rewardReferral(tx: Tx, userId: string, now = new Date()) {
  const [peek] = await tx.select({ by: users.referredById, done: users.referralRewardedAt }).from(users).where(eq(users.id, userId));
  if (!peek?.by || peek.done) return false;
  const [me] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
  if (!me?.referredById || me.referralRewardedAt) return false;
  if ((await deliveriesOf(tx, userId)) < REFERRAL.deliveriesNeeded) return false;
  if (mailConfig().enabled && !me.emailVerifiedAt) return false;
  const [inviter] = await tx.select().from(users).where(eq(users.id, me.referredById));
  const [{ recent = 0 } = {}] = inviter
    ? await tx.select({ recent: count() }).from(users).where(and(eq(users.referredById, inviter.id), eq(users.referralOutcome, 'rewarded'), isNotNull(users.referralRewardedAt), gte(users.referralRewardedAt, new Date(now.getTime() - 30 * 86_400_000))))
    : [];
  const sameNetwork = !!inviter?.signupIpHash && inviter.signupIpHash === me.signupIpHash;
  const declined = !inviter || !!inviter.bannedAt || sameNetwork || recent >= REFERRAL.monthlyLimit;
  await tx.update(users).set({ referralRewardedAt: now, referralOutcome: declined ? 'declined' : 'rewarded' }).where(eq(users.id, userId));
  if (declined) {
    await logActivity(tx, userId, 'referral_not_rewarded', { inviterId: me.referredById, sameNetwork, recent });
    return false;
  }
  const [mine] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
  const [theirs] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, inviter.id));
  const key = `referral:${userId}`;
  if (mine) await post(tx, mine.id, [{ category: 'referral_reward', amountCents: REFERRAL.inviteeCents, description: `Награда: поканен от ${inviter.username}`, idempotencyKey: `${key}:invitee` }]);
  if (theirs) await post(tx, theirs.id, [{ category: 'referral_reward', amountCents: REFERRAL.inviterCents, description: `Награда за поканен приятел: ${me.username}`, idempotencyKey: `${key}:inviter` }]);
  await postCoins(tx, inviter.id, { amount: REFERRAL.inviterCoins, reason: 'referral_reward', description: `Поканен приятел: ${me.username}`, idempotencyKey: `${key}:coins` });
  await notify(tx, userId, 'success', 'Награда за добър старт', `${inviter.username} те покани в TransVerse — получаваш ${(REFERRAL.inviteeCents / 100).toLocaleString('bg-BG')} €.`, '/game/finance');
  await notify(tx, inviter.id, 'success', `${me.username} вече кара!`, `Поканеният ти приятел направи ${REFERRAL.deliveriesNeeded} доставки. Получаваш ${(REFERRAL.inviterCents / 100).toLocaleString('bg-BG')} € и ${REFERRAL.inviterCoins} TC.`, '/game/invite');
  return true;
}

/** Invited players and their progress, for the "Покани приятел" card. */
export async function referralStats(db: DbOrTx, userId: string) {
  const invited = await db
    .select({ id: users.id, username: users.username, rewardedAt: users.referralRewardedAt, outcome: users.referralOutcome, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.referredById, userId))
    .orderBy(desc(users.createdAt))
    .limit(50);
  const withProgress = await Promise.all(invited.map(async (u) => ({ ...u, deliveries: u.rewardedAt ? REFERRAL.deliveriesNeeded : Math.min(REFERRAL.deliveriesNeeded, await deliveriesOf(db, u.id)) })));
  return { invited: withProgress, rewarded: invited.filter((u) => u.outcome === 'rewarded').length };
}
