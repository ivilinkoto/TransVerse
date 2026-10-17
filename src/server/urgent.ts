import { desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CARGO, CARGO_TYPES, type CargoType } from '@/lib/game/cargo';
import { gameDurationMinutes } from '@/lib/game/schedule';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { adminAudit, cities, contracts, notifications, users } from '@/server/db/schema';
import { requireAdminRole, type Staff } from '@/server/admin';
import { fail } from '@/server/game/errors';
import { broadcast } from '@/server/game/notify';
import { getRoute } from '@/server/geo/route-service';
import type { RoutingProvider } from '@/server/geo/routing';

export const urgentSchema = z.object({
  goods: z.string().trim().min(2, 'Въведете име на товара.').max(60, 'Най-много 60 символа.'),
  cargoType: z.enum(CARGO_TYPES as unknown as [CargoType, ...CargoType[]]),
  weightTons: z.coerce.number().min(0.1, 'Минимум 0,1 т.').max(40, 'Най-много 40 т.'),
  rewardEur: z.coerce.number().min(1, 'Цената е поне 1 €.').max(1_000_000, 'Твърде висока цена.'),
  originCityId: z.coerce.number().int().positive(),
  destCityId: z.coerce.number().int().positive(),
  /** Deadline for delivery, counted from acceptance. */
  windowMinutes: z.coerce.number().int().min(5, 'Срокът е поне 5 минути.').max(2880, 'Срокът е най-много 48 часа.'),
  /** How many times faster than normal the truck travels. */
  speedFactor: z.coerce.number().min(1).max(5),
  /** How long the offer stays on the board. */
  expiresHours: z.coerce.number().min(1).max(72),
  announce: z.boolean().default(true),
});
export type UrgentInput = z.infer<typeof urgentSchema>;

/** Administrator creates an urgent shipment: listed first on the board and driven faster. */
export async function createUrgentContract(db: Database, actor: Staff, raw: UrgentInput, provider?: RoutingProvider) {
  requireAdminRole(actor);
  const input = urgentSchema.parse(raw);
  if (input.originCityId === input.destCityId) fail('same_city', 'Началната и крайната точка трябва да са различни.');
  const ends = await db.select({ id: cities.id, nameBg: cities.nameBg }).from(cities).where(inArray(cities.id, [input.originCityId, input.destCityId]));
  const from = ends.find((c) => c.id === input.originCityId);
  const to = ends.find((c) => c.id === input.destCityId);
  if (!from || !to) fail('city_not_found', 'Градът не е намерен.', 404);
  const cargo = CARGO[input.cargoType];
  if (input.weightTons > cargo.tons[1]) fail('too_heavy', `${cargo.label}: най-много ${cargo.tons[1]} т.`);

  // Real road route (network call) before writing anything.
  const route = await getRoute(db, input.originCityId, input.destCityId, 'truck', provider);
  const fastest = Math.ceil(gameDurationMinutes(route.distanceKm) / input.speedFactor);
  if (input.windowMinutes < fastest) fail('window_too_short', `Курсът с товар трае около ${fastest} мин при ×${input.speedFactor}. Дайте поне толкова срок (плюс време за празния курс до товара).`);

  return db.transaction(async (tx) => {
    const contract = await insertUrgent(
      tx,
      { goods: input.goods, cargoType: input.cargoType, weightTons: input.weightTons, originCityId: input.originCityId, destCityId: input.destCityId, routeId: route.id, distanceKm: route.distanceKm, rewardCents: Math.round(input.rewardEur * 100), windowMinutes: input.windowMinutes, speedFactor: input.speedFactor, expiresAt: new Date(Date.now() + input.expiresHours * 3_600_000), createdBy: actor.id },
      { from: from!.nameBg, to: to!.nameBg },
      input.announce ? 'all' : 'none',
    );
    await tx.insert(adminAudit).values({
      actorId: actor.id,
      action: 'create_urgent_contract',
      targetUserId: null,
      details: { contractId: contract.id, goods: input.goods, from: from!.nameBg, to: to!.nameBg, rewardCents: contract.rewardCents, windowMinutes: input.windowMinutes, speedFactor: input.speedFactor },
    });
    return contract;
  });
}

export interface UrgentValues {
  goods: string;
  cargoType: CargoType;
  weightTons: number;
  originCityId: number;
  destCityId: number;
  routeId: number;
  distanceKm: number;
  rewardCents: number;
  windowMinutes: number;
  speedFactor: number;
  expiresAt: Date;
  /** Administrator, or null for the automatic dispatcher. */
  createdBy: string | null;
}

/**
 * Writes an urgent shipment and tells players about it: everyone ('all'), only
 * players seen in the last 3 days ('active', used by the automatic dispatcher)
 * or nobody.
 */
export async function insertUrgent(tx: Tx, v: UrgentValues, names: { from: string; to: string }, announce: 'all' | 'active' | 'none') {
  const [contract] = await tx
    .insert(contracts)
    .values({
      shipper: 'Спешна поръчка · Диспечерски център TransVerse',
      goods: v.goods,
      cargoType: v.cargoType,
      weightTons: Math.round(v.weightTons * 10) / 10,
      originCityId: v.originCityId,
      destCityId: v.destCityId,
      routeId: v.routeId,
      distanceKm: v.distanceKm,
      rewardCents: v.rewardCents,
      windowMinutes: v.windowMinutes,
      minLevel: CARGO[v.cargoType].minLevel,
      urgent: true,
      speedFactor: v.speedFactor,
      createdBy: v.createdBy,
      expiresAt: v.expiresAt,
    })
    .returning();
  if (announce !== 'none') {
    // One notification per player, in a single statement.
    const title = `Спешна доставка: ${v.goods}`;
    const body = `${names.from} → ${names.to} · ${(v.rewardCents / 100).toLocaleString('bg-BG')} € · ×${v.speedFactor} по-бързо, до товара за 1 мин. Може да я поеме всеки със свободен камион, докато не изтече.`;
    const active = announce === 'active' ? sql`and ${users.lastSeenAt} > now() - interval '3 days'` : sql``;
    await tx.execute(sql`insert into ${notifications} (user_id, kind, title, body, href) select ${users.id}, 'warning', ${title}, ${body}, '/game/contracts' from ${users} where ${users.bannedAt} is null ${active}`);
  }
  await broadcast(tx, 'market');
  return contract!;
}

export async function urgentContracts(db: DbOrTx, limit = 30) {
  const rows = await db
    .select({
      contract: contracts,
      takers: sql<number>`(select count(*)::int from deliveries d where d.contract_id = ${contracts.id})`,
      delivered: sql<number>`(select count(*)::int from deliveries d where d.contract_id = ${contracts.id} and d.status = 'completed')`,
    })
    .from(contracts)
    .where(eq(contracts.urgent, true))
    .orderBy(desc(contracts.createdAt))
    .limit(limit);
  const ids = [...new Set(rows.flatMap((r) => [r.contract.originCityId, r.contract.destCityId]))];
  const names = ids.length ? new Map((await db.select({ id: cities.id, nameBg: cities.nameBg }).from(cities).where(inArray(cities.id, ids))).map((c) => [c.id, c.nameBg])) : new Map<number, string>();
  return rows.map((r) => ({ ...r, from: names.get(r.contract.originCityId) ?? '—', to: names.get(r.contract.destCityId) ?? '—' }));
}
