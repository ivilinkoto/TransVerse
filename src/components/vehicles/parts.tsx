/**
 * Building blocks for side-view vehicle illustrations.
 * Units are centimetres; ground is y = 0 and "up" is negative y.
 */
import type { ReactNode } from 'react';

export interface Ids {
  body: string;
  metal: string;
  glass: string;
  tire: string;
  rim: string;
  chrome: string;
  white: string;
  shadow: string;
  corrugation: string;
}

export function Defs({ ids, color }: { ids: Ids; color: string }) {
  return (
    <defs>
      <linearGradient id={ids.body} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={color} stopOpacity="1" />
        <stop offset="0.55" stopColor={color} />
        <stop offset="1" stopColor="#000" stopOpacity="0.35" />
      </linearGradient>
      <linearGradient id={ids.metal} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f1f5f9" />
        <stop offset="0.45" stopColor="#94a3b8" />
        <stop offset="0.55" stopColor="#cbd5e1" />
        <stop offset="1" stopColor="#64748b" />
      </linearGradient>
      <linearGradient id={ids.chrome} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.5" stopColor="#9ca3af" />
        <stop offset="1" stopColor="#e5e7eb" />
      </linearGradient>
      <linearGradient id={ids.white} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.7" stopColor="#e7ebf0" />
        <stop offset="1" stopColor="#b8c1cc" />
      </linearGradient>
      <linearGradient id={ids.glass} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#7dd3fc" stopOpacity="0.9" />
        <stop offset="0.35" stopColor="#0c4a6e" />
        <stop offset="1" stopColor="#020617" />
      </linearGradient>
      <radialGradient id={ids.tire} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0.62" stopColor="#3f3f46" />
        <stop offset="0.8" stopColor="#18181b" />
        <stop offset="1" stopColor="#09090b" />
      </radialGradient>
      <radialGradient id={ids.rim} cx="0.45" cy="0.4" r="0.6">
        <stop offset="0" stopColor="#f8fafc" />
        <stop offset="0.6" stopColor="#9ca3af" />
        <stop offset="1" stopColor="#4b5563" />
      </radialGradient>
      <radialGradient id={ids.shadow} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#000" stopOpacity="0.55" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </radialGradient>
      <pattern id={ids.corrugation} width="14" height="10" patternUnits="userSpaceOnUse">
        <rect width="14" height="10" fill="#000" fillOpacity="0" />
        <rect x="0" width="5" height="10" fill="#000" fillOpacity="0.16" />
        <rect x="5" width="2" height="10" fill="#fff" fillOpacity="0.12" />
      </pattern>
    </defs>
  );
}

/** Tyre with sidewall, rim, lug nuts and hub cap. */
export function Wheel({ x, r = 52, ids, twin = false }: { x: number; r?: number; ids: Ids; twin?: boolean }) {
  const cy = -r;
  const rimR = r * 0.56;
  const lugs = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    return <circle key={i} cx={x + Math.cos(a) * rimR * 0.62} cy={cy + Math.sin(a) * rimR * 0.62} r={r * 0.04} fill="#374151" />;
  });
  return (
    <g>
      <circle cx={x} cy={cy} r={r} fill={`url(#${ids.tire})`} />
      <circle cx={x} cy={cy} r={r * 0.94} fill="none" stroke="#27272a" strokeWidth={r * 0.06} strokeDasharray={`${r * 0.08} ${r * 0.06}`} />
      <circle cx={x} cy={cy} r={rimR} fill={`url(#${ids.rim})`} stroke="#1f2937" strokeWidth={r * 0.03} />
      {twin && <circle cx={x} cy={cy} r={rimR * 0.8} fill="none" stroke="#6b7280" strokeWidth={r * 0.04} />}
      {lugs}
      <circle cx={x} cy={cy} r={rimR * 0.3} fill="#6b7280" stroke="#d1d5db" strokeWidth={r * 0.02} />
      <circle cx={x - r * 0.08} cy={cy - r * 0.08} r={rimR * 0.1} fill="#f9fafb" opacity="0.8" />
    </g>
  );
}

/** Plastic wheel arch / mudguard over a wheel. */
export function Fender({ x, r = 52, color = '#111827' }: { x: number; r?: number; color?: string }) {
  const R = r + 12;
  return <path d={`M ${x - R} ${-r + 4} A ${R} ${R} 0 0 1 ${x + R} ${-r + 4} L ${x + R - 8} ${-r + 4} A ${R - 8} ${R - 8} 0 0 0 ${x - R + 8} ${-r + 4} Z`} fill={color} />;
}

export function GroundShadow({ from, to }: { from: number; to: number }) {
  return <ellipse cx={(from + to) / 2} cy={-2} rx={(to - from) / 2 + 30} ry={14} fill="#000" opacity="0.35" />;
}

export function Group({ x = 0, children }: { x?: number; children: ReactNode }) {
  return <g transform={`translate(${x} 0)`}>{children}</g>;
}
