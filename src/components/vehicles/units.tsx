import { Fender, Wheel, type Ids } from './parts';
import { GRILLE_COLORS, LIGHT_COLORS, type Cosmetics } from '@/lib/game/cosmetics';
import { tx } from '@/i18n/t';

/** Cab-over European truck cab. `x` = rear of cab, faces right. */
export function Cab({ x, style, ids, color, aero = false, extras }: { x: number; style: 'day' | 'sleeper' | 'highline'; ids: Ids; color: string; aero?: boolean; extras?: Cosmetics }) {
  const L = style === 'day' ? 200 : 240;
  const T = style === 'day' ? -300 : style === 'sleeper' ? -330 : -372;
  const f = x + L; // front face
  const doorX = f - 160;
  const beltY = -205;
  return (
    <g>
      {/* rear wall shadow + air intake */}
      <rect x={x - 14} y={T + 70} width={10} height={-T - 190} rx={4} fill="#374151" />
      <rect x={x - 17} y={T + 64} width={16} height={12} rx={3} fill="#4b5563" />
      {/* body shell */}
      <path
        d={`M ${x} -108 L ${x} ${T + 14} Q ${x} ${T} ${x + 14} ${T} L ${f - 22} ${T} Q ${f - 5} ${T} ${f - 3} ${T + 18} L ${f} -150 L ${f + 2} -112 L ${f - 2} -104 L ${x + 4} -104 Z`}
        fill={`url(#${ids.body})`}
        stroke="#0b1220"
        strokeWidth="2"
      />
      {aero && style !== 'day' && (
        // Roof deflector and side extenders close the gap to a 4 m trailer
        <g>
          <path d={`M ${x + 6} ${T} L ${x + 6} -398 Q ${x + 8} -404 ${x + 20} -404 L ${x + 120} -404 Q ${f - 60} ${T - 4} ${f - 30} ${T} Z`} fill={`url(#${ids.body})`} stroke="#0b1220" strokeWidth="2" />
          <path d={`M ${x + 20} -398 L ${x + 116} -398`} stroke="#fff" strokeOpacity="0.3" strokeWidth="3" />
          <path d={`M ${x} ${T + 20} L ${x - 34} ${T + 12} L ${x - 34} -150 L ${x} -140 Z`} fill={color} opacity="0.9" stroke="#0b1220" strokeWidth="1.5" />
        </g>
      )}
      {/* grille slats on the front corner (a bought grille: a finished panel behind them) */}
      {extras?.grille && <rect x={f - 12} y={-268} width={13} height={88} rx={3} fill={extras.grille === 'chrome' ? `url(#${ids.chrome})` : GRILLE_COLORS[extras.grille]} stroke="#0b1220" strokeWidth="1.5" />}
      {Array.from({ length: 6 }, (_, i) => (
        <rect key={`g${i}`} x={f - 9} y={-262 + i * 14} width={9} height={6} rx={2} fill={extras?.grille === 'black' ? '#475569' : '#0b1220'} opacity="0.55" />
      ))}
      {/* roof highlight */}
      <path d={`M ${x + 14} ${T + 3} L ${f - 22} ${T + 3}`} stroke="#fff" strokeOpacity="0.35" strokeWidth="4" strokeLinecap="round" />
      {style === 'highline' && <rect x={x + 30} y={T + 18} width={L - 80} height={10} rx={4} fill="#000" opacity="0.12" />}
      {style !== 'day' && (
        // Sleeper compartment: vent grill and storage locker
        <g>
          <rect x={x + 18} y={-196} width={doorX - x - 34} height={72} rx={6} fill="#000" opacity="0.12" />
          {Array.from({ length: 5 }, (_, i) => (
            <rect key={i} x={x + 26} y={T + 60 + i * 9} width={40} height={4} rx={2} fill="#000" opacity="0.25" />
          ))}
        </g>
      )}
      {/* side window and A-pillar glass */}
      <path d={`M ${doorX + 10} ${T + 34} L ${f - 26} ${T + 34} Q ${f - 15} ${T + 36} ${f - 13} ${T + 48} L ${f - 10} ${beltY} L ${doorX + 10} ${beltY} Z`} fill={`url(#${ids.glass})`} stroke="#0b1220" strokeWidth="2" />
      <path d={`M ${doorX + 18} ${T + 42} L ${doorX + 70} ${T + 42} L ${doorX + 40} ${beltY - 6} L ${doorX + 18} ${beltY - 6} Z`} fill="#fff" opacity="0.12" />
      <path d={`M ${f - 6} ${T + 22} L ${f - 1} ${T + 26} L ${f + 1} -192 L ${f - 7} -192 Z`} fill={`url(#${ids.glass})`} />
      {/* door seams and handle */}
      <path d={`M ${doorX} -110 L ${doorX} ${T + 26} L ${f - 22} ${T + 26}`} fill="none" stroke="#000" strokeOpacity="0.45" strokeWidth="2" />
      <rect x={doorX + 12} y={beltY + 14} width={26} height={6} rx={3} fill={`url(#${ids.chrome})`} />
      {/* livery stripe */}
      <path d={`M ${x} -158 L ${f - 1} -158 L ${f - 1} -146 L ${x} -146 Z`} fill="#000" opacity="0.18" />
      <path d={`M ${x} -170 L ${f - 2} -170`} stroke="#fff" strokeOpacity="0.35" strokeWidth="3" />
      {/* sun visor */}
      {extras?.visor ? (
        <path d={`M ${f - 64} ${T - 2} L ${f + 6} ${T - 2} L ${f + 2} ${T + 14} L ${f - 60} ${T + 8} Z`} fill={extras.visor === 'chrome' ? `url(#${ids.chrome})` : extras.visor === 'body' ? color : '#0b1220'} stroke="#0b1220" strokeWidth="1.5" />
      ) : (
        <rect x={f - 46} y={T - 6} width={46} height={10} rx={4} fill="#111827" />
      )}
      {extras?.lights && (
        // Roof light bar with four lamps
        <g>
          <rect x={f - 84} y={T - 20} width={60} height={10} rx={4} fill="#111827" />
          {[0, 1, 2, 3].map((i) => <circle key={i} cx={f - 76 + i * 15} cy={T - 22} r={6} fill={LIGHT_COLORS[extras.lights!]} stroke="#0b1220" strokeWidth="1" />)}
        </g>
      )}
      {extras?.martenitsa && (
        // Martenitsa: red and white cord from the mirror arm, with two pompoms and tassels
        <g>
          <path d={`M ${f + 6} ${T + 57} Q ${f + 2} ${T + 80} ${f + 4} ${T + 100}`} stroke="#dc2626" strokeWidth="2.5" fill="none" />
          <path d={`M ${f + 8} ${T + 57} Q ${f + 6} ${T + 80} ${f + 8} ${T + 100}`} stroke="#f8fafc" strokeWidth="2.5" fill="none" />
          <circle cx={f - 2} cy={T + 104} r={7} fill="#f8fafc" stroke="#94a3b8" strokeWidth="1" />
          <circle cx={f + 12} cy={T + 106} r={7} fill="#dc2626" />
          <path d={`M ${f - 5} ${T + 110} l -2 14 M ${f - 1} ${T + 111} l 0 14 M ${f + 9} ${T + 112} l 0 14 M ${f + 14} ${T + 112} l 2 14`} stroke="#94a3b8" strokeWidth="1.5" />
        </g>
      )}
      {extras?.sticker && (
        <text x={doorX + 72} y={-121} textAnchor="middle" fontSize="16" fontWeight="800" fill="#fff" stroke="#0b1220" strokeWidth="0.8" paintOrder="stroke" fontFamily="system-ui, sans-serif" letterSpacing="1" {...(extras.sticker.length > 13 ? { textLength: 130, lengthAdjust: 'spacingAndGlyphs' } : {})}>{tx(extras.sticker)}</text>
      )}
      {/* headlight, indicator, bumper, step */}
      <rect x={f - 16} y={-150} width={16} height={18} rx={4} fill="#fffbe6" stroke="#9ca3af" />
      <ellipse cx={f + 4} cy={-141} rx={18} ry={8} fill="#fff7c2" opacity="0.35" />
      <rect x={f - 30} y={-128} width={9} height={7} rx={2} fill="#f59e0b" />
      <path d={`M ${f - 44} -118 L ${f + 4} -118 L ${f + 6} -74 L ${f - 44} -74 Z`} fill="#1f2937" stroke="#0b1220" />
      <rect x={f - 40} y={-96} width={44} height={6} fill="#4b5563" />
      <rect x={doorX - 34} y={-96} width={32} height={7} rx={2} fill="#4b5563" />
      <rect x={doorX - 34} y={-66} width={32} height={7} rx={2} fill="#4b5563" />
      {/* mirror */}
      <path d={`M ${f - 8} ${T + 54} L ${f + 20} ${T + 60}`} stroke="#111827" strokeWidth="5" strokeLinecap="round" />
      <rect x={f + 14} y={T + 50} width={12} height={74} rx={5} fill="#111827" />
      <rect x={f + 16} y={T + 130} width={9} height={26} rx={4} fill="#111827" />
      {/* side marker */}
      <rect x={x + 6} y={-122} width={10} height={6} rx={2} fill="#f59e0b" />
    </g>
  );
}

