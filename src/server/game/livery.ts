import { eq } from 'drizzle-orm';
import { isLiveryColor } from '@/lib/game/livery';
import type { Database, DbOrTx } from '@/server/db/client';
import { companies, organizations, users } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { fail } from './errors';
import { membershipOf, notifyMembers, requirePermission } from './membership';

/** Sets (or clears) the company's livery; members' trucks wear it unless they opted out. */
export async function setLivery(db: Database, actorId: string, color: string | null) {
  if (color !== null && !isLiveryColor(color)) fail('bad_color', 'Непознат цвят.');
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'edit_profile');
    await tx.update(organizations).set({ liveryColor: color }).where(eq(organizations.id, actor.company.id));
    if (color) await notifyMembers(tx, actor.company.id, null, 'Нова ливрея на компанията', 'Камионите на членовете вече са в цвета на компанията (може да се изключи от Настройки).', '/game/fleet');
  });
}

/** A member's own choice: wear the company livery or keep their own colours. */
export async function setCompanyLivery(db: Database, userId: string, on: boolean) {
  await db.update(users).set({ companyLivery: on }).where(eq(users.id, userId));
}

/** The colour an account's trucks wear: the company livery when there is one and the owner wants it. */
export async function liveryFor(db: DbOrTx, accountId: string): Promise<string | null> {
  const [owner] = await db.select({ id: users.id, on: users.companyLivery }).from(companies).innerJoin(users, eq(users.id, companies.ownerId)).where(eq(companies.id, accountId));
  if (!owner?.on) return null;
  const m = await membershipOf(db, owner.id);
  if (!m?.company.liveryColor) return null;
  return (await featureFor(db, owner.id, 'livery')) ? m.company.liveryColor : null;
}
