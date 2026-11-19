/**
 * 1.3.3: side views of the trains at true proportions — centimetres, the top
 * of the rail at y = 0 and "up" is negative y, like the trucks. Invented
 * designs (no real model is copied): a two-cab electric locomotive with
 * single-arm pantographs, a six-axle diesel with a fuel tank and an exhaust,
 * and four wagons — a 60-foot container flat with a 40' and a 20' box, a tank
 * wagon, a sliding-wall covered wagon and a bulk hopper. The train runs right.
 */
import { useId } from 'react';
import type { LocoId, WagonType } from '@/lib/game/trains';

interface LocoLook {
  len: number;
  roof: number;
  body: string;
  dark: string;
  stripe: string;
  electric: boolean;
  /** Axles per bogie. */
  axles: 2 | 3;
}

const LOCO_LOOK: Record<LocoId, LocoLook> = {
  'danubia-d22': { len: 2135, roof: 395, body: '#f59e0b', dark: '#78350f', stripe: '#111827', electric: false, axles: 3 },
  'balkan-e40': { len: 1898, roof: 425, body: '#0ea5e9', dark: '#0c4a6e', stripe: '#f8fafc', electric: true, axles: 2 },
  'rila-e60': { len: 1990, roof: 430, body: '#dc2626', dark: '#7f1d1d', stripe: '#f8fafc', electric: true, axles: 2 },
};

const WAGON_LEN: Record<WagonType, number> = { container: 1970, tank: 1590, covered: 2326, hopper: 1250 };
const GAP = 30;

/** A wheel with its rim and hub; r in cm, sitting on the rail. */
function Wheel({ x, r, tire, rim }: { x: number; r: number; tire: string; rim: string }) {
  return (
    <g>
      <circle cx={x} cy={-r} r={r} fill={`url(#${tire})`} />
      <circle cx={x} cy={-r} r={r * 0.78} fill={`url(#${rim})`} stroke="#1f2937" strokeWidth={3} />
      <circle cx={x} cy={-r} r={r * 0.22} fill="#374151" />
    </g>
  );
}

/** A bogie: the side frame behind the wheels, the wheels, the axle boxes and the springs, centred at x. */
function Bogie({ x, axles, spacing, r, ids }: { x: number; axles: number; spacing: number; r: number; ids: Ids }) {
  const first = x - ((axles - 1) * spacing) / 2;
  const w = (axles - 1) * spacing + r * 2.6;
  const at = Array.from({ length: axles }, (_, i) => first + i * spacing);
  return (
    <g>
      <path d={`M${x - w / 2} ${-r - 40} H${x + w / 2} V${-r + 6} H${x - w / 2} Z`} fill="#1f2937" stroke="#0a0a0a" strokeWidth={3} />
      {at.map((ax) => <Wheel key={ax} x={ax} r={r} tire={ids.tire} rim={ids.rim} />)}
      {at.map((ax) => <rect key={ax} x={ax - 20} y={-r - 18} width={40} height={36} rx={6} fill="#3f3f46" stroke="#111827" strokeWidth={3} />)}
      {at.map((ax) => (
        <path key={ax} d={`M${ax - 16} ${-r - 22} v-${r * 0.35} m10 0 v${r * 0.35} m10 0 v-${r * 0.35} m10 0 v${r * 0.35}`} stroke="#a1a1aa" strokeWidth={5} fill="none" />
      ))}
    </g>
  );
}

/** Buffers and the screw coupling at one end (dir = -1 left, +1 right) of a body ending at x. */
function Buffers({ x, dir }: { x: number; dir: 1 | -1 }) {
  const y = -106;
  return (
    <g fill="#52525b" stroke="#18181b" strokeWidth={3}>
      <rect x={dir > 0 ? x : x - 40} y={y - 14} width={40} height={28} />
      <rect x={dir > 0 ? x + 36 : x - 52} y={y - 24} width={16} height={48} rx={6} fill="#a1a1aa" />
      <path d={`M${x} ${y + 22} h${dir * 40}`} stroke="#18181b" strokeWidth={6} />
    </g>
  );
}

interface Ids { tire: string; rim: string; glass: string; shade: string; metal: string }

function Pantograph({ x, roof, up }: { x: number; roof: number; up: boolean }) {
  const base = -roof - 18;
  const top = up ? -roof - 150 : -roof - 40;
  return (
    <g stroke="#9ca3af" strokeWidth={6} fill="none" strokeLinecap="round">
      <rect x={x - 60} y={base} width={120} height={14} rx={4} fill="#4b5563" stroke="none" />
      <path d={`M${x - 50} ${base} L${x + 70} ${(base + top) / 2} L${x - 30} ${top}`} />
      <path d={`M${x - 90} ${top} h120`} strokeWidth={9} stroke="#d1d5db" />
    </g>
  );
}

