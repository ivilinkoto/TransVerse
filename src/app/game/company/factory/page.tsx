import { eq, inArray } from 'drizzle-orm';
import { Factory } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ActionButton } from '@/components/ui/ActionButton';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { dateTime, dec, int, km, money } from '@/lib/format';
import { batchHours, batchTons, FACTORY, RAW, rawCostCents, RECIPES, type RawId } from '@/lib/game/factory';
import { cities, organizations } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { factoryView } from '@/server/game/factory';
import { can, membershipOf } from '@/server/game/membership';
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Фабрика') };
}

export default async function FactoryPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.factories) notFound();
  const m = await membershipOf(db, user.id);
  if (!m) redirect('/game/company');
  const v = await factoryView(db, m.company.id, now);
  const canRun = can(m.rank, 'build');
  const buyerNames = v.buyers.length ? new Map((await db.select({ id: cities.id, nameBg: cities.nameBg }).from(cities).where(inArray(cities.id, v.buyers.map((b) => b.cityId)))).map((c) => [c.id, c.nameBg])) : new Map<number, string>();
  const [org] = await db.select({ treasury: organizations.treasuryCents }).from(organizations).where(eq(organizations.id, m.company.id));
  const f = v.factory;
  const r = v.recipe;
  return (
    <div className="space-y-6">
      <PageHeader
        title={tr('Фабрика')}
        subtitle={tr('Суровини от реални градове, продукция за реални купувачи — парите от продажбата влизат в касата.')}
        help={tr('Фабриката се строи на участъка (от ниво 3 на компанията). Длъжностите с право „Строителство“ избират какво произвежда, поръчват суровини (плаща касата) и пускат продукцията за продан. Суровините и продукцията се карат от членовете — товарите са само за компанията и се плащат като обикновени курсове. Една партида тече няколко часа; по-високо ниво на фабриката — по-бързо и повече продукция. Рецептите, цените и времената са игрови данни.')}
      />
      {v.level < 1 ? (
        <Empty icon={Factory} title={tr('Компанията още няма фабрика')}>
          {tr('Постройте я на')}{' '}<Link href="/game/company/plot" className="text-cyan-glow hover:underline">{tr('участъка')}</Link>{' '}{tr('— нужно е ниво 3 на компанията.')}
        </Empty>
      ) : (
        <>
          <Card title={tr('Фабрика · ниво {0}', v.level)} actions={r ? <Badge tone="cyan">{tx(r.label)}</Badge> : null}>
            {!r ? (
              <p className="text-sm text-mist-300">{tr('Изберете какво да произвежда фабриката.')}</p>
            ) : (
              <div className="grid gap-3 text-sm sm:grid-cols-4">
                <div><div className="label">{tr('Партида')}</div><div className="mt-1">{Object.entries(r.inputs).map(([id, t]) => tr('{0} т {1}', dec(t ?? 0), RAW[id as RawId].label.toLowerCase())).join(' + ')}{' '}{tr('→ {0} т за {1} ч', dec(batchTons(r, v.level)), dec(batchHours(r, v.level)))}</div></div>
                <div><div className="label">{tr('Суровини на участъка')}</div><div className="mt-1">{Object.keys(r.inputs).map((id) => tr('{0}: {1} т{2}', RAW[id as RawId].label, dec(f?.stock[id] ?? 0), v.onTheWay[id as RawId] ? tr(' (+{0} на път)', dec(v.onTheWay[id as RawId]!)) : '')).join(' · ')}</div></div>
                <div><div className="label">{tr('Сега')}</div><div className="mt-1">{f?.batchEndsAt ? tr('Партида готова в {0}', dateTime(f.batchEndsAt)) : tr('Чака суровини')}</div></div>
                <div><div className="label">{tr('Готова продукция')}</div><div className="mt-1 num font-semibold text-profit">{tr('{0} т', dec(f?.productTons ?? 0))}</div><div className="text-xs text-mist-400">{tr('{0} партиди · продадено за {1}', int(f?.batches ?? 0), money(f?.soldCents ?? 0))}</div></div>
              </div>
            )}
          </Card>

          {canRun && (
            <Card title={tr('Производство')}>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {RECIPES.map((x) => (
                  <li key={x.id} className={`rounded-xl border p-3 text-sm ${x.id === r?.id ? 'border-cyan-glow/60 bg-cyan-glow/5' : 'border-asphalt-700'}`}>
                    <div className="font-semibold">{tx(x.label)}</div>
                    <div className="mt-1 text-xs text-mist-400">{Object.entries(x.inputs).map(([id, t]) => tr('{0} т {1}', dec(t ?? 0), RAW[id as RawId].label.toLowerCase())).join(' + ')}{' '}{tr('→ {0} т · {1}/т', dec(batchTons(x, v.level)), money(x.output.priceCentsPerTon))}</div>
                    {x.id !== r?.id && <div className="mt-2"><ActionButton action={{ type: 'factoryRecipe', recipe: x.id }} className="btn-ghost px-3 py-1.5 text-xs">{tr('Произвеждай това')}</ActionButton></div>}
                  </li>
                ))}
              </ul>
              {r && (
                <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-mist-300">{tr('Поръчай суровини за:')}</span>
                  {[1, 3, FACTORY.maxBatches].map((n) => (
                    <ActionButton key={n} action={{ type: 'factoryOrder', batches: n }} className="btn-ghost px-3 py-1.5 text-xs" confirm={tr('Касата плаща до {0} (без това, което вече е на участъка или на път). Касата има {1}.', money(rawCostCents(r, n)), money(org?.treasury ?? 0))}>
                      {tr('{0} {1} · до {2}', n, n === 1 ? tr('партида') : tr('партиди'), money(rawCostCents(r, n)))}
                    </ActionButton>
                  ))}
                </div>
              )}
            </Card>
          )}

          {r && (
            <Card title={tr('Купувачи')}>
              {v.buyers.length === 0 ? (
                <p className="text-sm text-mist-400">{tr('Няма град наблизо, който купува тази продукция.')}</p>
              ) : (
                <ul className="divide-y divide-asphalt-800 text-sm">
                  {v.buyers.map((b) => (
                    <li key={b.cityId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span><b>{buyerNames.get(b.cityId)}</b> · ≈ {km(b.km)} · <span className="num text-profit">{tr('{0}/т', money(b.priceCentsPerTon))}</span></span>
                      {canRun && (f?.productTons ?? 0) >= 0.5 && <ActionButton action={{ type: 'factorySell', cityId: b.cityId }} className="btn-primary px-3 py-1.5 text-xs">{tr('Продай {0} т тук · {1}', dec(f!.productTons), money(Math.round(f!.productTons * b.priceCentsPerTon)))}</ActionButton>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-mist-400">{tr('Продукцията тръгва като товари само за членовете; всеки товар плаща на касата при пристигане. Непоетите товари се връщат във фабриката.')}</p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
