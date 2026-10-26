import { Swords, Trophy } from 'lucide-react';
import Link from 'next/link';
import { Badge, Card } from '@/components/ui';
import { duration, money } from '@/lib/format';
import { BATTLE_RULES } from '@/lib/game/battles';
import { t, tx, intlLocale } from '@/i18n/t';

interface Props {
  now: Date;
  battle: { endsAt: Date; ourTons: number; theirTons: number; rival: { id: string; name: string; tag: string | null; level: number } | null } | null;
  record: { wins: number; recent: { id: string; rival: string; ourTons: number; theirTons: number; result: 'win' | 'loss' | 'draw' }[] };
  companyName: string;
}

/** This week's battle of the company: us against the rival in tonnes, and the trophies. */
export function BattleCard({ now, battle, record, companyName }: Props) {
  const total = battle ? Math.max(1, battle.ourTons + battle.theirTons) : 1;
  const ahead = battle ? (battle.ourTons === battle.theirTons ? t('равенство') : battle.ourTons > battle.theirTons ? t('водите') : t('изоставате')) : '';
  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><Swords className="h-4 w-4 text-loss" />{t('Битка на компаниите')}</span>}
      actions={<Badge tone="gold"><Trophy className="h-3 w-3" />{tx(record.wins)} {record.wins === 1 ? t('трофей') : t('трофея')}</Badge>}
    >
      {battle && battle.rival ? (
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span>{t('Тази седмица срещу')}{' '}<Link href={`/game/companies/${battle.rival.id}`} className="font-semibold text-cyan-glow hover:underline">{battle.rival.tag ? `[${battle.rival.tag}] ` : ''}{tx(battle.rival.name)}</Link>{' '}{t('· ниво {0}', battle.rival.level)}</span>
            <span className="text-xs text-mist-400">{t('край след {0}', duration(Math.max(0, (battle.endsAt.getTime() - now.getTime()) / 60_000)))}</span>
          </div>
          <div className="mt-3 flex items-center justify-between font-display text-lg font-bold">
            <span className="text-cyan-glow">{t('{0} т', Math.round(battle.ourTons).toLocaleString(intlLocale()))}</span>
            <span className="text-xs font-normal text-mist-400">{ahead}</span>
            <span className="text-loss">{t('{0} т', Math.round(battle.theirTons).toLocaleString(intlLocale()))}</span>
          </div>
          <div className="mt-1 flex h-2.5 overflow-hidden rounded-full bg-asphalt-800" aria-hidden="true">
            <div className="bg-cyan-glow" style={{ width: `${(battle.ourTons / total) * 100}%` }} />
            <div className="flex-1 bg-loss/70" />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-mist-400"><span>{companyName}</span><span>{tx(battle.rival.name)}</span></div>
          <p className="mt-3 text-xs text-mist-400">{t('Брои се всеки тон, който членовете доставят до неделя 24:00. Победителят взема {0} за касата, {1} фирмен опит и трофей в профила на компанията.', money(BATTLE_RULES.rewardCents), BATTLE_RULES.rewardXp)}</p>
        </div>
      ) : (
        <p className="text-sm text-mist-400">{t('Тази седмица компанията няма съперник. Всеки понеделник активните компании (с доставка през последните {0} дни) се срещат с компания с близко ниво.', BATTLE_RULES.activeDays)}</p>
      )}
      {record.recent.length > 0 && (
        <ul className="mt-4 space-y-1 border-t border-asphalt-800 pt-3 text-xs">
          {record.recent.map((r) => (
            <li key={r.id} className="flex justify-between gap-2">
              <span>{t('срещу {0}', r.rival)}</span>
              <span className={r.result === 'win' ? 'text-profit' : r.result === 'loss' ? 'text-loss' : 'text-mist-300'}>{t('{0} · {1} : {2} т', r.result === 'win' ? t('победа') : r.result === 'loss' ? t('загуба') : t('равенство'), Math.round(r.ourTons), Math.round(r.theirTons))}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
