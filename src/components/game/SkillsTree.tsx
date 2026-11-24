import { ActionButton } from '@/components/ui/ActionButton';
import { BRANCHES, SKILL_IDS, SKILL_RULES, SKILLS, type Branch } from '@/lib/game/skills';
import { money } from '@/lib/format';
import type { skillsView } from '@/server/game/skills';
import { t, tx } from '@/i18n/t';

const pct = (share: number) => Math.round(share * 1000) / 10;

/** 1.3 „Умения на шофьора“: the player's own points and the three branches (the Skills page and, 1.3.3, the player's driver window). */
export function SkillsTree({ v }: { v: Awaited<ReturnType<typeof skillsView>> }) {
  return (
    <div className="space-y-4">
      <section className="skill-bar flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4" data-testid="skills-points">
          <div>
            <p className="font-display text-2xl font-bold text-white">{t('{0} свободни точки', v.free)}</p>
            <p className="text-xs text-mist-400">{t('Похарчени {0} от {1} · нова точка с всяко ниво', v.spent, v.points)}</p>
          </div>
          {v.spent > 0 && (
            <ActionButton action={{ type: 'resetSkills' }} confirm={v.resetCents ? t('Върни всички точки за {0}?', money(v.resetCents)) : t('Върни всички точки? Първият път е безплатно.')} className="game-action flex-row px-4 py-2 text-xs">
              ↺ {v.resetCents ? t('Отначало ({0})', money(v.resetCents)) : t('Отначало (безплатно)')}
            </ActionButton>
          )}
        </section>
        <div className="grid gap-4 lg:grid-cols-3">
          {(Object.keys(BRANCHES) as Branch[]).map((b) => (
            <section key={b} className="skill-branch space-y-3 rounded-3xl p-4" style={{ '--tile': BRANCHES[b].colour } as React.CSSProperties} data-testid={`skills-${b}`}>
              <h2 className="font-display text-lg font-bold text-white">{BRANCHES[b].emoji} {tx(BRANCHES[b].label)}</h2>
              <ul className="space-y-2">
                {SKILL_IDS.filter((id) => SKILLS[id].branch === b).map((id) => {
                  const s = SKILLS[id];
                  const rank = v.ranks[id] ?? 0;
                  const max = rank >= SKILL_RULES.maxRank;
                  return (
                    <li key={id} className={`skill-card rounded-2xl p-3 ${rank > 0 ? 'skill-card-on' : ''}`}>
                      <div className="flex items-start gap-3">
                        <span className="skill-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl" aria-hidden>{s.emoji}</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-white">{tx(s.label)}</p>
                          <p className="text-xs text-mist-300">{rank > 0 ? t('Сега: {0}', tx(s.effect).replace('{0}', String(pct(s.perRank * rank)))) : tx(s.effect).replace('{0}', String(pct(s.perRank)))}</p>
                          <div className="mt-1.5 flex gap-1" aria-label={t('Ниво {0} от {1}', rank, SKILL_RULES.maxRank)}>
                            {Array.from({ length: SKILL_RULES.maxRank }, (_, i) => <span key={i} className={`skill-pip h-2 w-6 rounded-full ${i < rank ? 'skill-pip-on' : ''}`} />)}
                          </div>
                        </div>
                      </div>
                      {!max && (
                        <div className="mt-2 flex justify-end">
                          <ActionButton action={{ type: 'learnSkill', skill: id }} disabled={v.free <= 0} className="game-action game-action-main flex-row px-4 py-1.5 text-xs">
                            {rank === 0 ? t('Научи') : t('Ниво {0} → {1}', rank, rank + 1)}
                          </ActionButton>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
    </div>
  );
}
