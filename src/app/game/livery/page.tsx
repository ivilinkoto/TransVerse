import { Palette } from 'lucide-react';
import { notFound } from 'next/navigation';
import { LiveryEnter, LiveryVote } from '@/components/game/TogetherActions';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { VehicleIllustration } from '@/components/vehicles/VehicleIllustration';
import { LIVERY_CONTEST, previousMonth, sofiaMonth } from '@/lib/game/together';
import { gameContext } from '@/server/game/context';
import { liveryContest } from '@/server/game/livery-contest';
import { fleetView } from '@/server/game/queries';

export const metadata = { title: 'Ливреи' };

const MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];
const monthName = (key: string) => `${MONTHS[Number(key.slice(5)) - 1]} ${key.slice(0, 4)}`;

export default async function LiveryPage() {
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
        title="Конкурс за ливрея"
        subtitle={`Покажи най-красивия си камион — ${monthName(month)}.`}
        help={`Всеки играч показва по един камион на месец — такъв, какъвто е в момента (модел, ремарке, цвят на компанията и специална боя). Другите дават 👍 (по веднъж, не за своя). На 1-во число камионът с най-много 👍 (поне ${LIVERY_CONTEST.minVotes}) печели ${LIVERY_CONTEST.coins} ТрансКоин и значката „Ливрея на месеца“. Камионите се показват и в Discord, в #ливреи.`}
      />
      {winner && (
        <Card title={`Ливрея на месеца · ${monthName(winner.monthKey)}`}>
          <div className="flex flex-wrap items-center gap-4">
            <VehicleIllustration modelId={winner.modelId} trailerModelId={winner.trailerModelId} color={winner.color} livery={winner.livery} className="h-24 w-72 max-w-full" />
            <div>
              <div className="font-display text-xl font-bold">{winner.username}</div>
              <div className="text-sm text-mist-400">{winner.model} · {winner.plate} · {winner.votes} 👍</div>
            </div>
          </div>
        </Card>
      )}
      <Card title="Твоят камион">
        {mine ? (
          <p className="text-sm text-mist-300">Участваш с <b>{mine.plate}</b> ({mine.model}) — {mine.votes} 👍 досега.</p>
        ) : fleet.vehicles.length ? (
          <LiveryEnter trucks={fleet.vehicles.map((v) => ({ id: v.id, label: `${v.plate} · ${v.model.name}${v.trailer ? ` + ${v.trailer.model.name}` : ''}` }))} />
        ) : (
          <p className="text-sm text-mist-400">Нямаш камион, който да покажеш.</p>
        )}
      </Card>
      {entries.length === 0 ? (
        <Empty icon={Palette} title="Още няма камиони този месец">Бъди първият!</Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((e, i) => (
            <li key={e.id} className="panel p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold">{e.username}</span>
                {i === 0 && e.votes > 0 && <Badge tone="gold">води</Badge>}
              </div>
              <VehicleIllustration modelId={e.modelId} trailerModelId={e.trailerModelId} color={e.color} livery={e.livery} className="my-3 h-24 w-full" />
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-mist-400">{e.model} · {e.plate}</span>
                <LiveryVote entryId={e.id} votes={e.votes} voted={e.voted} own={e.userId === user.id} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
