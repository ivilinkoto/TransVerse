import Link from 'next/link';
import { t, tx } from '@/i18n/t';

export type RegionProjectViewProps = {
  name: string;
  countryName: string;
  stage: number;
  stages: number;
  label: string;
  cargoLabel: string;
  progress: number;
  target: number;
  top: { username: string; tons: number }[];
  mine: number;
};

/** 1.2.6: the common project of the region on „Курсове“ (the loads that count are marked on the board). */
export function RegionProjectCard({ p }: { p: RegionProjectViewProps }) {
  const share = Math.min(100, Math.round((p.progress / p.target) * 100));
  return (
    <section id="region-project" className="mb-4 rounded-2xl border border-lime-400/40 bg-lime-500/10 p-4 text-sm" data-testid="region-project">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">🏗️ {tx(p.name)} <span className="text-mist-400">· {tx(p.countryName)}</span></p>
        <Link href="/game?chat=projects" className="text-xs font-semibold text-cyan-glow hover:underline">{t('Канал „Проекти“ →')}</Link>
      </div>
      <p className="mt-1">{t('Етап {0}/{1}: {2} — {3} до {4}', p.stage, p.stages, tx(p.label), tx(p.cargoLabel).toLowerCase(), tx(p.countryName))}</p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-asphalt-800" role="progressbar" aria-valuenow={share} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-lime-400" style={{ width: `${share}%` }} />
      </div>
      <p className="mt-1 text-xs text-mist-300">{t('{0} / {1} т · ти: {2} т', p.progress, p.target, p.mine)}{p.top.length ? ` · ${t('Най-много: {0}', p.top.map((x) => `${x.username} (${x.tons} т)`).join(', '))}` : ''}</p>
      <p className="mt-1 text-xs text-mist-400">{t('Товарите, които се броят, са с 🏗️ на борсата. Всеки етап и краят носят точки за пропуска.')}</p>
    </section>
  );
}
