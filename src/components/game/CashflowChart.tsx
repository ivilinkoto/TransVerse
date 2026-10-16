import { money } from '@/lib/format';

/** Daily income vs expenses, bars drawn to one shared scale. */
export function CashflowChart({ days }: { days: { day: string; income: number; expense: number }[] }) {
  if (!days.length) return <p className="text-sm text-mist-400">Още няма движения.</p>;
  const max = Math.max(1, ...days.flatMap((d) => [d.income, d.expense]));
  const W = 640;
  const H = 180;
  const pad = 28;
  const bw = Math.min(28, (W - pad) / days.length / 2.6);
  const step = (W - pad) / days.length;
  const y = (v: number) => H - 22 - (v / max) * (H - 40);
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-full min-w-[480px]" role="img" aria-label="Приходи и разходи по дни">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="#263347" strokeDasharray="3 4" />
            <text x={0} y={y(max * f) + 4} fontSize="10" fill="#8d9bb3">{f === 0 ? '0' : money(max * f).replace(/\s?€/, '')}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = pad + i * step + step / 2;
          return (
            <g key={d.day}>
              <title>{`${d.day}: +${money(d.income)} / −${money(d.expense)}`}</title>
              <rect x={x - bw - 1} y={y(d.income)} width={bw} height={Math.max(1, H - 22 - y(d.income))} rx={3} fill="#2fd27a" />
              <rect x={x + 1} y={y(d.expense)} width={bw} height={Math.max(1, H - 22 - y(d.expense))} rx={3} fill="#ff5a6a" opacity="0.85" />
              <text x={x} y={H - 6} fontSize="10" textAnchor="middle" fill="#8d9bb3">{d.day.slice(8)}.{d.day.slice(5, 7)}</text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex gap-4 text-xs text-mist-400"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-profit" />Приходи</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-loss" />Разходи</span></div>
    </div>
  );
}
