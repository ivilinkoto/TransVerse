import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui';
import { ItemArt } from '@/components/game/ItemArt';
import { PlayerName } from '@/components/game/PlayerName';
import { COLLECTIONS, GOLDEN_KEY } from '@/lib/game/items';
import { date as dateOnly } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { hallOfFame } from '@/server/game/item-trade';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Зала на славата') };
}

/** 1.2.1 „Зала на славата“: the first collectors, the golden keys and the busiest case openers and craftsmen. */
export default async function HallPage() {
  await initLocale();
  const { db, features } = await gameContext();
  if (!features.item_album) notFound();
  const hall = await hallOfFame(db);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Зала на славата')} subtitle={t('Първите събрали всяка колекция, притежателите на златните ключове и най-упоритите.')} />
      <Card title={t('Златните ключове ({0}/{1})', hall.keys.length, GOLDEN_KEY.total)} className="border-gold-400/40">
        {hall.keys.length ? (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {hall.keys.map((k) => (
              <li key={k.serial} className="flex items-center gap-2 rounded-xl border border-gold-400/30 bg-gold-400/5 p-2 text-sm">
                <ItemArt id="golden_key" className="h-8 w-8" />
                <span className="num font-black text-gold-300">#{k.serial}</span>
                <span className="min-w-0 flex-1 truncate">{k.userId && k.username ? <PlayerName name={k.username} /> : '—'}</span>
                <span className="text-xs text-mist-500">{dateOnly(k.at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-mist-400">{t('Още никой не е намерил златен ключ. Първият ще е #1.')}</p>
        )}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {hall.collections.map((c) => {
          const def = COLLECTIONS.find((x) => x.id === c.id)!;
          return (
            <Card key={c.id} title={t('{0} · събрали: {1}', tx(c.name), c.total)}>
              <div className="mb-2 flex gap-1">{def.items.map((i) => <ItemArt key={i} id={i} className="h-7 w-7" />)}</div>
              {c.first.length ? (
                <ol className="space-y-1 text-sm">
                  {c.first.map((p, i) => (
                    <li key={p.userId} className="flex items-center gap-2">
                      <span className="num w-6 text-mist-500">{i + 1}.</span>
                      <span className="min-w-0 flex-1 truncate"><PlayerName name={p.username} /></span>
                      <span className="text-xs text-mist-500">{dateOnly(p.at)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-mist-400">{t('Още никой — бъди първият.')}</p>
              )}
            </Card>
          );
        })}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {([['Най-много отворени кейсове', hall.openers], ['Майстори в работилницата', hall.crafters]] as const).map(([title, rows]) => (
          <Card key={title} title={tx(title)}>
            {rows.length ? (
              <ol className="space-y-1 text-sm">
                {rows.map((p, i) => (
                  <li key={p.userId} className="flex items-center gap-2">
                    <span className="num w-6 text-mist-500">{i + 1}.</span>
                    <span className="min-w-0 flex-1 truncate"><PlayerName name={p.username} /></span>
                    <span className="num font-semibold">{p.n}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-mist-400">{t('Още няма.')}</p>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
