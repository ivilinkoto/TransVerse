import { redirect } from 'next/navigation';
import { ActionButton } from '@/components/ui/ActionButton';
import { Card, Meter } from '@/components/ui';
import { date, dateTime, dec } from '@/lib/format';
import { INTERNS, KEY_CLIENTS, TRADITION } from '@/lib/game/company-life';
import { gameContext } from '@/server/game/context';
import { companyLifeView } from '@/server/game/company-life';
import { can, companyHub } from '@/server/game/membership';
import { NewAssembly, NewDepartment, TraditionForm } from './CommunityForms';

export const metadata = { title: 'Общност на компанията' };

/** v1.9: departments, the assembly, key clients, tradition, interns, mergers and the dynasty. */
export default async function CompanyCommunityPage() {
  const { db, user, now, features } = await gameContext();
  const hub = await companyHub(db, user.id);
  if (!hub) redirect('/game/company');
  const c = hub.company;
  const view = await companyLifeView(db, c.id, user.id, now);
  const manage = can(hub.rank, 'manage_members');
  const settings = can(hub.rank, 'manage_settings');
  const recruit = can(hub.rank, 'recruit');
  const open = view.assemblies.find((a) => !a.closed);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {features.departments && (
        <Card title="Отдели" className="lg:col-span-2">
          {view.departments.length === 0 ? <p className="text-sm text-mist-400">Още няма отдели. Например „Хладилен отдел“ или „Балкански отдел“ — всеки със свой началник и седмична цел.</p> : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {view.departments.map((d) => (
                <li key={d.id} className="rounded-xl bg-asphalt-850 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2"><b>{d.name}</b><span className="text-xs text-mist-400">началник: {d.head ?? '—'}</span></div>
                  <Meter value={Math.min(100, (d.weekTons / d.goalTons) * 100)} tone="cyan" className="mt-2" />
                  <div className="mt-1 flex justify-between text-xs text-mist-400"><span>{dec(d.weekTons)} / {d.goalTons} т тази седмица</span><span>{d.members.length} членове</span></div>
                  {d.members.length > 0 && <p className="mt-1 truncate text-xs text-mist-300">{d.members.join(', ')}</p>}
                  <div className="mt-2 flex gap-2">
                    {view.myDepartment === d.id ? <ActionButton action={{ type: 'joinDepartment', id: null }} className="btn-ghost px-2 py-1 text-xs">Напусни отдела</ActionButton> : <ActionButton action={{ type: 'joinDepartment', id: d.id }} className="btn-ghost px-2 py-1 text-xs">Влез в отдела</ActionButton>}
                    {manage && <ActionButton action={{ type: 'departmentHead', id: d.id, userId: user.id }} className="btn-ghost px-2 py-1 text-xs">Стани началник</ActionButton>}
                    {manage && <ActionButton action={{ type: 'deleteDepartment', id: d.id }} confirm={`Да махнем ли отдел „${d.name}“?`} className="btn-ghost px-2 py-1 text-xs text-loss">Махни</ActionButton>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {manage && <div className="mt-3"><NewDepartment /></div>}
        </Card>
      )}
      {features.general_assembly && (
        <Card title="Общо събрание 🗳️">
          {open ? (
            <div className="text-sm">
              <p className="font-semibold">{open.question}</p>
              <p className="text-xs text-mist-400">до {dateTime(open.closesAt)}</p>
              <ul className="mt-2 space-y-1.5">
                {open.options.map((o, i) => (
                  <li key={o.label} className="flex items-center justify-between gap-2">
                    <span>{o.label} <span className="text-xs text-mist-400">· {o.votes} гласа</span></span>
                    {open.mine === null ? <ActionButton action={{ type: 'voteAssembly', id: open.id, option: i }} className="btn-ghost px-2 py-1 text-xs">Гласувай</ActionButton> : open.mine === i ? <span className="text-xs text-profit">✓ твоят глас</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : settings ? <NewAssembly /> : <p className="text-sm text-mist-400">Няма отворено гласуване.</p>}
          {view.assemblies.filter((a) => a.closed).slice(0, 3).map((a) => (
            <p key={a.id} className="mt-2 text-xs text-mist-400">{a.question} → {a.result !== null ? `„${a.options[a.result]?.label}“` : 'без гласове'}</p>
          ))}
        </Card>
      )}
      {features.key_clients && (
        <Card title="Ключови клиенти">
          {view.keys.length ? (
            <ul className="space-y-1 text-sm">{view.keys.map((k) => <li key={k.city}>🤝 <b>{k.client}</b> · {k.city} <span className="text-xs text-mist-400">({Math.round(k.tons)} т миналия месец)</span></li>)}</ul>
          ) : <p className="text-sm text-mist-400">Тази месец няма. Компанията, докарала най-много тонове до голям град (300 000+ жители, поне {KEY_CLIENTS.minTons} т) за месеца, получава там ключов клиент със собствени товари (+{Math.round((KEY_CLIENTS.multiplier - 1) * 100)} %).</p>}
        </Card>
      )}
      {features.company_traditions && (
        <Card title="Традиция на компанията">
          <p className="text-sm text-mist-300">{c.traditionDay ? `„${c.traditionName}“ — всяка година на ${c.traditionDay.split('-').reverse().join('.')}. Тогава всички членове получават +${Math.round(TRADITION.bonusShare * 100)} % от наградите.` : `Изберете свой ден — тогава членовете получават +${Math.round(TRADITION.bonusShare * 100)} % от наградите.`}</p>
          {settings && <div className="mt-2"><TraditionForm day={c.traditionDay} name={c.traditionName} /></div>}
        </Card>
      )}
      {features.interns && (
        <Card title="Стажанти 🎓">
          {view.myStay && <p className="mb-2 text-sm">Твоят стаж в „{view.myStay.host}“: {view.myStay.status === 'active' ? `до ${dateTime(view.myStay.endsAt!)}` : 'чака отговор'}.</p>}
          {view.interns.length ? (
            <ul className="space-y-1.5 text-sm">
              {view.interns.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{s.username} · {s.status === 'active' ? `на стаж до ${dateTime(s.endsAt!)}` : 'иска стаж'}</span>
                  {s.status === 'requested' && recruit && <span className="flex gap-1"><ActionButton action={{ type: 'decideInternship', id: s.id, accept: true }} className="btn-ghost px-2 py-1 text-xs">Приеми</ActionButton><ActionButton action={{ type: 'decideInternship', id: s.id, accept: false }} className="btn-ghost px-2 py-1 text-xs">Откажи</ActionButton></span>}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-mist-400">Играч от друга компания може да поиска {INTERNS.days} дни стаж при вас (от профила на компанията). Стажантът кара с +{Math.round(INTERNS.xpBonus * 100)} % опит, а вашата компания печели фирмен опит.</p>}
        </Card>
      )}
      {features.mergers && hub.rank.isOwner && view.offers.length > 0 && (
        <Card title="Предложения за сливане">
          <ul className="space-y-2 text-sm">
            {view.offers.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>„{o.from}“ иска да ви приеме като отдел. Членовете и касата минават при тях, а компанията се закрива.</span>
                <span className="flex gap-1"><ActionButton action={{ type: 'decideMerger', id: o.id, accept: true }} confirm="Сигурни ли сте? Компанията ще се закрие, членовете и касата минават в другата." className="btn-ghost px-2 py-1 text-xs">Приеми</ActionButton><ActionButton action={{ type: 'decideMerger', id: o.id, accept: false }} className="btn-ghost px-2 py-1 text-xs">Откажи</ActionButton></span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {features.company_history && view.history && (
        <Card title="История на компанията" className="lg:col-span-2">
          <p className="text-sm text-mist-300">Основана на {date(view.history.foundedAt)}.</p>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            <div>
              <div className="label">Собственици</div>
              <ol className="mt-1 space-y-1 text-sm">{view.history.owners.map((o) => <li key={`${o.userId}-${String(o.fromAt)}`}>👑 {o.username} <span className="text-xs text-mist-400">{date(o.fromAt)} – {o.toAt ? date(o.toAt) : 'сега'}</span></li>)}</ol>
            </div>
            <div>
              <div className="label">Ветерани</div>
              <ol className="mt-1 space-y-1 text-sm">{view.history.veterans.map((v) => <li key={v.username}>🚛 {v.username} <span className="text-xs text-mist-400">{v.deliveries} курса · от {date(v.joinedAt)}</span></li>)}</ol>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
