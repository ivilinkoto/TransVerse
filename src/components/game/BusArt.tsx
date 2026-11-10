import type { BusModelId } from '@/lib/game/buses';

interface Look {
  len: number; tall: number; nose: number; body: string; dark: string; stripe: string;
  /** Axle and door centres, measured back from the front. */
  axles: number[]; doors: number[]; bays: boolean; wheelR: number;
}
const LOOK: Record<BusModelId, Look> = {
  // A minibus with a sloped nose and its door behind the front wheel.
  shuttle: { len: 118, tall: 46, nose: 22, body: '#f59e0b', dark: '#b45309', stripe: '#fde68a', axles: [32, 96], doors: [56], bays: false, wheelR: 8 },
  intercity: { len: 170, tall: 52, nose: 12, body: '#22d3ee', dark: '#0e7490', stripe: '#e0f2fe', axles: [50, 138], doors: [22, 92], bays: true, wheelR: 9.5 },
  // A tall touring coach with a third axle.
  coach: { len: 192, tall: 60, nose: 12, body: '#8b5cf6', dark: '#5b21b6', stripe: '#ddd6fe', axles: [52, 142, 164], doors: [22, 104], bays: true, wheelR: 9.5 },
};

/**
 * 1.3: the three buses, side view, drawn in code (invented brands) — a rounded
 * body with a raked windscreen, wheel arches, glass doors (never over a wheel),
 * mirror, lights, a destination sign and, on the long buses, luggage bays.
 * The bus faces right.
 */
