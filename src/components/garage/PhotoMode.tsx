'use client';

import { Camera } from 'lucide-react';
import { useRef, useState } from 'react';
import { VehicleIllustration, type VehicleIllustrationProps } from '@/components/vehicles/VehicleIllustration';

const W = 1600;
const H = 900;

/** The scenes of the photo mode: the sky, the hills and the road (original drawings). */
const SCENES = {
  day: { label: 'Ден', sky: ['#7cc4ff', '#d7efff'], hills: ['#5fa35f', '#4a8a4a'], road: '#4b5160', sun: '#fff3b0' },
  sunset: { label: 'Залез', sky: ['#ff8a5c', '#ffd29a'], hills: ['#7a5a7a', '#5b4560'], road: '#3e3a48', sun: '#ffdf7a' },
  night: { label: 'Нощ', sky: ['#05070d', '#1b2440'], hills: ['#1e2b3c', '#152030'], road: '#20242e', sun: '#e8eef7' },
  spring: { label: 'Пролет', sky: ['#a8dcff', '#eaf7ff'], hills: ['#8fd18a', '#6dbb68'], road: '#535a68', sun: '#fff7c2' },
  snow: { label: 'Зима', sky: ['#b8c7d9', '#e8eef5'], hills: ['#f4f7fb', '#dfe7f0'], road: '#59606d', sun: '#ffffff' },
} as const;
type Scene = keyof typeof SCENES;

function Backdrop({ scene }: { scene: Scene }) {
  const s = SCENES[scene];
  return (
    <>
      <defs>
        <linearGradient id="pm-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={s.sky[0]} /><stop offset="1" stopColor={s.sky[1]} /></linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#pm-sky)" />
      <circle cx={scene === 'sunset' ? 1180 : 1320} cy={scene === 'sunset' ? 560 : 150} r={scene === 'night' ? 46 : 70} fill={s.sun} opacity={scene === 'night' ? 0.9 : 0.85} />
      {scene === 'night' && Array.from({ length: 60 }, (_, i) => <circle key={i} cx={(i * 263) % W} cy={(i * 97) % 420} r={i % 5 ? 1.4 : 2.2} fill="#fff" opacity={0.7} />)}
      <path d={`M0 600 Q 260 470 520 590 T 1040 570 T 1600 560 V ${H} H 0 Z`} fill={s.hills[0]} />
      <path d={`M0 660 Q 360 580 760 650 T 1600 640 V ${H} H 0 Z`} fill={s.hills[1]} />
      {scene === 'spring' && Array.from({ length: 7 }, (_, i) => (
        <g key={i} transform={`translate(${120 + i * 230} ${610 + (i % 2) * 20})`}>
          <rect x={-5} y={0} width={10} height={60} fill="#6b4f3a" />
          <circle cx={0} cy={-10} r={42} fill="#f9a8d4" />
          <circle cx={-26} cy={4} r={26} fill="#fbcfe8" />
          <circle cx={26} cy={2} r={28} fill="#f472b6" opacity={0.8} />
        </g>
      ))}
      <rect y={740} width={W} height={160} fill={s.road} />
      {Array.from({ length: 12 }, (_, i) => <rect key={i} x={i * 150 + 20} y={812} width={80} height={8} fill="#f2f0e4" opacity={scene === 'night' ? 0.6 : 0.9} />)}
    </>
  );
}

const loadImage = (svg: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });

/** Photo mode (v1.6): the truck on a scene of your choice, with a caption, saved as a PNG picture. */
export function PhotoMode({ truck, hasTrailer, plate }: { truck: VehicleIllustrationProps; hasTrailer: boolean; plate: string }) {
  const [scene, setScene] = useState<Scene>('day');
  const [trailer, setTrailer] = useState(hasTrailer);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const backdrop = useRef<SVGSVGElement>(null);
  const vehicle = useRef<HTMLDivElement>(null);

  const save = async () => {
    if (!frame.current || !backdrop.current || !vehicle.current) return;
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(await loadImage(new XMLSerializer().serializeToString(backdrop.current)), 0, 0, W, H);
      const truckSvg = vehicle.current.querySelector('svg');
      if (truckSvg) {
        const box = frame.current.getBoundingClientRect();
        const r = truckSvg.getBoundingClientRect();
        const k = W / box.width;
        ctx.drawImage(await loadImage(new XMLSerializer().serializeToString(truckSvg)), (r.left - box.left) * k, (r.top - box.top) * k, r.width * k, r.height * k);
      }
      if (scene === 'night') {
        ctx.fillStyle = 'rgba(5,7,13,0.25)';
        ctx.fillRect(0, 0, W, H);
      }
      ctx.font = '600 42px system-ui, sans-serif';
      ctx.fillStyle = scene === 'night' ? '#e8eef7' : '#0b1220';
      if (caption.trim()) ctx.fillText(caption.trim().slice(0, 60), 48, 84);
      ctx.font = '500 24px system-ui, sans-serif';
      ctx.globalAlpha = 0.8;
      ctx.fillText('TransVerse', W - 190, H - 30);
      ctx.globalAlpha = 1;
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `transverse-${plate.replace(/[^\p{L}\p{N}-]+/gu, '-')}.png`;
      a.click();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(SCENES) as Scene[]).map((s) => (
          <button key={s} type="button" className={`${scene === s ? 'btn-primary' : 'btn-ghost'} px-3 py-1.5 text-sm`} onClick={() => setScene(s)}>{SCENES[s].label}</button>
        ))}
        {hasTrailer && <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setTrailer((t) => !t)}>{trailer ? 'Без ремаркето' : 'С ремаркето'}</button>}
        <input className="input min-w-0 flex-1" maxLength={60} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Надпис на снимката (по желание)" />
        <button type="button" className="btn-primary" onClick={save} disabled={busy}><Camera className="h-4 w-4" />Запази снимка</button>
      </div>
      <div ref={frame} className="relative w-full overflow-hidden rounded-2xl border border-asphalt-700" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg ref={backdrop} viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg"><Backdrop scene={scene} /></svg>
        <div ref={vehicle} className="absolute bottom-[12%] left-[5%] right-[5%]" style={{ filter: scene === 'night' ? 'brightness(0.7)' : undefined }}>
          <VehicleIllustration {...truck} trailerModelId={trailer ? truck.trailerModelId : null} className="h-auto w-full" />
        </div>
        {caption.trim() && <p className={`absolute left-[3%] top-[4%] text-lg font-semibold sm:text-2xl ${scene === 'night' ? 'text-mist-100' : 'text-asphalt-950'}`}>{caption}</p>}
      </div>
      <p className="text-xs text-mist-400">Снимката се прави в браузъра ти (PNG, 1600 × 900). Рисунките са оригинални, марките — измислени.</p>
    </div>
  );
}
