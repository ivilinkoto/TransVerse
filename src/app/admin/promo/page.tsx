import { Badge, Card, PageHeader, Table } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { PromoForm } from '@/components/admin/PromoForm';
import { dateTime, int, money } from '@/lib/format';
import { ITEMS, type ItemId } from '@/lib/game/items';
import type { PromoReward } from '@/lib/game/promo';
import { adminContext } from '@/server/admin-context';
import { isAdmin } from '@/server/auth/roles';
import { batchCodes, promoOverview, promoRedeemers } from '@/server/game/promo';
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Промокодове') };
}

/** A table of rows (or a quiet line when there are none). */
function Rows({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-mist-400">{empty}</p>;
  return (
    <Table head={head}>
      {rows.map((cells, i) => (
        <tr key={i}>{cells.map((c, j) => <td key={j} className="px-3 py-2">{c}</td>)}</tr>
      ))}
    </Table>
  );
}

const rewardText = (r: PromoReward) =>
  [
    r.coins ? `${int(r.coins)} TC` : '',
    r.cents ? money(r.cents) : '',
    r.vipDays ? tr('{0} VIP дни', r.vipDays) : '',
    ...(r.items ?? []).map((i) => `${tx(ITEMS[i.itemId as ItemId]?.name ?? i.itemId)} ×${i.qty}`),
  ].filter(Boolean).join(' · ');

/** 1.1.4.3: the team's promo codes — make, follow and stop them. */
export default async function AdminPromoPage({ searchParams }: { searchParams: Promise<{ code?: string; batch?: string }> }) {
  await initLocale();
  const { db, user, now } = await adminContext();
  const sp = await searchParams;
  const { publics, batches } = await promoOverview(db);
  const picked = sp.code ? publics.find((p) => p.id === sp.code) : null;
  const redeemers = picked ? await promoRedeemers(db, picked.id) : [];
  const batch = sp.batch ? await batchCodes(db, sp.batch) : null;
  const admin = isAdmin(user.role);
  const state = (p: { disabledAt: Date | null; endsAt: Date | null; maxUses: number | null; uses: number }) =>
    p.disabledAt ? <Badge tone="red">{tr('спрян')}</Badge> : p.endsAt && p.endsAt <= now ? <Badge tone="neutral">{tr('изтекъл')}</Badge> : p.maxUses != null && p.uses >= p.maxUses ? <Badge tone="neutral">{tr('изчерпан')}</Badge> : <Badge tone="green">{tr('активен')}</Badge>;
  return (
    <div className="space-y-6">
      <PageHeader title={tr('Промокодове')} subtitle={tr('Общи кодове за публикации и еднократни кодове за турнири и стриймове. Всеки играч използва код веднъж; профили от една мрежа — също веднъж. Наградите са данни от играта, не истински пари.')} />
      {admin ? <Card title={tr('Нов код')}><PromoForm /></Card> : <p className="text-sm text-mist-400">{tr('Кодове създават само администраторите.')}</p>}
      <Card title={tr('Общи кодове')}>
        <Rows
          head={[tr('Код'), tr('Награда'), tr('Използван'), tr('Важи до'), tr('Състояние'), '']}
          rows={publics.map((p) => [
            <a key="c" href={`/admin/promo?code=${p.id}`} className="num font-mono font-semibold text-cyan-glow hover:underline">{p.code}</a>,
            rewardText(p.reward),
            `${int(p.uses)}${p.maxUses != null ? ` / ${int(p.maxUses)}` : ''}`,
            p.endsAt ? dateTime(p.endsAt) : '—',
            state(p),
            admin ? <ActionButton key="a" endpoint="/api/admin/action" action={{ type: 'promoDisable', id: p.id, disabled: !p.disabledAt }} className="btn-ghost px-2 py-1 text-xs">{p.disabledAt ? tr('Пусни') : tr('Спри')}</ActionButton> : null,
          ])}
          empty={tr('Още няма кодове.')}
        />
      </Card>
      {picked && (
        <Card title={tr('Кой използва {0}', picked.code)}>
          {picked.note && <p className="mb-2 text-xs text-mist-400">{tx(picked.note)}</p>}
          <Rows head={[tr('Играч'), tr('Откъде'), tr('Кога')]} rows={redeemers.map((r) => [tx(r.username), r.via === 'discord' ? 'Discord' : tr('Играта'), dateTime(r.at)])} empty={tr('Още никой.')} />
        </Card>
      )}
      <Card title={tr('Еднократни кодове')}>
        <Rows
          head={[tr('Пакет'), tr('Награда'), tr('Използвани'), tr('Създаден'), tr('Състояние'), '']}
          rows={batches.map((b) => [
            <a key="b" href={`/admin/promo?batch=${b.batchId}`} className="font-mono font-semibold text-cyan-glow hover:underline">{b.prefix}-…</a>,
            rewardText(b.reward),
            `${int(b.used)} / ${int(b.count)}`,
            dateTime(b.createdAt),
            b.disabled ? <Badge key="s" tone="red">{tr('спрян')}</Badge> : <Badge key="s" tone="green">{tr('активен')}</Badge>,
            admin ? <ActionButton key="a" endpoint="/api/admin/action" action={{ type: 'promoDisable', id: b.firstId, disabled: !b.disabled }} className="btn-ghost px-2 py-1 text-xs">{b.disabled ? tr('Пусни всички') : tr('Спри всички')}</ActionButton> : null,
          ])}
          empty={tr('Още няма пакети.')}
        />
      </Card>
      {batch && (
        <Card title={tr('Кодовете в пакета')}>
          <textarea readOnly className="input num h-48 w-full font-mono text-xs" value={batch.map((c) => `${c.code}${c.uses ? ' ✓' : ''}`).join('\n')} aria-label={tr('Кодове')} />
          <p className="mt-1 text-xs text-mist-400">{tr('✓ — вече използван.')}</p>
        </Card>
      )}
    </div>
  );
}
