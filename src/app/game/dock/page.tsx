import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Warehouse } from 'lucide-react';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { EmptyAction } from '@/components/game/EmptyAction';
import { dateTime, int, money } from '@/lib/format';
import { DOCK } from '@/lib/game/dock';
import { gameContext } from '@/server/game/context';
import { dockView } from '@/server/game/dock';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Рампата') };
}

const GIFTS = [100_00, 300_00, 800_00];

/** 1.2.3.6 „Рампата“: unloading slots at the big warehouses, swaps for a gift, the most punctual drivers. */
export default async function DockPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.dock_slots) notFound();
  const v = await dockView(db, user.id, now);
  return (
    <div className="space-y-6">
      <PageHeader title={t('🏭 Рампата')} subtitle={t('Складовете в градове над {0} жители приемат по {1} камиона на {2} минути. Заета рампа = опашка. Игрови данни.', int(DOCK.minPopulation), DOCK.perSlot, DOCK.slotMin)} />
      {v.incoming.length > 0 && (
        <Card title={t('Искат твоя час')}>
          <ul className="space-y-3 text-sm" data-testid="dock-incoming">
            {v.incoming.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{t('{0} предлага {1} за твоя час в {2} ({3}). Ти ще разтовариш в {4}.', o.from, money(o.giftCents), tx(o.city), o.yourSlot ? dateTime(o.yourSlot) : '—', o.theirSlot ? dateTime(o.theirSlot) : '—')}</span>
                <span className="flex gap-2">
                  <ActionButton action={{ type: 'dockSwapAnswer', swapId: o.id, accept: true }} className="btn-primary px-3 py-1.5 text-xs">{t('Приеми · +{0}', money(o.giftCents))}</ActionButton>
                  <ActionButton action={{ type: 'dockSwapAnswer', swapId: o.id, accept: false }} className="btn-ghost px-3 py-1.5 text-xs">{t('Откажи')}</ActionButton>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title={t('Твоите камиони към рампата')}>
        {!v.bookings.length ? (
          <Empty icon={Warehouse} title={t('Няма камион към голям склад')}>{t('Вземи товар до голям град — там камионът получава час на рампата.')}<EmptyAction href="/game/contracts" label="Намери курс" /></Empty>
        ) : (
          <ul className="divide-y divide-asphalt-800 text-sm" data-testid="dock-bookings">
            {v.bookings.map((b) => (
              <li key={b.deliveryId} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{tx(b.city)} · {t('час {0}', dateTime(b.slotAt))}</span>
                  {b.waitMin > 0 ? <Badge tone="gold">{t('Опашка: {0} мин', b.waitMin)}</Badge> : <Badge tone="green">{t('Направо на рампата')}</Badge>}
                </div>
                {b.swaps.length > 0 && (
                  <div className="rounded-xl border border-asphalt-700 bg-asphalt-900/60 p-2.5">
                    <p className="text-xs text-mist-300">{t('Размени се с по-ранен камион срещу подарък (той решава):')}</p>
                    <ul className="mt-2 space-y-2">
                      {b.swaps.map((s) => (
                        <li key={s.deliveryId} className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="min-w-0 flex-1">{t('{0} · час {1} · печелиш {2} мин', s.username, dateTime(s.slotAt), s.gain)}</span>
                          {GIFTS.map((g) => <ActionButton key={g} action={{ type: 'dockSwapOffer', deliveryId: b.deliveryId, withDeliveryId: s.deliveryId, giftCents: g }} className="btn-ghost px-2 py-1 text-xs">{money(g)}</ActionButton>)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {v.outgoing.length > 0 && <p className="mt-3 text-xs text-mist-400">{t('Чакат отговор: {0}', v.outgoing.map((o) => `${o.to} (${tx(o.city)}, ${money(o.giftCents)})`).join(' · '))}</p>}
      </Card>
      <Card title={t('Най-точен на рампата · тази седмица')}>
        {!v.board.length ? <p className="text-sm text-mist-400">{t('Още никой. Стигни до голям склад навреме и без опашка.')}</p> : (
          <ol className="space-y-1 text-sm" data-testid="dock-board">
            {v.board.map((r, i) => (
              <li key={r.userId} className={`flex justify-between gap-2 ${r.userId === user.id ? 'font-semibold text-cyan-glow' : ''}`}>
                <span>{i + 1}. {r.username}</span>
                <span className="num">{t('{0} точни', r.count)}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-xs text-mist-400">{t('Брои се камион, който стигне до рампата без опашка и достави навреме.')}</p>
      </Card>
    </div>
  );
}
