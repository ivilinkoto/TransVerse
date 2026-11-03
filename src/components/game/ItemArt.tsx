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

/** 1.2.1: a fridge magnet with a flag (vertical or horizontal stripes). */
const magnet = (stripes: string[], horizontal = false) => (
  <g>
    <rect x="18" y="24" width="64" height="48" rx="8" fill="#0f172a" opacity="0.35" transform="translate(3 4)" />
    <g>
      <clipPath id={`mag-${stripes.join('')}`}><rect x="18" y="24" width="64" height="48" rx="8" /></clipPath>
      <g clipPath={`url(#mag-${stripes.join('')})`}>
        {stripes.map((c, i) => (horizontal ? <rect key={i} x="18" y={24 + (48 / stripes.length) * i} width="64" height={48 / stripes.length + 0.5} fill={c} /> : <rect key={i} x={18 + (64 / stripes.length) * i} y="24" width={64 / stripes.length + 0.5} height="48" fill={c} />))}
      </g>
      <rect x="18" y="24" width="64" height="48" rx="8" fill="none" stroke="#e2e8f0" strokeWidth="3" />
    </g>
    <path d="M26 30 h14" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.55" />
    <path d="M38 80 h24" stroke="#64748b" strokeWidth="4" strokeLinecap="round" />
  </g>
);

/** 1.2.1: a portrait frame (the reward of a collection). */
const frame = (outer: string, inner: string, deco: ReactNode) => (
  <g>
    <rect x="14" y="14" width="72" height="72" rx="14" fill="#1e293b" />
    <rect x="14" y="14" width="72" height="72" rx="14" fill="none" stroke={outer} strokeWidth="7" />
    <rect x="22" y="22" width="56" height="56" rx="9" fill="none" stroke={inner} strokeWidth="2" opacity="0.8" />
    <circle cx="50" cy="44" r="10" fill="#475569" />
    <path d="M32 74 q18 -22 36 0" fill="#475569" />
    {deco}
  </g>
);

