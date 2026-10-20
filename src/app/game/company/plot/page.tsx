import { and, eq, isNull, sql } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';
import { CompanyFleetCard } from '@/components/company/plot/CompanyFleetCard';
import { PlotView } from '@/components/company/plot/PlotView';
import { isChristmas } from '@/lib/game/christmas';
import { isBoom } from '@/lib/game/plot';
import { isNight, plotWeather } from '@/lib/game/ambience';
import { companyShowcase, recentVisitors } from '@/server/game/base-life';
import { Showcase } from '@/components/company/plot/Showcase';
import { isWinter } from '@/lib/game/winter';
import { companies, contracts, deliveries, users, vehicles } from '@/server/db/schema';
import { orgFleetView } from '@/server/game/company-fleet';
import { gameContext } from '@/server/game/context';
import { can, companyHub } from '@/server/game/membership';
import { plotView } from '@/server/game/plot';

export const metadata = { title: 'Участък' };

export default async function PlotPage() {
  const { db, user, now, features } = await gameContext();
  if (!features.company_plot) notFound();
  const hub = await companyHub(db, user.id);
  if (!hub) redirect('/game/company');
  const data = await plotView(db, hub.company.id, now, { boom: features.build_boom && isBoom(now) });
  if (!data) notFound();
  const fleet = features.company_fleet ? await orgFleetView(db, hub.company.id) : null;
  const [mine] = fleet
    ? await db.select({ id: vehicles.id }).from(vehicles).innerJoin(companies, eq(companies.id, vehicles.companyId)).where(and(eq(companies.ownerId, user.id), eq(vehicles.ownership, 'company'), isNull(vehicles.soldAt)))
    : [];
  const [{ coins = 0 } = {}] = await db.select({ coins: users.coins }).from(users).where(eq(users.id, user.id));
  const season = !features.plot_season ? null : isChristmas(now) ? 'christmas' : isWinter(now) ? 'winter' : null;
  const yard = fleet?.vehicles.filter((v) => !v.lentTo).length ?? 0;
  const visitors = features.plot_visits && data.hq ? await recentVisitors(db, hub.company.id, data.hq.id, now) : [];
  const showcase = features.company_trophies || features.builder_week ? await companyShowcase(db, hub.company.id) : null;
  const c = data.construction;
  // Material loads driving to the plot right now (drawn on the street).
  const [{ incoming = 0 } = {}] = c
    ? await db.select({ incoming: sql<number>`count(*)::int` }).from(deliveries).innerJoin(contracts, eq(contracts.id, deliveries.contractId)).where(and(eq(contracts.constructionId, c.id), eq(deliveries.status, 'in_progress')))
    : [];
  return (
    <PlotView
      now={now.getTime()}
      canBuild={can(hub.rank, 'build')}
      parkedTrucks={Math.min(6, hub.members + 1 + yard)}
      season={season}
      ambience={{ night: features.plot_night && isNight(now), weather: features.plot_weather ? plotWeather(now) : null, visitors }}
      features={{ decor: features.plot_decor, expand: features.plot_expand }}
      coins={coins}
      incoming={incoming}
      data={{
        org: data.org,
        hq: data.hq,
        buildings: data.buildings,
        decor: data.decor,
        expansions: data.expansions,
        plotW: data.plotW,
        boom: data.boom,
        construction: c && {
          id: c.id,
          type: c.type,
          targetLevel: c.targetLevel,
          status: c.status as 'materials' | 'building',
          needs: c.needs,
          delivered: c.delivered,
          onTheWay: c.onTheWay,
          missing: c.missing,
          orderCostCents: c.orderCostCents,
          deliveredCostCents: c.deliveredCostCents,
          complete: c.complete,
          startedAt: c.startedAt?.toISOString() ?? null,
          endsAt: c.endsAt?.toISOString() ?? null,
          minutes: c.minutes,
        },
      }}
    >
      {showcase && <Showcase data={showcase} trophies={features.company_trophies} builderWeek={features.builder_week} />}
      {fleet && <CompanyFleetCard fleet={fleet} me={user.id} myVehicleId={mine?.id ?? null} canManage={can(hub.rank, 'manage_upgrades')} treasuryCents={data.org.treasuryCents} notes={features.truck_notes} />}
    </PlotView>
  );
}
