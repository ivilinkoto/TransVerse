import type { ReactNode } from 'react';
import type { ItemId } from '@/lib/game/items';

/**
 * 1.2: the drawing of every inventory item (viewBox 0 0 100 100). Drawn for
 * TransVerse — no real brands. A case is a crate in its metal's colour.
 */
const steam = (x: number) => (
  <g fill="none" stroke="#e2e8f0" strokeWidth="3" strokeLinecap="round" opacity="0.75">
    <path d={`M${x} 26 q-5 -6 0 -12 q5 -6 0 -12`} />
    <path d={`M${x + 12} 28 q-5 -6 0 -12 q5 -6 0 -12`} />
  </g>
);

const crate = (body: string, edge: string, shine: string) => (
  <g>
    <rect x="14" y="30" width="72" height="54" rx="8" fill={body} stroke={edge} strokeWidth="3" />
    <rect x="14" y="30" width="72" height="16" rx="8" fill={edge} opacity="0.55" />
    <rect x="44" y="40" width="12" height="16" rx="3" fill={edge} />
    <circle cx="50" cy="48" r="2.5" fill={shine} />
    <rect x="24" y="22" width="52" height="10" rx="5" fill="none" stroke={edge} strokeWidth="4" />
    <path d="M22 60 h56" stroke={edge} strokeWidth="2" opacity="0.6" />
    <path d="M24 34 l10 0" stroke={shine} strokeWidth="3" strokeLinecap="round" opacity="0.8" />
    <path d="M70 66 l6 -6 M72 72 l3 -3" stroke={shine} strokeWidth="2" strokeLinecap="round" opacity="0.7" />
  </g>
);


/** A ТрансКоин coin (1.2: coins straight from a case). */
const coin = (cx: number, cy: number, r: number) => (
  <g key={`${cx}-${cy}`}>
    <ellipse cx={cx} cy={cy + r * 0.18} rx={r} ry={r * 0.92} fill="#0e7490" />
    <circle cx={cx} cy={cy} r={r} fill="#22d3ee" stroke="#0e7490" strokeWidth="2" />
    <circle cx={cx} cy={cy} r={r * 0.68} fill="none" stroke="#a5f3fc" strokeWidth="1.5" />
    <text x={cx} y={cy + r * 0.32} fontSize={r * 0.85} fontWeight="900" textAnchor="middle" fill="#083344" fontFamily="system-ui, sans-serif">TC</text>
  </g>
);

