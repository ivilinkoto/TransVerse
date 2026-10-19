import { notFound } from 'next/navigation';
import { CalendarHeart, Clock, Flag, Globe2, Medal, Route, Truck, Users, Weight } from 'lucide-react';
import { RecapCard } from '@/components/game/RecapCard';
import { Card, Empty, PageHeader, Stat } from '@/components/ui';
import { int, km, money } from '@/lib/format';
import { isRecapTime, MONTHS_BG, recapYear } from '@/lib/game/recap';
import { isStaff } from '@/server/auth/roles';
import { gameContext } from '@/server/game/context';
import { yearRecap } from '@/server/game/recap';

export const metadata = { title: 'Моята година' };

export default async function RecapPage() {
  const { db, user, now, features } = await gameContext();
  if (!features.year_recap) notFound();
  const open = isRecapTime(now) || isStaff(user.role);
  const year = recapYear(now);
  const r = open ? await yearRecap(db, user.id, year) : null;
  if (!open || !r) {
    return (
      <div className="space-y-6">
        <PageHeader title="Моята година в TransVerse" subtitle="Годишната равносметка" />
        <Empty icon={CalendarHeart} title="Равносметката идва на 15 декември">Тогава ще видиш своята година: километри, рекорди, любима линия и с кого си карал най-много в конвой — и ще можеш да я споделиш като картинка.</Empty>
      </div>
    );
  }
  const onTime = r.onTimeShare == null ? '—' : `${Math.round(r.onTimeShare * 100)} %`;
  const lines = [
    { label: 'Курсове', value: `${int(r.trips)} · ${onTime} навреме` },
    { label: 'Изминати', value: km(r.km) },
    { label: 'Превозени', value: `${int(r.tons)} т в ${r.countries} ${r.countries === 1 ? 'държава' : 'държави'}` },
    ...(r.longest ? [{ label: 'Най-дълъг курс', value: `${r.longest.from} → ${r.longest.to} · ${km(r.longest.km)}` }] : []),
    ...(r.lane ? [{ label: 'Любима линия', value: `${r.lane.from} → ${r.lane.to} (${r.lane.trips}×)` }] : []),
    ...(r.convoy ? [{ label: 'Най-често в конвой с', value: `${r.convoy.username} (${r.convoy.trips}×)` }] : []),
    ...(r.month ? [{ label: 'Най-натоварен месец', value: `${MONTHS_BG[r.month.month - 1]} · ${r.month.trips} курса` }] : []),
  ].slice(0, 7);
  return (
    <div className="space-y-6">
      <PageHeader title={`Моята ${r.year} в TransVerse`} subtitle={`${r.username} · ниво ${r.level}${r.company ? ` · „${r.company}“` : ''}`} help="Курсовете на твоя акаунт (твоите и на наетите шофьори), приключени през годината по българско време. Игрови данни." />
      {r.trips === 0 ? (
        <Empty icon={Truck} title="Още няма курсове през тази година">Поеми поръчка — равносметката се пълни с всеки доставен товар.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Курсове" value={int(r.trips)} icon={Truck} hint={`${onTime} навреме`} />
            <Stat label="Изминати" value={km(r.km)} icon={Route} />
            <Stat label="Превозени" value={`${int(r.tons)} т`} icon={Weight} />
            <Stat label="Държави" value={r.countries} icon={Globe2} />
            <Stat label="Нетно от курсове" value={money(r.earnedCents)} icon={Flag} tone="gold" />
            <Stat label="Постижения" value={r.achievements} icon={Medal} />
            <Stat label="Най-натоварен месец" value={r.month ? MONTHS_BG[r.month.month - 1]! : '—'} icon={Clock} hint={r.month ? `${r.month.trips} курса` : undefined} />
            <Stat label="Конвой" value={r.convoy?.username ?? '—'} icon={Users} hint={r.convoy ? `${r.convoy.trips} курса заедно` : 'покарай с приятел'} />
          </div>
          <Card title="Рекорди на годината">
            <ul className="space-y-2 text-sm">
              {r.longest && <li>Най-дълъг курс: <b>{r.longest.from} → {r.longest.to}</b> · {km(r.longest.km)} · {r.longest.goods.toLowerCase()}</li>}
              {r.lane && <li>Любима линия: <b>{r.lane.from} → {r.lane.to}</b> — {r.lane.trips} пъти</li>}
              {r.convoy && <li>Най-често в конвой с <b>{r.convoy.username}</b> — {r.convoy.trips} курса</li>}
            </ul>
          </Card>
          <Card title="Сподели годината си">
            <p className="mb-3 text-sm text-mist-400">Картинка с твоите числа (без пари) — за историята, поста или чата с приятели.</p>
            <RecapCard title={`Моята ${r.year} на пътя`} name={r.username} lines={lines} fileName={`transverse-${r.year}-${r.username}.png`} />
          </Card>
        </>
      )}
    </div>
  );
}
