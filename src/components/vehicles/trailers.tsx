import type { BodyType } from '@/lib/game/cargo';
import { Wheel, type Ids } from './parts';

/** Semi-trailers, rear at x = 0, nose at x = 1360, kingpin at x = 1200. */
export type TrailerBody = Exclude<BodyType, 'box'>;

const AXLES = [150, 282, 414];

function Running({ ids, axles = AXLES, r = 48, deck = -128 }: { ids: Ids; axles?: number[]; r?: number; deck?: number }) {
  return (
    <g>
      {/* landing gear */}
      <rect x={1060} y={deck} width={16} height={-deck - 24} fill="#374151" />
      <rect x={1048} y={-26} width={40} height={10} rx={2} fill="#1f2937" />
      <rect x={1080} y={deck + 30} width={10} height={20} rx={2} fill="#6b7280" />
      {/* side underrun protection */}
      <rect x={480} y={-98} width={560} height={7} rx={2} fill="#9ca3af" />
      <rect x={480} y={-72} width={560} height={7} rx={2} fill="#9ca3af" />
      {[520, 700, 880].map((x) => (
        <rect key={x} x={x} y={-104} width={6} height={40} fill="#6b7280" />
      ))}
      {/* rear bumper, lights, mud flap */}
      <rect x={0} y={-80} width={18} height={18} rx={2} fill="#374151" />
      <rect x={0} y={-134} width={10} height={20} rx={2} fill="#dc2626" />
      <rect x={axles[0]! - r - 22} y={-r - 6} width={8} height={r + 2} fill="#111827" />
      {axles.map((x) => (
        <g key={x}>
          <rect x={x - r - 6} y={-r * 2 - 10} width={r * 2 + 12} height={10} rx={3} fill="#111827" />
          <Wheel x={x} r={r} ids={ids} />
        </g>
      ))}
      {/* side markers */}
      {[220, 560, 900, 1240].map((x) => (
        <rect key={x} x={x} y={-142} width={10} height={6} rx={2} fill="#f59e0b" />
      ))}
    </g>
  );
}

function Chassis({ to = 1360 }: { to?: number }) {
  return <rect x={0} y={-140} width={to} height={14} rx={2} fill="#1f2937" />;
}

