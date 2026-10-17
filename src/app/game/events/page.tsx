import { PartyPopper } from 'lucide-react';
import { EventCard, EventStatusBadge } from '@/components/events/EventCard';
import { Card, Empty, PageHeader, Table } from '@/components/ui';
import { dateTime, int } from '@/lib/format';
import { formatAmount, rewardText, type EventMetric } from '@/lib/game/events';
import { gameContext } from '@/server/game/context';
import { eventsBoard } from '@/server/game/events';

export const metadata = { title: 'Ивенти' };

export default async function EventsPage() {
  const { db, user, now } = await gameContext();
  const { open, past } = await eventsBoard(db, user.id, now);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Ивенти"
        subtitle="Общи цели за всички играчи — постигаме ги заедно."
        help="Всяка подходяща доставка се брои автоматично. Ако целта бъде постигната навреме, всеки участник получава награда, а най-добрите — и VIP. Ако не — никой не получава, затова се борим заедно. Целите и наградите са игрови данни."
      />
      {open.length === 0 ? (
        <Card><Empty icon={PartyPopper} title="В момента няма ивент">Следващият ще бъде обявен скоро — ще получиш известие.</Empty></Card>
      ) : (
        open.map((d) => <EventCard key={d.event.id} detail={d} now={now} viewerId={user.id} />)
      )}
      {past.length > 0 && (
        <Card title="Минали ивенти">
          <Table head={['Ивент', 'Период', 'Резултат', 'Постигнато', 'Твоето място', 'Твоята награда']}>
            {past.map((d) => (
              <tr key={d.event.id}>
                <td className="px-3 py-2 font-semibold">{d.event.name}</td>
                <td className="px-3 py-2 text-mist-400">{dateTime(d.event.startsAt)} – {dateTime(d.event.endsAt)}</td>
                <td className="px-3 py-2"><EventStatusBadge detail={d} now={now} /></td>
                <td className="num px-3 py-2">{formatAmount(d.event.metric as EventMetric, d.event.progress)} / {formatAmount(d.event.metric as EventMetric, d.event.target)}</td>
                <td className="num px-3 py-2">{d.mine?.rank ? int(d.mine.rank) : '—'}</td>
                <td className="px-3 py-2">{d.mine?.reward ? rewardText(d.mine.reward) : '—'}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
