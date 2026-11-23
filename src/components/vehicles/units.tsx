import { Fender, Wheel, type Ids, type RimStyle } from './parts';
import { GRILLE_COLORS, LIGHT_COLORS, type Cosmetics } from '@/lib/game/cosmetics';
import { tx } from '@/i18n/t';

/**
 * 1.3.2.2: each (invented) brand has its own cab: Hemus — the plain local
 * truck with round lamps and amber roof markers; Danubia — rounded, with
 * chrome bars and slim lamps; Rila Heavy — square and massive, a big grille,
 * twin lamps, air horns and exhaust stacks; Volta — the electric, a sloped
 * aero nose with a light band and camera mirrors.
 */
export type CabBrand = 'hemus' | 'danubia' | 'rila' | 'volta';
export interface CabDesign {
  brand: CabBrand;
  /** Chrome exhaust stacks behind the cab (tractors). */
  stacks?: boolean;
  /** A bull bar in front of the bumper. */
  bullbar?: boolean;
  /** The roof deflector even without a trailer. */
  aero?: boolean;
}
/** The rims each brand fits. */
export const RIMS: Record<CabBrand, RimStyle> = { hemus: 'steel', danubia: 'alloy', rila: 'heavy', volta: 'aero' };
export function cabBrand(brand: string): CabBrand {
  return brand.startsWith('Danubia') ? 'danubia' : brand.startsWith('Rila') ? 'rila' : brand.startsWith('Volta') ? 'volta' : 'hemus';
}