const ART: Record<ItemId, ReactNode> = {
  coffee: (
    <g>
      {steam(40)}
      <ellipse cx="50" cy="84" rx="32" ry="7" fill="#cbd5e1" />
      <path d="M24 40 h46 v26 a16 16 0 0 1 -16 16 h-14 a16 16 0 0 1 -16 -16 z" fill="#f8fafc" stroke="#94a3b8" strokeWidth="2" />
      <ellipse cx="47" cy="40" rx="23" ry="5" fill="#6b3f1d" />
      <ellipse cx="44" cy="39" rx="7" ry="1.6" fill="#a16207" opacity="0.6" />
      <path d="M70 46 h4 a9 9 0 0 1 0 18 h-5" fill="none" stroke="#94a3b8" strokeWidth="5" />
      <path d="M32 50 v16" stroke="#e2e8f0" strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
  energy_drink: (
    <g>
      <rect x="32" y="16" width="36" height="70" rx="6" fill="#0ea5e9" stroke="#0369a1" strokeWidth="2" />
      <rect x="34" y="12" width="32" height="8" rx="3" fill="#cbd5e1" />
      <rect x="34" y="82" width="32" height="6" rx="3" fill="#94a3b8" />
      <path d="M53 30 l-12 22 h9 l-4 18 l14 -24 h-9 z" fill="#facc15" stroke="#a16207" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M38 22 v58" stroke="#7dd3fc" strokeWidth="3" opacity="0.7" />
    </g>
  ),
  thermos: (
    <g>
      {steam(68)}
      <rect x="30" y="22" width="30" height="64" rx="7" fill="#64748b" stroke="#334155" strokeWidth="2" />
      <rect x="28" y="14" width="34" height="12" rx="4" fill="#ef4444" stroke="#991b1b" strokeWidth="2" />
      <rect x="34" y="38" width="22" height="22" rx="3" fill="#f97316" opacity="0.9" />
      <path d="M36 26 v56" stroke="#cbd5e1" strokeWidth="3" opacity="0.6" />
      <path d="M62 50 h14 v16 a7 7 0 0 1 -7 7 h0 a7 7 0 0 1 -7 -7 z" fill="#ef4444" stroke="#991b1b" strokeWidth="2" />
      <ellipse cx="69" cy="50" rx="7" ry="2" fill="#6b3f1d" />
    </g>
  ),
  cab_coffee: (
    <g>
      <rect x="20" y="16" width="56" height="64" rx="8" fill="#1f2937" stroke="#0b1220" strokeWidth="2" />
      <rect x="26" y="22" width="44" height="14" rx="3" fill="#0ea5e9" opacity="0.85" />
      <circle cx="34" cy="29" r="3" fill="#e0f2fe" />
      <circle cx="44" cy="29" r="3" fill="#e0f2fe" opacity="0.6" />
      <rect x="40" y="40" width="16" height="8" rx="2" fill="#94a3b8" />
      <path d="M46 48 v6 M50 48 v6" stroke="#6b3f1d" strokeWidth="2" />
      <path d="M38 58 h20 v10 a6 6 0 0 1 -6 6 h-8 a6 6 0 0 1 -6 -6 z" fill="#f8fafc" />
      <rect x="20" y="76" width="56" height="8" rx="3" fill="#ef4444" />
      <path d="M82 40 l4 -4 M84 50 h6 M82 60 l4 4" stroke="#facc15" strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
  power_nap: (
    <g>
      <path d="M14 52 q0 -20 18 -20 h36 q18 0 18 20 q0 20 -18 20 h-36 q-18 0 -18 -20 z" fill="#c4b5fd" stroke="#7c3aed" strokeWidth="2" />
      <path d="M24 46 q26 10 52 0" fill="none" stroke="#a78bfa" strokeWidth="3" />
      <text x="62" y="26" fontSize="18" fontWeight="900" fill="#e0e7ff" fontFamily="system-ui, sans-serif">Z</text>
      <text x="76" y="16" fontSize="12" fontWeight="900" fill="#e0e7ff" fontFamily="system-ui, sans-serif">z</text>
    </g>
  ),
  repair_kit: (
    <g>
      <rect x="14" y="36" width="72" height="46" rx="6" fill="#dc2626" stroke="#7f1d1d" strokeWidth="2" />
      <path d="M36 36 v-8 a4 4 0 0 1 4 -4 h20 a4 4 0 0 1 4 4 v8" fill="none" stroke="#1f2937" strokeWidth="5" />
      <rect x="14" y="52" width="72" height="5" fill="#7f1d1d" />
      <rect x="44" y="49" width="12" height="10" rx="2" fill="#facc15" />
      <path d="M60 14 a8 8 0 0 0 -10 10 l-16 16 4 4 16 -16 a8 8 0 0 0 10 -10 l-5 5 -4 -1 -1 -4 z" fill="#cbd5e1" stroke="#475569" strokeWidth="1.5" transform="translate(14 -4)" />
    </g>
  ),
  fuel_voucher: (
    <g>
      <path d="M10 30 h80 v12 a6 6 0 0 0 0 16 v12 h-80 v-12 a6 6 0 0 0 0 -16 z" fill="#fef3c7" stroke="#d97706" strokeWidth="2" />
      <path d="M64 32 v36" stroke="#d97706" strokeWidth="2" strokeDasharray="4 4" />
      <rect x="22" y="40" width="16" height="22" rx="2" fill="#16a34a" />
      <rect x="25" y="43" width="10" height="7" rx="1" fill="#dcfce7" />
      <path d="M38 46 h4 v10 a3 3 0 0 0 6 0 v-14 l-4 -4" fill="none" stroke="#16a34a" strokeWidth="2.5" />
      <text x="73" y="54" fontSize="10" fontWeight="900" textAnchor="middle" fill="#b45309" fontFamily="system-ui, sans-serif">150</text>
    </g>
  ),
  cargo_cover: (
    <g>
      <path d="M50 12 l30 10 v22 c0 20 -14 34 -30 42 c-16 -8 -30 -22 -30 -42 v-22 z" fill="#2563eb" stroke="#1e3a8a" strokeWidth="2" />
      <path d="M50 20 l22 7 v17 c0 15 -10 26 -22 32 z" fill="#3b82f6" />
      <path d="M36 48 l10 10 l18 -20" fill="none" stroke="#f8fafc" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ),
  queue_ticket: (
    <g>
      <path d="M18 22 h64 v56 h-64 v-10 a6 6 0 0 0 0 -12 v-12 a6 6 0 0 0 0 -12 z" fill="#ccfbf1" stroke="#0d9488" strokeWidth="2" />
      <text x="50" y="58" fontSize="28" fontWeight="900" textAnchor="middle" fill="#0f766e" fontFamily="system-ui, sans-serif">+2</text>
      <path d="M28 70 h44" stroke="#0d9488" strokeWidth="2" strokeDasharray="3 3" />
      <path d="M30 32 h40" stroke="#0d9488" strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
  driver_handbook: (
    <g>
      <path d="M20 18 h50 a6 6 0 0 1 6 6 v58 h-50 a6 6 0 0 1 -6 -6 z" fill="#7c3aed" stroke="#4c1d95" strokeWidth="2" />
      <path d="M26 82 v-6 h50" fill="none" stroke="#e9d5ff" strokeWidth="3" />
      <rect x="30" y="38" width="22" height="12" rx="2" fill="#f8fafc" />
      <rect x="52" y="42" width="10" height="8" rx="2" fill="#f8fafc" />
      <circle cx="36" cy="52" r="3" fill="#1f2937" />
      <circle cx="56" cy="52" r="3" fill="#1f2937" />
      <path d="M30 28 h34" stroke="#e9d5ff" strokeWidth="3" strokeLinecap="round" />
      <text x="62" y="70" fontSize="12" fontWeight="900" fill="#facc15" fontFamily="system-ui, sans-serif">×2</text>
    </g>
  ),
  coin_pouch: (
    <g>
      <path d="M30 40 q-12 20 -6 34 q6 12 26 12 q20 0 26 -12 q6 -14 -6 -34 z" fill="#a16207" stroke="#713f12" strokeWidth="2" />
      <path d="M34 40 q16 -10 32 0" fill="none" stroke="#713f12" strokeWidth="4" />
      <path d="M38 30 q12 8 24 0 l-4 10 h-16 z" fill="#ca8a04" />
      <circle cx="68" cy="30" r="10" fill="#facc15" stroke="#a16207" strokeWidth="2" />
      <circle cx="80" cy="44" r="8" fill="#facc15" stroke="#a16207" strokeWidth="2" />
      <text x="68" y="34" fontSize="10" fontWeight="900" textAnchor="middle" fill="#a16207" fontFamily="system-ui, sans-serif">T</text>
      <text x="50" y="68" fontSize="14" fontWeight="900" textAnchor="middle" fill="#fde68a" fontFamily="system-ui, sans-serif">TC</text>
    </g>
  ),
  trucker_cap: (
    <g>
      <path d="M22 60 q0 -32 30 -32 q28 0 28 32 z" fill="#ea580c" stroke="#9a3412" strokeWidth="2" />
      <path d="M22 60 h28 v8 h-36 a8 8 0 0 1 8 -8 z" fill="#1f2937" />
      <path d="M50 30 v30" stroke="#9a3412" strokeWidth="2" opacity="0.6" />
      <circle cx="52" cy="28" r="3" fill="#9a3412" />
      <rect x="46" y="40" width="22" height="10" rx="2" fill="#f8fafc" />
      <text x="57" y="48" fontSize="7" fontWeight="900" textAnchor="middle" fill="#ea580c" fontFamily="system-ui, sans-serif">TV</text>
    </g>
  ),
  sunglasses: (
    <g>
      <path d="M10 42 h80" stroke="#cbd5e1" strokeWidth="4" />
      <path d="M14 42 h28 v8 a12 12 0 0 1 -12 12 h-4 a12 12 0 0 1 -12 -12 z" fill="#0f172a" stroke="#cbd5e1" strokeWidth="3" />
      <path d="M58 42 h28 v8 a12 12 0 0 1 -12 12 h-4 a12 12 0 0 1 -12 -12 z" fill="#0f172a" stroke="#cbd5e1" strokeWidth="3" />
      <path d="M20 46 l8 8 M64 46 l8 8" stroke="#38bdf8" strokeWidth="3" opacity="0.7" />
    </g>
  ),
  gold_frame: (
    <g>
      <rect x="14" y="14" width="72" height="72" rx="6" fill="#facc15" stroke="#a16207" strokeWidth="3" />
      <rect x="24" y="24" width="52" height="52" rx="3" fill="#1e1b4b" stroke="#a16207" strokeWidth="2" />
      <circle cx="50" cy="44" r="10" fill="#475569" />
      <path d="M32 74 q18 -24 36 0 z" fill="#475569" />
      <circle cx="14" cy="14" r="5" fill="#fde68a" />
      <circle cx="86" cy="14" r="5" fill="#fde68a" />
      <circle cx="14" cy="86" r="5" fill="#fde68a" />
      <circle cx="86" cy="86" r="5" fill="#fde68a" />
    </g>
  ),
  old_tachograph: (
    <g>
      <circle cx="50" cy="50" r="38" fill="#fef9c3" stroke="#a16207" strokeWidth="2" />
      <circle cx="50" cy="50" r="28" fill="none" stroke="#d6d3d1" strokeWidth="1" />
      <circle cx="50" cy="50" r="18" fill="none" stroke="#d6d3d1" strokeWidth="1" />
      <path d="M50 12 v8 M50 80 v8 M12 50 h8 M80 50 h8" stroke="#a16207" strokeWidth="2" />
      <path d="M50 22 l6 6 l-2 8 l8 4 l-4 10 l10 6 l-6 12" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="50" cy="50" r="6" fill="#a16207" />
    </g>
  ),
  truck_keychain: (
    <g>
      <circle cx="40" cy="20" r="11" fill="none" stroke="#cbd5e1" strokeWidth="4" />
      <circle cx="46" cy="34" r="3.5" fill="none" stroke="#cbd5e1" strokeWidth="2.5" />
      <circle cx="50" cy="41" r="3.5" fill="none" stroke="#cbd5e1" strokeWidth="2.5" />
      <rect x="40" y="46" width="34" height="22" rx="3" fill="#ea580c" />
      <path d="M74 52 h8 l6 8 v8 h-14 z" fill="#f97316" />
      <rect x="76" y="54" width="7" height="5" rx="1" fill="#bae6fd" />
      <circle cx="50" cy="70" r="5" fill="#1f2937" />
      <circle cx="80" cy="70" r="5" fill="#1f2937" />
    </g>
  ),
  road_atlas: (
    <g>
      <path d="M12 24 l24 -8 l28 8 l24 -8 v60 l-24 8 l-28 -8 l-24 8 z" fill="#fef3c7" stroke="#a16207" strokeWidth="2" strokeLinejoin="round" />
      <path d="M36 16 v60 M64 24 v60" stroke="#d6d3d1" strokeWidth="2" />
      <path d="M18 64 q12 -20 24 -10 q12 10 22 -12 q8 -14 20 -10" fill="none" stroke="#dc2626" strokeWidth="3" strokeDasharray="5 3" />
      <circle cx="78" cy="32" r="4" fill="#dc2626" />
      <circle cx="22" cy="62" r="3" fill="#16a34a" />
    </g>
  ),
  cb_mic: (
    <g>
      <path d="M50 58 q-14 4 -18 14 q-4 10 6 14 q10 4 22 -2" fill="none" stroke="#1f2937" strokeWidth="3" strokeDasharray="4 2" />
      <rect x="38" y="14" width="26" height="44" rx="12" fill="#334155" stroke="#0f172a" strokeWidth="2" />
      <rect x="44" y="20" width="14" height="14" rx="3" fill="#64748b" />
      <path d="M46 24 h10 M46 28 h10" stroke="#1f2937" strokeWidth="1.5" />
      <rect x="64" y="34" width="8" height="12" rx="2" fill="#dc2626" />
      <text x="51" y="50" fontSize="8" fontWeight="900" textAnchor="middle" fill="#cbd5e1" fontFamily="system-ui, sans-serif">CB</text>
    </g>
  ),
  tc_small: <g>{coin(50, 56, 20)}</g>,
  tc_medium: (
    <g>
      <path d="M24 82 q-4 -30 10 -40 h32 q14 10 10 40 z" fill="#78350f" stroke="#451a03" strokeWidth="2" />
      <path d="M34 42 q16 -10 32 0" fill="none" stroke="#451a03" strokeWidth="3" />
      {coin(38, 34, 13)}
      {coin(60, 30, 13)}
      {coin(50, 62, 14)}
    </g>
  ),
  tc_jackpot: (
    <g>
      <circle cx="50" cy="52" r="40" fill="#fde047" opacity="0.25" />
      {coin(30, 70, 14)}
      {coin(70, 70, 14)}
      {coin(50, 74, 14)}
      {coin(40, 50, 14)}
      {coin(62, 48, 14)}
      {coin(50, 28, 16)}
      <path d="M20 22 l4 6 M80 20 l-4 6 M86 44 l-6 2 M14 46 l6 2" stroke="#fde047" strokeWidth="3" strokeLinecap="round" />
    </g>
  ),
  case_bronze: crate('#b45309', '#78350f', '#fdba74'),
  case_silver: crate('#94a3b8', '#475569', '#f1f5f9'),
  case_gold: crate('#eab308', '#a16207', '#fef9c3'),
};

export function ItemArt({ id, className = 'h-16 w-16' }: { id: ItemId; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-hidden="true">
      {ART[id]}
    </svg>
  );
}
