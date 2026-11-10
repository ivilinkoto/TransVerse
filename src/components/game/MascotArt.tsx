import type { Accessory, MascotKind } from '@/lib/game/mascot';

/**
 * 1.3 „Талисман в кабината“: the four companions, drawn in code (viewBox 0 0 120 120,
 * sitting on y ≈ 108), with the accessory on top. `sad` droops the eyes.
 */
export function MascotArt({ kind, accessory, sad = false, className = 'h-28 w-28' }: { kind: MascotKind; accessory?: Accessory | null; sad?: boolean; className?: string }) {
  const eye = (cx: number, cy: number) =>
    sad ? <path d={`M${cx - 4} ${cy + 1} q4 -3 8 0`} fill="none" stroke="#111827" strokeWidth="2.4" strokeLinecap="round" /> : (
      <g>
        <circle cx={cx} cy={cy} r="4.2" fill="#111827" />
        <circle cx={cx + 1.3} cy={cy - 1.4} r="1.3" fill="#fff" />
      </g>
    );
  const body: Record<MascotKind, React.ReactNode> = {
    cat: (
      <g>
        <ellipse cx="60" cy="96" rx="30" ry="14" fill="#f59e0b" />
        <path d="M86 96 q22 -4 18 -26" fill="none" stroke="#f59e0b" strokeWidth="7" strokeLinecap="round" />
        <path d="M30 40 l6 -22 l16 14 z M90 40 l-6 -22 l-16 14 z" fill="#f59e0b" stroke="#b45309" strokeWidth="2" strokeLinejoin="round" />
        <path d="M36 34 l3 -10 l7 6 z M84 34 l-3 -10 l-7 6 z" fill="#fda4af" />
        <circle cx="60" cy="56" r="30" fill="#fbbf24" stroke="#b45309" strokeWidth="2" />
        <path d="M40 46 h8 M42 40 h6 M72 46 h8 M72 40 h6" stroke="#d97706" strokeWidth="2.4" strokeLinecap="round" />
        {eye(49, 56)}
        {eye(71, 56)}
        <path d="M57 64 h6 l-3 3 z" fill="#f43f5e" />
        <path d="M60 67 q-4 5 -8 3 M60 67 q4 5 8 3" fill="none" stroke="#7c2d12" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M32 62 l-12 -2 M32 66 l-12 2 M88 62 l12 -2 M88 66 l12 2" stroke="#7c2d12" strokeWidth="1.4" strokeLinecap="round" />
      </g>
    ),
    dog: (
      <g>
        <ellipse cx="60" cy="96" rx="30" ry="14" fill="#a16207" />
        <path d="M88 92 q14 -8 12 -22" fill="none" stroke="#a16207" strokeWidth="7" strokeLinecap="round" />
        <circle cx="60" cy="56" r="30" fill="#ca8a04" stroke="#713f12" strokeWidth="2" />
        <path d="M30 42 q-14 10 -8 32 q10 2 14 -14 z M90 42 q14 10 8 32 q-10 2 -14 -14 z" fill="#713f12" />
        <ellipse cx="70" cy="50" rx="10" ry="8" fill="#fef3c7" opacity="0.6" />
        {eye(49, 54)}
        {eye(71, 54)}
        <ellipse cx="60" cy="68" rx="13" ry="10" fill="#fef3c7" />
        <ellipse cx="60" cy="64" rx="5" ry="3.6" fill="#111827" />
        <path d="M60 68 v4 M60 72 q-5 4 -9 1 M60 72 q5 4 9 1" fill="none" stroke="#111827" strokeWidth="1.8" strokeLinecap="round" />
        {!sad && <path d="M57 75 q3 7 6 0" fill="#f43f5e" />}
      </g>
    ),
    parrot: (
      <g>
        <path d="M54 104 l-6 12 M66 104 l6 12" stroke="#f97316" strokeWidth="3" strokeLinecap="round" />
        <path d="M60 104 q-6 -20 -2 -24 M66 102 q10 -14 22 -2" fill="#16a34a" />
        <ellipse cx="60" cy="80" rx="22" ry="26" fill="#22c55e" stroke="#15803d" strokeWidth="2" />
        <path d="M44 74 q-14 10 -8 26 q12 -6 14 -18 z" fill="#2563eb" />
        <path d="M76 74 q14 10 8 26 q-12 -6 -14 -18 z" fill="#2563eb" />
        <circle cx="60" cy="48" r="24" fill="#22c55e" stroke="#15803d" strokeWidth="2" />
        <path d="M50 26 q4 -14 12 -6 q4 -10 10 0" fill="#ef4444" />
        <circle cx="49" cy="48" r="8" fill="#fef9c3" />
        <circle cx="71" cy="48" r="8" fill="#fef9c3" />
        {eye(49, 48)}
        {eye(71, 48)}
        <path d="M60 52 q12 2 8 14 q-6 -4 -8 -4 q-2 0 -8 4 q-4 -12 8 -14 z" fill="#f59e0b" stroke="#b45309" strokeWidth="1.5" />
      </g>
    ),
    turtle: (
      <g>
        <ellipse cx="28" cy="98" rx="9" ry="6" fill="#5eead4" />
        <ellipse cx="92" cy="98" rx="9" ry="6" fill="#5eead4" />
        <path d="M24 92 q36 -56 72 0 z" fill="#0f766e" stroke="#134e4a" strokeWidth="2" />
        <path d="M44 70 l16 -10 l16 10 l-4 14 h-24 z" fill="#14b8a6" stroke="#134e4a" strokeWidth="1.6" />
        <path d="M34 86 l10 -16 M86 86 l-10 -16 M48 84 h24" stroke="#134e4a" strokeWidth="1.6" />
        <ellipse cx="60" cy="94" rx="38" ry="6" fill="#134e4a" />
        <circle cx="60" cy="42" r="20" fill="#5eead4" stroke="#0f766e" strokeWidth="2" />
        <path d="M50 58 q10 14 20 0" fill="#5eead4" />
        {eye(52, 42)}
        {eye(68, 42)}
        <path d="M54 50 q6 5 12 0" fill="none" stroke="#134e4a" strokeWidth="2" strokeLinecap="round" />
      </g>
    ),
  };
  const head = { cat: 26, dog: 26, parrot: 22, turtle: 22 }[kind];
  const acc: Record<Accessory, React.ReactNode> = {
    scarf: (
      <g>
        <path d={`M36 ${head + 56} q24 10 48 0 v8 q-24 10 -48 0 z`} fill="#dc2626" stroke="#7f1d1d" strokeWidth="1.5" />
        <path d={`M74 ${head + 62} l6 18 l8 -4 l-6 -14 z`} fill="#dc2626" stroke="#7f1d1d" strokeWidth="1.5" />
        <path d={`M44 ${head + 60} v6 M54 ${head + 62} v6 M64 ${head + 62} v6`} stroke="#fca5a5" strokeWidth="2" />
      </g>
    ),
    cap: (
      <g>
        <path d={`M38 ${head + 4} q22 -24 44 0 z`} fill="#2563eb" stroke="#1e3a8a" strokeWidth="2" />
        <path d={`M76 ${head + 4} h20 q2 4 -4 6 h-18 z`} fill="#1e3a8a" />
        <circle cx="60" cy={head - 8} r="3" fill="#fbbf24" />
        <text x="60" y={head + 1} textAnchor="middle" fontSize="8" fontWeight="900" fill="#fff" fontFamily="system-ui, sans-serif">TV</text>
      </g>
    ),
    glasses: (
      <g fill="rgba(15, 23, 42, 0.85)" stroke="#0f172a" strokeWidth="2">
        <rect x="39" y={head + 22} width="18" height="12" rx="4" />
        <rect x="63" y={head + 22} width="18" height="12" rx="4" />
        <path d={`M57 ${head + 26} h6`} fill="none" />
        <path d={`M43 ${head + 25} l6 0`} stroke="#94a3b8" strokeWidth="1.5" />
      </g>
    ),
    crown: (
      <g>
        <path d={`M42 ${head + 2} l4 -18 l8 10 l6 -14 l6 14 l8 -10 l4 18 z`} fill="#f6c343" stroke="#a16207" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="60" cy={head - 6} r="2.6" fill="#ef4444" />
        <circle cx="48" cy={head - 4} r="2" fill="#22d3ee" />
        <circle cx="72" cy={head - 4} r="2" fill="#22d3ee" />
      </g>
    ),
  };
  return (
    <svg viewBox="0 0 120 120" className={className} role="img" aria-hidden>
      <ellipse cx="60" cy="110" rx="36" ry="5" fill="rgba(0,0,0,0.35)" />
      {body[kind]}
      {accessory && acc[accessory]}
    </svg>
  );
}