/** Tractor unit, rear at x = 0, front at ≈ 602. Fifth wheel centre at x = 120 (kingpin sits 1.6 m behind the trailer nose). */
export function Tractor({ ids, color, cab, heavy = false, coupled = false, extras }: { ids: Ids; color: string; cab: 'day' | 'sleeper' | 'highline'; heavy?: boolean; coupled?: boolean; extras?: Cosmetics }) {
  const cabX = 362;
  const rear = heavy ? [72, 198] : [100];
  return (
    <g>
      {/* frame rails */}
      <rect x={0} y={-122} width={560} height={24} rx={3} fill="#1f2937" />
      <rect x={2} y={-116} width={8} height={14} fill="#dc2626" />
      {/* fifth wheel */}
      <rect x={70} y={-136} width={104} height={14} rx={5} fill="#111827" />
      <rect x={112} y={-142} width={16} height={8} rx={2} fill="#6b7280" />
      {/* fuel tank with straps + AdBlue */}
      <rect x={heavy ? 254 : 218} y={-158} width={heavy ? 92 : 128} height={70} rx={14} fill={`url(#${ids.metal})`} stroke="#475569" />
      <rect x={(heavy ? 254 : 218) + 22} y={-158} width={6} height={70} fill="#475569" />
      <rect x={(heavy ? 254 : 218) + (heavy ? 64 : 100)} y={-158} width={6} height={70} fill="#475569" />
      <rect x={heavy ? 228 : 186} y={-140} width={24} height={46} rx={6} fill="#e5e7eb" stroke="#64748b" />
      <rect x={heavy ? 232 : 190} y={-134} width={16} height={6} fill="#2563eb" />
      {/* side skirt */}
      {!heavy && <rect x={160} y={-102} width={196} height={18} rx={4} fill={color} opacity="0.85" />}
      <Cab x={cabX} style={cab} ids={ids} color={color} aero={coupled && !heavy} extras={extras} />
      {rear.map((wx) => (
        <g key={wx}>
          <Fender x={wx} />
          <Wheel x={wx} ids={ids} twin />
        </g>
      ))}
      <Fender x={482} />
      <Wheel x={482} ids={ids} />
    </g>
  );
}

