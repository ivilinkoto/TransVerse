import { eq } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { companyMembers, users } from '@/server/db/schema';
import { Card } from '@/components/ui';
import { SelectAction } from '@/components/ui/SelectAction';
import { ItemArt } from './ItemArt';
import { CHEST_REWARDS } from '@/lib/game/item-chests';
import { ITEMS } from '@/lib/game/items';
import { dateTime } from '@/lib/format';
import { companyChestOf } from '@/server/game/item-trade';
import { t, tx } from '@/i18n/t';

const CHEST_REASONS: Record<string, string> = { project: 'Фирмен проект', battle_win: 'Победа в битка', battle_draw: 'Равна битка', give: 'Дадено на' };

/** 1.2.1: the company chest — cases from projects and battles; the owner gives them to members. */
export async function CompanyChest({ db, organizationId, owner }: { db: DbOrTx; organizationId: string; owner: boolean }) {
  const [chest, members] = await Promise.all([companyChestOf(db, organizationId), owner ? db.select({ id: users.id, username: users.username }).from(companyMembers).innerJoin(users, eq(users.id, companyMembers.userId)).where(eq(companyMembers.companyId, organizationId)) : []]);
  return (
    <Card title={t('Фирмен сандък')} className="border-violet-500/40 bg-gradient-to-br from-violet-700/15 to-transparent">
      {chest.items.length ? (
        <ul className="space-y-2">
          {chest.items.map((i) => (
            <li key={i.itemId} className="flex flex-wrap items-center gap-3 rounded-xl border border-asphalt-800 bg-asphalt-900/50 p-2">
              <ItemArt id={i.itemId} className="h-10 w-10" />
              <span className="flex-1 text-sm font-semibold">{tx(ITEMS[i.itemId].name)} <span className="num text-mist-400">×{i.qty}</span></span>
              {owner && <SelectAction label={t('Дай')} ariaLabel={t('Дай на член')} value="" field="memberId" action={{ type: 'giveFromChest', itemId: i.itemId }} options={[{ value: '', label: t('— на кого —') }, ...members.map((m) => ({ value: m.id, label: m.username }))]} />}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-mist-400">{t('Празен е. Пълни се от фирмените проекти и битките на компаниите.')}</p>
      )}
      <p className="mt-2 text-xs text-mist-400">{t('Проект: {0} × {1}. Победа в битка: {2}. Равна битка: {3}.', CHEST_REWARDS.project.qty, tx(ITEMS[CHEST_REWARDS.project.item].name), tx(ITEMS[CHEST_REWARDS.battleWin.item].name), tx(ITEMS[CHEST_REWARDS.battleDraw.item].name))} {owner ? t('Ти решаваш кой какво получава.') : t('Собственикът ги раздава.')}</p>
      {chest.log.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-xs text-mist-400">
          {chest.log.map((l, i) => (
            <li key={i}>{l.delta > 0 ? '+' : ''}{l.delta} {tx(ITEMS[l.itemId].name)} · {tx(CHEST_REASONS[l.reason] ?? l.reason)}{l.reason === 'give' && l.username ? ` ${l.username}` : ''} · {dateTime(l.at)}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