function Locomotive({ loco, x, ids }: { loco: LocoId; x: number; ids: Ids }) {
  const L = LOCO_LOOK[loco];
  const bottom = -110, top = -L.roof;
  const nose = 150; // the cab's slope, cm
  const r = 62;
  const bogieAt = L.axles === 3 ? [x + 420, x + L.len - 420] : [x + 470, x + L.len - 470];
  const spacing = L.axles === 3 ? 200 : 290;
  // A cab at each end: the windscreen slopes back from the front.
  const body = `M${x} ${bottom} V${top + 120} L${x + 40} ${top + 30} Q${x + 60} ${top} ${x + nose} ${top} H${x + L.len - nose} Q${x + L.len - 60} ${top} ${x + L.len - 40} ${top + 30} L${x + L.len} ${top + 120} V${bottom} Z`;
  const winY = top + 40;
  return (
    <g>
      <path d={body} fill={L.body} stroke={L.dark} strokeWidth={6} />
      <path d={body} fill={`url(#${ids.shade})`} />
      {/* Roof equipment */}
      <rect x={x + nose + 40} y={top - 16} width={L.len - 2 * nose - 80} height={18} rx={6} fill="#6b7280" />
      {L.electric ? (
        <>
          <Pantograph x={x + 480} roof={L.roof} up={false} />
          <Pantograph x={x + L.len - 480} roof={L.roof} up />
          <rect x={x + L.len / 2 - 150} y={top - 40} width={300} height={26} rx={6} fill="#9ca3af" />
          {/* The transformer and the batteries hang between the bogies. */}
          <rect x={x + 680} y={bottom + 4} width={L.len - 1360} height={64} rx={10} fill="#27272a" />
          {Array.from({ length: 4 }, (_, i) => <rect key={i} x={x + 720 + i * ((L.len - 1440) / 4)} y={bottom + 14} width={(L.len - 1440) / 4 - 30} height={40} rx={4} fill="#3f3f46" />)}
        </>
      ) : (
        <>
          <rect x={x + L.len * 0.42} y={top - 60} width={50} height={60} fill="#27272a" />
          <rect x={x + L.len * 0.5} y={top - 30} width={300} height={30} rx={6} fill="#52525b" />
          <rect x={x + 700} y={bottom + 4} width={L.len - 1400} height={70} rx={14} fill="#27272a" />
        </>
      )}
      {/* Cab windows (front and rear) and the side windows */}
      <path d={`M${x + L.len - 40} ${top + 115} L${x + L.len - 70} ${winY} L${x + L.len - nose - 10} ${winY} V${top + 130} Z`} fill={`url(#${ids.glass})`} />
      <path d={`M${x + 40} ${top + 115} L${x + 70} ${winY} L${x + nose + 10} ${winY} V${top + 130} Z`} fill={`url(#${ids.glass})`} />
      <rect x={x + nose + 30} y={winY} width={90} height={90} rx={10} fill={`url(#${ids.glass})`} />
      <rect x={x + L.len - nose - 120} y={winY} width={90} height={90} rx={10} fill={`url(#${ids.glass})`} />
      {/* Doors */}
      <rect x={x + nose + 140} y={winY} width={70} height={bottom - 10 - winY} fill="none" stroke={L.dark} strokeWidth={4} />
      <rect x={x + L.len - nose - 210} y={winY} width={70} height={bottom - 10 - winY} fill="none" stroke={L.dark} strokeWidth={4} />
      {/* Machine-room grilles */}
      {Array.from({ length: L.electric ? 4 : 6 }, (_, i) => {
        const gx = x + nose + 260 + i * ((L.len - 2 * nose - 560) / (L.electric ? 4 : 6));
        return (
          <g key={i}>
            <rect x={gx} y={top + 50} width={(L.len - 2 * nose - 640) / (L.electric ? 4 : 6)} height={110} rx={6} fill={L.dark} opacity={0.55} />
            {Array.from({ length: 6 }, (_, k) => <line key={k} x1={gx + 6} x2={gx + (L.len - 2 * nose - 660) / (L.electric ? 4 : 6)} y1={top + 62 + k * 17} y2={top + 62 + k * 17} stroke={L.body} strokeWidth={3} opacity={0.5} />)}
          </g>
        );
      })}
      {/* Livery stripe, headlights and the frame */}
      <path d={`M${x + 8} ${bottom - 70} H${x + L.len - 8}`} stroke={L.stripe} strokeWidth={22} opacity={0.9} />
      <circle cx={x + L.len - 22} cy={bottom - 120} r={12} fill="#fef3c7" />
      <circle cx={x + 22} cy={bottom - 120} r={12} fill="#ef4444" />
      <rect x={x} y={bottom} width={L.len} height={22} fill="#1f2937" />
      <Buffers x={x} dir={-1} />
      <Buffers x={x + L.len} dir={1} />
      {bogieAt.map((bx) => <Bogie key={bx} x={bx} axles={L.axles} spacing={spacing} r={r} ids={ids} />)}
    </g>
  );
}

