import Link from 'next/link';
import { and, count, eq, isNotNull } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { adContracts, deliveryExtras, laneRepeats, officeStaff, research } from '@/server/db/schema';
import type { FeatureId } from '@/lib/game/features';
import { FOG, foggyAreas } from '@/lib/game/fog';
import { INTERVIEW_ANSWERS, INTERVIEW_OCCASIONS, type InterviewAnswer, type InterviewOccasion } from '@/lib/game/interviews';
import { ActionButton } from '@/components/ui/ActionButton';
import { caseOf } from '@/server/game/lost-cargo';
import { openInterview } from '@/server/game/interviews';
import { t, tx } from '@/i18n/t';

/** „Знаеше ли, че…“: features the player has not tried yet (one a day). */
const TIPS: { feature: FeatureId; text: string; href: string; unused: (db: DbOrTx, userId: string, companyId: string) => Promise<boolean> }[] = [
  { feature: 'load_promise', text: 'Обещай „⚡ Бързо“ на клиента — +15% при удържан срок.', href: '/game/contracts', unused: async (db, userId) => !(await db.select({ n: count() }).from(deliveryExtras).where(and(eq(deliveryExtras.userId, userId), isNotNull(deliveryExtras.promise))))[0]?.n },
  { feature: 'loading_puzzle', text: 'Подреди ремаркето в първите 15 минути на курса — до +8% от плащането.', href: '/game/fleet', unused: async (db, userId) => !(await db.select({ n: count() }).from(deliveryExtras).where(and(eq(deliveryExtras.userId, userId), isNotNull(deliveryExtras.puzzle))))[0]?.n },
  { feature: 'research', text: 'Развойна дейност: аеродинамичният пакет връща част от горивото на всеки курс.', href: '/game/growth', unused: async (db, _u, companyId) => !(await db.select({ n: count() }).from(research).where(eq(research.companyId, companyId)))[0]?.n },
  { feature: 'office', text: 'Назначи търговец в офиса — +2% към всяко плащане на ниво.', href: '/game/growth', unused: async (db, _u, companyId) => !(await db.select({ n: count() }).from(officeStaff).where(eq(officeStaff.companyId, companyId)))[0]?.n },
  { feature: 'trailer_ads', text: 'Марки плащат за реклама по ремаркетата ти — виж офертите за седмицата.', href: '/game/growth', unused: async (db, _u, companyId) => !(await db.select({ n: count() }).from(adContracts).where(eq(adContracts.companyId, companyId)))[0]?.n },
  { feature: 'lane_repeat', text: '„🔁 Повтаряй линията“ кара камиона сам напред-назад по любимата ти линия.', href: '/game/fleet', unused: async (db, _u, companyId) => !(await db.select({ n: count() }).from(laneRepeats).where(eq(laneRepeats.companyId, companyId)))[0]?.n },
];

/** 1.1.4.2 on the dashboard: the press, the lost pallet, the fog and a tip. */
export async function Dashboard1142({ db, userId, companyId, now, features }: { db: DbOrTx; userId: string; companyId: string; now: Date; features: Record<FeatureId, boolean> }) {
  const [interview, lost] = await Promise.all([features.interviews ? openInterview(db, userId) : null, features.lost_cargo ? caseOf(db, userId) : null]);
  const fog = features.fog ? foggyAreas(now) : [];
  let tip: (typeof TIPS)[number] | null = null;
  if (features.did_you_know) {
    const day = Math.floor(now.getTime() / 86_400_000);
    const order = TIPS.map((_, i) => TIPS[(i + day) % TIPS.length]!).filter((x) => features[x.feature]);
    for (const x of order) if (await x.unused(db, userId, companyId)) {
      tip = x;
      break;
    }
  }
  return (
    <>
      {interview && (
        <section className="panel border-violet-400/40 p-4">
          <p className="font-display font-bold">{t('🎤 Пресата иска интервю')}</p>
          <p className="text-sm text-mist-300">{t('Повод: {0}. Какво ще кажеш? Отговорът важи цяла седмица.', tx(INTERVIEW_OCCASIONS[interview.occasion as InterviewOccasion] ?? interview.occasion))}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {(Object.keys(INTERVIEW_ANSWERS) as InterviewAnswer[]).map((a) => (
              <ActionButton key={a} action={{ type: 'answerInterview', id: interview.id, answer: a }} className="btn-ghost flex-col items-start px-3 py-2 text-left text-xs">
                <span className="font-semibold">{tx(INTERVIEW_ANSWERS[a].label)} {tx(INTERVIEW_ANSWERS[a].quote)}</span>
                <span className="text-mist-400">{tx(INTERVIEW_ANSWERS[a].effect)}</span>
              </ActionButton>
            ))}
          </div>
        </section>
      )}
      {lost && !lost.closed && (
        <Link href="/game/case" className="panel flex items-center gap-3 border-amber-400/40 p-3.5 transition hover:border-amber-400/80">
          <span className="text-3xl" aria-hidden="true">🔍</span>
          <span className="min-w-0 flex-1 text-sm"><span className="block font-semibold">{t('Липсва палет: {0}', tx(lost.goods))}</span><span className="text-mist-300">{t('Разгледай уликите и посочи виновника.')}</span></span>
          <span className="btn-primary px-3 py-1.5 text-xs">{t('Към случая')}</span>
        </Link>
      )}
      {fog.length > 0 && (
        <Link href="/game/contracts" className="panel flex items-center gap-3 border-slate-400/40 p-3.5 transition hover:border-slate-300/70">
          <span className="text-3xl" aria-hidden="true">🌫</span>
          <span className="min-w-0 flex-1 text-sm"><span className="block font-semibold">{t('Мъгла днес: {0}', fog.map((a) => tx(a.label)).join(', '))}</span><span className="text-mist-300">{t('Товари от и до мъгливите места: +{0}%. {1} такива курса през ноември — значка „Пилот в мъглата“.', Math.round(FOG.payShare * 100), FOG.missionTrips)}</span></span>
          <span className="btn-primary px-3 py-1.5 text-xs">{t('Товари')}</span>
        </Link>
      )}
      {tip && (
        <Link href={tip.href} className="panel flex items-center gap-3 p-3 text-sm transition hover:border-asphalt-500">
          <span aria-hidden="true">💡</span>
          <span className="min-w-0 flex-1"><span className="font-semibold">{t('Знаеше ли, че…')}</span> <span className="text-mist-300">{tx(tip.text)}</span></span>
        </Link>
      )}
    </>
  );
}
