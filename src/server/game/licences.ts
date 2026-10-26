import { eq, inArray } from 'drizzle-orm';
import { LICENCES, LICENCE_IDS, companyLicencePrice, contractCountries, missingLicences, requiredLicences, type LicenceId } from '@/lib/game/licences';
import type { Database, DbOrTx } from '@/server/db/client';
import { companyLicences, companyMembers, users, userLicences } from '@/server/db/schema';
import { companyForUser } from './company';
import { fail } from './errors';
import { post, postTreasury } from './finance';
import { logActivity, notify } from './notify';
import { notifyMembers, requirePermission } from './membership';
import { t } from '@/i18n/t';

/** Licences of several players at once: their own plus their company's. */
export async function licencesForUsers(db: DbOrTx, userIds: readonly string[]): Promise<Map<string, Set<LicenceId>>> {
  const out = new Map<string, Set<LicenceId>>(userIds.map((id) => [id, new Set<LicenceId>()]));
  if (!userIds.length) return out;
  const [own, viaCompany] = await Promise.all([
    db.select({ userId: userLicences.userId, licence: userLicences.licence }).from(userLicences).where(inArray(userLicences.userId, [...userIds])),
    db
      .select({ userId: companyMembers.userId, licence: companyLicences.licence })
      .from(companyMembers)
      .innerJoin(companyLicences, eq(companyLicences.companyId, companyMembers.companyId))
      .where(inArray(companyMembers.userId, [...userIds])),
  ]);
  for (const r of [...own, ...viaCompany]) out.get(r.userId)?.add(r.licence as LicenceId);
  return out;
}

/** Everything a player may use: personal licences and those of their company. */
export async function heldLicences(db: DbOrTx, userId: string): Promise<Set<LicenceId>> {
  return (await licencesForUsers(db, [userId])).get(userId)!;
}

/** Licences of a player company (for its profile and the members). */
export async function companyLicenceSet(db: DbOrTx, companyId: string) {
  return db.select().from(companyLicences).where(eq(companyLicences.companyId, companyId));
}

/** A company buys a licence from its treasury at double price; all members may use it. */
export async function buyCompanyLicence(db: Database, actorId: string, licenceId: string) {
  return db.transaction(async (tx) => {
    if (!LICENCE_IDS.includes(licenceId as LicenceId)) fail('unknown_licence', t('Непознат лиценз.'));
    const def = LICENCES[licenceId as LicenceId];
    if (!def.available) fail('licence_unavailable', t('{0} ще бъде наличен, когато в играта се появи този вид транспорт.', def.label));
    const actor = await requirePermission(tx, actorId, 'manage_upgrades');
    const held = new Set((await companyLicenceSet(tx, actor.company.id)).map((l) => l.licence));
    if (held.has(def.id)) fail('licence_owned', t('Компанията вече има този лиценз.'), 409);
    if (def.requires && !held.has(def.requires)) fail('licence_prerequisite', t('Първо компанията трябва да има {0}.', LICENCES[def.requires].label));
    const price = companyLicencePrice(def.id);
    await postTreasury(tx, actor.company.id, [{ category: 'company_licence', amountCents: -price, description: t('Лиценз: {0}', def.label), idempotencyKey: `company-licence:${actor.company.id}:${def.id}`, actorUserId: actorId }], { requireFunds: true });
    await tx.insert(companyLicences).values({ companyId: actor.company.id, licence: def.id, priceCents: price, boughtBy: actorId });
    await logActivity(tx, actorId, 'company_licence_bought', { companyId: actor.company.id, licence: def.id });
    await notifyMembers(tx, actor.company.id, null, () => t('Компанията има нов лиценз: {0}', def.label), () => t('Всички членове вече могат да поемат поръчки с него.'), '/game/licences');
    return def.id;
  });
}

/** Buys a licence with the player's personal money (once; it never expires). */
export async function buyLicence(db: Database, userId: string, licenceId: string) {
  return db.transaction(async (tx) => {
    if (!LICENCE_IDS.includes(licenceId as LicenceId)) fail('unknown_licence', t('Непознат лиценз.'));
    const def = LICENCES[licenceId as LicenceId];
    if (!def.available) fail('licence_unavailable', t('{0} ще бъде наличен, когато в играта се появи този вид транспорт.', def.label));
    const held = new Set((await tx.select({ l: userLicences.licence }).from(userLicences).where(eq(userLicences.userId, userId))).map((r) => r.l));
    if (held.has(def.id)) fail('licence_owned', t('Вече притежавате този лиценз.'), 409);
    const [user] = await tx.select({ level: users.level }).from(users).where(eq(users.id, userId));
    if ((user?.level ?? 1) < def.minLevel) fail('level', t('{0} изисква ниво {1}.', def.label, def.minLevel));
    if (def.requires && !held.has(def.requires)) fail('licence_prerequisite', t('Първо е нужен {0}.', LICENCES[def.requires].label));
    const account = await companyForUser(tx, userId);
    await post(tx, account.id, [{ category: 'licences', amountCents: -def.priceCents, description: def.label, idempotencyKey: `licence:${userId}:${def.id}` }], { requireFunds: true });
    await tx.insert(userLicences).values({ userId, licence: def.id, priceCents: def.priceCents, source: 'purchase' });
    await logActivity(tx, userId, 'licence_bought', { licence: def.id });
    await notify(tx, userId, 'achievement', () => t('Нов лиценз: {0}', def.label), def.description, '/game/licences');
    return def.id;
  });
}

/** Licences the player is missing for a contract (empty = allowed). */
export function missingFor(contract: { cargoType: string; originCountry: string; destCountry: string; routeCountries: readonly string[] | null | undefined }, held: ReadonlySet<string>): LicenceId[] {
  return missingLicences(requiredLicences(contract.cargoType, contractCountries(contract.originCountry, contract.destCountry, contract.routeCountries)), held);
}

export const licenceNames = (ids: readonly LicenceId[]) => ids.map((id) => LICENCES[id].label).join(', ');