/** Cab-over European truck cab. `x` = rear of cab, faces right. */
export function Cab({ x, style, ids, color, aero = false, extras, design = { brand: 'hemus' } }: { x: number; style: 'day' | 'sleeper' | 'highline'; ids: Ids; color: string; aero?: boolean; extras?: Cosmetics; design?: CabDesign }) {
  const L = style === 'day' ? 200 : 240;
  const b = design.brand;
  // Rila's cab sits higher on its frame; Volta's is low and smooth.
  const T = (style === 'day' ? -300 : style === 'sleeper' ? -330 : -372) + (b === 'rila' ? -18 : b === 'volta' ? 10 : 0);
  const f = x + L; // front face
  const doorX = f - 160;
  const beltY = -205;
  aero = (aero || !!design.aero) && b !== 'volta';
  const shell =
    b === 'danubia' ? `M ${x} -108 L ${x} ${T + 14} Q ${x} ${T} ${x + 14} ${T} L ${f - 70} ${T} Q ${f - 6} ${T} ${f - 3} ${T + 64} L ${f} -150 L ${f + 2} -112 L ${f - 2} -104 L ${x + 4} -104 Z`
    : b === 'volta' ? `M ${x} -108 L ${x} ${T + 20} Q ${x} ${T} ${x + 20} ${T} L ${f - 90} ${T} Q ${f - 40} ${T} ${f - 22} ${T + 50} L ${f - 4} -200 Q ${f + 2} -176 ${f + 2} -150 L ${f + 2} -112 L ${f - 2} -104 L ${x + 4} -104 Z`
    : b === 'rila' ? `M ${x} -108 L ${x} ${T + 6} L ${x + 6} ${T} L ${f - 8} ${T} L ${f - 1} ${T + 8} L ${f + 2} -150 L ${f + 4} -112 L ${f - 2} -104 L ${x + 4} -104 Z`
    : `M ${x} -108 L ${x} ${T + 14} Q ${x} ${T} ${x + 14} ${T} L ${f - 22} ${T} Q ${f - 5} ${T} ${f - 3} ${T + 18} L ${f} -150 L ${f + 2} -112 L ${f - 2} -104 L ${x + 4} -104 Z`;
  return (
    <g>
      {design.stacks && (
        // Rila: twin chrome exhaust stacks behind the cab with heat shields
        <g>
          {[x - 30, x - 48].map((sx, i) => (
            <g key={sx}>
              <rect x={sx} y={T - 40 + i * 14} width={12} height={-T - 80 - i * 14} rx={5} fill={`url(#${ids.chrome})`} stroke="#475569" strokeWidth="1.5" />
              <rect x={sx - 2} y={T + 60} width={16} height={80} rx={4} fill="#94a3b8" stroke="#475569" strokeWidth="1" />
              {Array.from({ length: 5 }, (_, k) => <rect key={k} x={sx} y={T + 68 + k * 14} width={12} height={4} fill="#475569" opacity="0.6" />)}
              <path d={`M ${sx - 1} ${T - 40 + i * 14} L ${sx + 14} ${T - 46 + i * 14}`} stroke="#334155" strokeWidth="4" strokeLinecap="round" />
            </g>
          ))}
        </g>
      )}
      {/* rear wall shadow + air intake */}
      <rect x={x - 14} y={T + 70} width={10} height={-T - 190} rx={4} fill="#374151" />
      <rect x={x - 17} y={T + 64} width={16} height={12} rx={3} fill="#4b5563" />
      {/* body shell */}
      <path
        d={shell}
        fill={`url(#${ids.body})`}
        stroke="#0b1220"
        strokeWidth="2"
      />
      {b === 'volta' && style !== 'day' && (
        // Volta: a low roof fairing grown out of the cab
        <path d={`M ${x + 6} ${T + 2} L ${x + 6} ${T - 30} Q ${x + 10} ${T - 38} ${x + 30} ${T - 38} L ${x + 110} ${T - 38} Q ${f - 110} ${T - 30} ${f - 80} ${T + 2} Z`} fill={`url(#${ids.body})`} stroke="#0b1220" strokeWidth="2" />
      )}
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
      {b === 'hemus' && Array.from({ length: 6 }, (_, i) => (
        <rect key={`g${i}`} x={f - 9} y={-262 + i * 14} width={9} height={6} rx={2} fill={extras?.grille === 'black' ? '#475569' : '#0b1220'} opacity="0.55" />
      ))}
      {b === 'danubia' && (
        // three wide chrome bars and the round badge
        <g>
          {[0, 1, 2].map((i) => <rect key={i} x={f - 16} y={-262 + i * 24} width={18} height={9} rx={4} fill={extras?.grille && extras.grille !== 'chrome' ? GRILLE_COLORS[extras.grille] : `url(#${ids.chrome})`} stroke="#334155" strokeWidth="1" />)}
          <circle cx={f - 7} cy={-276} r={7} fill={`url(#${ids.chrome})`} stroke="#334155" strokeWidth="1" />
        </g>
      )}
      {b === 'rila' && (
        // a tall, massive grille with heavy bars
        <g>
          <rect x={f - 18} y={-292} width={21} height={130} rx={3} fill="#0b1220" stroke="#334155" strokeWidth="1.5" />
          {Array.from({ length: 7 }, (_, i) => <rect key={i} x={f - 16} y={-286 + i * 18} width={18} height={8} rx={1} fill={extras?.grille ? (extras.grille === 'chrome' ? `url(#${ids.chrome})` : GRILLE_COLORS[extras.grille]) : '#475569'} />)}
        </g>
      )}
      {b === 'volta' && (
        // a closed nose with a light band (no radiator)
        <g>
          <rect x={f - 6} y={-284} width={7} height={96} rx={3} fill="#38bdf8" />
          <rect x={f - 9} y={-288} width={13} height={104} rx={5} fill="#38bdf8" opacity="0.18" />
        </g>
      )}
      {b === 'hemus' && style === 'day' && !extras?.lights && (
        // amber cab markers on the roof front
        <g>{[0, 1, 2].map((i) => <rect key={i} x={f - 70 + i * 18} y={T - 8} width={10} height={8} rx={2} fill="#f59e0b" stroke="#78350f" strokeWidth="1" />)}</g>
      )}
      {b === 'rila' && (
        // air horns on the roof
        <g>
          <path d={`M ${x + 70} ${T - 4} L ${x + 70} ${T - 14} L ${x + 120} ${T - 20} L ${x + 120} ${T - 2} Z`} fill={`url(#${ids.chrome})`} stroke="#475569" strokeWidth="1.5" />
          <path d={`M ${x + 82} ${T - 4} L ${x + 82} ${T - 24} L ${x + 144} ${T - 32} L ${x + 144} ${T - 6} Z`} fill={`url(#${ids.chrome})`} stroke="#475569" strokeWidth="1.5" />
        </g>
      )}
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
      {/* brand graphics on the cab side */}
      {b === 'danubia' && <path d={`M ${x + 4} -128 L ${x + 4} -150 Q ${x + L * 0.45} -150 ${f - 30} ${T + 90} L ${f - 6} ${T + 90} Q ${x + L * 0.55} -120 ${x + 4} -128 Z`} fill="#fff" opacity="0.22" />}
      {b === 'rila' && <rect x={x + 2} y={-150} width={L - 4} height={44} fill="#0b1220" opacity="0.55" />}
      {b === 'volta' && <path d={`M ${x + 4} -132 L ${f - 4} -168`} stroke="#38bdf8" strokeWidth="6" strokeLinecap="round" />}
      {b === 'hemus' && <rect x={x + 2} y={-196} width={L - 6} height={14} fill="#fff" opacity="0.85" />}
      {/* side window and A-pillar glass (by brand: Rila square, Volta raked) */}
      {b === 'rila' ? (
        <path d={`M ${doorX + 16} ${T + 40} L ${f - 16} ${T + 40} L ${f - 16} ${beltY} L ${doorX + 16} ${beltY} Z`} fill={`url(#${ids.glass})`} stroke="#0b1220" strokeWidth="3" />
      ) : b === 'volta' ? (
        <path d={`M ${doorX + 30} ${T + 34} L ${f - 40} ${T + 34} Q ${f - 24} ${T + 40} ${f - 16} ${T + 70} L ${f - 8} ${beltY} L ${doorX - 10} ${beltY} Z`} fill={`url(#${ids.glass})`} stroke="#0b1220" strokeWidth="2" />
      ) : (
        <path d={`M ${doorX + 10} ${T + 34} L ${f - 26} ${T + 34} Q ${f - 15} ${T + 36} ${f - 13} ${T + 48} L ${f - 10} ${beltY} L ${doorX + 10} ${beltY} Z`} fill={`url(#${ids.glass})`} stroke="#0b1220" strokeWidth="2" />
      )}
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
      {extras?.premium && (
        // Premium trim: twin gold pinstripes along the cab and a crown badge on the door
        <g>
          <rect x={x + 2} y={-182} width={f - x - 4} height={5} fill="#f6c343" />
          <rect x={x + 2} y={-173} width={f - x - 4} height={2} fill="#f6c343" opacity="0.8" />
          <rect x={x + 2} y={-108} width={f - x - 4} height={3} fill="#f6c343" opacity="0.9" />
          <g transform={`translate(${doorX + 80} -132) scale(0.8)`}>
            <path d="M -20 8 L -24 -12 L -11 -2 L 0 -18 L 11 -2 L 24 -12 L 20 8 Z" fill="#f6c343" stroke="#78350f" strokeWidth="1.5" />
            <rect x={-20} y={9} width={40} height={6} rx={2} fill="#f6c343" stroke="#78350f" strokeWidth="1.5" />
          </g>
        </g>
      )}
      {extras?.sticker && (
        <text x={doorX + 72} y={-121} textAnchor="middle" fontSize="16" fontWeight="800" fill="#fff" stroke="#0b1220" strokeWidth="0.8" paintOrder="stroke" fontFamily="system-ui, sans-serif" letterSpacing="1" {...(extras.sticker.length > 13 ? { textLength: 130, lengthAdjust: 'spacingAndGlyphs' } : {})}>{tx(extras.sticker)}</text>
      )}
      {/* headlight (by brand), indicator, bumper, step */}
      {b === 'hemus' ? <circle cx={f - 8} cy={-141} r={10} fill="#fffbe6" stroke="#9ca3af" strokeWidth="2" />
        : b === 'danubia' ? <><rect x={f - 26} y={-147} width={28} height={10} rx={5} fill="#fffbe6" stroke="#9ca3af" /><rect x={f - 24} y={-134} width={24} height={3} rx={1.5} fill="#e0f2fe" /></>
        : b === 'rila' ? <>{[-158, -138].map((y) => <rect key={y} x={f - 14} y={y} width={16} height={15} rx={2} fill="#fffbe6" stroke="#9ca3af" />)}</>
        : <><rect x={f - 34} y={-146} width={36} height={6} rx={3} fill="#f0f9ff" /><rect x={f - 30} y={-136} width={30} height={3} rx={1.5} fill="#38bdf8" /></>}
      <ellipse cx={f + 4} cy={-141} rx={18} ry={8} fill="#fff7c2" opacity="0.35" />
      <rect x={f - 30} y={-128} width={9} height={7} rx={2} fill="#f59e0b" />
      {b === 'rila' ? (
        <path d={`M ${f - 54} -122 L ${f + 8} -122 L ${f + 10} -66 L ${f - 54} -66 Z`} fill="#111827" stroke="#0b1220" />
      ) : b === 'volta' ? (
        <path d={`M ${f - 44} -118 L ${f + 2} -118 Q ${f + 8} -96 ${f + 2} -74 L ${f - 44} -74 Z`} fill={color} stroke="#0b1220" />
      ) : (
        <path d={`M ${f - 44} -118 L ${f + 4} -118 L ${f + 6} -74 L ${f - 44} -74 Z`} fill="#1f2937" stroke="#0b1220" />
      )}
      <rect x={f - 40} y={-96} width={44} height={6} fill={b === 'danubia' ? `url(#${ids.chrome})` : '#4b5563'} />
      {design.bullbar && (
        // a chrome bull bar in front of the bumper
        <g fill="none" stroke={`url(#${ids.chrome})`} strokeWidth="7" strokeLinecap="round">
          <path d={`M ${f - 10} -170 L ${f + 18} -164 L ${f + 20} -76 L ${f - 6} -72`} />
          <path d={`M ${f + 18} -132 L ${f - 4} -132`} />
        </g>
      )}
      <rect x={doorX - 34} y={-96} width={32} height={7} rx={2} fill="#4b5563" />
      <rect x={doorX - 34} y={-66} width={32} height={7} rx={2} fill="#4b5563" />
      {/* mirror (Volta: camera arms) */}
      {b === 'volta' ? (
        <g>
          <path d={`M ${f - 30} ${T + 70} L ${f + 8} ${T + 66}`} stroke="#111827" strokeWidth="6" strokeLinecap="round" />
          <rect x={f + 4} y={T + 58} width={16} height={14} rx={4} fill="#111827" />
        </g>
      ) : (
        <g>
          <path d={`M ${f - 8} ${T + 54} L ${f + 20} ${T + 60}`} stroke="#111827" strokeWidth="5" strokeLinecap="round" />
          <rect x={f + 14} y={T + 50} width={12} height={b === 'rila' ? 84 : 74} rx={b === 'rila' ? 2 : 5} fill="#111827" />
          <rect x={f + 16} y={T + (b === 'rila' ? 140 : 130)} width={9} height={26} rx={4} fill="#111827" />
        </g>
      )}
      {/* side marker */}
      <rect x={x + 6} y={-122} width={10} height={6} rx={2} fill="#f59e0b" />
    </g>
  );
}