/** A 40' (1219 cm) or 20' (606 cm) box on a flat, 259 cm high, with its ribs and doors. */
function Container({ x, len, deck, color, dark }: { x: number; len: number; deck: number; color: string; dark: string }) {
  const h = 259;
  const ribs = Math.floor(len / 30);
  return (
    <g>
      <rect x={x} y={deck - h} width={len} height={h} fill={color} stroke={dark} strokeWidth={6} />
      {Array.from({ length: ribs - 1 }, (_, i) => <line key={i} x1={x + (i + 1) * (len / ribs)} x2={x + (i + 1) * (len / ribs)} y1={deck - h + 14} y2={deck - 14} stroke={dark} strokeWidth={3} opacity={0.45} />)}
      <rect x={x} y={deck - h} width={len} height={16} fill={dark} opacity={0.5} />
      <rect x={x} y={deck - 16} width={len} height={16} fill={dark} opacity={0.5} />
    </g>
  );
}

function Wagon({ type, x, ids }: { type: WagonType; x: number; ids: Ids }) {
  const len = WAGON_LEN[type];
  const r = 46;
  const deck = -116;
  const bogies = type === 'hopper' ? [x + 250, x + len - 250] : [x + 280, x + len - 280];
  const frame = <rect x={x} y={deck} width={len} height={34} fill="#334155" stroke="#0f172a" strokeWidth={4} />;
  let body;
  if (type === 'container') {
    body = (
      <>
        {frame}
        <Container x={x + 40} len={1219} deck={deck} color="#2563eb" dark="#1e3a8a" />
        <Container x={x + 1290} len={606} deck={deck} color="#ea580c" dark="#7c2d12" />
      </>
    );
  } else if (type === 'tank') {
    const cy = -270, rr = 150;
    body = (
      <>
        {frame}
        <rect x={x + 60} y={cy - rr} width={len - 120} height={rr * 2} rx={rr} fill="#e2e8f0" stroke="#475569" strokeWidth={6} />
        <rect x={x + 60} y={cy - rr} width={len - 120} height={rr * 2} rx={rr} fill={`url(#${ids.metal})`} opacity={0.6} />
        <path d={`M${x + 100} ${cy + 20} H${x + len - 100}`} stroke="#f97316" strokeWidth={26} />
        <rect x={x + len / 2 - 60} y={cy - rr - 40} width={120} height={44} rx={10} fill="#94a3b8" stroke="#475569" strokeWidth={4} />
        {[x + 30, x + len - 60].map((lx) => <path key={lx} d={`M${lx} ${deck} V${cy - 40} M${lx + 30} ${deck} V${cy - 40} ${Array.from({ length: 5 }, (_, k) => `M${lx} ${deck - 20 - k * 30} h30`).join(' ')}`} stroke="#64748b" strokeWidth={4} fill="none" />)}
        <rect x={x + len / 2 - 70} y={cy + 40} width={140} height={60} fill="#f97316" stroke="#111827" strokeWidth={4} />
        <path d={`M${x + len / 2 - 70} ${cy + 70} H${x + len / 2 + 70}`} stroke="#111827" strokeWidth={4} />
      </>
    );
  } else if (type === 'covered') {
    const top = -405;
    const panels = 4;
    body = (
      <>
        {frame}
        <path d={`M${x + 30} ${deck} V${top + 40} Q${x + len / 2} ${top - 20} ${x + len - 30} ${top + 40} V${deck} Z`} fill="#b45309" stroke="#451a03" strokeWidth={6} />
        {Array.from({ length: panels }, (_, i) => {
          const pw = (len - 60) / panels;
          const px = x + 30 + i * pw;
          return (
            <g key={i}>
              <rect x={px + 8} y={top + 50} width={pw - 16} height={deck - 10 - (top + 50)} fill="none" stroke="#451a03" strokeWidth={4} />
              {Array.from({ length: 5 }, (_, k) => <line key={k} x1={px + 20 + k * ((pw - 40) / 4)} x2={px + 20 + k * ((pw - 40) / 4)} y1={top + 60} y2={deck - 12} stroke="#78350f" strokeWidth={4} />)}
            </g>
          );
        })}
        <path d={`M${x + 30} ${top + 70} H${x + len - 30}`} stroke="#d97706" strokeWidth={8} />
      </>
    );
  } else {
    const top = -365;
    body = (
      <>
        <path d={`M${x + 20} ${top} H${x + len - 20} V${-190} L${x + len - 330} ${deck + 10} H${x + 330} L${x + 20} ${-190} Z`} fill="#57534e" stroke="#1c1917" strokeWidth={6} />
        {Array.from({ length: 7 }, (_, i) => <line key={i} x1={x + 160 + i * ((len - 320) / 6)} x2={x + 160 + i * ((len - 320) / 6)} y1={top + 10} y2={-200} stroke="#292524" strokeWidth={8} />)}
        <path d={`M${x + 20} ${top + 20} H${x + len - 20}`} stroke="#78716c" strokeWidth={10} />
        <rect x={x} y={deck} width={len} height={30} fill="#292524" />
      </>
    );
  }
  return (
    <g>
      {body}
      <Buffers x={x} dir={-1} />
      <Buffers x={x + len} dir={1} />
      {bogies.map((bx) => <Bogie key={bx} x={bx} axles={2} spacing={180} r={r} ids={ids} />)}
    </g>
  );
}

