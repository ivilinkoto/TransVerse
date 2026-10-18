import { BarChart3, Bell, Gavel, Map, Newspaper, Paintbrush, ScrollText, Shield, Sparkles, Trophy, Truck } from 'lucide-react';
import type { Release, ReleaseIcon } from '@/lib/game/releases';
import { GhostTruckIcon, PumpkinIcon } from '@/components/seasonal/icons';

const ICONS: Record<ReleaseIcon, React.ComponentType<{ className?: string }>> = {
  pumpkin: PumpkinIcon,
  ghost: GhostTruckIcon,
  truck: Truck,
  trophy: Trophy,
  paint: Paintbrush,
  scroll: ScrollText,
  sparkles: Sparkles,
  map: Map,
  bell: Bell,
  shield: Shield,
  chart: BarChart3,
  news: Newspaper,
  gavel: Gavel,
};

const released = (r: Release) => new Date(r.publishedAt).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Sofia' });

/** Title block of a release: version, name, date. */
export function ReleaseTitle({ release, as: H = 'h2' }: { release: Release; as?: 'h1' | 'h2' | 'h3' }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-glow">
        <span className="rounded-full bg-cyan-glow/15 px-2 py-0.5">Версия {release.version}</span>
        <span className="text-mist-400">{released(release)}</span>
      </div>
      <H className="mt-1.5 font-display text-2xl font-bold sm:text-3xl">{release.name}</H>
      <p className="mt-1.5 text-mist-300">{release.tagline}</p>
    </div>
  );
}

/** The full notes of a release: highlights, then every section. */
export function ReleaseBody({ release }: { release: Release }) {
  return (
    <div className="space-y-5">
      {release.highlights.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {release.highlights.map((h) => {
            const Icon = ICONS[h.icon];
            return (
              <li key={h.title} className="flex gap-3 rounded-2xl border border-asphalt-700 bg-asphalt-850 p-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-asphalt-800 text-gold-400"><Icon className="h-6 w-6" /></span>
                <span className="min-w-0">
                  <span className="block font-semibold">{h.title}</span>
                  <span className="mt-0.5 block text-sm text-mist-300">{h.body}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {release.sections.map((s) => (
        <section key={s.title}>
          <h3 className="label mb-2">{s.title}</h3>
          <ul className="space-y-1.5 text-sm text-mist-200">
            {s.items.map((item) => (
              <li key={item} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-glow" aria-hidden="true" /><span>{item}</span></li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
