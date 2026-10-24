import { eq } from 'drizzle-orm';
import { SPECIALIZATION, SPECIALIZATIONS, specializationCovers, type Specialization } from '@/lib/game/specialization';
import type { Database, Tx } from '@/server/db/client';
import { organizations } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { addChronicle } from './chronicle';
import { fail } from './errors';
import { post } from './finance';
import { requirePermission } from './membership';
import { t, intlLocale } from '@/i18n/t';

/** The company picks its specialisation (settings permission; once a month). */
export async function setSpecialization(db: Database, userId: string, spec: Specialization | null, now = new Date()) {
  return db.transaction(async (tx) => {
    const m = await requirePermission(tx, userId, 'manage_settings');
    const org = m.company;
    if ((org.specialization ?? null) === spec) return { specialization: spec };
    if (org.specializationAt && now.getTime() - org.specializationAt.getTime() < SPECIALIZATION.changeDays * 86_400_000) {
      const next = new Date(org.specializationAt.getTime() + SPECIALIZATION.changeDays * 86_400_000);
      fail('too_soon', t('Специализацията се сменя веднъж на {0} дни — следващата смяна от {1}.', SPECIALIZATION.changeDays, next.toLocaleDateString(intlLocale(), { timeZone: 'Europe/Sofia' })));
    }
    await tx.update(organizations).set({ specialization: spec, specializationAt: now }).where(eq(organizations.id, org.id));
    if (spec) await addChronicle(tx, org.id, 'specialization', `Компанията се специализира: ${SPECIALIZATIONS[spec].label}.`, now);
    return { specialization: spec };
  });
}

/** A member's load in the company's specialisation pays a little more (personal account). */
export async function specializationBonus(tx: Tx, userId: string, org: { specialization: string | null; name: string } | undefined, d: { id: string; companyId: string }, cargo: string, rewardCents: number, at: Date) {
  if (!org || !specializationCovers(org.specialization, cargo) || !(await featureFor(tx, userId, 'specializations', at))) return 0;
  const bonus = Math.round(rewardCents * SPECIALIZATION.bonusShare);
  if (bonus) await post(tx, d.companyId, [{ category: 'company_bonus', amountCents: bonus, description: t('Специализация на „{0}“: {1}', org.name, SPECIALIZATIONS[org.specialization as Specialization].label), idempotencyKey: `delivery:${d.id}:specialization`, refType: 'delivery', refId: d.id }]);
  return bonus;
}
