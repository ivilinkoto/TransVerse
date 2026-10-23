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
import { isStaff } from '@/server/auth/roles';
import { trailerHireView } from '@/server/game/trailer-hire';

export const metadata = { title: 'Ремаркета под наем' };

const BODY_LABEL: Record<string, string> = { curtain: 'завеса', box: 'фургон', reefer: 'хладилно', flatbed: 'платформа', tanker: 'цистерна', tipper: 'самосвал', container: 'контейнеровоз', lowbed: 'нискорамно' };

/** v1.6: trailers for hire between players. Game data. */
export default async function TrailerHirePage({ searchParams }: { searchParams: Promise<{ city?: string; body?: string }> }) {
  const { db, user, company, features } = await gameContext();
  if (!features.trailer_hire) notFound();
  const view = await trailerHireView(db, user.id);
  const filter = await searchParams;
  const cityOptions = [...new Map(view.offers.map((o) => [String(o.cityId), o.city])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'bg'));
  const bodyOptions = [...new Set(view.offers.map((o) => o.body))].sort();
  const offers = view.offers.filter((o) => (!filter.city || String(o.cityId) === filter.city) && (!filter.body || o.body === filter.body));
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
        {view.offers.length > 0 && (
          <form className="mb-3 flex flex-wrap items-center gap-2 text-sm" method="get">
            <select name="city" className="input" defaultValue={filter.city ?? ''}><option value="">Всички градове</option>{cityOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
            <select name="body" className="input" defaultValue={filter.body ?? ''}><option value="">Всички видове</option>{bodyOptions.map((b) => <option key={b} value={b}>{BODY_LABEL[b] ?? b}</option>)}</select>
            <button type="submit" className="btn-ghost">Покажи</button>
          </form>
        )}
        {offers.length ? (
          <ul className="divide-y divide-white/5">
            {offers.map((o) => (
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
      {isStaff(user.role) && view.all.length > 0 && (
        <Card title="Екип: всички наеми">
          <ul className="divide-y divide-white/5 text-sm">
            {view.all.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{o.model} <span className="font-mono text-xs text-mist-400">{o.plate}</span> · {o.owner} → {o.renter ?? 'свободно'}{o.until ? ` · до ${dateTime(o.until)}` : ''}</span>
                <ActionButton endpoint="/api/admin/action" action={{ type: 'endTrailerHire', hireId: o.id }} className="btn-danger px-3 py-1.5 text-xs" confirm="Да прекратим ли наема? Неизползваните дни се връщат на наемателя.">Прекрати</ActionButton>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Моите предложения">
          <OfferTrailerForm maxDays={TRAILER_HIRE.maxDays} trailers={free.map((t) => ({ id: t.id, label: `${t.plate} · ${trailerModel(t.modelId).name} · ${t.city}` }))} />
          {view.mine.length > 0 && (
            <ul className="mt-4 divide-y divide-white/5 text-sm">
              {view.mine.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{o.model} <span className="font-mono text-xs text-mist-400">{o.plate}</span> · {money(o.pricePerDayCents)}/ден</span>
                  {o.renterId ? <Badge tone="cyan">наето от {o.renter ?? '—'} до {o.until ? dateTime(o.until) : '—'}</Badge> : <ActionButton action={{ type: 'withdrawTrailer', hireId: o.id }}>Свали</ActionButton>}
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
