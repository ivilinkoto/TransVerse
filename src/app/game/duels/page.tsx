import { Swords } from 'lucide-react';
import { notFound } from 'next/navigation';
import { DuelAnswer } from '@/components/game/TogetherActions';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { dateTime, dec } from '@/lib/format';
import { DUEL } from '@/lib/game/together';
import { gameContext } from '@/server/game/context';
import { duelsOf } from '@/server/game/together';

export const metadata = { title: 'Дуели' };

export default async function DuelsPage() {
  const { db, user, features } = await gameContext();
  if (!features.duels) notFound();
  const list = await duelsOf(db, user.id, 20);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Дуели"
        subtitle={`1 срещу 1: кой ще превози повече тонове за ${DUEL.days} дни.`}
        help={`Предизвикай играч от картата му („Дуел“) или в Discord с /дуел. Той има ${DUEL.pendingHours} часа да приеме. От приемането се броят тоновете на доставките ви (по времето на пристигане) за ${DUEL.days} дни. Победителят получава ${DUEL.coins} ТрансКоин и значката „Дуелист“. До ${DUEL.maxOpen} дуела наведнъж.`}
      />
      <Card>
        {list.length === 0 ? (
          <Empty icon={Swords} title="Още нямаш дуели">Отвори картата на играч (класации, чат, приятели) и натисни „Дуел“.</Empty>
        ) : (
          <ul className="divide-y divide-asphalt-800">
            {list.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 font-semibold">
                    <Swords className="h-4 w-4 text-loss" />срещу {d.rival}
                    {d.status === 'active' && <Badge tone="cyan">тече</Badge>}
                    {d.status === 'pending' && <Badge tone="gold">{d.incoming ? 'покана за теб' : 'чака отговор'}</Badge>}
                    {d.status === 'done' && <Badge tone={d.won === true ? 'green' : d.won === false ? 'red' : 'neutral'}>{d.won === true ? `победа · +${DUEL.coins} TC` : d.won === false ? 'загуба' : 'равенство'}</Badge>}
                    {(d.status === 'declined' || d.status === 'expired') && <Badge tone="neutral">{d.status === 'declined' ? 'отказан' : 'изтекъл'}</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-mist-400">
                    {d.status === 'active' || d.status === 'done' ? <>Ти <span className="num text-white">{dec(d.myTons)} т</span> : <span className="num text-white">{dec(d.theirTons)} т</span> {d.rival}{d.endsAt && d.status === 'active' ? ` · край ${dateTime(d.endsAt)}` : ''}</> : `Изпратена ${dateTime(d.createdAt)}`}
                  </div>
                </div>
                {d.incoming && <DuelAnswer duelId={d.id} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
