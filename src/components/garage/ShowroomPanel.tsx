'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState } from 'react';
import type { Cosmetics } from '@/lib/game/cosmetics';
import { t } from '@/i18n/t';

// three.js loads only when the player opens the showroom (the garage page stays light).
const Showroom3D = dynamic(() => import('./Showroom3D').then((m) => m.Showroom3D), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-mist-400">{t('Зареждане на 3D…')}</div>,
});

const SWATCHES = ['#1d4ed8', '#dc2626', '#f8fafc', '#111827', '#16a34a', '#f59e0b', '#7c3aed', '#0891b2', '#9ca3af'];
const GRILLES: { id: NonNullable<Cosmetics['grille']>; label: string }[] = [{ id: 'chrome', label: 'Хром' }, { id: 'black', label: 'Черна' }, { id: 'gold', label: 'Златна' }];
const LIGHTS: { id: NonNullable<Cosmetics['lights']> | ''; label: string }[] = [{ id: '', label: 'Без' }, { id: 'amber', label: 'Оранжеви' }, { id: 'white', label: 'Бели' }, { id: 'blue', label: 'Сини' }];
const VISORS: { id: NonNullable<Cosmetics['visor']> | ''; label: string }[] = [{ id: '', label: 'Без' }, { id: 'chrome', label: 'Хром' }, { id: 'body', label: 'В цвета' }, { id: 'black', label: 'Черен' }];

/** 1.2.8: the truck in 3D with paint and parts to try (buying stays in the shop). */
export function ShowroomPanel({ modelId, trailerModelId, color, cosmetics }: { modelId: string; trailerModelId: string | null; color: string; cosmetics: Cosmetics | null }) {
  const [open, setOpen] = useState(false);
  const [paint, setPaint] = useState(color);
  const [trailer, setTrailer] = useState(!!trailerModelId);
  const [night, setNight] = useState(false);
  const [spin, setSpin] = useState(true);
  const [parts, setParts] = useState<Cosmetics>({ grille: cosmetics?.grille ?? 'chrome', lights: cosmetics?.lights, visor: cosmetics?.visor });
  const changed = paint !== color || parts.grille !== (cosmetics?.grille ?? 'chrome') || parts.lights !== cosmetics?.lights || parts.visor !== cosmetics?.visor;
  if (!open) {
    return (
      <button type="button" className="btn-primary w-full justify-center" onClick={() => setOpen(true)} data-testid="showroom-open">
        {t('🔄 Виж в 3D и пробвай боя и части')}
      </button>
    );
  }
  const chip = (on: boolean) => `rounded-full border px-2.5 py-1 text-xs ${on ? 'border-cyan-glow bg-cyan-glow/15 text-white' : 'border-asphalt-700 text-mist-300 hover:text-white'}`;
  return (
    <div className="space-y-3" data-testid="showroom">
      <div className="relative h-[340px] overflow-hidden rounded-2xl border border-asphalt-700 sm:h-[440px]">
        <Showroom3D modelId={modelId} trailerModelId={trailer ? trailerModelId : null} color={paint} cosmetics={parts} night={night} spin={spin} />
        <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-white/80 drop-shadow">{t('Въртиш с пръст или мишка, приближаваш с два пръста или колелцето.')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="label">{t('Боя')}</span>
        {SWATCHES.map((c) => <button key={c} type="button" onClick={() => setPaint(c)} className={`h-7 w-7 rounded-full border-2 ${paint === c ? 'border-cyan-glow' : 'border-asphalt-700'}`} style={{ background: c }} aria-label={c} />)}
        <input type="color" value={paint} onChange={(e) => setPaint(e.target.value)} className="h-7 w-9 cursor-pointer rounded border border-asphalt-700 bg-transparent" aria-label={t('Друг цвят')} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="label">{t('Решетка')}</span>
        {GRILLES.map((g) => <button key={g.id} type="button" className={chip(parts.grille === g.id)} onClick={() => setParts({ ...parts, grille: g.id })}>{t(g.label)}</button>)}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="label">{t('Светлини')}</span>
        {LIGHTS.map((l) => <button key={l.label} type="button" className={chip((parts.lights ?? '') === l.id)} onClick={() => setParts({ ...parts, lights: l.id || undefined })}>{t(l.label)}</button>)}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="label">{t('Сенник')}</span>
        {VISORS.map((v) => <button key={v.label} type="button" className={chip((parts.visor ?? '') === v.id)} onClick={() => setParts({ ...parts, visor: v.id || undefined })}>{t(v.label)}</button>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {trailerModelId && <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setTrailer((x) => !x)}>{trailer ? t('Без ремаркето') : t('С ремаркето')}</button>}
        <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setNight((x) => !x)}>{night ? t('☀️ Ден') : t('🌙 Нощ')}</button>
        <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setSpin((x) => !x)}>{spin ? t('⏸ Спри въртенето') : t('▶ Върти')}</button>
        {changed && <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => { setPaint(color); setParts({ grille: cosmetics?.grille ?? 'chrome', lights: cosmetics?.lights, visor: cosmetics?.visor }); }}>{t('Както е сега')}</button>}
      </div>
      {changed && <p className="text-xs text-mist-300">{t('Това е само проба.')}{' '}<Link href="/game/shop" className="font-semibold text-cyan-glow hover:underline">{t('Частите и боите се купуват от Магазина →')}</Link></p>}
    </div>
  );
}
