import type { BusModelId } from '@/lib/game/buses';

/** 1.3: the three buses, side view, drawn in code (invented brands). */
export function BusArt({ model, className = 'h-16 w-40' }: { model: BusModelId; className?: string }) {
  const len = model === 'shuttle' ? 120 : model === 'intercity' ? 170 : 190;
  const tall = model === 'coach' ? 58 : model === 'shuttle' ? 44 : 52;
  const colour = model === 'shuttle' ? '#f59e0b' : model === 'intercity' ? '#22d3ee' : '#a78bfa';
  const windows = Math.floor((len - 40) / 22);
  return (
    <svg viewBox={`0 0 ${len + 10} ${tall + 20}`} className={className} role="img" aria-hidden>
      <rect x="5" y="6" width={len} height={tall} rx="10" fill={colour} stroke="#0f172a" strokeWidth="2" />
      <rect x={len - 18} y="12" width="16" height={tall * 0.45} rx="4" fill="#0f172a" opacity="0.85" />
      {Array.from({ length: windows }, (_, i) => <rect key={i} x={14 + i * 22} y="13" width="18" height={tall * 0.32} rx="3" fill="#e0f2fe" opacity="0.85" />)}
      <rect x="5" y={6 + tall * 0.62} width={len} height="5" fill="#0f172a" opacity="0.35" />
      <rect x={len - 8} y={tall - 8} width="6" height="5" rx="1" fill="#fde68a" />
      <circle cx="30" cy={tall + 8} r="9" fill="#111827" stroke="#475569" strokeWidth="3" />
      <circle cx={len - 30} cy={tall + 8} r="9" fill="#111827" stroke="#475569" strokeWidth="3" />
      {model === 'coach' && <circle cx={len - 52} cy={tall + 8} r="9" fill="#111827" stroke="#475569" strokeWidth="3" />}
    </svg>
  );
}