export function Trailer({ body, ids, color }: { body: TrailerBody; ids: Ids; color: string }) {
  switch (body) {
    case 'curtain':
      return (
        <g>
          <Chassis />
          <rect x={0} y={-400} width={1360} height={262} rx={4} fill={color} />
          {Array.from({ length: 45 }, (_, i) => (
            <rect key={i} x={14 + i * 30} y={-384} width={9} height={232} fill="#000" opacity={i % 2 ? 0.07 : 0.12} />
          ))}
          <rect x={0} y={-400} width={1360} height={16} fill="#334155" />
          <rect x={0} y={-152} width={1360} height={14} fill="#334155" />
          {Array.from({ length: 13 }, (_, i) => (
            <g key={i}>
              <rect x={60 + i * 100} y={-384} width={5} height={232} fill="#0f172a" opacity="0.55" />
              <rect x={56 + i * 100} y={-170} width={13} height={18} rx={2} fill="#cbd5e1" />
            </g>
          ))}
          <text x={680} y={-250} textAnchor="middle" fontSize="92" fontWeight="900" fill="#fff" fillOpacity="0.92" fontFamily="system-ui, sans-serif" letterSpacing="14">TRANSVERSE</text>
          <text x={680} y={-196} textAnchor="middle" fontSize="30" fontWeight="600" fill="#fff" fillOpacity="0.7" fontFamily="system-ui, sans-serif" letterSpacing="8">INTERNATIONAL LOGISTICS</text>
          <Running ids={ids} />
        </g>
      );
    case 'reefer':
      return (
        <g>
          <Chassis />
          <rect x={0} y={-404} width={1360} height={266} rx={10} fill={`url(#${ids.white})`} stroke="#94a3b8" strokeWidth="2" />
          {Array.from({ length: 19 }, (_, i) => (
            <rect key={i} x={40 + i * 70} y={-398} width={2} height={254} fill="#94a3b8" opacity="0.55" />
          ))}
          <rect x={0} y={-226} width={1360} height={10} fill={color} />
          <rect x={0} y={-212} width={1360} height={4} fill={color} opacity="0.6" />
          {/* refrigeration unit on the nose */}
          <rect x={1352} y={-392} width={40} height={150} rx={8} fill="#e2e8f0" stroke="#64748b" strokeWidth="2" />
          {Array.from({ length: 8 }, (_, i) => (
            <rect key={i} x={1360} y={-380 + i * 15} width={26} height={5} rx={2} fill="#475569" />
          ))}
          <rect x={980} y={-126} width={110} height={44} rx={8} fill={`url(#${ids.metal})`} stroke="#475569" />
          <text x={640} y={-282} textAnchor="middle" fontSize="70" fontWeight="900" fill={color} fontFamily="system-ui, sans-serif" letterSpacing="10">TRANSVERSE</text>
          <text x={640} y={-240} textAnchor="middle" fontSize="28" fontWeight="700" fill="#64748b" fontFamily="system-ui, sans-serif" letterSpacing="8">TEMPERATURE CONTROLLED  −25°C … +25°C</text>
          <Running ids={ids} />
        </g>
      );
    case 'tanker':
      return (
        <g>
          <Chassis />
          {[120, 520, 980].map((x) => (
            <path key={x} d={`M ${x} -140 L ${x + 30} -168 L ${x + 90} -168 L ${x + 120} -140 Z`} fill="#374151" />
          ))}
          <rect x={30} y={-384} width={1290} height={226} rx={113} fill={`url(#${ids.metal})`} stroke="#475569" strokeWidth="2" />
          {[300, 560, 820, 1080].map((x) => (
            <rect key={x} x={x} y={-384} width={10} height={226} fill="#64748b" opacity="0.65" />
          ))}
          <rect x={60} y={-300} width={1230} height={22} fill={color} opacity="0.85" />
          {/* walkway and handrail */}
          <rect x={260} y={-396} width={860} height={10} rx={3} fill="#9ca3af" />
          {[280, 480, 680, 880, 1080].map((x) => (
            <rect key={x} x={x} y={-430} width={5} height={36} fill="#9ca3af" />
          ))}
          <rect x={276} y={-432} width={812} height={5} rx={2} fill="#9ca3af" />
          {/* rear ladder and valves */}
          {Array.from({ length: 7 }, (_, i) => (
            <rect key={i} x={36} y={-372 + i * 30} width={30} height={5} rx={2} fill="#6b7280" />
          ))}
          <rect x={34} y={-380} width={5} height={220} fill="#6b7280" />
          <rect x={64} y={-380} width={5} height={220} fill="#6b7280" />
          {[420, 680, 940].map((x) => (
            <g key={x}>
              <rect x={x} y={-158} width={14} height={22} fill="#475569" />
              <circle cx={x + 7} cy={-130} r={9} fill="#ef4444" />
            </g>
          ))}
          <rect x={1220} y={-250} width={60} height={60} fill="#f97316" stroke="#fff" strokeWidth="3" />
          <text x={1250} y={-212} textAnchor="middle" fontSize="22" fontWeight="800" fill="#111" fontFamily="system-ui, sans-serif">33</text>
          <Running ids={ids} />
        </g>
      );
    case 'tipper':
      return (
        <g>
          <Chassis />
          <path d="M 20 -392 L 1326 -392 L 1300 -150 L 70 -150 Z" fill={color} stroke="#0b1220" strokeWidth="2" />
          {Array.from({ length: 12 }, (_, i) => {
            const x = 120 + i * 100;
            return <path key={i} d={`M ${x} -392 L ${x + 6} -150`} stroke="#000" strokeOpacity="0.28" strokeWidth="9" />;
          })}
          <rect x={20} y={-400} width={1306} height={14} rx={3} fill="#1f2937" />
          <rect x={1296} y={-420} width={34} height={34} rx={17} fill="#374151" />
          <path d="M 20 -392 L 70 -150" stroke="#0b1220" strokeWidth="10" />
          <rect x={1260} y={-180} width={40} height={50} fill="#4b5563" />
          <Running ids={ids} />
        </g>
      );
    case 'container':
      return (
        <g>
          {/* skeletal chassis */}
          <rect x={0} y={-140} width={1360} height={16} rx={2} fill="#1f2937" />
          {[40, 300, 600, 900, 1200].map((x) => (
            <rect key={x} x={x} y={-150} width={16} height={12} fill="#111827" />
          ))}
          <g>
            <rect x={60} y={-400} width={1219} height={259} fill={color} />
            <rect x={60} y={-400} width={1219} height={259} fill={`url(#${ids.corrugation})`} />
            <rect x={60} y={-400} width={1219} height={12} fill="#000" opacity="0.25" />
            <rect x={60} y={-153} width={1219} height={12} fill="#000" opacity="0.3" />
            {[60, 1259].map((x) => (
              <g key={x}>
                <rect x={x} y={-400} width={20} height={259} fill="#000" opacity="0.18" />
                <rect x={x} y={-400} width={20} height={16} fill="#111827" />
                <rect x={x} y={-157} width={20} height={16} fill="#111827" />
              </g>
            ))}
            <text x={668} y={-290} textAnchor="middle" fontSize="76" fontWeight="900" fill="#fff" fillOpacity="0.92" fontFamily="system-ui, sans-serif" letterSpacing="10">TRANSVERSE</text>
            <text x={1240} y={-370} textAnchor="end" fontSize="24" fontWeight="700" fill="#fff" fillOpacity="0.85" fontFamily="ui-monospace, monospace">TVSU 402871 5  45G1</text>
          </g>
          <Running ids={ids} />
        </g>
      );
    case 'lowbed':
      return (
        <g>
          {/* gooseneck */}
          <path d="M 1360 -178 L 1080 -178 L 1030 -112 L 470 -112 L 470 -86 L 1040 -86 L 1094 -150 L 1360 -150 Z" fill={color} stroke="#0b1220" strokeWidth="2" />
          <rect x={0} y={-130} width={480} height={30} rx={3} fill={color} stroke="#0b1220" strokeWidth="2" />
          {Array.from({ length: 10 }, (_, i) => (
            <rect key={i} x={500 + i * 52} y={-112} width={4} height={26} fill="#000" opacity="0.3" />
          ))}
          {/* load: tracked excavator, chained down */}
          <g>
            <rect x={560} y={-150} width={400} height={38} rx={19} fill="#1f2937" />
            {[590, 650, 710, 770, 830, 890, 930].map((x) => (
              <circle key={x} cx={x} cy={-131} r={13} fill="#4b5563" stroke="#111827" />
            ))}
            <rect x={600} y={-196} width={330} height={46} rx={6} fill="#f59e0b" stroke="#78350f" strokeWidth="2" />
            <path d="M 760 -196 L 760 -300 Q 760 -312 772 -312 L 860 -312 Q 878 -312 884 -294 L 900 -196 Z" fill="#f59e0b" stroke="#78350f" strokeWidth="2" />
            <path d="M 776 -298 L 860 -298 L 876 -246 L 776 -246 Z" fill={`url(#${ids.glass})`} />
            <path d="M 700 -210 L 520 -330 L 460 -260 L 470 -150" fill="none" stroke="#f59e0b" strokeWidth="26" strokeLinejoin="round" />
            <path d="M 470 -150 L 440 -150 L 450 -120 L 500 -120 Z" fill="#78350f" />
            <path d="M 560 -112 L 600 -170 M 960 -112 L 920 -170" stroke="#9ca3af" strokeWidth="5" />
          </g>
          <rect x={0} y={-118} width={10} height={16} fill="#dc2626" />
          {[70, 160, 250, 340].map((x) => (
            <g key={x}>
              <rect x={x - 42} y={-96} width={84} height={8} rx={3} fill="#111827" />
              <Wheel x={x} r={38} ids={ids} />
            </g>
          ))}
          <rect x={1100} y={-150} width={14} height={118} fill="#374151" />
          <rect x={1088} y={-34} width={38} height={10} rx={2} fill="#1f2937" />
        </g>
      );
  }
}