/**
 * The locomotive (or none — a wagon alone) and up to `show` wagons behind it,
 * on a track with sleepers. Sized by `className` (the drawing keeps its proportions).
 */
export function TrainArt({ loco, wagons = [], show = 3, className = 'h-12 w-full' }: { loco: LocoId | null; wagons?: WagonType[]; show?: number; className?: string }) {
  const uid = useId().replace(/[:«»]/g, '');
  const ids: Ids = { tire: `tt${uid}`, rim: `tr${uid}`, glass: `tg${uid}`, shade: `ts${uid}`, metal: `tm${uid}` };
  const cars = wagons.slice(0, show);
  const pad = 70;
  const step = (c: WagonType) => WAGON_LEN[c] + GAP + 100;
  const placed = cars.map((c, i) => ({ c, at: pad + cars.slice(0, i).reduce((s, w) => s + step(w), 0) }));
  const x = pad + cars.reduce((s, w) => s + step(w), 0);
  const locoX = x;
  const width = (loco ? locoX + LOCO_LOOK[loco].len : x - GAP - 100) + pad;
  const top = loco && LOCO_LOOK[loco].electric ? -600 : -480;
  return (
    <svg viewBox={`0 ${top} ${width} ${-top + 40}`} className={className} role="img" aria-hidden="true" preserveAspectRatio="xMinYMax meet">
      <defs>
        <radialGradient id={ids.tire} cx="0.5" cy="0.5" r="0.5"><stop offset="0.7" stopColor="#52525b" /><stop offset="1" stopColor="#18181b" /></radialGradient>
        <radialGradient id={ids.rim} cx="0.4" cy="0.35" r="0.7"><stop offset="0" stopColor="#d4d4d8" /><stop offset="1" stopColor="#52525b" /></radialGradient>
        <linearGradient id={ids.glass} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7dd3fc" stopOpacity="0.9" /><stop offset="0.4" stopColor="#0c4a6e" /><stop offset="1" stopColor="#020617" /></linearGradient>
        <linearGradient id={ids.shade} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0.18" /><stop offset="0.5" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.3" /></linearGradient>
        <linearGradient id={ids.metal} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0.7" /><stop offset="0.5" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.35" /></linearGradient>
      </defs>
      {/* Sleepers, ballast and the rail */}
      <rect x={0} y={4} width={width} height={30} fill="#3f3f46" opacity={0.6} />
      {Array.from({ length: Math.ceil(width / 60) }, (_, i) => <rect key={i} x={i * 60 + 10} y={6} width={30} height={14} fill="#57534e" />)}
      <rect x={0} y={-2} width={width} height={10} fill="#a1a1aa" />
      {placed.map(({ c, at }, i) => <Wagon key={i} type={c} x={at} ids={ids} />)}
      {loco && <Locomotive loco={loco} x={locoX} ids={ids} />}
    </svg>
  );
}
