import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CARGO, CARGO_TYPES, type CargoType } from '@/lib/game/cargo';
import { gameDurationMinutes } from '@/lib/game/schedule';
import type { Database, DbOrTx } from '@/server/db/client';
import { adminAudit, cities, companies, contracts, notifications, users } from '@/server/db/schema';
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
    const [contract] = await tx
      .insert(contracts)
      .values({
        shipper: 'Спешна поръчка · Диспечерски център TransVerse',
        goods: input.goods,
        cargoType: input.cargoType,
        weightTons: Math.round(input.weightTons * 10) / 10,
        originCityId: input.originCityId,
        destCityId: input.destCityId,
        routeId: route.id,
        distanceKm: route.distanceKm,
        rewardCents: Math.round(input.rewardEur * 100),
        windowMinutes: input.windowMinutes,
        minLevel: cargo.minLevel,
        urgent: true,
        speedFactor: input.speedFactor,
        createdBy: actor.id,
        expiresAt: new Date(Date.now() + input.expiresHours * 3_600_000),
      })
      .returning();
    await tx.insert(adminAudit).values({
      actorId: actor.id,
      action: 'create_urgent_contract',
      targetUserId: null,
      details: { contractId: contract!.id, goods: input.goods, from: from!.nameBg, to: to!.nameBg, rewardCents: contract!.rewardCents, windowMinutes: input.windowMinutes, speedFactor: input.speedFactor },
    });
    if (input.announce) {
      // One notification per active player, in a single statement.
      const title = `Спешна доставка: ${input.goods}`;
      const body = `${from!.nameBg} → ${to!.nameBg} · ${(contract!.rewardCents / 100).toLocaleString('bg-BG')} € · ×${input.speedFactor} по-бързо. Първият, който я поеме, я печели.`;
      await tx.execute(sql`insert into ${notifications} (user_id, kind, title, body, href) select ${users.id}, 'warning', ${title}, ${body}, '/game/contracts' from ${users} where ${users.bannedAt} is null`);
    }
    await broadcast(tx, 'market');
    return contract!;
  });
}

export async function urgentContracts(db: DbOrTx, limit = 30) {
  const rows = await db
    .select({ contract: contracts, acceptedBy: users.username })
    .from(contracts)
    .leftJoin(companies, eq(companies.id, contracts.acceptedByCompanyId))
    .leftJoin(users, eq(users.id, companies.ownerId))
    .where(and(eq(contracts.urgent, true)))
    .orderBy(desc(contracts.createdAt))
    .limit(limit);
  const ids = [...new Set(rows.flatMap((r) => [r.contract.originCityId, r.contract.destCityId]))];
  const names = ids.length ? new Map((await db.select({ id: cities.id, nameBg: cities.nameBg }).from(cities).where(inArray(cities.id, ids))).map((c) => [c.id, c.nameBg])) : new Map<number, string>();
  return rows.map((r) => ({ ...r, from: names.get(r.contract.originCityId) ?? '—', to: names.get(r.contract.destCityId) ?? '—' }));
}
