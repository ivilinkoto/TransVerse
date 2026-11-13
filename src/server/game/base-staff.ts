/**
 * 1.4 „Персонал на базата“ on the server. The staff of a company live in job_state
 * `base-staff:<org>` = { [role]: { name, hiredAt } }; the weekly pay is one treasury posting per
 * role and ISO week (`base-staff-pay:<org>:<role>:<week>`); a day's story is posted once
 * (`base-staff-story:<org>:<day>`).
 */
import { eq, like } from 'drizzle-orm';
import { STAFF, STAFF_ROLES, staffAllowed, staffName, withStaff, type StaffRole } from '@/lib/game/base-staff';
import { featureOn } from '@/server/feature-off';
import type { MemberBonuses, UpgradeLevels } from '@/lib/game/company';
import { dayKey } from '@/lib/game/daily';
import { seededRandom } from '@/lib/game/road-events';
import { isoWeek } from '@/lib/game/shop-v2';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { companyMessages, jobState, organizations } from '@/server/db/schema';
import { t, tx } from '@/i18n/t';
import { botUserId } from './chat-life';
import { fail } from './errors';
import { postTreasury } from './finance';
import { notifyMembers, requirePermission } from './membership';

type Staff = Partial<Record<StaffRole, { name: string; hiredAt: string }>>;
const key = (orgId: string) => `base-staff:${orgId}`;

export async function staffOf(db: DbOrTx, orgId: string): Promise<Staff> {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key(orgId)));
  return (row?.value as Staff | undefined) ?? {};
}

/** The members' bonuses with the staff the company has now (the staff count only from 1.4 on). */
export async function staffBonuses(db: DbOrTx, orgId: string, bonuses: MemberBonuses, now = new Date()): Promise<MemberBonuses> {
  if (!(await featureOn(db, 'base_staff', now))) return bonuses;
  return withStaff(bonuses, Object.keys(await staffOf(db, orgId)) as StaffRole[]);
}

/** Hires a person for a role (the building is needed; the first week is paid at once). */
export async function hireStaff(db: Database, actorId: string, role: StaffRole, now: Date) {
  return db.transaction(async (tx) => {
    const m = await requirePermission(tx, actorId, 'build');
    if (!staffAllowed(role, m.company.upgrades as UpgradeLevels)) fail('no_building', t('Нужна е сградата „{0}“.', tx_(STAFF[role].buildingLabel)));
    const staff = await staffOf(tx, m.company.id);
    if (staff[role]) fail('hired', t('Тази длъжност вече е заета.'));
    const name = staffName(`${m.company.id}:${role}:${now.toISOString()}`);
    await pay(tx, m.company.id, role, now, true);
    await saveStaff(tx, m.company.id, { ...staff, [role]: { name, hiredAt: now.toISOString() } }, now);
    await notifyMembers(tx, m.company.id, null, () => t('Нов човек в базата'), () => t('{0} започва работа като {1}.', name, tx_(STAFF[role].label).toLowerCase()), '/game/company/plot');
    return { name };
  });
}

export async function fireStaff(db: Database, actorId: string, role: StaffRole, now: Date) {
  return db.transaction(async (tx) => {
    const m = await requirePermission(tx, actorId, 'build');
    const staff = await staffOf(tx, m.company.id);
    if (!staff[role]) fail('not_hired', t('Тази длъжност е свободна.'));
    const { [role]: _gone, ...rest } = staff;
    await saveStaff(tx, m.company.id, rest, now);
    return { ok: true };
  });
}

async function saveStaff(tx: Tx, orgId: string, staff: Staff, now: Date) {
  await tx.insert(jobState).values({ key: key(orgId), value: staff }).onConflictDoUpdate({ target: jobState.key, set: { value: staff, updatedAt: now } });
}

/** The week's pay for one role (once a week); without the money the person leaves. */
async function pay(tx: Tx, orgId: string, role: StaffRole, now: Date, mustPay: boolean): Promise<boolean> {
  const week = isoWeek(now);
  const [first] = await tx.insert(jobState).values({ key: `base-staff-pay:${orgId}:${role}:${week}`, value: { at: now.toISOString() } }).onConflictDoNothing().returning();
  if (!first) return true;
  const [org] = await tx.select({ treasury: organizations.treasuryCents }).from(organizations).where(eq(organizations.id, orgId));
  if ((org?.treasury ?? 0) < STAFF[role].weeklyCents) {
    if (mustPay) fail('insufficient_treasury', t('В касата на компанията няма достатъчно средства.'));
    return false;
  }
  await postTreasury(tx, orgId, [{ category: 'base_staff', amountCents: -STAFF[role].weeklyCents, description: t('Заплата: {0}', tx_(STAFF[role].label)), idempotencyKey: `base-staff-pay:${orgId}:${role}:${week}` }], { requireFunds: true });
  return true;
}
const tx_ = tx;

/** Worker: the week's pay (or the person leaves), the building check and a story a day. */
export async function runBaseStaff(db: Database, now = new Date()) {
  if (!(await featureOn(db, 'base_staff', now))) return 0;
  const rows = await db.select({ key: jobState.key, value: jobState.value }).from(jobState).where(like(jobState.key, 'base-staff:%'));
  let n = 0;
  for (const r of rows) {
    if (r.key.split(':').length !== 2) continue;
    const orgId = r.key.slice('base-staff:'.length);
    await db.transaction(async (tx) => {
      const [org] = await tx.select({ upgrades: organizations.upgrades }).from(organizations).where(eq(organizations.id, orgId));
      const staff = { ...(r.value as Staff) };
      if (!org) return;
      for (const role of Object.keys(staff) as StaffRole[]) {
        const why = !staffAllowed(role, org.upgrades as UpgradeLevels) ? 'building' : !(await pay(tx, orgId, role, now, false)) ? 'money' : null;
        if (!why) continue;
        const name = staff[role]!.name;
        delete staff[role];
        await notifyMembers(tx, orgId, 'build', () => t('{0} напусна базата', name), () => (why === 'money' ? t('В касата нямаше пари за заплатата.') : t('Сградата за тази длъжност вече я няма.')), '/game/company/plot');
      }
      await saveStaff(tx, orgId, staff, now);
      const roles = Object.keys(staff) as StaffRole[];
      if (!roles.length) return;
      const day = dayKey(now);
      const [story] = await tx.insert(jobState).values({ key: `base-staff-story:${orgId}:${day}`, value: { at: now.toISOString() } }).onConflictDoNothing().returning();
      if (!story) return;
      const rand = seededRandom(`staff-story:${orgId}:${day}`);
      const role = roles[Math.floor(rand() * roles.length)]!;
      const lines = STAFF[role].stories;
      const body = `${STAFF[role].emoji} ${t(lines[Math.floor(rand() * lines.length)]!, staff[role]!.name)}`;
      await tx.insert(companyMessages).values({ companyId: orgId, userId: await botUserId(tx), body, createdAt: now });
      n++;
    });
  }
  return n;
}
