import { notFound } from 'next/navigation';
import { Card, Meter, PageHeader } from '@/components/ui';
import { date } from '@/lib/format';
import { POSTCARDS } from '@/lib/game/road-life';
import { isEuropeCountry } from '@/lib/geo/scope';
import { countries } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { postcardsOf } from '@/server/game/road-life';

export const metadata = { title: 'Картички' };

/** Card colours by country (game art, not flags). */
const HUES: Record<string, string> = { BG: '#16a34a', RO: '#2563eb', GR: '#0ea5e9', TR: '#dc2626', RS: '#b91c1c', MK: '#f59e0b', HU: '#15803d', AT: '#e11d48', DE: '#eab308', PL: '#ef4444', CZ: '#3b82f6', SK: '#1d4ed8', SI: '#0891b2', HR: '#2563eb', BA: '#1e40af', ME: '#b45309', AL: '#dc2626', XK: '#2563eb', IT: '#16a34a', FR: '#1d4ed8', ES: '#f59e0b', PT: '#15803d', NL: '#f97316', BE: '#eab308', LU: '#0ea5e9', CH: '#dc2626' };

/** v1.8: postcards from the real landmarks a loaded trip passed. */
export default async function PostcardsPage() {
  const { db, user, features } = await gameContext();
  if (!features.postcards) notFound();
  const all = (await postcardsOf(db, user.id)).filter((p) => features.europe || !isEuropeCountry(p.country));
  const names = new Map((await db.select({ code: countries.code, nameBg: countries.nameBg }).from(countries)).map((c) => [c.code, c.nameBg]));
  const got = all.filter((p) => p.collectedAt).length;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Картички от пътя"
        subtitle={`Мине ли курс с товар на до ${POSTCARDS.radiusKm} км от истинска забележителност, картичката ѝ влиза в колекцията (+${POSTCARDS.xp} опит и ${POSTCARDS.coins} TC). Картичките са нарисувани от играта.`}
      />
      <Card title={`Колекцията · ${got} / ${all.length}`}>
        <Meter value={(got / Math.max(1, all.length)) * 100} tone="cyan" />
        <p className="mt-2 text-xs text-mist-400">10 картички — значка „Колекционер на картички“; всички — „Всички картички на Европа“.</p>
      </Card>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {all.map((p) => {
          const hue = HUES[p.country] ?? '#64748b';
          return p.collectedAt ? (
            <div key={p.id} className="relative overflow-hidden rounded-xl border-4 border-white/90 shadow-lg" style={{ background: `linear-gradient(160deg, ${hue}, #0b1220 85%)` }}>
              <div className="flex aspect-[4/3] flex-col justify-between p-3">
                <div className="flex justify-between text-[10px] uppercase tracking-widest text-white/70"><span>Поздрави от</span><span className="rounded border border-white/40 px-1">{p.country}</span></div>
                <div className="text-center text-5xl drop-shadow-lg">{p.emoji}</div>
                <div>
                  <div className="font-display text-sm font-bold leading-tight text-white">{p.name}</div>
                  <div className="text-[11px] text-white/70">{names.get(p.country) ?? p.country} · {date(p.collectedAt)}</div>
                </div>
              </div>
            </div>
          ) : (
            <div key={p.id} className="flex aspect-[4/3] flex-col items-center justify-center rounded-xl border-2 border-dashed border-asphalt-600 bg-asphalt-850 p-3 text-center">
              <div className="text-3xl opacity-30">📮</div>
              <div className="mt-1 text-xs text-mist-400">{p.name}</div>
              <div className="text-[11px] text-mist-500">{names.get(p.country) ?? p.country}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
