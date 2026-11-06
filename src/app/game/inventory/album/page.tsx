import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui';
import { ItemArt } from '@/components/game/ItemArt';
import { COLLECTIONS, GOLDEN_KEY, ITEMS } from '@/lib/game/items';
import { inSeasonWindow, sofiaMonthDay } from '@/lib/game/seasonal';
import { date as dateOnly } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { foundItems, provenance } from '@/server/game/item-trade';
import { t, tx } from '@/i18n/t';
import Link from 'next/link';
import { ActionButton } from '@/components/ui/ActionButton';
import { wantsView } from '@/server/game/meet';
import { ITEM_WANTS } from '@/lib/game/on-the-road';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Албум с предмети') };
}

/** 1.2.1 „Албум“: every collection, what is found, what is missing and the reward. Game data. */
export default async function AlbumPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.item_album) notFound();
  const found = await foundItems(db, user.id);
  const keys = found.has('golden_key') ? (await provenance(db, user.id, ['golden_key'])).golden_key?.serials ?? [] : [];
  const today = sofiaMonthDay(now);
  // 1.2.7 „Търся / Давам“: what the player looks for, who has a spare, and who looks for the player's spares.
  const trade = features.item_wants ? await wantsView(db, user.id) : null;
  const wanted = new Set(trade?.wants.map((w) => w.itemId) ?? []);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Албум с предмети')} subtitle={t('Всеки предмет, намерен поне веднъж, остава в албума — дори да го използваш, продадеш или размениш.')} />
      {trade && (
        <Card title={t('🔎 Търся / Давам')}>
          <p className="text-sm text-mist-400">{t('Отбележи до {0} липсващи предмета с „Търся“. Играчите с резервен ги виждат и получават известие — разберете се в личните съобщения.', ITEM_WANTS.max)}</p>
          {trade.wants.length > 0 && (
            <ul className="mt-3 space-y-2 text-sm" data-testid="item-wants">
              {trade.wants.map((w) => (
                <li key={w.itemId} className="flex flex-wrap items-center gap-2">
                  <ItemArt id={w.itemId as keyof typeof ITEMS} className="h-8 w-8" />
                  <span className="font-semibold">{tx(w.name)}</span>
                  <span className="text-mist-400">{w.owners.length ? t('Имат резервен:') : t('Още никой няма резервен.')}</span>
                  {w.owners.map((o) => <Link key={o.id} href={`/game?chat=dm:${o.id}`} className="text-cyan-glow hover:underline">{o.username}</Link>)}
                  <ActionButton action={{ type: 'wantItem', itemId: w.itemId, want: false }} className="btn-ghost px-2 py-0.5 text-xs">{t('Махни')}</ActionButton>
                </li>
              ))}
            </ul>
          )}
          {trade.canGive.length > 0 && (
            <div className="mt-3 text-sm" data-testid="item-give">
              <p className="font-semibold">{t('Търсят твоите резервни:')}</p>
              <ul className="mt-1 flex flex-wrap gap-2">
                {trade.canGive.map((g) => <li key={`${g.userId}:${g.itemId}`}><Link href={`/game?chat=dm:${g.userId}`} className="rounded-full bg-asphalt-800 px-2.5 py-1 text-xs hover:bg-asphalt-700">{g.username} · {tx(g.name)}</Link></li>)}
              </ul>
            </div>
          )}
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {COLLECTIONS.map((c) => {
          const got = c.items.filter((i) => found.has(i)).length;
          const done = got === c.items.length;
          const live = !c.season || inSeasonWindow(today, c.season);
          return (
            <Card key={c.id} title={`${tx(c.name)} · ${got}/${c.items.length}`} className={done ? 'border-gold-400/60 bg-gradient-to-br from-gold-400/10 to-transparent' : ''}>
              <div className="mb-3 h-2 overflow-hidden rounded-full bg-asphalt-800"><div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-gold-400" style={{ width: `${(got / c.items.length) * 100}%` }} /></div>
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                {c.items.map((id) => {
                  const at = found.get(id);
                  return (
                    <li key={id} className={`flex flex-col items-center gap-1 text-center text-[11px] ${at ? '' : 'opacity-30 grayscale'}`}>
                      <ItemArt id={id} className="h-14 w-14" />
                      <span className="leading-tight">{at ? tx(ITEMS[id].name) : '?'}</span>
                      {at && <span className="text-[10px] text-mist-500">{dateOnly(at)}</span>}
                      {!at && trade && (wanted.has(id) ? <span className="text-[10px] text-cyan-glow">{t('🔎 търсиш')}</span> : <ActionButton action={{ type: 'wantItem', itemId: id, want: true }} className="text-[10px] text-mist-300 underline opacity-100">{t('Търся')}</ActionButton>)}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 space-y-1 text-xs text-mist-400">
                <p>{tx(c.source)}{c.season && live && <span className="ml-1 font-semibold text-profit">{t('· пада сега')}</span>}</p>
                <p className="flex flex-wrap items-center gap-2">
                  <span>{t('Награда: значка, {0} ТрансКоин', c.coins)}</span>
                  {c.frame && <span className="flex items-center gap-1">+ <ItemArt id={c.frame} className="h-6 w-6" />{tx(ITEMS[c.frame].name)}</span>}
                  {done && <span className="font-bold text-gold-300">{t('✓ Получена')}</span>}
                </p>
              </div>
            </Card>
          );
        })}
      </div>
      <Card title={t('Номерирани предмети')}>
        <div className="flex items-center gap-4">
          <ItemArt id="golden_key" className={`h-20 w-20 ${keys.length ? '' : 'opacity-30 grayscale'}`} />
          <div className="text-sm">
            <p className="font-semibold">{tx(ITEMS.golden_key.name)}</p>
            <p className="text-mist-400">{t('Само {0} в цялата игра — шанс {1}% в златен кейс, докато има номера.', GOLDEN_KEY.total, GOLDEN_KEY.goldCaseChance * 100)}</p>
            {keys.length > 0 && <p className="num mt-1 font-bold text-gold-300">{keys.map((n) => t('#{0} от {1}', n, GOLDEN_KEY.total)).join(', ')}</p>}
          </div>
        </div>
      </Card>
    </div>
  );
}
