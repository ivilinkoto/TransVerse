import Link from 'next/link';
import { Badge, Card, PageHeader, Stat, Table } from '@/components/ui';
import { dateTime, int } from '@/lib/format';
import { COIN_REASON_LABELS, type CoinReason } from '@/server/game/coins';
import { adminContext } from '@/server/admin-context';
import { COIN_WATCH, coinMovement } from '@/server/admin-coins';
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Движение на ТрансКоин') };
}

const reasonLabel = (r: string) => tx(COIN_REASON_LABELS[r as CoinReason] ?? r);
const PERIODS = [1, 7, 30] as const;

/** 1.2.1: where ТрансКоин come from and go — for the team. */
export default async function AdminCoinsPage({ searchParams }: { searchParams: Promise<{ user?: string; reason?: string; days?: string; min?: string }> }) {
  await initLocale();
  const { db, now } = await adminContext({ admin: true });
  const sp = await searchParams;
  const days = PERIODS.includes(Number(sp.days) as (typeof PERIODS)[number]) ? Number(sp.days) : 7;
  const min = Math.max(0, Math.round(Number(sp.min) || 0));
  const filter = { username: sp.user?.trim() || undefined, reason: sp.reason || undefined, days, min: min || undefined };
  const m = await coinMovement(db, filter, now);
  const link = (patch: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    const next = { user: filter.username, reason: filter.reason, days, min: min || undefined, ...patch };
    for (const [k, v] of Object.entries(next)) if (v !== undefined && v !== '') q.set(k, String(v));
    return `/admin/coins?${q.toString()}`;
  };
  return (
    <div className="space-y-6">
      <PageHeader title={tr('Движение на ТрансКоин')} subtitle={tr('Откъде идват и къде отиват ТрансКоин: всеки запис, по причина, най-големите печалби и записи, които заслужават проверка.')} />

      <Card>
        <form className="flex flex-wrap items-end gap-2" action="/admin/coins">
          <label className="space-y-1"><span className="label">{tr('Играч')}</span><input name="user" defaultValue={filter.username ?? ''} className="input w-44" placeholder={tr('потребителско име')} /></label>
          <label className="space-y-1"><span className="label">{tr('Причина')}</span>
            <select name="reason" defaultValue={filter.reason ?? ''} className="input w-56">
              <option value="">{tr('— всички —')}</option>
              {Object.keys(COIN_REASON_LABELS).sort((a, b) => reasonLabel(a).localeCompare(reasonLabel(b))).map((r) => <option key={r} value={r}>{reasonLabel(r)}</option>)}
            </select>
          </label>
          <label className="space-y-1"><span className="label">{tr('Период')}</span>
            <select name="days" defaultValue={String(days)} className="input w-32">
              {PERIODS.map((d) => <option key={d} value={d}>{d === 1 ? tr('24 часа') : tr('{0} дни', d)}</option>)}
            </select>
          </label>
          <label className="space-y-1"><span className="label">{tr('Поне (TC)')}</span><input name="min" type="number" min={0} defaultValue={min || ''} className="input w-28" /></label>
          <button type="submit" className="btn-primary">{tr('Покажи')}</button>
          <Link href="/admin/coins" className="btn-ghost">{tr('Изчисти')}</Link>
        </form>
        {filter.username && !m.player && <p className="mt-2 text-sm text-loss">{tr('Няма играч с това име.')}</p>}
        {m.player && <p className="mt-2 text-sm text-mist-300">{tr('{0} има сега {1} TC.', m.player.username, int(m.player.coins))}{' '}<Link href={`/admin/users/${m.player.id}`} className="text-cyan-glow hover:underline">{tr('Към профила в админ панела')}</Link></p>}
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={tr('Влезли')} value={<span className="text-profit">+{int(m.totalIn)} TC</span>} hint={tr('от {0}', dateTime(m.since))} />
        <Stat label={tr('Излезли')} value={<span className="text-loss">−{int(m.totalOut)} TC</span>} />
        <Stat label={tr('Разлика')} value={`${m.totalIn - m.totalOut >= 0 ? '+' : '−'}${int(Math.abs(m.totalIn - m.totalOut))} TC`} />
      </div>

      {/* 1.2.6: is play giving too many ТрансКоин for the shop to matter? */}
      <Card title={tr('Баланс на наградите')} id="coin-balance">
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label={tr('От награди')} value={`+${int(m.balance.rewards)} TC`} hint={tr('{0} TC на активен играч ({1} активни)', int(m.balance.perPlayer), int(m.balance.active))} />
          <Stat label={tr('Купени')} value={`+${int(m.balance.bought)} TC`} />
          <Stat label={tr('Изхарчени')} value={`−${int(m.balance.spent)} TC`} hint={tr('магазин, пропуск, номера')} />
          <Stat label={tr('Награди сега')} value={`${Math.round(m.balance.factor * 100)}%`} hint={m.balance.next ? tr('{0}% от {1}', Math.round(m.balance.next.factor * 100), dateTime(new Date(m.balance.next.from))) : tr('последна стъпка')} />
        </div>
        <p className="mt-3 text-xs text-mist-400">{m.balance.rewards > m.balance.spent ? tr('Наградите дават повече, отколкото играчите харчат — ТрансКоин се трупат.') : tr('Играчите харчат колкото печелят — балансът е добър.')}{' '}{tr('Стъпките са в src/lib/game/coin-taper.ts.')}</p>
      </Card>

      <Card title={tr('По причина')}>
        {!m.byReason.length ? <p className="text-sm text-mist-400">{tr('Няма движение за периода.')}</p> : (
          <Table head={[tr('Причина'), tr('Влезли'), tr('Излезли'), tr('Записи')]}>
            {m.byReason.map((r) => (
              <tr key={r.reason}>
                <td className="px-3 py-2"><Link href={link({ reason: r.reason })} className="hover:underline">{reasonLabel(r.reason)}</Link></td>
                <td className="num px-3 py-2 text-profit">{r.in ? `+${int(r.in)}` : '—'}</td>
                <td className="num px-3 py-2 text-loss">{r.out ? `−${int(r.out)}` : '—'}</td>
                <td className="num px-3 py-2 text-mist-400">{int(r.n)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={tr('Най-много спечелили (без покупки)')}>
          {!m.gainers.length ? <p className="text-sm text-mist-400">{tr('Няма.')}</p> : (
            <ol className="space-y-1 text-sm">
              {m.gainers.map((g, i) => (
                <li key={g.userId} className="flex items-center justify-between gap-2">
                  <span><span className="num text-mist-400">{i + 1}.</span> <Link href={link({ user: g.username })} className="font-medium hover:underline">{tx(g.username)}</Link></span>
                  <span className="num"><span className={g.gained >= 0 ? 'text-profit' : 'text-loss'}>{g.gained >= 0 ? '+' : '−'}{int(Math.abs(g.gained))}</span> <span className="text-xs text-mist-400">{tr('(има {0})', int(g.coins))}</span></span>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card title={tr('За проверка')}>
          <p className="mb-2 text-xs text-mist-400">{tr('Един запис от поне {0} TC или над {1} TC за ден от игра (без покупки).', COIN_WATCH.bigEntry, COIN_WATCH.bigDay)}</p>
          {!m.flagged.length ? <p className="text-sm text-profit">{tr('Нищо подозрително за периода.')}</p> : (
            <ul className="space-y-1 text-sm">
              {m.flagged.map((f) => (
                <li key={`${f.user_id}-${f.day}`} className="flex flex-wrap items-center justify-between gap-2">
                  <span><Badge tone="gold">{f.day}</Badge> <Link href={link({ user: f.username, days: 30 })} className="font-medium hover:underline">{tx(f.username)}</Link></span>
                  <span className="num text-xs text-mist-300">{tr('общо +{0}, най-голям запис +{1}', int(f.total), int(f.biggest))}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={tr('Записи ({0})', m.entries.length)}>
        {!m.entries.length ? <p className="text-sm text-mist-400">{tr('Няма записи по тези условия.')}</p> : (
          <Table head={[tr('Кога'), tr('Играч'), tr('Сума'), tr('След това'), tr('Причина'), tr('Описание'), tr('От')]}>
            {m.entries.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-3 py-2 text-mist-400">{dateTime(e.at)}</td>
                <td className="px-3 py-2"><Link href={link({ user: e.username })} className="hover:underline">{tx(e.username)}</Link></td>
                <td className={`num px-3 py-2 font-semibold ${e.amount >= 0 ? 'text-profit' : 'text-loss'}`}>{e.amount >= 0 ? '+' : '−'}{int(Math.abs(e.amount))}</td>
                <td className="num px-3 py-2 text-mist-400">{int(e.balanceAfter)}</td>
                <td className="px-3 py-2">{reasonLabel(e.reason)}</td>
                <td className="max-w-xs truncate px-3 py-2 text-mist-300" title={e.description}>{tx(e.description)}</td>
                <td className="px-3 py-2 text-mist-400">{e.actor ? tx(e.actor) : '—'}</td>
              </tr>
            ))}
          </Table>
        )}
        {m.entries.length === 200 && <p className="mt-2 text-xs text-mist-400">{tr('Показани са последните 200 записа. Стесни филтъра, за да видиш по-стари.')}</p>}
      </Card>
    </div>
  );
}
