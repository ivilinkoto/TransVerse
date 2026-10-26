import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, PageHeader } from '@/components/ui';
import { CupForm } from '@/components/game/CupForm';
import { CARGO, CARGO_TYPES } from '@/lib/game/cargo';
import { CUP_METRIC_LABELS, CUPS, type CupMetric } from '@/lib/game/community-cups';
import { playableCountries } from '@/lib/geo/scope';
import { dateTime, money } from '@/lib/format';
import { countries, users } from '@/server/db/schema';
import { cupsList } from '@/server/game/community-cups';
import { gameContext } from '@/server/game/context';
import { eq, inArray } from 'drizzle-orm';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Турнири на общността') };
}

/** v2.0: tournaments organised by players — the list and, for organisers, a new one. */
export default async function CupsPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.community_cups) notFound();
  const [rows, [me], names] = await Promise.all([
    cupsList(db),
    db.select({ level: users.level }).from(users).where(eq(users.id, user.id)),
    db.select({ code: countries.code, nameBg: countries.nameBg }).from(countries).where(inArray(countries.code, [...playableCountries(!!features.europe, !!features.open_world)])),
  ]);
  const start = new Date(now.getTime() + 2 * 3_600_000);
  const local = new Date(start.getTime() - start.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Турнири на общността')} subtitle={t('Турнири, организирани от играчи: мярка, дати и награда, сложена от организатора. Първите трима делят наградата 50 / 30 / 20 %.')} />
      <Card title={t('Турнирите')}>
        <ul className="divide-y divide-asphalt-800 text-sm">
          {rows.map(({ cup, organizer, players }) => {
            const state = cup.status === 'done' ? t('завършил') : cup.startsAt > now ? t('предстои') : t('тече');
            return (
              <li key={cup.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/game/cups/${cup.id}`} className="font-semibold hover:underline">{cup.name}</Link>
                <span className="flex flex-wrap items-center gap-2 text-xs text-mist-400">
                  <Badge tone={cup.status === 'done' ? 'neutral' : cup.startsAt > now ? 'gold' : 'green'}>{state}</Badge>
                  {tx(CUP_METRIC_LABELS[cup.metric as CupMetric])} · {money(cup.poolCents)} · {t('Играчи: {0} / {1}', players, cup.maxPlayers)} · {organizer} · {dateTime(cup.startsAt)}
                </span>
              </li>
            );
          })}
        </ul>
        {!rows.length && <p className="text-sm text-mist-400">{t('Още няма турнири.')}</p>}
      </Card>
      <Card title={t('Организирай турнир')}>
        {(me?.level ?? 1) >= CUPS.minLevel ? (
          <CupForm cargo={CARGO_TYPES.map((c) => ({ id: c, label: CARGO[c].label }))} countries={names.map((c) => ({ code: c.code, name: c.nameBg }))} defaultStart={local} />
        ) : (
          <p className="text-sm text-mist-400">{t('Турнири организират играчи от ниво {0}.', CUPS.minLevel)}</p>
        )}
      </Card>
    </div>
  );
}