export function BusArt({ model, className = 'h-16 w-40' }: { model: BusModelId; className?: string }) {
  const { len, tall, nose, body, dark, stripe, axles, doors, bays, wheelR } = LOOK[model];
  const x0 = 6, top = 8, bottom = top + tall, r = 9;
  const front = x0 + len;
  const archR = wheelR + 3;
  // The body: a rounded rear, a straight roof, a raked front with a rounded nose,
  // and the bottom edge cut by an arch over each wheel.
  const axleX = axles.map((a) => front - a).sort((a, b) => a - b);
  const bottomEdge = axleX.map((ax) => `H${ax - archR} A${archR} ${archR} 0 0 1 ${ax + archR} ${bottom}`).join(' ');
  const outline = `M${x0 + 6} ${bottom} ${bottomEdge} H${front - 6} Q${front} ${bottom} ${front} ${bottom - 6} V${top + tall * 0.7} Q${front} ${top + tall * 0.55} ${front - 4} ${top + tall * 0.42} Q${front - nose + 4} ${top} ${front - nose - 6} ${top} H${x0 + r} Q${x0} ${top} ${x0} ${top + r} V${bottom - 6} Q${x0} ${bottom} ${x0 + 6} ${bottom} Z`;
  const wheelY = bottom + 1;
  const windowTop = top + 7, windowH = tall * 0.34;
  const winStart = x0 + 10, winEnd = front - nose - 20;
  const panes = Math.max(2, Math.round((winEnd - winStart) / 22));
  const paneW = (winEnd - winStart) / panes;
  const doorX = doors.map((d) => front - d);
  const doorBottom = bottom - 3;
  // Luggage bay flaps between the last two axles' arches (front and middle wheels).
  const bayFrom = axleX.length > 1 ? axleX[axleX.length - 2]! + archR + 3 : 0;
  const bayTo = axleX[axleX.length - 1]! - archR - 3;
  const bayTop = top + tall * 0.66, bayBottom = bottom - 4;
  const flaps = bays ? Math.max(2, Math.round((bayTo - bayFrom) / 22)) : 0;
  const id = `bus-${model}`;
  return (
    <svg viewBox={`0 0 ${len + 16} ${tall + 22}`} className={className} role="img" aria-hidden>
      <defs>
        <linearGradient id={`${id}-paint`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="0.12" stopColor={body} />
          <stop offset="0.75" stopColor={body} />
          <stop offset="1" stopColor={dark} />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#334155" />
          <stop offset="0.45" stopColor="#0f172a" />
          <stop offset="0.5" stopColor="#475569" />
          <stop offset="1" stopColor="#0f172a" />
        </linearGradient>
        <linearGradient id={`${id}-door`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#475569" />
          <stop offset="1" stopColor="#1e293b" />
        </linearGradient>
        <clipPath id={`${id}-clip`}><path d={outline} /></clipPath>
      </defs>
      <ellipse cx={x0 + len / 2} cy={wheelY + wheelR - 1} rx={len / 2 + 2} ry="3" fill="rgba(0,0,0,0.35)" />
      {/* Dark wheel wells, then the body over them. */}
      {axleX.map((ax, i) => <circle key={i} cx={ax} cy={bottom} r={archR} fill="#05080f" />)}
      <path d={outline} fill={`url(#${id}-paint)`} stroke={dark} strokeWidth="1.2" strokeLinejoin="round" />
      <g clipPath={`url(#${id}-clip)`}>
        {/* A darker skirt along the bottom (it follows the arches through the clip). */}
        <rect x={x0} y={bottom - 6} width={len} height="6" fill={dark} />
        {/* Livery: a wide stripe and a thin line under the windows. */}
        <rect x={x0} y={top + tall * 0.58} width={len} height="3.5" fill={stripe} opacity="0.9" />
        <rect x={x0} y={windowTop + windowH + 2.5} width={len} height="0.9" fill="#f8fafc" opacity="0.7" />
        {/* Luggage bays. */}
        {Array.from({ length: flaps ? flaps + 1 : 0 }, (_, i) => (
          <path key={i} d={`M${bayFrom + ((bayTo - bayFrom) * i) / flaps} ${bayTop} V${bayBottom}`} stroke={dark} strokeWidth="0.8" opacity="0.8" />
        ))}
        {flaps > 0 && <path d={`M${bayFrom} ${bayTop} H${bayTo}`} stroke={dark} strokeWidth="0.8" opacity="0.8" />}
        {Array.from({ length: flaps }, (_, i) => (
          <rect key={i} x={bayFrom + ((bayTo - bayFrom) * (i + 0.5)) / flaps - 3} y={bayBottom - 5} width="6" height="1.6" rx="0.8" fill="#e2e8f0" />
        ))}
        {/* Amber side markers between the wheels. */}
        {Array.from({ length: Math.floor(len / 34) }, (_, i) => x0 + 14 + i * 34)
          .filter((mx) => axleX.every((ax) => Math.abs(ax - mx) > archR + 3))
          .map((mx) => <rect key={mx} x={mx} y={bottom - 4.5} width="3" height="1.6" rx="0.8" fill="#fbbf24" />)}
      </g>
      {/* Roof: air conditioning with vents, a hatch, and a sheen along the roof. */}
      <rect x={x0 + len * 0.28} y={top - 3.5} width={len * 0.24} height="4.5" rx="2.2" fill="#cbd5e1" stroke={dark} strokeWidth="0.6" />
      {[0.33, 0.39, 0.45].map((f) => <path key={f} d={`M${x0 + len * f} ${top - 2.2} v2`} stroke="#64748b" strokeWidth="0.8" />)}
      <rect x={x0 + len * 0.68} y={top - 1.5} width="9" height="2" rx="1" fill="#94a3b8" />
      <path d={`M${x0 + 10} ${top + 2.5} H${front - nose - 10}`} stroke="#fff" strokeOpacity="0.4" strokeWidth="1.6" strokeLinecap="round" />
      {/* Window band with tinted panes. */}
      <rect x={winStart - 2} y={windowTop - 2} width={winEnd - winStart + 4} height={windowH + 4} rx="4" fill="#0b1220" />
      {Array.from({ length: panes }, (_, i) => (
        <rect key={i} x={winStart + i * paneW + 0.8} y={windowTop} width={paneW - 1.6} height={windowH} rx="3" fill={`url(#${id}-glass)`} />
      ))}
      {/* The raked windscreen with the lit destination sign and a wiper. */}
      <path d={`M${front - nose - 14} ${windowTop - 2} H${front - nose - 2} Q${front - nose + 6} ${windowTop - 2} ${front - 5} ${top + tall * 0.45} L${front - 3} ${top + tall * 0.6} H${front - nose - 14} Z`} fill={`url(#${id}-glass)`} stroke={dark} strokeWidth="1" />
      <rect x={front - nose - 12} y={windowTop - 0.5} width={nose + 2} height="4" rx="1" fill="#fbbf24" opacity="0.95" />
      <path d={`M${front - 5} ${top + tall * 0.58} l-7 -6`} stroke="#0b1220" strokeWidth="1" strokeLinecap="round" />
      {/* Doors: glass leaves in a dark frame with a rubber seal and a step. */}
      {doorX.map((dx, i) => (
        <g key={i}>
          <rect x={dx - 7.5} y={windowTop - 1} width="15" height={doorBottom - windowTop + 1} rx="2.5" fill="#0b1220" />
          <rect x={dx - 6.5} y={windowTop} width="6" height={doorBottom - windowTop - 1.5} rx="2" fill={`url(#${id}-door)`} />
          <rect x={dx + 0.5} y={windowTop} width="6" height={doorBottom - windowTop - 1.5} rx="2" fill={`url(#${id}-door)`} />
          <path d={`M${dx - 3.5} ${windowTop + 9} v${(doorBottom - windowTop) * 0.4} M${dx + 3.5} ${windowTop + 9} v${(doorBottom - windowTop) * 0.4}`} stroke="#cbd5e1" strokeWidth="0.7" />
          <rect x={dx - 7} y={doorBottom} width="14" height="1.4" rx="0.7" fill="#94a3b8" />
        </g>
      ))}
      {/* Mirror on its arm, headlight, indicator, fog light, bumper; at the back the tail light. */}
      <path d={`M${front - 3} ${top + tall * 0.28} q7 -3 7 4 v6`} fill="none" stroke="#0f172a" strokeWidth="1.8" strokeLinecap="round" />
      <rect x={front + 2.5} y={top + tall * 0.3 + 3} width="3" height="7" rx="1.2" fill="#0f172a" />
      <rect x={front - 8} y={bottom - 15} width="7" height="4" rx="2" fill="#fef9c3" />
      <rect x={front - 6} y={bottom - 10.5} width="4.5" height="1.6" rx="0.8" fill="#fbbf24" />
      <rect x={front - 4} y={bottom - 5} width="5" height="4" rx="1.5" fill={dark} />
      <rect x={x0 - 1} y={bottom - 5} width="5" height="4" rx="1.5" fill={dark} />
      <rect x={x0 + 0.5} y={bottom - 18} width="3" height="9" rx="1.4" fill="#f43f5e" />
      {/* Wheels with rims and hubs. */}
      {axleX.map((ax, i) => (
        <g key={i}>
          <circle cx={ax} cy={wheelY} r={wheelR} fill="#111827" />
          <circle cx={ax} cy={wheelY} r={wheelR * 0.6} fill="#cbd5e1" />
          {[0, 72, 144, 216, 288].map((deg) => (
            <circle key={deg} cx={ax + Math.cos((deg * Math.PI) / 180) * wheelR * 0.38} cy={wheelY + Math.sin((deg * Math.PI) / 180) * wheelR * 0.38} r={wheelR * 0.07} fill="#64748b" />
          ))}
          <circle cx={ax} cy={wheelY} r={wheelR * 0.18} fill="#334155" />
        </g>
      ))}
    </svg>
  );
}
