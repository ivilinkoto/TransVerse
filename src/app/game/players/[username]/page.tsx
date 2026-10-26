import { CheckCircle2, Clock, Crown, Flag, Globe2, Medal, Route, Sparkles, Trophy, Truck, Weight } from 'lucide-react';
import { notFound } from 'next/navigation';
import { PlayerCardLive } from '@/components/game/PlayerCardLive';
import { Card, Empty, PageHeader } from '@/components/ui';
import { date, dec, int, km } from '@/lib/format';
import { playerCareer } from '@/server/game/career';
import { gameContext } from '@/server/game/context';
import { ProfileShowcase } from '@/components/game/ProfileShowcase';
import { laneRecordsView, showcaseOf } from '@/server/game/community';
import { kingdomsOf } from '@/server/game/kings';
import { playerCard } from '@/server/game/social';
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Кариера на играч') };
}

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
  await initLocale();
  const username = decodeURIComponent((await params).username);
  const { db, user, features, now } = await gameContext();
  if (!features.career) notFound();
  const card = await playerCard(db, user.id, username);
  if (!card) notFound();
  const career = await playerCareer(db, card.id);
  if (!career) notFound();
  const showcase = features.profile_showcase ? await showcaseOf(db, card.id) : null;
  const [records, kingdoms] = await Promise.all([features.lane_records ? laneRecordsView(db, now, 10, card.id) : [], features.country_kings ? kingdomsOf(db, card.id) : []]);
  return (
    <div className="space-y-6">
      <PageHeader title={tr('Кариера · {0}', card.username)} subtitle={tr('Курсове, рекорди и любими линии. Игрови данни, без пари.')} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <div className="min-w-0 space-y-6">
          <Card><PlayerCardLive card={card} /></Card>
          {showcase && (showcase.trucks.length > 0 || showcase.badges.length > 0) && (
            <Card title={<span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4 text-gold-400" />{tr('Витрина')}</span>}><ProfileShowcase showcase={showcase} /></Card>
          )}
          {kingdoms.length > 0 && (
            <Card title={<span className="inline-flex items-center gap-2"><Crown className="h-4 w-4 text-gold-400" />{tr('Крал на държавата')}</span>}>
              <p className="text-sm text-mist-300">{tr('Най-много тонове до {0} миналия месец:', kingdoms.length === 1 ? tr('тази държава') : tr('тези държави'))}</p>
              <div className="mt-2 flex flex-wrap gap-2">{kingdoms.map((k) => <span key={k.countryCode} className="rounded-full bg-gold-400/10 px-2.5 py-1 text-xs text-gold-400">👑 {tx(k.country)} · <span className="num">{dec(k.tons)}</span>{' '}{tr('т')}</span>)}</div>
            </Card>
          )}
          <Card title={<span className="inline-flex items-center gap-2"><Trophy className="h-4 w-4 text-gold-400" />{tr('В числа')}</span>}>
            <div className="grid grid-cols-2 gap-2">
              <Fact label={tr('Курсове')} value={int(career.trips)} icon={Truck} />
              <Fact label={tr('Изминати')} value={km(career.km)} icon={Route} />
              <Fact label={tr('Превозени')} value={tr('{0} т', int(career.tons))} icon={Weight} />
              <Fact label={tr('Навреме')} value={career.onTimeShare == null ? '—' : `${Math.round(career.onTimeShare * 100)} %`} icon={Clock} />
              <Fact label={tr('Държави (доставки)')} value={career.countries} icon={Globe2} />
              <Fact label={tr('Постижения')} value={career.achievements} icon={Medal} />
            </div>
          </Card>
          <Card title={<span className="inline-flex items-center gap-2"><Medal className="h-4 w-4 text-gold-400" />{tr('Рекорди')}</span>}>
            {career.longest ? (
              <ul className="space-y-3 text-sm">
                <li><div>{tr('Най-дълъг курс:')}{' '}<span className="num font-semibold">{km(career.longest.km)}</span></div><div className="text-xs text-mist-400">{tx(career.longest.from)} → {tx(career.longest.to)} · {tx(career.longest.goods)}</div></li>
                {career.heaviest && <li><div>{tr('Най-тежък товар:')}{' '}<span className="num font-semibold">{tr('{0} т', int(Math.round(career.heaviest.tons)))}</span> {career.heaviest.goods.toLowerCase()}</div><div className="text-xs text-mist-400">{tx(career.heaviest.from)} → {tx(career.heaviest.to)}</div></li>}
              </ul>
            ) : <p className="text-sm text-mist-400">{tr('Още няма завършени курсове.')}</p>}
            {records.length > 0 && (
              <div className="mt-4 border-t border-asphalt-800 pt-3">
                <div className="label">{tr('Рекорди на линии този месец')}</div>
                <ul className="mt-2 space-y-1 text-sm">{records.map((r) => <li key={`${r.originCityId}-${r.destCityId}`} className="flex justify-between gap-2"><span className="truncate">{tx(r.from)} → {tx(r.to)}</span><span className="num shrink-0 text-xs text-mist-400">{tr('{0} ч {1} мин', Math.floor(r.minutes / 60), r.minutes % 60)}</span></li>)}</ul>
              </div>
            )}
          </Card>
        </div>
        <div className="min-w-0 space-y-6">
          <Card title={<span className="inline-flex items-center gap-2"><Flag className="h-4 w-4 text-cyan-glow" />{tr('Любими линии')}</span>}>
            {career.lanes.length ? (
              <ol className="space-y-2 text-sm">
                {career.lanes.map((l, i) => (
                  <li key={`${l.from}-${l.to}`} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate"><span className="num mr-2 text-mist-400">{i + 1}.</span>{tx(l.from)} → {tx(l.to)}</span>
                    <span className="num shrink-0 text-xs text-mist-400">{tx(l.trips)} {l.trips === 1 ? tr('курс') : tr('курса')} · {km(l.km)}</span>
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm text-mist-400">{tr('Още няма любими линии.')}</p>}
          </Card>
          <Card title={<span className="inline-flex items-center gap-2"><Truck className="h-4 w-4 text-mist-400" />{tr('Последни курсове')}</span>} className="p-2 sm:p-3">
            {career.recent.length ? (
              <ul className="divide-y divide-asphalt-800">
                {career.recent.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-2 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{tx(t.from)} → {tx(t.to)}</span>
                      <span className="block truncate text-xs text-mist-400">{tr('{0} · {1} т · {2}', t.goods, int(Math.round(t.tons)), km(t.km))}</span>
                    </span>
                    <span className="shrink-0 text-right text-xs">
                      {t.late ? <span className="text-amber-sig">{tr('със закъснение')}</span> : <span className="inline-flex items-center gap-1 text-profit"><CheckCircle2 className="h-3.5 w-3.5" />{tr('навреме')}</span>}
                      {t.at && <span className="block text-mist-400">{date(t.at)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <Empty icon={Truck} title={tr('Още няма курсове')}>{tr('Тук ще се появяват завършените курсове.')}</Empty>}
          </Card>
        </div>
      </div>
    </div>
  );
}
