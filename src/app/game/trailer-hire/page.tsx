import { Container } from 'lucide-react';
import { notFound } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import { HireTrailerForm, OfferTrailerForm } from '@/components/game/HireForms';
import { ActionButton } from '@/components/ui/ActionButton';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { dateTime, money } from '@/lib/format';
import { trailerModel } from '@/lib/game/catalog';
import { TRAILER_HIRE } from '@/lib/game/trailer-hire';
import { cities, trailers } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { trailerHireView } from '@/server/game/trailer-hire';

export const metadata = { title: 'Ремаркета под наем' };

/** v1.6: trailers for hire between players. Game data. */
export default async function TrailerHirePage() {
  const { db, user, company, features } = await gameContext();
  if (!features.trailer_hire) notFound();
  const view = await trailerHireView(db, user.id);
  const free = await db
    .select({ id: trailers.id, plate: trailers.plate, modelId: trailers.modelId, city: cities.nameBg })
    .from(trailers)
    .innerJoin(cities, eq(cities.id, trailers.cityId))
    .where(and(eq(trailers.companyId, company.id), eq(trailers.ownership, 'owned'), eq(trailers.listed, false), eq(trailers.hiredOut, false), isNull(trailers.soldAt)));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Ремаркета под наем"
        subtitle="Свободно ремарке носи пари, а нужното ремарке се взима за няколко дни."
        help={`Собственикът определя цена на ден и до колко дни (най-много ${TRAILER_HIRE.maxDays}). Наемателят плаща всичко предварително и взима ремаркето там, където стои. В края ремаркето се връща само (ако е на курс — след него) с износването и мястото, където е спряло.`}
      />
      <Card title="Свободни ремаркета">
        {view.offers.length ? (
          <ul className="divide-y divide-white/5">
            {view.offers.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                <span>{o.model} <span className="font-mono text-xs text-mist-400">{o.plate}</span> · {o.city} · {Math.round(o.condition)} % · {o.owner}</span>
                <span className="flex items-center gap-3"><span className="num">{money(o.pricePerDayCents)}/ден</span><HireTrailerForm hireId={o.id} maxDays={o.maxDays} pricePerDayCents={o.pricePerDayCents} /></span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon={Container} title="Няма свободни ремаркета">Никой не предлага ремарке в момента.</Empty>
        )}
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Моите предложения">
          <OfferTrailerForm maxDays={TRAILER_HIRE.maxDays} trailers={free.map((t) => ({ id: t.id, label: `${t.plate} · ${trailerModel(t.modelId).name} · ${t.city}` }))} />
          {view.mine.length > 0 && (
            <ul className="mt-4 divide-y divide-white/5 text-sm">
              {view.mine.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{o.model} <span className="font-mono text-xs text-mist-400">{o.plate}</span> · {money(o.pricePerDayCents)}/ден</span>
                  {o.renterId ? <Badge tone="cyan">нает до {o.until ? dateTime(o.until) : '—'}</Badge> : <ActionButton action={{ type: 'withdrawTrailer', hireId: o.id }}>Свали</ActionButton>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Наети от мен">
          {view.hired.length ? (
            <ul className="divide-y divide-white/5 text-sm">
              {view.hired.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{o.model} <span className="font-mono text-xs text-mist-400">{o.plate}</span> · от {o.owner} · до {o.until ? dateTime(o.until) : '—'}</span>
                  <ActionButton action={{ type: 'returnHiredTrailer', hireId: o.id }} confirm="Да върнем ли ремаркето по-рано? Парите не се връщат.">Върни</ActionButton>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-mist-400">Нямаш наети ремаркета. Закачаш наетото ремарке от сервиза, както своето.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
