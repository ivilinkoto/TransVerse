import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { CARGO, type CargoType } from '@/lib/game/cargo';
import { getDb } from '@/server/db/client';
import { cities, cityMarkets, contracts, countries, ports } from '@/server/db/schema';
import { errorResponse, requireUser } from '@/server/http';
import { t } from '@/i18n/t';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: 'invalid' }, { status: 400 });
    const db = getDb();
    const [city] = await db.select({ city: cities, country: countries }).from(cities).innerJoin(countries, eq(countries.code, cities.countryCode)).where(eq(cities.id, id));
    if (!city) return NextResponse.json({ error: 'not_found', message: t('Градът не е намерен.') }, { status: 404 });
    const market = await db.select().from(cityMarkets).where(eq(cityMarkets.cityId, id));
    const portRows = await db.select({ name: ports.name, nameBg: ports.nameBg }).from(ports).where(eq(ports.cityId, id));
    const [{ open = 0 } = {}] = await db.select({ open: sql<number>`count(*)::int` }).from(contracts).where(and(eq(contracts.originCityId, id), eq(contracts.status, 'open'), eq(contracts.shady, false), isNull(contracts.tenderId), gt(contracts.expiresAt, new Date())));
    return NextResponse.json({
      id,
      name: city.city.nameBg,
      nameLatin: city.city.name,
      country: city.country.nameBg,
      countryCode: city.country.code,
      region: city.city.regionBg,
      population: city.city.population,
      lat: city.city.lat,
      lon: city.city.lon,
      ports: portRows.map((p) => p.nameBg ?? p.name),
      openContracts: open,
      market: market.map((m) => ({ cargo: CARGO[m.cargoType as CargoType]?.label ?? m.cargoType, produces: m.produces, consumes: m.consumes, demand: Math.round(m.demand * 100) / 100 })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
