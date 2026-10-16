import { eq } from 'drizzle-orm';
import { LICENCES, LICENCE_IDS, contractCountries, missingLicences, requiredLicences, type LicenceId } from '@/lib/game/licences';
import type { Database, DbOrTx } from '@/server/db/client';
import { users, userLicences } from '@/server/db/schema';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { logActivity, notify } from './notify';

export async function heldLicences(db: DbOrTx, userId: string): Promise<Set<LicenceId>> {
  const rows = await db.select({ licence: userLicences.licence }).from(userLicences).where(eq(userLicences.userId, userId));
  return new Set(rows.map((r) => r.licence as LicenceId));
}

/** Buys a licence with the player's personal money (once; it never expires). */
export async function buyLicence(db: Database, userId: string, licenceId: string) {
  return db.transaction(async (tx) => {
    if (!LICENCE_IDS.includes(licenceId as LicenceId)) fail('unknown_licence', 'Непознат лиценз.');
    const def = LICENCES[licenceId as LicenceId];
    if (!def.available) fail('licence_unavailable', `${def.label} ще бъде наличен, когато в играта се появи този вид транспорт.`);
    const held = await heldLicences(tx, userId);
    if (held.has(def.id)) fail('licence_owned', 'Вече притежавате този лиценз.', 409);
    const [user] = await tx.select({ level: users.level }).from(users).where(eq(users.id, userId));
    if ((user?.level ?? 1) < def.minLevel) fail('level', `${def.label} изисква ниво ${def.minLevel}.`);
    if (def.requires && !held.has(def.requires)) fail('licence_prerequisite', `Първо е нужен ${LICENCES[def.requires].label}.`);
    const account = await companyForUser(tx, userId);
    await post(tx, account.id, [{ category: 'licences', amountCents: -def.priceCents, description: def.label, idempotencyKey: `licence:${userId}:${def.id}` }], { requireFunds: true });
    await tx.insert(userLicences).values({ userId, licence: def.id, priceCents: def.priceCents, source: 'purchase' });
    await logActivity(tx, userId, 'licence_bought', { licence: def.id });
    await notify(tx, userId, 'achievement', `Нов лиценз: ${def.label}`, def.description, '/game/licences');
    return def.id;
  });
}

/** Licences the player is missing for a contract (empty = allowed). */
export function missingFor(contract: { cargoType: string; originCountry: string; destCountry: string; routeCountries: readonly string[] | null | undefined }, held: ReadonlySet<string>): LicenceId[] {
  return missingLicences(requiredLicences(contract.cargoType, contractCountries(contract.originCountry, contract.destCountry, contract.routeCountries)), held);
}

export const licenceNames = (ids: readonly LicenceId[]) => ids.map((id) => LICENCES[id].label).join(', ');
