import { Medal } from 'lucide-react';
import { Card } from '@/components/ui';
import { date } from '@/lib/format';
import { COMPANY_ACHIEVEMENTS, COMPANY_ACHIEVEMENT_TIER_ICON, MEDAL_INFO, MEDALS, medalCounts, type Medal as MedalKind } from '@/lib/game/medals';
import type { companyAchievementsOf } from '@/server/game/medals';
import { t, tx } from '@/i18n/t';

/** Season medals and company achievements as badges on the company's public page (1.1.3.1). */
export function CompanyMedals({ medals, achievements }: { medals: { seasonId: number; name: string; rank: number | null; medal: MedalKind }[] | null; achievements: Awaited<ReturnType<typeof companyAchievementsOf>> | null }) {
  const counts = medalCounts((medals ?? []).map((m) => m.medal));
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Medal className="h-4 w-4 text-gold-400" />{t('Медали и постижения')}</span>} actions={achievements && <span className="text-xs text-mist-400">{t('{0} от {1} постижения', achievements.length, COMPANY_ACHIEVEMENTS.length)}</span>}>
      {medals && (
        <div className="mb-3">
          {medals.length ? (
            <>
              <div className="flex flex-wrap gap-3 text-sm">
                {MEDALS.filter((m) => counts[m] > 0).map((m) => <span key={m} className="num font-semibold" title={tx(MEDAL_INFO[m].label)}>{MEDAL_INFO[m].icon} × {counts[m]}</span>)}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {medals.map((m) => <span key={m.seasonId} className="rounded-full border border-gold-400/40 bg-gold-400/10 px-2 py-0.5 text-xs text-gold-200">{MEDAL_INFO[m.medal].icon} {tx(m.name)} · {t('{0}. място', m.rank ?? 0)}</span>)}
              </div>
            </>
          ) : (
            <p className="text-sm text-mist-400">{t('Още няма медали. Първите три компании в сезона печелят злато, сребро и бронз.')}</p>
          )}
        </div>
      )}
      {achievements && (
        <div className="flex flex-wrap gap-1.5">
          {COMPANY_ACHIEVEMENTS.map((a) => {
            const got = achievements.find((x) => x.key === a.key);
            return (
              <span key={a.key} title={`${tx(a.description)}${got ? ` · ${date(got.unlockedAt)}` : ''}`} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${got ? 'border-prestige/50 bg-prestige/10 text-prestige' : 'border-asphalt-700 text-mist-500 opacity-60'}`}>
                <span>{got ? a.icon : '🔒'}</span>{tx(a.title)} <span className="opacity-70">{COMPANY_ACHIEVEMENT_TIER_ICON[a.tier]}</span>
              </span>
            );
          })}
        </div>
      )}
    </Card>
  );
}
