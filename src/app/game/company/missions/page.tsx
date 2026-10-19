import { CheckCircle2, Landmark, Target } from 'lucide-react';
import { redirect } from 'next/navigation';
import { Card, Meter } from '@/components/ui';
import { dateTime, duration, int, money } from '@/lib/format';
import { companyMissionById } from '@/lib/game/company-missions';
import { companyMissionBoard } from '@/server/game/company-missions';
import { gameContext } from '@/server/game/context';
import { companyHub } from '@/server/game/membership';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { ProjectCard } from '@/components/company/ProjectCard';
import { BattleCard } from '@/components/company/BattleCard';
import { battleRecord, currentBattle } from '@/server/game/battles';
import type { CargoType } from '@/lib/game/cargo';
import { periodWindow } from '@/lib/game/missions';
import { cities, companyProjects, users } from '@/server/db/schema';
import { canOfferJobs } from '@/server/game/hire';
import { activeProject, projectChoices } from '@/server/game/projects';

export const metadata = { title: 'Мисии на компанията' };

export default async function CompanyMissionsPage() {
  const { db, user, now } = await gameContext();
  const hub = await companyHub(db, user.id);
  if (!hub) redirect('/game/company');
  const board = await companyMissionBoard(db, hub.company.id, now);
  // The company project: the running one, or this week's choice.
  const [project, choices, canStart, lastProject] = await Promise.all([activeProject(db, hub.company.id), projectChoices(db, hub.company.id, now), canOfferJobs(db, user.id), db.select({ startsAt: companyProjects.startsAt }).from(companyProjects).where(eq(companyProjects.organizationId, hub.company.id)).orderBy(desc(companyProjects.startsAt)).limit(1)]);
  const cityIds = project ? [project.destCityId] : [];
  const cityRows = await db.select({ id: cities.id, name: cities.name, country: cities.countryCode, nameBg: cities.nameBg }).from(cities).where(or(inArray(cities.id, cityIds.length ? cityIds : [-1]), ...choices.map((c) => and(eq(cities.name, c.city), eq(cities.countryCode, c.country)))));
  const helperNames = project ? await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, Object.keys(project.contributions).length ? Object.keys(project.contributions) : ['00000000-0000-0000-0000-000000000000'])) : [];
  const startedThisWeek = !project && !!lastProject[0] && periodWindow('weekly', lastProject[0].startsAt).key === periodWindow('weekly', now).key;
  const [battle, record] = await Promise.all([currentBattle(db, hub.company.id, now), battleRecord(db, hub.company.id)]);
  const amount = (metric: string | undefined, v: number) => (metric === 'earned_cents' ? money(v) : int(Math.floor(v)));
  return (
    <div className="space-y-5">
      <BattleCard now={now} battle={battle} record={record} companyName={hub.company.name} />
      <ProjectCard
        now={now}
        canStart={canStart}
        startedThisWeek={startedThisWeek}
        choices={choices.map((c) => ({ id: c.id, title: c.title, goods: c.goods, cargo: c.cargo, target: c.target, reward: c.reward, cityBg: cityRows.find((r) => r.name === c.city && r.country === c.country)?.nameBg ?? c.city }))}
        running={project && { title: project.title, cargo: project.cargoType as CargoType, city: cityRows.find((r) => r.id === project.destCityId)?.nameBg ?? '', progress: project.progressTons, target: project.targetTons, rewardCents: project.rewardCents, rewardXp: project.rewardXp, endsAt: project.endsAt, helpers: Object.entries(project.contributions).sort((a, b) => b[1] - a[1]).map(([id, tons]) => ({ username: helperNames.find((h) => h.id === id)?.username ?? '—', tons })) }}
      />
      <Card
        title={<span className="inline-flex items-center gap-2"><Target className="h-4 w-4 text-cyan-glow" />Седмични мисии на компанията</span>}
        actions={<span className="text-xs text-mist-400">Нови след {duration((board.window.endsAt.getTime() - now.getTime()) / 60_000)} · {dateTime(board.window.endsAt)}</span>}
      >
        <p className="mb-4 text-sm text-mist-400">Цели за всички членове заедно. Всяка доставка на член се брои автоматично. Наградата отива директно в касата на компанията, заедно с фирмен опит. Целите растат с броя на членовете.</p>
        <ul className="grid gap-3 lg:grid-cols-3">
          {board.missions.map((m) => {
            const def = companyMissionById(m.missionId);
            const share = m.target ? (m.progress / m.target) * 100 : 0;
            return (
              <li key={m.missionId} className={`rounded-xl border p-4 ${m.completedAt ? 'border-profit/50 bg-profit/5' : 'border-asphalt-700'}`}>
                <div className="flex items-start gap-2 font-semibold">
                  {m.completedAt ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-profit" /> : <Target className="mt-0.5 h-4 w-4 shrink-0 text-cyan-glow" />}
                  <span>{def ? def.title(m.target) : m.missionId}</span>
                </div>
                <div className="mt-2 flex gap-3 text-xs">
                  <span className="num inline-flex items-center gap-1 text-gold-400"><Landmark className="h-3.5 w-3.5" />{money(m.rewardCents)} в касата</span>
                  <span className="num text-prestige">+{int(m.rewardXp)} фирмен опит</span>
                </div>
                <div className="mt-3 flex justify-between text-xs text-mist-400">
                  <span className="num">{amount(def?.metric, m.progress)} / {amount(def?.metric, m.target)}</span>
                  <span className="num">{Math.floor(Math.min(100, share))}%</span>
                </div>
                <Meter value={share} tone={m.completedAt ? 'auto' : 'cyan'} className="mt-1" />
                {m.completedAt && <p className="mt-2 text-xs text-profit">Изпълнена · {dateTime(m.completedAt)} · наградата е в касата</p>}
                {m.contributors.length > 0 && (
                  <div className="mt-3 border-t border-asphalt-800 pt-2">
                    <div className="label mb-1">Принос</div>
                    <ul className="space-y-0.5 text-xs">
                      {m.contributors.slice(0, 5).map((c) => (
                        <li key={c.username} className="flex justify-between"><span className="truncate">{c.username}</span><span className="num text-mist-300">{def?.metric === 'active_members' ? `${int(c.amount)} дост.` : amount(def?.metric, c.amount)}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
      {board.history.length > 0 && (
        <Card title="Предишни седмици">
          <ul className="divide-y divide-asphalt-800 text-sm">
            {board.history.map((h) => (
              <li key={h.periodKey} className="flex justify-between py-2">
                <span>Седмица {h.periodKey.slice(1).replace('-', ' / ')}</span>
                <span className="num text-mist-300">{h.done} от {h.total} изпълнени · <span className="text-gold-400">{money(h.earned)}</span></span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