/** Tractor unit, rear at x = 0, front at ≈ 602. Fifth wheel centre at x = 120 (kingpin sits 1.6 m behind the trailer nose). */
export function Tractor({ ids, color, cab, heavy = false, coupled = false, classic = false, plow = false, extras, design }: { ids: Ids; color: string; cab: 'day' | 'sleeper' | 'highline'; heavy?: boolean; coupled?: boolean; classic?: boolean; plow?: boolean; extras?: Cosmetics; design?: CabDesign }) {
  const cabX = 362;
  const rear = heavy ? [72, 198] : [100];
  return (
    <g>
      {/* frame rails: a lighter steel with a top edge, so the chassis reads as one piece on a dark page */}
      <rect x={0} y={-122} width={560} height={24} rx={3} fill="#374151" stroke="#1f2937" strokeWidth="2" />
      <rect x={2} y={-121} width={556} height={3} fill="#64748b" opacity="0.8" />
      {/* rear light bar, mud-flap hanger and the flap behind the last axle */}
      <rect x={-4} y={-124} width={16} height={34} rx={3} fill="#4b5563" stroke="#1f2937" strokeWidth="1.5" />
      <rect x={2} y={-116} width={8} height={14} fill="#dc2626" />
      <rect x={14} y={-100} width={10} height={56} rx={2} fill="#111827" />
      {/* spring hangers that hold each rear axle under the frame */}
      {rear.map((wx) => (
        <g key={`h${wx}`}>
          <rect x={wx - 40} y={-104} width={14} height={30} rx={3} fill="#4b5563" stroke="#1f2937" strokeWidth="1.5" />
          <rect x={wx + 26} y={-104} width={14} height={30} rx={3} fill="#4b5563" stroke="#1f2937" strokeWidth="1.5" />
          <path d={`M ${wx - 36} -78 Q ${wx} -66 ${wx + 36} -78`} fill="none" stroke="#6b7280" strokeWidth="7" strokeLinecap="round" />
        </g>
      ))}
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
      {design?.aero && !heavy && (
        // aero side skirt over the tanks, in the cab colour
        <path d="M 150 -150 L 356 -150 L 356 -84 L 150 -84 Q 140 -84 140 -96 L 140 -138 Q 140 -150 150 -150 Z" fill={color} opacity="0.92" stroke="#0b1220" strokeWidth="1.5" />
      )}
      <Cab x={cabX} style={cab} ids={ids} color={color} aero={coupled && !heavy} extras={extras} design={design} />
      {plow && (
        // 1.2.5 „Първи сняг“: a snow plough blade on a push frame in front, and amber beacons on the roof
        <g>
          <rect x={590} y={-104} width={34} height={14} rx={3} fill="#1f2937" />
          <path d="M618 -150 L668 -168 Q686 -96 668 -24 L618 -36 Q630 -92 618 -150 Z" fill="#f59e0b" stroke="#78350f" strokeWidth="3" />
          <path d="M630 -146 L660 -157 M634 -112 L672 -118 M634 -76 L672 -74 M630 -42 L662 -34" stroke="#111827" strokeWidth="7" opacity="0.85" />
          <rect x={662} y={-30} width={12} height={10} rx={2} fill="#334155" />
          {(() => {
            const roof = cab === 'highline' ? -372 : cab === 'sleeper' ? -330 : -300;
            return (
              <>
                <rect x={cabX + 40} y={roof - 8} width={150} height={8} rx={3} fill="#64748b" />
                {[cabX + 52, cabX + 166].map((bx) => <rect key={bx} x={bx} y={roof - 24} width={22} height={16} rx={5} fill="#fbbf24" stroke="#b45309" strokeWidth="2" />)}
              </>
            );
          })()}
        </g>
      )}
      {classic && (
        // Old-school look: twin cream stripes along the cab, a round lamp and a chrome bumper
        <g>
          <rect x={cabX + 4} y={-197} width={cab === 'day' ? 192 : 232} height={9} fill="#fef3c7" opacity="0.9" />
          <rect x={cabX + 4} y={-183} width={cab === 'day' ? 192 : 232} height={5} fill="#fef3c7" opacity="0.9" />
          <circle cx={cabX + (cab === 'day' ? 194 : 234)} cy={-140} r={11} fill="#fef9c3" stroke="#78716c" strokeWidth="2" />
          <rect x={cabX + (cab === 'day' ? 176 : 216)} y={-116} width={30} height={12} rx={4} fill={`url(#${ids.chrome})`} stroke="#475569" />
        </g>
      )}
      {rear.map((wx) => (
        <g key={wx}>
          <Fender x={wx} color="#334155" />
          {/* the bracket that holds the mudguard to the frame */}
          <rect x={wx - 6} y={-122} width={12} height={14} rx={2} fill="#334155" />
          <Wheel x={wx} ids={ids} twin rim={extras?.premium ? 'gold' : RIMS[design?.brand ?? 'hemus']} />
        </g>
      ))}
      <Fender x={482} />
      <Wheel x={482} ids={ids} rim={extras?.premium ? 'gold' : RIMS[design?.brand ?? 'hemus']} />
    </g>
  );
}

