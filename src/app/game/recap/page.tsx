import { notFound } from 'next/navigation';
import { CalendarHeart, Clock, Flag, Globe2, Medal, Route, Truck, Users, Weight } from 'lucide-react';
import { RecapCard } from '@/components/game/RecapCard';
import { Card, Empty, PageHeader, Stat } from '@/components/ui';
import { int, km, money } from '@/lib/format';
import { isRecapTime, MONTHS_BG, recapYear } from '@/lib/game/recap';
import { testsUnreleased } from '@/server/auth/roles';
import { gameContext } from '@/server/game/context';
import { yearRecap } from '@/server/game/recap';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Моята година') };
}

export default async function RecapPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.year_recap) notFound();
  const open = isRecapTime(now) || testsUnreleased(user);
  const year = recapYear(now);
  const r = open ? await yearRecap(db, user.id, year) : null;
  if (!open || !r) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('Моята година в TransVerse')} subtitle={t('Годишната равносметка')} />
        <Empty icon={CalendarHeart} title={t('Равносметката идва на 15 декември')}>{t('Тогава ще видиш своята година: километри, рекорди, любима линия и с кого си карал най-много в конвой — и ще можеш да я споделиш като картинка.')}</Empty>
      </div>
    );
  }
  const onTime = r.onTimeShare == null ? '—' : `${Math.round(r.onTimeShare * 100)} %`;
  const lines = [
    { label: t('Курсове'), value: t('{0} · {1} навреме', int(r.trips), onTime) },
    { label: t('Изминати'), value: km(r.km) },
    { label: t('Превозени'), value: t('{0} т в {1} {2}', int(r.tons), r.countries, r.countries === 1 ? t('държава') : t('държави')) },
    ...(r.longest ? [{ label: t('Най-дълъг курс'), value: `${tx(r.longest.from)} → ${tx(r.longest.to)} · ${km(r.longest.km)}` }] : []),
    ...(r.lane ? [{ label: t('Любима линия'), value: `${tx(r.lane.from)} → ${tx(r.lane.to)} (${r.lane.trips}×)` }] : []),
    ...(r.convoy ? [{ label: t('Най-често в конвой с'), value: `${r.convoy.username} (${r.convoy.trips}×)` }] : []),
    ...(r.month ? [{ label: t('Най-натоварен месец'), value: t('{0} · {1} курса', MONTHS_BG[r.month.month - 1], r.month.trips) }] : []),
  ].slice(0, 7);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Моята {0} в TransVerse', r.year)} subtitle={t('{0} · ниво {1}{2}', r.username, r.level, r.company ? ` · „${r.company}“` : '')} help={t('Курсовете на твоя акаунт (твоите и на наетите шофьори), приключени през годината по българско време. Игрови данни.')} />
      {r.trips === 0 ? (
        <Empty icon={Truck} title={t('Още няма курсове през тази година')}>{t('Поеми поръчка — равносметката се пълни с всеки доставен товар.')}</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t('Курсове')} value={int(r.trips)} icon={Truck} hint={t('{0} навреме', onTime)} />
            <Stat label={t('Изминати')} value={km(r.km)} icon={Route} />
            <Stat label={t('Превозени')} value={t('{0} т', int(r.tons))} icon={Weight} />
            <Stat label={t('Държави')} value={r.countries} icon={Globe2} />
            <Stat label={t('Нетно от курсове')} value={money(r.earnedCents)} icon={Flag} tone="gold" />
            <Stat label={t('Постижения')} value={r.achievements} icon={Medal} />
            <Stat label={t('Най-натоварен месец')} value={r.month ? tx(MONTHS_BG[r.month.month - 1]!) : '—'} icon={Clock} hint={r.month ? t('{0} курса', r.month.trips) : undefined} />
            <Stat label={t('Конвой')} value={r.convoy?.username ?? '—'} icon={Users} hint={r.convoy ? t('{0} курса заедно', r.convoy.trips) : t('покарай с приятел')} />
          </div>
          <Card title={t('Рекорди на годината')}>
            <ul className="space-y-2 text-sm">
              {r.longest && <li>{t('Най-дълъг курс:')}{' '}<b>{tx(r.longest.from)} → {tx(r.longest.to)}</b> · {km(r.longest.km)} · {tx(r.longest.goods).toLowerCase()}</li>}
              {r.lane && <li>{t('Любима линия:')}{' '}<b>{tx(r.lane.from)} → {tx(r.lane.to)}</b>{' '}{t('— {0} пъти', r.lane.trips)}</li>}
              {r.convoy && <li>{t('Най-често в конвой с')}{' '}<b>{tx(r.convoy.username)}</b>{' '}{t('— {0} курса', r.convoy.trips)}</li>}
            </ul>
          </Card>
          <Card title={t('Сподели годината си')}>
            <p className="mb-3 text-sm text-mist-400">{t('Картинка с твоите числа (без пари) — за историята, поста или чата с приятели.')}</p>
            <RecapCard title={t('Моята {0} на пътя', r.year)} name={r.username} lines={lines} fileName={`transverse-${r.year}-${r.username}.png`} />
          </Card>
        </>
      )}
    </div>
  );
}
