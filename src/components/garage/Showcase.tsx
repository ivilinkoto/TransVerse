'use client';

import { Moon, Sun, ZoomIn, ZoomOut } from 'lucide-react';
import { useState } from 'react';
import { VehicleIllustration, type VehicleIllustrationProps } from '@/components/vehicles/VehicleIllustration';
import { t as tr } from '@/i18n/t';

/** The truck up close: zoom, with or without its trailer, day or night (side view, original drawing). */
export function Showcase({ truck, hasTrailer }: { truck: VehicleIllustrationProps; hasTrailer: boolean }) {
  const [zoom, setZoom] = useState(1);
  const [trailer, setTrailer] = useState(hasTrailer);
  const [night, setNight] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} disabled={zoom <= 1} aria-label={tr('Отдалечи')}><ZoomOut className="h-4 w-4" /></button>
        <span className="num w-12 text-center text-sm">×{zoom}</span>
        <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setZoom((z) => Math.min(3, z + 0.5))} disabled={zoom >= 3} aria-label={tr('Приближи')}><ZoomIn className="h-4 w-4" /></button>
        {hasTrailer && <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setTrailer((t) => !t)}>{trailer ? tr('Без ремаркето') : tr('С ремаркето')}</button>}
        <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setNight((n) => !n)}>{night ? <><Sun className="h-4 w-4" />{tr('Ден')}</> : <><Moon className="h-4 w-4" />{tr('Нощ')}</>}</button>
      </div>
      <div className={`overflow-x-auto rounded-2xl border border-asphalt-700 p-4 ${night ? 'bg-gradient-to-b from-[#05070d] to-[#111827]' : 'bg-gradient-to-b from-sky-900/40 to-asphalt-900'}`}>
        <div style={{ width: `${zoom * 100}%`, filter: night ? 'brightness(0.62) saturate(0.85)' : undefined }}>
          <VehicleIllustration {...truck} trailerModelId={trailer ? truck.trailerModelId : null} className="h-auto w-full" />
        </div>
      </div>
    </div>
  );
}