/** Rigid truck with its own body. Rear at 0, front at ≈ 902. */
export function Rigid({ ids, color, body, extras }: { ids: Ids; color: string; body: 'box' | 'reefer'; extras?: Cosmetics }) {
  const bodyEnd = 680;
  return (
    <g>
      <rect x={20} y={-124} width={860} height={22} rx={3} fill="#1f2937" />
      {body === 'reefer' ? (
        <g>
          <rect x={0} y={-372} width={bodyEnd} height={244} rx={6} fill={`url(#${ids.white})`} stroke="#94a3b8" strokeWidth="2" />
          {Array.from({ length: 10 }, (_, i) => (
            <rect key={i} x={30 + i * 66} y={-366} width={2} height={232} fill="#94a3b8" opacity="0.6" />
          ))}
          <rect x={bodyEnd - 4} y={-360} width={28} height={110} rx={6} fill="#e2e8f0" stroke="#64748b" />
          {Array.from({ length: 6 }, (_, i) => (
            <rect key={i} x={bodyEnd + 2} y={-348 + i * 15} width={18} height={4} rx={2} fill="#475569" />
          ))}
          <text x={bodyEnd / 2} y={-262} textAnchor="middle" fontSize="54" fontWeight="800" fill={color} fontFamily="system-ui, sans-serif" letterSpacing="4">FRIGO</text>
        </g>
      ) : (
        <g>
          <rect x={0} y={-372} width={bodyEnd} height={244} rx={4} fill={`url(#${ids.white})`} stroke="#94a3b8" strokeWidth="2" />
          <rect x={0} y={-372} width={bodyEnd} height={14} fill="#94a3b8" />
          <rect x={0} y={-142} width={bodyEnd} height={14} fill="#64748b" />
          <rect x={20} y={-300} width={bodyEnd - 40} height={70} rx={8} fill={color} opacity="0.9" />
          <text x={bodyEnd / 2} y={-250} textAnchor="middle" fontSize="44" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif" letterSpacing="6">TRANSVERSE</text>
        </g>
      )}
      <rect x={0} y={-140} width={8} height={14} fill="#dc2626" />
      {/* side guard */}
      <rect x={300} y={-96} width={320} height={6} rx={2} fill="#9ca3af" />
      <rect x={300} y={-74} width={320} height={6} rx={2} fill="#9ca3af" />
      <rect x={430} y={-150} width={110} height={56} rx={12} fill={`url(#${ids.metal})`} stroke="#475569" />
      <Cab x={bodyEnd + 12} style="day" ids={ids} color={color} extras={extras} />
      <Fender x={200} />
      <Wheel x={200} ids={ids} twin />
      <Fender x={778} />
      <Wheel x={778} ids={ids} />
    </g>
  );
}

