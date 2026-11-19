import type { LocoId, WagonType } from '@/lib/game/trains';

const LOCO_LOOK: Record<LocoId, { body: string; dark: string; stripe: string; len: number; pantograph: boolean }> = {
  'danubia-d22': { body: '#f59e0b', dark: '#92400e', stripe: '#1f2937', len: 92, pantograph: false },
  'balkan-e40': { body: '#22d3ee', dark: '#0e7490', stripe: '#f8fafc', len: 96, pantograph: true },
  'rila-e60': { body: '#ef4444', dark: '#7f1d1d', stripe: '#f8fafc', len: 108, pantograph: true },
};

const WAGON_LOOK: Record<WagonType, { color: string; dark: string }> = {
  container: { color: '#3b82f6', dark: '#1e3a8a' },
  tank: { color: '#cbd5e1', dark: '#475569' },
  covered: { color: '#a16207', dark: '#713f12' },
  hopper: { color: '#57534e', dark: '#292524' },
};

/** Two bogies of two wheels each under a car from x to x + len. */
function Bogies({ x, len, y }: { x: number; len: number; y: number }) {
  const at = [x + 12, x + 24, x + len - 24, x + len - 12];
  return (
    <g>
      <rect x={x + 6} y={y - 2} width={24} height={4} rx={1.5} fill="#1f2937" />
      <rect x={x + len - 30} y={y - 2} width={24} height={4} rx={1.5} fill="#1f2937" />
      {at.map((cx) => <circle key={cx} cx={cx} cy={y + 4} r={5} fill="#111827" stroke="#9ca3af" strokeWidth={1.5} />)}
    </g>
  );
}

function Wagon({ type, x }: { type: WagonType; x: number }) {
  const len = 78, base = 52;
  const { color, dark } = WAGON_LOOK[type];
  return (
    <g>
      <rect x={x} y={base - 4} width={len} height={5} fill="#374151" />
      {type === 'container' && <>
        <rect x={x + 4} y={base - 30} width={34} height={26} fill={color} stroke={dark} strokeWidth={1.5} />
        <rect x={x + 40} y={base - 30} width={34} height={26} fill="#f97316" stroke="#9a3412" strokeWidth={1.5} />
        {[10, 18, 26, 46, 54, 62].map((d) => <line key={d} x1={x + d} y1={base - 28} x2={x + d} y2={base - 6} stroke="rgba(0,0,0,0.25)" />)}
      </>}
      {type === 'tank' && <>
        <rect x={x + 4} y={base - 28} width={len - 8} height={22} rx={11} fill={color} stroke={dark} strokeWidth={1.5} />
        <rect x={x + len / 2 - 5} y={base - 32} width={10} height={5} fill={dark} />
        <line x1={x + 10} y1={base - 17} x2={x + len - 10} y2={base - 17} stroke="#f59e0b" strokeWidth={2} />
      </>}
      {type === 'covered' && <>
        <path d={`M${x + 3} ${base - 4} V${base - 30} Q${x + len / 2} ${base - 38} ${x + len - 3} ${base - 30} V${base - 4} Z`} fill={color} stroke={dark} strokeWidth={1.5} />
        <rect x={x + len / 2 - 12} y={base - 28} width={24} height={22} fill="none" stroke={dark} strokeWidth={1.5} />
      </>}
      {type === 'hopper' && <>
        <path d={`M${x + 3} ${base - 30} H${x + len - 3} V${base - 14} L${x + len - 18} ${base - 4} H${x + 18} L${x + 3} ${base - 14} Z`} fill={color} stroke={dark} strokeWidth={1.5} />
        {[20, 39, 58].map((d) => <line key={d} x1={x + d} y1={base - 29} x2={x + d} y2={base - 6} stroke="rgba(255,255,255,0.15)" />)}
      </>}
      <Bogies x={x} len={len} y={base + 1} />
    </g>
  );
}

/**
 * 1.3.3: a train side view drawn in code (invented brands) — the locomotive
 * (a pantograph on the electric ones, an exhaust on the diesel; none for a
 * wagon alone) and up to
 * `show` wagons behind it. The train runs to the right.
 */
export function TrainArt({ loco, wagons = [], show = 3, className = 'h-12 w-full' }: { loco: LocoId | null; wagons?: WagonType[]; show?: number; className?: string }) {
  const L = loco ? LOCO_LOOK[loco] : null;
  const cars = wagons.slice(0, show);
  const gap = 4;
  const width = 8 + cars.length * (78 + gap) + (L ? L.len + 8 : 4);
  const lx = 8 + cars.length * (78 + gap);
  const base = 52;
  const top = base - 34;
  return (
    <svg viewBox={`0 0 ${width} 66`} className={className} role="img" aria-hidden="true" preserveAspectRatio="xMinYMid meet">
      <line x1={0} y1={base + 10} x2={width} y2={base + 10} stroke="#4b5563" strokeWidth={2} />
      {cars.map((c, i) => <Wagon key={i} type={c} x={8 + i * (78 + gap)} />)}
      {L && <g>
        {L.pantograph && <path d={`M${lx + L.len * 0.35} ${top} L${lx + L.len * 0.45} ${top - 10} L${lx + L.len * 0.58} ${top - 10} M${lx + L.len * 0.45} ${top - 10} L${lx + L.len * 0.52} ${top}`} stroke="#9ca3af" strokeWidth={1.5} fill="none" />}
        {!L.pantograph && <rect x={lx + L.len * 0.3} y={top - 6} width={6} height={7} fill="#374151" />}
        <path d={`M${lx} ${base - 2} V${top + 4} Q${lx} ${top} ${lx + 4} ${top} H${lx + L.len - 16} Q${lx + L.len - 4} ${top} ${lx + L.len} ${top + 14} V${base - 2} Z`} fill={L.body} stroke={L.dark} strokeWidth={1.5} />
        <rect x={lx + 2} y={base - 14} width={L.len - 4} height={4} fill={L.stripe} opacity={0.85} />
        <path d={`M${lx + L.len - 15} ${top + 3} H${lx + L.len - 8} Q${lx + L.len - 3} ${top + 5} ${lx + L.len - 2} ${top + 13} H${lx + L.len - 15} Z`} fill="#0f172a" />
        {[0.12, 0.3, 0.48].map((f) => <rect key={f} x={lx + L.len * f} y={top + 6} width={10} height={8} rx={1} fill="#0f172a" opacity={0.7} />)}
        <circle cx={lx + L.len - 3} cy={base - 6} r={2} fill="#fde68a" />
        <rect x={lx} y={base - 3} width={L.len} height={4} fill="#1f2937" />
        <Bogies x={lx} len={L.len} y={base + 1} />
      </g>}
    </svg>
  );
}
