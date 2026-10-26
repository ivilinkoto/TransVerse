import { notFound } from 'next/navigation';
import { Card, Meter, PageHeader } from '@/components/ui';
import { date } from '@/lib/format';
import { POSTCARDS } from '@/lib/game/road-life';
import { countryOpen } from '@/lib/geo/scope';
import { countries } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { postcardsOf } from '@/server/game/road-life';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Картички') };
}

/** Card colours by country (game art, not flags). */
const HUES: Record<string, string> = { BG: '#16a34a', RO: '#2563eb', GR: '#0ea5e9', TR: '#dc2626', RS: '#b91c1c', MK: '#f59e0b', HU: '#15803d', AT: '#e11d48', DE: '#eab308', PL: '#ef4444', CZ: '#3b82f6', SK: '#1d4ed8', SI: '#0891b2', HR: '#2563eb', BA: '#1e40af', ME: '#b45309', AL: '#dc2626', XK: '#2563eb', IT: '#16a34a', FR: '#1d4ed8', ES: '#f59e0b', PT: '#15803d', NL: '#f97316', BE: '#eab308', LU: '#0ea5e9', CH: '#dc2626', MD: '#1d4ed8', UA: '#eab308', BY: '#16a34a', LT: '#15803d', LV: '#9f1239', EE: '#0284c7', RU: '#2563eb', GE: '#dc2626', AM: '#f97316' };

/** v1.8: postcards from the real landmarks a loaded trip passed. */
export default async function PostcardsPage() {
  await initLocale();
  const { db, user, features } = await gameContext();
  if (!features.postcards) notFound();
  const all = (await postcardsOf(db, user.id)).filter((p) => countryOpen(p.country, features.europe, features.open_world));
  const names = new Map((await db.select({ code: countries.code, nameBg: countries.nameBg }).from(countries)).map((c) => [c.code, c.nameBg]));
  const got = all.filter((p) => p.collectedAt).length;
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Картички от пътя')}
        subtitle={t('Мине ли курс с товар на до {0} км от истинска забележителност, картичката ѝ влиза в колекцията (+{1} опит и {2} TC). Картичките са нарисувани от играта.', POSTCARDS.radiusKm, POSTCARDS.xp, POSTCARDS.coins)}
      />
      <Card title={t('Колекцията · {0} / {1}', got, all.length)}>
        <Meter value={(got / Math.max(1, all.length)) * 100} tone="cyan" />
        <p className="mt-2 text-xs text-mist-400">{t('10 картички — значка „Колекционер на картички“; всички — „Всички картички на Европа“.')}</p>
      </Card>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {all.map((p) => {
          const hue = HUES[p.country] ?? '#64748b';
          return p.collectedAt ? (
            <div key={p.id} className="relative overflow-hidden rounded-xl border-4 border-white/90 shadow-lg" style={{ background: `linear-gradient(160deg, ${hue}, #0b1220 85%)` }}>
              <div className="flex aspect-[4/3] flex-col justify-between p-3">
                <div className="flex justify-between text-[10px] uppercase tracking-widest text-white/70"><span>{t('Поздрави от')}</span><span className="rounded border border-white/40 px-1">{tx(p.country)}</span></div>
                <div className="text-center text-5xl drop-shadow-lg">{tx(p.emoji)}</div>
                <div>
                  <div className="font-display text-sm font-bold leading-tight text-white">{tx(p.name)}</div>
                  <div className="text-[11px] text-white/70">{tx(names.get(p.country) ?? p.country)} · {date(p.collectedAt)}</div>
                </div>
              </div>
            </div>
          ) : (
            <div key={p.id} className="flex aspect-[4/3] flex-col items-center justify-center rounded-xl border-2 border-dashed border-asphalt-600 bg-asphalt-850 p-3 text-center">
              <div className="text-3xl opacity-30">📮</div>
              <div className="mt-1 text-xs text-mist-400">{tx(p.name)}</div>
              <div className="text-[11px] text-mist-500">{tx(names.get(p.country) ?? p.country)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
