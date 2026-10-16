import { redirect } from 'next/navigation';
import { RankForm } from '@/components/company/forms';
import { Badge, Card } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { ALL_PERMISSIONS, COMPANY_UNLOCKS, maxRanks, PERMISSIONS } from '@/lib/game/company';
import { gameContext } from '@/server/game/context';
import { can, companyHub, companyRanksView } from '@/server/game/membership';

export const metadata = { title: 'Длъжности' };

export default async function RanksPage() {
  const { db, user } = await gameContext();
  const hub = await companyHub(db, user.id);
  if (!hub) redirect('/game/company');
  const ranks = await companyRanksView(db, hub.company.id);
  const manage = can(hub.rank, 'manage_ranks');
  const limit = maxRanks(hub.company.companyLevel);
  const permissions = ALL_PERMISSIONS.map((key) => ({ key, label: PERMISSIONS[key] }));
  const grantable = hub.rank.isOwner ? [...ALL_PERMISSIONS] : hub.rank.permissions;
  const nextPriority = Math.min(999, Math.max(hub.rank.priority, ...ranks.map((r) => r.priority)) + 10);
  return (
    <div className="space-y-6">
      <p className="text-sm text-mist-400">
        Длъжностите се подреждат по старшинство — по-малкото число е по-висока длъжност. Всеки управлява само длъжностите под своята и може да дава само права, които има. Длъжности: {ranks.length} / {limit}
        {limit < 10 && ` · повече се отключват на ниво ${COMPANY_UNLOCKS.find((u) => u.key === (limit < 6 ? 'custom_ranks' : 'more_ranks'))!.level}`}.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {ranks.map((r) => {
          const editable = manage && (r.isOwner ? hub.rank.isOwner : r.priority > hub.rank.priority);
          return (
            <Card key={r.id} title={<span className="inline-flex items-center gap-2">{r.name}{r.isOwner && <Badge tone="gold">собственик</Badge>}<span className="num text-xs font-normal text-mist-400">старшинство {r.priority}</span></span>}>
              {editable ? (
                <>
                  <RankForm rank={{ id: r.id, name: r.name, priority: r.priority, permissions: r.permissions, isOwner: r.isOwner }} permissions={permissions} grantable={grantable} minPriority={hub.rank.priority + 1} submitLabel="Запази" />
                  {!r.isOwner && (
                    <div className="mt-3 border-t border-asphalt-800 pt-3">
                      <ActionButton action={{ type: 'deleteRank', rankId: r.id }} className="btn-ghost px-3 py-1.5 text-sm text-loss" confirm="Да изтриете длъжността?">Изтрий длъжността</ActionButton>
                    </div>
                  )}
                </>
              ) : (
                <ul className="list-inside list-disc space-y-1 text-sm text-mist-300">
                  {(r.isOwner ? ALL_PERMISSIONS : r.permissions).map((p) => <li key={p}>{PERMISSIONS[p as keyof typeof PERMISSIONS] ?? p}</li>)}
                  {!r.isOwner && r.permissions.length === 0 && <li className="list-none text-mist-400">Без права за управление — кара курсове и получава бонусите.</li>}
                </ul>
              )}
            </Card>
          );
        })}
        {manage && ranks.length < limit && (
          <Card title="Нова длъжност">
            <RankForm key={ranks.length} rank={{ name: '', priority: nextPriority, permissions: [] }} permissions={permissions} grantable={grantable} minPriority={hub.rank.priority + 1} submitLabel="Създай" />
          </Card>
        )}
      </div>
    </div>
  );
}
