import { Palette } from 'lucide-react';
import { notFound } from 'next/navigation';
import { LiveryEnter, LiveryVote } from '@/components/game/TogetherActions';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { VehicleIllustration } from '@/components/vehicles/VehicleIllustration';
import { LIVERY_CONTEST, previousMonth, sofiaMonth } from '@/lib/game/together';
import { gameContext } from '@/server/game/context';
import { liveryContest } from '@/server/game/livery-contest';
import { fleetView } from '@/server/game/queries';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Ливреи') };
}

const MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];
const monthName = (key: string) => `${MONTHS[Number(key.slice(5)) - 1]} ${key.slice(0, 4)}`;

export default async function LiveryPage() {
  await initLocale();
  const { db, user, company, now, features } = await gameContext();
  if (!features.livery_contest) notFound();
  const month = sofiaMonth(now);
  const [entries, fleet, last] = await Promise.all([
    liveryContest(db, user.id, now),
    fleetView(db, company.id),
    liveryContest(db, user.id, now, previousMonth(month)),
  ]);
  const mine = entries.find((e) => e.userId === user.id);
  const winner = last.find((e) => e.won);
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Конкурс за ливрея')}
        subtitle={t('Покажи най-красивия си камион — {0}.', monthName(month))}
        help={t('Всеки играч показва по един камион на месец — такъв, какъвто е в момента (модел, ремарке, цвят на компанията и специална боя). Другите дават 👍 (по веднъж, не за своя). На 1-во число камионът с най-много 👍 (поне {0}) печели {1} ТрансКоин и значката „Ливрея на месеца“. Камионите се показват и в Discord, в #ливреи.', LIVERY_CONTEST.minVotes, LIVERY_CONTEST.coins)}
      />
      {winner && (
        <Card title={t('Ливрея на месеца · {0}', monthName(winner.monthKey))}>
          <div className="flex flex-wrap items-center gap-4">
            <VehicleIllustration modelId={winner.modelId} trailerModelId={winner.trailerModelId} color={winner.color} livery={winner.livery} className="h-24 w-72 max-w-full" />
            <div>
              <div className="font-display text-xl font-bold">{tx(winner.username)}</div>
              <div className="text-sm text-mist-400">{tx(winner.model)} · {tx(winner.plate)} · {tx(winner.votes)} 👍</div>
            </div>
          </div>
        </Card>
      )}
      <Card title={t('Твоят камион')}>
        {mine ? (
          <p className="text-sm text-mist-300">{t('Участваш с')}{' '}<b>{tx(mine.plate)}</b>{' '}{t('({0}) — {1} 👍 досега.', mine.model, mine.votes)}</p>
        ) : fleet.vehicles.length ? (
          <LiveryEnter trucks={fleet.vehicles.map((v) => ({ id: v.id, label: `${v.plate} · ${v.model.name}${v.trailer ? ` + ${v.trailer.model.name}` : ''}` }))} />
        ) : (
          <p className="text-sm text-mist-400">{t('Нямаш камион, който да покажеш.')}</p>
        )}
      </Card>
      {entries.length === 0 ? (
        <Empty icon={Palette} title={t('Още няма камиони този месец')}>{t('Бъди първият!')}</Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((e, i) => (
            <li key={e.id} className="panel p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold">{tx(e.username)}</span>
                {i === 0 && e.votes > 0 && <Badge tone="gold">{t('води')}</Badge>}
              </div>
              <VehicleIllustration modelId={e.modelId} trailerModelId={e.trailerModelId} color={e.color} livery={e.livery} className="my-3 h-24 w-full" />
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-mist-400">{tx(e.model)} · {tx(e.plate)}</span>
                <LiveryVote entryId={e.id} votes={e.votes} voted={e.voted} own={e.userId === user.id} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
