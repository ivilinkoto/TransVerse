import { Card } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { money } from '@/lib/format';
import { STAFF, STAFF_ROLES, staffAllowed, type StaffRole } from '@/lib/game/base-staff';
import type { UpgradeLevels } from '@/lib/game/company';
import { t, tx } from '@/i18n/t';

/** 1.4 „Персонал на базата“: who works at the base, what they give, hire / let go. */
export function BaseStaffCard({ staff, upgrades, canManage, treasuryCents }: { staff: Partial<Record<StaffRole, { name: string }>>; upgrades: UpgradeLevels; canManage: boolean; treasuryCents: number }) {
  return (
    <Card title={t('👷 Персонал на базата')}>
      <p className="mb-3 text-xs text-mist-400">{t('Всеки иска своята сграда и заплата всяка седмица от касата. Без пари в касата — напуска.')}</p>
      <ul className="divide-y divide-asphalt-800" data-testid="base-staff">
        {STAFF_ROLES.map((role) => {
          const s = STAFF[role];
          const person = staff[role];
          const allowed = staffAllowed(role, upgrades);
          return (
            <li key={role} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="font-semibold">{s.emoji} {tx(s.label)}</span>{person && <span className="text-mist-300"> · {person.name}</span>}
                <span className="block text-xs text-mist-400">{tx(s.bonus)} · {t('{0} на седмица', money(s.weeklyCents))}</span>
              </span>
              {person ? (
                canManage && <ActionButton action={{ type: 'fireBaseStaff', role }} className="game-action flex-row px-3 py-1 text-xs" confirm={t('Да освободиш ли {0}?', person.name)}>{t('Освободи')}</ActionButton>
              ) : !allowed ? (
                <span className="text-xs text-mist-500">{t('Нужна е сградата „{0}“', tx(s.buildingLabel))}</span>
              ) : canManage && (
                <ActionButton action={{ type: 'hireBaseStaff', role }} className="game-action game-action-main flex-row px-3 py-1 text-xs" disabled={treasuryCents < s.weeklyCents}>{t('Наеми')}</ActionButton>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
