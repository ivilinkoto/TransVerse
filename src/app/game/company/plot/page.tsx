import { and, eq, sql } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';
import { PlotView } from '@/components/company/plot/PlotView';
import { contracts, deliveries } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { can, companyHub } from '@/server/game/membership';
import { plotView } from '@/server/game/plot';

export const metadata = { title: 'Участък' };

export default async function PlotPage() {
  const { db, user, now, features } = await gameContext();
  if (!features.company_plot) notFound();
  const hub = await companyHub(db, user.id);
  if (!hub) redirect('/game/company');
  const data = await plotView(db, hub.company.id, now);
  if (!data) notFound();
  const c = data.construction;
  // Material loads driving to the plot right now (drawn on the street).
  const [{ incoming = 0 } = {}] = c
    ? await db.select({ incoming: sql<number>`count(*)::int` }).from(deliveries).innerJoin(contracts, eq(contracts.id, deliveries.contractId)).where(and(eq(contracts.constructionId, c.id), eq(deliveries.status, 'in_progress')))
    : [];
  return (
    <PlotView
      now={now.getTime()}
      canBuild={can(hub.rank, 'build')}
      parkedTrucks={Math.min(6, hub.members + 1)}
      incoming={incoming}
      data={{
        org: data.org,
        hq: data.hq,
        buildings: data.buildings,
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
    />
  );
}