/** Large panel van (3.5 t class). Rear at 0, front at ≈ 600. */
export function Van({ ids, color }: { ids: Ids; color: string }) {
  return (
    <g>
      <path
        d="M 4 -60 L 4 -268 Q 4 -280 18 -280 L 420 -280 Q 446 -280 462 -258 L 520 -176 Q 530 -164 552 -158 L 588 -150 Q 600 -146 600 -132 L 600 -78 Q 600 -62 584 -62 Z"
        fill={`url(#${ids.white})`}
        stroke="#64748b"
        strokeWidth="2"
      />
      <path d="M 430 -268 Q 446 -268 458 -252 L 510 -178 L 430 -178 Z" fill={`url(#${ids.glass})`} stroke="#0b1220" strokeWidth="2" />
      <path d="M 466 -246 L 516 -176 L 528 -170 L 476 -244 Z" fill={`url(#${ids.glass})`} />
      <path d="M 424 -270 L 424 -68" stroke="#000" strokeOpacity="0.3" strokeWidth="2" />
      <path d="M 200 -272 L 200 -68" stroke="#000" strokeOpacity="0.2" strokeWidth="2" />
      <rect x={20} y={-200} width={390} height={60} rx={8} fill={color} />
      <text x={215} y={-158} textAnchor="middle" fontSize="38" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif" letterSpacing="5">TRANSVERSE</text>
      <rect x={436} y={-164} width={22} height={6} rx={3} fill="#6b7280" />
      <rect x={584} y={-146} width={14} height={18} rx={4} fill="#fffbe6" stroke="#9ca3af" />
      <ellipse cx={604} cy={-137} rx={14} ry={7} fill="#fff7c2" opacity="0.35" />
      <rect x={560} y={-100} width={42} height={34} rx={6} fill="#1f2937" />
      <rect x={0} y={-112} width={10} height={40} rx={2} fill="#dc2626" />
      <rect x={0} y={-80} width={60} height={14} rx={4} fill="#1f2937" />
      <path d="M 506 -216 L 532 -212" stroke="#111827" strokeWidth="5" strokeLinecap="round" />
      <rect x={526} y={-226} width={10} height={40} rx={4} fill="#111827" />
      <Fender x={112} r={38} />
      <Wheel x={112} r={38} ids={ids} />
      <Fender x={478} r={38} />
      <Wheel x={478} r={38} ids={ids} />
    </g>
  );
}
