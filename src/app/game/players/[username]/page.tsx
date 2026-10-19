import { CheckCircle2, Clock, Flag, Globe2, Medal, Route, Trophy, Truck, Weight } from 'lucide-react';
import { notFound } from 'next/navigation';
import { PlayerCardLive } from '@/components/game/PlayerCardLive';
import { Card, Empty, PageHeader } from '@/components/ui';
import { date, int, km } from '@/lib/format';
import { playerCareer } from '@/server/game/career';
import { gameContext } from '@/server/game/context';
import { playerCard } from '@/server/game/social';

export const metadata = { title: 'Кариера на играч' };

function Fact({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon: typeof Truck }) {
  return (
    <div className="rounded-xl bg-asphalt-850 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-mist-400"><Icon className="h-3.5 w-3.5" />{label}</div>
      <div className="num mt-0.5 font-display text-lg font-bold">{value}</div>
    </div>
  );
}

/** A player's public career page: the card, totals, records, favourite lanes and the latest trips. */
export default async function PlayerCareerPage({ params }: { params: Promise<{ username: string }> }) {
  const username = decodeURIComponent((await params).username);
  const { db, user } = await gameContext();
  const card = await playerCard(db, user.id, username);
  if (!card) notFound();
  const career = await playerCareer(db, card.id);
  if (!career) notFound();
  return (
    <div className="space-y-6">
      <PageHeader title={`Кариера · ${card.username}`} subtitle="Курсове, рекорди и любими линии. Игрови данни, без пари." />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <div className="min-w-0 space-y-6">
          <Card><PlayerCardLive card={card} /></Card>
          <Card title={<span className="inline-flex items-center gap-2"><Trophy className="h-4 w-4 text-gold-400" />В числа</span>}>
            <div className="grid grid-cols-2 gap-2">
              <Fact label="Курсове" value={int(career.trips)} icon={Truck} />
              <Fact label="Изминати" value={km(career.km)} icon={Route} />
              <Fact label="Превозени" value={`${int(career.tons)} т`} icon={Weight} />
              <Fact label="Навреме" value={career.onTimeShare == null ? '—' : `${Math.round(career.onTimeShare * 100)} %`} icon={Clock} />
              <Fact label="Държави (доставки)" value={career.countries} icon={Globe2} />
              <Fact label="Постижения" value={career.achievements} icon={Medal} />
            </div>
          </Card>
          <Card title={<span className="inline-flex items-center gap-2"><Medal className="h-4 w-4 text-gold-400" />Рекорди</span>}>
            {career.longest ? (
              <ul className="space-y-3 text-sm">
                <li><div>Най-дълъг курс: <span className="num font-semibold">{km(career.longest.km)}</span></div><div className="text-xs text-mist-400">{career.longest.from} → {career.longest.to} · {career.longest.goods}</div></li>
                {career.heaviest && <li><div>Най-тежък товар: <span className="num font-semibold">{int(Math.round(career.heaviest.tons))} т</span> {career.heaviest.goods.toLowerCase()}</div><div className="text-xs text-mist-400">{career.heaviest.from} → {career.heaviest.to}</div></li>}
              </ul>
            ) : <p className="text-sm text-mist-400">Още няма завършени курсове.</p>}
          </Card>
        </div>
        <div className="min-w-0 space-y-6">
          <Card title={<span className="inline-flex items-center gap-2"><Flag className="h-4 w-4 text-cyan-glow" />Любими линии</span>}>
            {career.lanes.length ? (
              <ol className="space-y-2 text-sm">
                {career.lanes.map((l, i) => (
                  <li key={`${l.from}-${l.to}`} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate"><span className="num mr-2 text-mist-400">{i + 1}.</span>{l.from} → {l.to}</span>
                    <span className="num shrink-0 text-xs text-mist-400">{l.trips} {l.trips === 1 ? 'курс' : 'курса'} · {km(l.km)}</span>
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm text-mist-400">Още няма любими линии.</p>}
          </Card>
          <Card title={<span className="inline-flex items-center gap-2"><Truck className="h-4 w-4 text-mist-400" />Последни курсове</span>} className="p-2 sm:p-3">
            {career.recent.length ? (
              <ul className="divide-y divide-asphalt-800">
                {career.recent.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-2 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{t.from} → {t.to}</span>
                      <span className="block truncate text-xs text-mist-400">{t.goods} · {int(Math.round(t.tons))} т · {km(t.km)}</span>
                    </span>
                    <span className="shrink-0 text-right text-xs">
                      {t.late ? <span className="text-amber-sig">със закъснение</span> : <span className="inline-flex items-center gap-1 text-profit"><CheckCircle2 className="h-3.5 w-3.5" />навреме</span>}
                      {t.at && <span className="block text-mist-400">{date(t.at)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <Empty icon={Truck} title="Още няма курсове">Тук ще се появяват завършените курсове.</Empty>}
          </Card>
        </div>
      </div>
    </div>
  );
}
