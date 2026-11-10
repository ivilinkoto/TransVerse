import type { BusModelId } from '@/lib/game/buses';

const LOOK: Record<BusModelId, { len: number; tall: number; body: string; dark: string; stripe: string; axles: number; doors: number }> = {
  // A short shuttle with a sloped nose.
  shuttle: { len: 118, tall: 46, body: '#f59e0b', dark: '#b45309', stripe: '#fde68a', axles: 2, doors: 1 },
  intercity: { len: 170, tall: 52, body: '#22d3ee', dark: '#0e7490', stripe: '#e0f2fe', axles: 2, doors: 2 },
  // A tall touring coach with a third axle.
  coach: { len: 192, tall: 60, body: '#8b5cf6', dark: '#5b21b6', stripe: '#ddd6fe', axles: 3, doors: 2 },
};

/**
 * 1.3: the three buses, side view, drawn in code (invented brands) — a rounded
 * body with a raked windscreen, wheel arches, doors, a mirror and a stripe.
 * The bus faces right; 1 unit ≈ 7 cm.
 */
export function BusArt({ model, className = 'h-16 w-40' }: { model: BusModelId; className?: string }) {
  const { len, tall, body, dark, stripe, axles, doors } = LOOK[model];
  const x0 = 6, top = 8, bottom = top + tall, r = 9;
  const front = x0 + len;
  const nose = model === 'shuttle' ? 22 : 12;
  // The body: a rounded rear, a straight roof, a raked front with a rounded nose.
  const outline = `M${x0 + r} ${top} H${front - nose - 6} Q${front - nose + 4} ${top} ${front - 4} ${top + tall * 0.42} Q${front} ${top + tall * 0.55} ${front} ${top + tall * 0.7} V${bottom - 6} Q${front} ${bottom} ${front - 6} ${bottom} H${x0 + 6} Q${x0} ${bottom} ${x0} ${bottom - 6} V${top + r} Q${x0} ${top} ${x0 + r} ${top} Z`;
  const wheelY = bottom + 1;
  const wheelR = model === 'shuttle' ? 8 : 9.5;
  const axleX = axles === 3 ? [x0 + 30, front - 52, front - 30] : [x0 + 28, front - 30];
  const windowTop = top + 7, windowH = tall * 0.34;
  const winStart = x0 + 12, winEnd = front - nose - 22;
  const panes = Math.max(2, Math.round((winEnd - winStart) / 24));
  const paneW = (winEnd - winStart) / panes;
  const doorX = doors === 2 ? [front - nose - 18, x0 + len * 0.48] : [front - nose - 18];
  return (
    <svg viewBox={`0 0 ${len + 14} ${tall + 22}`} className={className} role="img" aria-hidden>
      <defs>
        <linearGradient id={`bus-${model}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={body} stopOpacity="0.95" />
          <stop offset="0.7" stopColor={body} />
          <stop offset="1" stopColor={dark} />
        </linearGradient>
        <linearGradient id={`glass-${model}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e0f2fe" />
          <stop offset="1" stopColor="#7dd3fc" />
        </linearGradient>
      </defs>
      <ellipse cx={x0 + len / 2} cy={wheelY + wheelR - 1} rx={len / 2} ry="3" fill="rgba(0,0,0,0.35)" />
      <path d={outline} fill={`url(#bus-${model})`} stroke={dark} strokeWidth="1.5" strokeLinejoin="round" />
      {/* Roof hatch / AC unit and a sheen along the roof. */}
      <rect x={x0 + len * 0.3} y={top - 3} width={len * 0.22} height="4" rx="2" fill={dark} opacity="0.8" />
      <path d={`M${x0 + 10} ${top + 3} H${front - nose - 10}`} stroke="#fff" strokeOpacity="0.35" strokeWidth="2" strokeLinecap="round" />
      {/* Side windows with rounded corners and thin pillars. */}
      {Array.from({ length: panes }, (_, i) => (
        <rect key={i} x={winStart + i * paneW + 1} y={windowTop} width={paneW - 3} height={windowH} rx="3.5" fill={`url(#glass-${model})`} opacity="0.92" />
      ))}
      {/* The raked windscreen. */}
      <path d={`M${front - nose - 16} ${windowTop} H${front - nose - 2} Q${front - nose + 6} ${windowTop} ${front - 6} ${top + tall * 0.45} L${front - 4} ${windowTop + windowH + 2} H${front - nose - 16} Z`} fill={`url(#glass-${model})`} stroke={dark} strokeWidth="1" />
      {/* Doors: glass panels with a centre line. */}
      {doorX.map((dx, i) => (
        <g key={i}>
          <rect x={dx - 7} y={windowTop + 1} width="14" height={bottom - windowTop - 9} rx="3" fill={`url(#glass-${model})`} stroke={dark} strokeWidth="1" opacity="0.95" />
          <path d={`M${dx} ${windowTop + 2} V${bottom - 9}`} stroke={dark} strokeWidth="1" />
        </g>
      ))}
      {/* A stripe in the livery colour, broken by the doors. */}
      <path d={`M${x0 + 2} ${top + tall * 0.62} H${front - 3}`} stroke={stripe} strokeWidth="3.5" strokeLinecap="round" opacity="0.9" />
      <path d={`M${x0 + 2} ${top + tall * 0.7} H${front - 3}`} stroke={dark} strokeWidth="1.5" opacity="0.5" />
      {/* Mirror, headlight, tail light. */}
      <path d={`M${front - 2} ${top + tall * 0.3} q6 -2 6 4 v5`} fill="none" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" />
      <rect x={front - 9} y={bottom - 14} width="7" height="4" rx="2" fill="#fef9c3" />
      <rect x={x0 + 1} y={bottom - 15} width="3.5" height="7" rx="1.5" fill="#f43f5e" />
      {/* Wheel arches, then the wheels with rims. */}
      {axleX.map((ax, i) => (
        <g key={i}>
          <path d={`M${ax - wheelR - 3} ${bottom} A${wheelR + 3} ${wheelR + 3} 0 0 1 ${ax + wheelR + 3} ${bottom} Z`} fill="#0b1220" />
          <circle cx={ax} cy={wheelY} r={wheelR} fill="#111827" />
          <circle cx={ax} cy={wheelY} r={wheelR * 0.55} fill="#94a3b8" />
          <circle cx={ax} cy={wheelY} r={wheelR * 0.2} fill="#334155" />
        </g>
      ))}
    </svg>
  );
}