/** Rigid truck with its own body. Rear at 0, front at ≈ 902. */
export function Rigid({ ids, color, body, extras, design }: { ids: Ids; color: string; body: 'box' | 'reefer' | 'tipper' | 'tanker'; extras?: Cosmetics; design?: CabDesign }) {
  const bodyEnd = 680;
  return (
    <g>
      <rect x={20} y={-124} width={860} height={22} rx={3} fill="#1f2937" />
      {body === 'tipper' ? (
        // 1.1.3.1: a dump body (sand, gravel) with its tipping ram behind the cab.
        <g>
          <path d="M 10 -330 L 660 -330 L 640 -150 L 40 -150 Z" fill="#ca8a04" stroke="#0b1220" strokeWidth="2" />
          {Array.from({ length: 6 }, (_, i) => {
            const x = 110 + i * 100;
            return <path key={i} d={`M ${x} -330 L ${x + 4} -150`} stroke="#000" strokeOpacity="0.28" strokeWidth="8" />;
          })}
          <rect x={10} y={-338} width={650} height={12} rx={3} fill="#1f2937" />
          <path d="M 10 -330 L 40 -150" stroke="#0b1220" strokeWidth="9" />
          <rect x={662} y={-300} width={20} height={150} rx={6} fill={`url(#${ids.metal})`} stroke="#475569" />
          <rect x={666} y={-250} width={12} height={110} fill="#94a3b8" />
          <text x={340} y={-230} textAnchor="middle" fontSize="40" fontWeight="800" fill="#1f2937" fillOpacity="0.55" fontFamily="system-ui, sans-serif" letterSpacing="6">TRANSVERSE</text>
        </g>
      ) : body === 'tanker' ? (
        // 1.1.3.1: a small tank for liquids, with the orange ADR plate.
        <g>
          <rect x={10} y={-340} width={650} height={196} rx={98} fill={`url(#${ids.metal})`} stroke="#475569" strokeWidth="2" />
          {[180, 340, 500].map((x) => (
            <rect key={x} x={x} y={-340} width={9} height={196} fill="#64748b" opacity="0.65" />
          ))}
          <rect x={40} y={-262} width={590} height={20} fill={color} opacity="0.85" />
          <rect x={160} y={-352} width={380} height={9} rx={3} fill="#9ca3af" />
          {Array.from({ length: 5 }, (_, i) => (
            <rect key={i} x={20} y={-330 + i * 34} width={26} height={5} rx={2} fill="#6b7280" />
          ))}
          <rect x={18} y={-338} width={5} height={186} fill="#6b7280" />
          <rect x={44} y={-338} width={5} height={186} fill="#6b7280" />
          {[260, 460].map((x) => (
            <g key={x}>
              <rect x={x} y={-146} width={12} height={18} fill="#475569" />
              <circle cx={x + 6} cy={-124} r={8} fill="#ef4444" />
            </g>
          ))}
          <rect x={590} y={-226} width={50} height={50} fill="#f97316" stroke="#fff" strokeWidth="3" />
          <text x={615} y={-194} textAnchor="middle" fontSize="19" fontWeight="800" fill="#111" fontFamily="system-ui, sans-serif">33</text>
        </g>
      ) : body === 'reefer' ? (
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
      <Cab x={bodyEnd + 12} style="day" ids={ids} color={color} extras={extras} design={design ? { ...design, stacks: false } : undefined} />
      <Fender x={200} />
      <Wheel x={200} ids={ids} twin rim={extras?.premium ? 'gold' : RIMS[design?.brand ?? 'hemus']} />
      <Fender x={778} />
      <Wheel x={778} ids={ids} rim={extras?.premium ? 'gold' : RIMS[design?.brand ?? 'hemus']} />
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

/** 1.1.3.1: a box van (7.2 t class): the van's cab and a separate, taller cargo box. Rear at 0, front at ≈ 760. */
export function BoxVan({ ids, color }: { ids: Ids; color: string }) {
  return (
    <g>
      {/* chassis rail and the box's cross members */}
      <rect x={10} y={-100} width={770} height={16} rx={3} fill="#1f2937" />
      {Array.from({ length: 9 }, (_, i) => (
        <rect key={`m${i}`} x={18 + i * 62} y={-104} width={10} height={10} fill="#374151" />
      ))}
      {/* cargo box: frame, ribbed panels, rear hinges */}
      <rect x={0} y={-344} width={560} height={240} rx={4} fill={`url(#${ids.white})`} stroke="#64748b" strokeWidth="2" />
      {Array.from({ length: 7 }, (_, i) => (
        <rect key={`r${i}`} x={76 + i * 68} y={-332} width={3} height={216} fill="#94a3b8" opacity="0.45" />
      ))}
      <rect x={0} y={-344} width={560} height={14} rx={3} fill="#94a3b8" />
      <rect x={0} y={-118} width={560} height={14} fill="#64748b" />
      <rect x={0} y={-344} width={16} height={240} rx={3} fill="#cbd5e1" stroke="#64748b" />
      <rect x={544} y={-344} width={16} height={240} rx={3} fill="#cbd5e1" stroke="#64748b" />
      {[-316, -232, -148].map((y) => (
        <rect key={`h${y}`} x={2} y={y} width={12} height={16} rx={2} fill="#475569" />
      ))}
      {/* company band */}
      <rect x={30} y={-276} width={500} height={70} rx={8} fill={color} />
      <text x={280} y={-232} textAnchor="middle" fontSize="40" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif" letterSpacing="5">TRANSVERSE</text>
      <text x={280} y={-186} textAnchor="middle" fontSize="15" fontWeight="700" fill="#475569" fontFamily="system-ui, sans-serif" letterSpacing="4">LOGISTICS · 7.2 t</text>
      {/* side marker lights along the bottom rail */}
      {[70, 200, 330, 460].map((x) => (
        <rect key={`l${x}`} x={x} y={-114} width={12} height={6} rx={2} fill="#f59e0b" />
      ))}
      {/* rear: tail lights and the underrun bar */}
      <rect x={-2} y={-138} width={10} height={20} rx={2} fill="#dc2626" />
      <rect x={-2} y={-160} width={10} height={18} rx={2} fill="#f59e0b" />
      <rect x={18} y={-96} width={8} height={30} fill="#374151" />
      <rect x={-6} y={-70} width={44} height={10} rx={3} fill="#1f2937" />
      {/* roof deflector up to the box */}
      <path d="M 566 -282 L 566 -334 Q 566 -344 578 -342 L 592 -340 Q 632 -324 662 -284 Z" fill={color} stroke="#0b1220" strokeWidth="2" />
      {/* cab */}
      <path
        d="M 572 -62 L 572 -270 Q 572 -284 588 -284 L 652 -284 Q 680 -284 694 -262 L 738 -184 Q 746 -170 764 -166 L 776 -162 Q 790 -158 790 -142 L 790 -76 Q 790 -62 776 -62 L 711 -62 A 54 54 0 0 0 609 -62 Z"
        fill={color}
        stroke="#0b1220"
        strokeWidth="2"
      />
      <path d="M 590 -280 L 652 -280" stroke="#fff" strokeOpacity="0.35" strokeWidth="4" strokeLinecap="round" />
      <path d="M 610 -266 L 660 -266 Q 676 -266 686 -250 L 722 -188 L 610 -188 Z" fill={`url(#${ids.glass})`} stroke="#0b1220" strokeWidth="2" />
      <path d="M 642 -266 L 642 -188" stroke="#0b1220" strokeWidth="3" />
      <path d="M 684 -248 L 734 -178 L 746 -172 L 694 -246 Z" fill={`url(#${ids.glass})`} />
      {/* door, handle and step */}
      <path d="M 600 -276 L 600 -70 M 730 -184 L 730 -104" stroke="#000" strokeOpacity="0.35" strokeWidth="2" />
      <rect x={600} y={-190} width={130} height={5} fill="#000" opacity="0.18" />
      <rect x={612} y={-170} width={26} height={7} rx={3} fill="#111827" />
      <rect x={574} y={-78} width={26} height={8} rx={2} fill="#374151" />
      {/* mirror */}
      <path d="M 718 -214 L 746 -224" stroke="#111827" strokeWidth="5" strokeLinecap="round" />
      <rect x={742} y={-254} width={12} height={50} rx={4} fill="#111827" />
      {/* front: grille, headlamp, indicator, bumper, fog light */}
      {Array.from({ length: 4 }, (_, i) => (
        <rect key={`g${i}`} x={776} y={-136 + i * 9} width={14} height={4} rx={2} fill="#0b1220" opacity="0.6" />
      ))}
      <path d="M 762 -164 L 784 -158 Q 790 -156 790 -150 L 790 -146 L 762 -150 Z" fill="#fffbe6" stroke="#9ca3af" />
      <rect x={754} y={-150} width={10} height={8} rx={2} fill="#f59e0b" />
      <ellipse cx={796} cy={-152} rx={14} ry={7} fill="#fff7c2" opacity="0.35" />
      <rect x={718} y={-100} width={76} height={36} rx={8} fill="#1f2937" />
      <rect x={722} y={-96} width={68} height={5} rx={2} fill="#4b5563" />
      <rect x={768} y={-86} width={18} height={10} rx={3} fill="#fde68a" stroke="#78716c" />
      <rect x={716} y={-66} width={78} height={6} rx={3} fill="#111827" />
      {/* fuel tank with straps, AdBlue, side guard, mudflap, exhaust */}
      <rect x={420} y={-124} width={110} height={34} rx={10} fill={`url(#${ids.metal})`} stroke="#475569" />
      <rect x={440} y={-124} width={5} height={34} fill="#475569" />
      <rect x={505} y={-124} width={5} height={34} fill="#475569" />
      <rect x={394} y={-120} width={20} height={28} rx={5} fill="#e5e7eb" stroke="#64748b" />
      <rect x={398} y={-115} width={12} height={5} fill="#2563eb" />
      <rect x={200} y={-76} width={350} height={6} rx={2} fill="#9ca3af" />
      <rect x={200} y={-58} width={350} height={6} rx={2} fill="#9ca3af" />
      <rect x={536} y={-94} width={26} height={6} rx={3} fill="#6b7280" />
      {/* rear mudguard on brackets under the box (behind the wheel), with its mudflap */}
      <rect x={96} y={-106} width={8} height={16} fill="#374151" />
      <rect x={176} y={-106} width={8} height={16} fill="#374151" />
      <Wheel x={140} r={42} ids={ids} twin />
      <path d="M 78 -38 L 78 -48 A 62 62 0 0 1 202 -48 L 202 -38 L 192 -38 L 192 -46 A 52 52 0 0 0 88 -46 L 88 -38 Z" fill="#1f2937" stroke="#64748b" strokeWidth="2" />
      <path d="M 92 -84 A 54 54 0 0 1 188 -84" fill="none" stroke="#fff" strokeOpacity="0.18" strokeWidth="3" />
      <rect x={72} y={-40} width={14} height={34} rx={2} fill="#111827" stroke="#475569" />
      <rect x={75} y={-30} width={8} height={4} fill="#94a3b8" />
      <Wheel x={660} r={42} ids={ids} />
      {/* front wheel arch liner and the mudflap behind the front wheel */}
      <path d="M 606 -62 A 57 57 0 0 1 714 -62" fill="none" stroke="#111827" strokeWidth="7" />
      <path d="M 612 -66 A 50 50 0 0 1 708 -66" fill="none" stroke="#fff" strokeOpacity="0.12" strokeWidth="2" />
      <rect x={590} y={-64} width={10} height={48} rx={2} fill="#111827" stroke="#475569" />
    </g>
  );
}