const star = (cx: number, cy: number, r: number, fill: string) => {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  return <polygon key={`${cx}-${cy}`} points={pts} fill={fill} />;
};

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
  treasure_map: (
    <g>
      <path d="M14 22 q8 -6 16 0 q10 6 20 0 q10 -6 20 0 q8 6 16 0 v58 q-8 6 -16 0 q-10 -6 -20 0 q-10 6 -20 0 q-8 -6 -16 0 z" fill="#fde68a" stroke="#92400e" strokeWidth="2.5" />
      <path d="M22 70 q10 -6 14 -16 q6 -14 18 -8 q10 4 14 -10" fill="none" stroke="#b45309" strokeWidth="2.5" strokeDasharray="4 4" />
      <path d="M64 30 l10 10 M74 30 l-10 10" stroke="#dc2626" strokeWidth="4" strokeLinecap="round" />
      <circle cx="24" cy="70" r="3" fill="#15803d" />
      <path d="M80 66 l4 -4 m-4 0 l4 4" stroke="#92400e" strokeWidth="1.5" />
    </g>
  ),
  golden_key: (
    <g>
      <circle cx="50" cy="50" r="40" fill="#facc15" opacity="0.18" />
      <circle cx="34" cy="38" r="16" fill="none" stroke="#ca8a04" strokeWidth="9" />
      <circle cx="34" cy="38" r="16" fill="none" stroke="#fde047" strokeWidth="4" />
      <path d="M46 50 l30 30" stroke="#ca8a04" strokeWidth="9" strokeLinecap="round" />
      <path d="M46 50 l30 30" stroke="#fde047" strokeWidth="4" strokeLinecap="round" />
      <path d="M64 68 l8 -8 M72 76 l6 -6" stroke="#ca8a04" strokeWidth="6" strokeLinecap="round" />
      <path d="M78 16 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2 z" fill="#fef9c3" />
    </g>
  ),
  snow_chains: (
    <g fill="none" strokeWidth="5" strokeLinecap="round">
      {[0, 1, 2, 3].map((i) => <ellipse key={i} cx={26 + i * 16} cy={50 + (i % 2 ? 6 : -6)} rx="10" ry="6" stroke={i % 2 ? '#94a3b8' : '#cbd5e1'} transform={`rotate(${i % 2 ? 30 : -30} ${26 + i * 16} ${50 + (i % 2 ? 6 : -6)})`} />)}
      <path d="M14 76 q36 10 72 0" stroke="#e0f2fe" strokeWidth="4" />
      <circle cx="80" cy="22" r="3" fill="#e0f2fe" stroke="none" />
      <circle cx="20" cy="24" r="2" fill="#e0f2fe" stroke="none" />
    </g>
  ),
  ice_scraper: (
    <g>
      <rect x="44" y="40" width="12" height="44" rx="6" fill="#0369a1" />
      <path d="M24 18 h52 l-8 26 h-36 z" fill="#38bdf8" stroke="#0369a1" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M26 18 h48" stroke="#e0f2fe" strokeWidth="3" />
      <path d="M18 12 l4 4 M80 10 l-3 5 M86 30 l-5 1" stroke="#bae6fd" strokeWidth="2.5" strokeLinecap="round" />
    </g>
  ),
  wool_gloves: (
    <g>
      <path d="M22 80 v-30 q0 -12 8 -14 v-12 q0 -6 6 -6 q6 0 6 6 v10 q4 -2 8 2 v16 q6 -6 10 0 l-6 14 v14 z" fill="#dc2626" stroke="#7f1d1d" strokeWidth="2" strokeLinejoin="round" />
      <rect x="20" y="76" width="36" height="10" rx="3" fill="#f8fafc" />
      <path d="M48 82 v-26 q0 -10 8 -12 v-10 q0 -6 6 -6 q6 0 6 6 v8 q4 -2 8 2 v14 q6 -6 10 0 l-6 12 v12 z" fill="#1d4ed8" stroke="#1e3a8a" strokeWidth="2" strokeLinejoin="round" opacity="0.92" />
      <path d="M28 58 h20 M28 64 h20" stroke="#fecaca" strokeWidth="2" strokeDasharray="3 3" />
    </g>
  ),
  antifreeze: (
    <g>
      <path d="M30 30 h30 l10 10 v44 q0 4 -4 4 h-36 q-4 0 -4 -4 v-50 q0 -4 4 -4 z" fill="#22c55e" stroke="#14532d" strokeWidth="2.5" />
      <rect x="36" y="18" width="14" height="12" rx="2" fill="#facc15" stroke="#854d0e" strokeWidth="2" />
      <path d="M60 30 q14 0 14 16" fill="none" stroke="#14532d" strokeWidth="4" />
      <rect x="32" y="50" width="32" height="20" rx="3" fill="#f0fdf4" />
      <path d="M48 53 v14 M42 56 l12 8 M54 56 l-12 8" stroke="#0284c7" strokeWidth="2" strokeLinecap="round" />
    </g>
  ),
  souvenir_de: magnet(['#111827', '#dc2626', '#facc15'], true),
  souvenir_fr: magnet(['#1d4ed8', '#f8fafc', '#dc2626']),
  souvenir_it: magnet(['#16a34a', '#f8fafc', '#dc2626']),
  souvenir_es: magnet(['#dc2626', '#facc15', '#facc15', '#dc2626'], true),
  souvenir_gr: magnet(['#2563eb', '#f8fafc', '#2563eb', '#f8fafc', '#2563eb', '#f8fafc', '#2563eb', '#f8fafc', '#2563eb'], true),
  souvenir_ro: magnet(['#1d4ed8', '#facc15', '#dc2626']),
  xmas_ornament: (
    <g>
      <path d="M50 8 v12" stroke="#a16207" strokeWidth="2" />
      <rect x="43" y="18" width="14" height="9" rx="2" fill="#eab308" />
      <circle cx="50" cy="56" r="30" fill="#dc2626" stroke="#7f1d1d" strokeWidth="2" />
      <path d="M22 50 q28 12 56 0" fill="none" stroke="#fde047" strokeWidth="4" />
      <path d="M24 64 q26 10 52 0" fill="none" stroke="#f8fafc" strokeWidth="2.5" strokeDasharray="4 4" />
      <ellipse cx="38" cy="40" rx="6" ry="9" fill="#fca5a5" opacity="0.6" transform="rotate(30 38 40)" />
    </g>
  ),
  gingerbread_truck: (
    <g>
      <rect x="14" y="30" width="44" height="34" rx="5" fill="#b45309" stroke="#78350f" strokeWidth="2" />
      <path d="M58 40 h14 l12 12 v12 h-26 z" fill="#b45309" stroke="#78350f" strokeWidth="2" strokeLinejoin="round" />
      <path d="M18 36 q4 4 8 0 q4 -4 8 0 q4 4 8 0 q4 -4 8 0 q4 4 8 0" fill="none" stroke="#f8fafc" strokeWidth="2.5" />
      <path d="M62 44 h8 l7 8 h-15 z" fill="#fde68a" />
      <circle cx="28" cy="68" r="8" fill="#78350f" stroke="#f8fafc" strokeWidth="2.5" />
      <circle cx="70" cy="68" r="8" fill="#78350f" stroke="#f8fafc" strokeWidth="2.5" />
      <circle cx="30" cy="50" r="3" fill="#dc2626" />
      <circle cx="42" cy="50" r="3" fill="#16a34a" />
    </g>
  ),
  xmas_lights: (
    <g>
      <path d="M8 30 q21 18 42 0 q21 -18 42 0" fill="none" stroke="#14532d" strokeWidth="2.5" />
      <path d="M8 62 q21 18 42 0 q21 -18 42 0" fill="none" stroke="#14532d" strokeWidth="2.5" />
      {[[16, 37, '#facc15'], [32, 39, '#ef4444'], [50, 30, '#22d3ee'], [68, 22, '#22c55e'], [84, 24, '#f472b6'], [16, 69, '#22c55e'], [32, 71, '#22d3ee'], [50, 62, '#facc15'], [68, 54, '#ef4444'], [84, 56, '#a78bfa']].map(([x, y, c]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x as number} cy={(y as number) + 7} r="9" fill={c as string} opacity="0.25" />
          <ellipse cx={x as number} cy={(y as number) + 7} rx="4" ry="6" fill={c as string} />
          <rect x={(x as number) - 3} y={(y as number) - 1} width="6" height="4" rx="1" fill="#1f2937" />
        </g>
      ))}
    </g>
  ),
  santa_hat: (
    <g>
      <path d="M20 70 q8 -46 42 -50 q18 0 22 22 l-10 6 q-4 -14 -12 -12 q-16 8 -14 34 z" fill="#dc2626" stroke="#7f1d1d" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="80" cy="50" r="9" fill="#f8fafc" />
      <rect x="14" y="64" width="62" height="16" rx="8" fill="#f8fafc" />
      <path d="M22 70 h4 M34 72 h4 M46 70 h4 M58 72 h4" stroke="#e2e8f0" strokeWidth="2" strokeLinecap="round" />
    </g>
  ),
  frost_frame: frame('#7dd3fc', '#e0f2fe', <g fill="#e0f2fe">{star(18, 18, 7, '#e0f2fe')}{star(82, 82, 7, '#e0f2fe')}<path d="M30 14 v6 M70 86 v-6" stroke="#bae6fd" strokeWidth="2" /></g>),
  euro_frame: frame('#1d4ed8', '#facc15', <g>{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => star(50 + 38 * Math.cos((Math.PI / 4) * i), 50 + 38 * Math.sin((Math.PI / 4) * i), 4.5, '#facc15'))}</g>),
  xmas_frame: frame('#dc2626', '#16a34a', <g><circle cx="18" cy="18" r="5" fill="#16a34a" /><circle cx="82" cy="18" r="5" fill="#facc15" /><circle cx="18" cy="82" r="5" fill="#facc15" /><circle cx="82" cy="82" r="5" fill="#16a34a" /></g>),
};

export function ItemArt({ id, className = 'h-16 w-16' }: { id: ItemId; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-hidden="true">
      {ART[id]}
    </svg>
  );
}
