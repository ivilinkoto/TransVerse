import { Award, HardHat, Swords, Trophy } from 'lucide-react';
import { money } from '@/lib/format';
import { BADGES } from '@/lib/game/halloween';
import { BUILD_BADGES, BUILDER_WEEK } from '@/lib/game/plot';

export interface ShowcaseData {
  battles: number;
  projects: number;
  builders: number;
  levels: number;
  badges: Record<string, number>;
  latestBuilder: { weekKey: string; tons: number; rewardCents: number; username: string | null } | null;
}

/** The trophy case of the company (shown by the office) and the latest "Строител на седмицата". */
export function Showcase({ data, trophies = true, builderWeek = true }: { data: ShowcaseData; trophies?: boolean; builderWeek?: boolean }) {
  const b = data.latestBuilder;
  return (
    <div className="panel p-4 text-sm">
      {trophies && (
        <>
          <h3 className="flex items-center gap-2 font-display text-lg font-bold"><Trophy className="h-5 w-5 text-gold-400" />Витрина</h3>
          <ul className="mt-2 grid grid-cols-2 gap-2">
            <li className="rounded-xl border border-asphalt-700 p-2"><Swords className="mb-1 h-4 w-4 text-gold-400" /><b className="num block text-lg">{data.battles}</b><span className="text-xs text-mist-400">спечелени битки</span></li>
            <li className="rounded-xl border border-asphalt-700 p-2"><Award className="mb-1 h-4 w-4 text-cyan-glow" /><b className="num block text-lg">{data.projects}</b><span className="text-xs text-mist-400">завършени проекта</span></li>
            <li className="rounded-xl border border-asphalt-700 p-2"><HardHat className="mb-1 h-4 w-4 text-amber-sig" /><b className="num block text-lg">{data.builders}</b><span className="text-xs text-mist-400">строители на седмицата</span></li>
            <li className="rounded-xl border border-asphalt-700 p-2"><Trophy className="mb-1 h-4 w-4 text-profit" /><b className="num block text-lg">{data.levels}</b><span className="text-xs text-mist-400">нива на сградите</span></li>
          </ul>
          {Object.values(BUILD_BADGES).some((id) => data.badges[id]) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.values(BUILD_BADGES).filter((id) => data.badges[id]).map((id) => (
                <span key={id} className="rounded-full border border-gold-400/40 bg-gold-400/10 px-2 py-0.5 text-xs text-gold-200" title={BADGES[id]?.description}>{BADGES[id]?.label} · {data.badges[id]}</span>
              ))}
            </div>
          )}
        </>
      )}
      {builderWeek && (
        <p className={`${trophies ? 'mt-3 border-t border-asphalt-800 pt-3' : ''} flex items-start gap-2 text-xs text-mist-300`}>
          <HardHat className="mt-0.5 h-4 w-4 shrink-0 text-amber-sig" />
          {b?.username ? <span><b className="text-white">Строител на седмицата: {b.username}</b> · {Math.round(b.tons * 10) / 10} т материали{b.rewardCents ? ` · награда ${money(b.rewardCents)}` : ''}</span> : <span>Който докара най-много материали за седмицата, става „Строител на седмицата“ — с награда {money(BUILDER_WEEK.rewardCents)} от касата.</span>}
        </p>
      )}
    </div>
  );
}
