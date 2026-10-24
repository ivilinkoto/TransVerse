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
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Ремаркета под наем') };
}

const BODY_LABEL: Record<string, string> = { curtain: 'завеса', box: 'фургон', reefer: 'хладилно', flatbed: 'платформа', tanker: 'цистерна', tipper: 'самосвал', container: 'контейнеровоз', lowbed: 'нискорамно' };

/** v1.6: trailers for hire between players. Game data. */
export default async function TrailerHirePage({ searchParams }: { searchParams: Promise<{ city?: string; body?: string }> }) {
  await initLocale();
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
        title={tr('Ремаркета под наем')}
        subtitle={tr('Свободно ремарке носи пари, а нужното ремарке се взима за няколко дни.')}
        help={tr('Собственикът определя цена на ден и до колко дни (най-много {0}). Наемателят плаща всичко предварително и взима ремаркето там, където стои. В края ремаркето се връща само (ако е на курс — след него) с износването и мястото, където е спряло.', TRAILER_HIRE.maxDays)}
      />
      <Card title={tr('Свободни ремаркета')}>
        {view.offers.length > 0 && (
          <form className="mb-3 flex flex-wrap items-center gap-2 text-sm" method="get">
            <select name="city" className="input" defaultValue={filter.city ?? ''}><option value="">{tr('Всички градове')}</option>{cityOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
            <select name="body" className="input" defaultValue={filter.body ?? ''}><option value="">{tr('Всички видове')}</option>{bodyOptions.map((b) => <option key={b} value={b}>{BODY_LABEL[b] ?? b}</option>)}</select>
            <button type="submit" className="btn-ghost">{tr('Покажи')}</button>
          </form>
        )}
        {offers.length ? (
          <ul className="divide-y divide-white/5">
            {offers.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                <span>{tx(o.model)} <span className="font-mono text-xs text-mist-400">{tx(o.plate)}</span> · {tx(o.city)} · {Math.round(o.condition)} % · {tx(o.owner)}</span>
                <span className="flex items-center gap-3"><span className="num">{tr('{0}/ден', money(o.pricePerDayCents))}</span><HireTrailerForm hireId={o.id} maxDays={o.maxDays} pricePerDayCents={o.pricePerDayCents} /></span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon={Container} title={tr('Няма свободни ремаркета')}>{tr('Никой не предлага ремарке в момента.')}</Empty>
        )}
      </Card>
      {isStaff(user.role) && view.all.length > 0 && (
        <Card title={tr('Екип: всички наеми')}>
          <ul className="divide-y divide-white/5 text-sm">
            {view.all.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{tx(o.model)} <span className="font-mono text-xs text-mist-400">{tx(o.plate)}</span> · {tx(o.owner)} → {o.renter ?? tr('свободно')}{o.until ? tr(' · до {0}', dateTime(o.until)) : ''}</span>
                <ActionButton endpoint="/api/admin/action" action={{ type: 'endTrailerHire', hireId: o.id }} className="btn-danger px-3 py-1.5 text-xs" confirm={tr('Да прекратим ли наема? Неизползваните дни се връщат на наемателя.')}>{tr('Прекрати')}</ActionButton>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={tr('Моите предложения')}>
          <OfferTrailerForm maxDays={TRAILER_HIRE.maxDays} trailers={free.map((t) => ({ id: t.id, label: `${t.plate} · ${trailerModel(t.modelId).name} · ${t.city}` }))} />
          {view.mine.length > 0 && (
            <ul className="mt-4 divide-y divide-white/5 text-sm">
              {view.mine.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{tx(o.model)} <span className="font-mono text-xs text-mist-400">{tx(o.plate)}</span>{' '}{tr('· {0}/ден', money(o.pricePerDayCents))}</span>
                  {o.renterId ? <Badge tone="cyan">{tr('наето от {0} до {1}', o.renter ?? '—', o.until ? dateTime(o.until) : '—')}</Badge> : <ActionButton action={{ type: 'withdrawTrailer', hireId: o.id }}>{tr('Свали')}</ActionButton>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={tr('Наети от мен')}>
          {view.hired.length ? (
            <ul className="divide-y divide-white/5 text-sm">
              {view.hired.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{tx(o.model)} <span className="font-mono text-xs text-mist-400">{tx(o.plate)}</span>{' '}{tr('· от {0} · до {1}', o.owner, o.until ? dateTime(o.until) : '—')}</span>
                  <ActionButton action={{ type: 'returnHiredTrailer', hireId: o.id }} confirm={tr('Да върнем ли ремаркето по-рано? Парите не се връщат.')}>{tr('Върни')}</ActionButton>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-mist-400">{tr('Нямаш наети ремаркета. Закачаш наетото ремарке от сервиза, както своето.')}</p>
          )}
        </Card>
      </div>
    </div>
  );
}
