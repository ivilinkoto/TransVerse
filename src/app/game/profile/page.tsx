import { Building2, Star, Users } from 'lucide-react';
import { notFound } from 'next/navigation';
import { AvatarUpload } from '@/components/game/AvatarUpload';
import { FriendsPanel } from '@/components/game/FriendsPanel';
import { PlayerCardView } from '@/components/game/PlayerCard';
import { Card, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { date } from '@/lib/format';
import { PREMIUM_LEVELS, REPUTATION_TIERS, reputationBonusShare, reputationTier } from '@/lib/game/progression';
import { gameContext } from '@/server/game/context';
import { friendsOf, myCompanyInvites, playerCard } from '@/server/game/social';

export const metadata = { title: 'Профил' };

export default async function ProfilePage() {
  const { db, user, company, now } = await gameContext();
  const [card, social, invites] = await Promise.all([playerCard(db, user.id, user.username, now), friendsOf(db, user.id, now), myCompanyInvites(db, user.id)]);
  if (!card) notFound();
  const tier = reputationTier(company.reputation);
  const next = REPUTATION_TIERS.find((t) => t.min > company.reputation);
  return (
    <div className="space-y-6">
      <PageHeader title="Профил" subtitle="Така те виждат другите играчи. Натисни името на всеки играч, за да видиш неговия профил." />
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <Card><PlayerCardView card={card} /></Card>
          <Card title="Снимка на профила"><AvatarUpload userId={user.id} username={user.username} version={user.avatarVersion} vip={card.vip} /></Card>
          {invites.length > 0 && (
            <Card id="invites" title={<span className="inline-flex items-center gap-2"><Building2 className="h-4 w-4 text-gold-400" />Покани за компании</span>}>
              <ul className="divide-y divide-asphalt-800">
                {invites.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="font-semibold">{i.company.tag && <span style={{ color: i.company.color ?? undefined }}>[{i.company.tag}] </span>}{i.company.name}</div>
                      <div className="text-xs text-mist-400">ниво {i.company.level} · покана от {i.by ?? 'компанията'} · {date(i.createdAt)}</div>
                    </div>
                    <div className="flex gap-2">
                      <ActionButton action={{ type: 'companyInviteRespond', inviteId: i.id, accept: true }} className="btn-gold px-3 py-1.5 text-xs" confirm={`Да се присъединиш ли към „${i.company.name}“?`}>Присъедини се</ActionButton>
                      <ActionButton action={{ type: 'companyInviteRespond', inviteId: i.id, accept: false }} className="btn-ghost px-3 py-1.5 text-xs">Откажи</ActionButton>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title={<span className="inline-flex items-center gap-2"><Star className="h-4 w-4 text-prestige" />Репутация · {tier.label}</span>}>
            <p className="text-sm text-mist-300">Репутацията ти е <span className="num font-semibold text-white">{Math.floor(company.reputation)}</span> от 100. Расте с всяка доставка навреме и пада с 3 при закъснение.{next && <> До „{next.label}“ остават <span className="num font-semibold">{Math.ceil(next.min - company.reputation)}</span>.</>}</p>
            <ul className="mt-3 space-y-1.5 text-sm">
              <li className="flex justify-between gap-3"><span className="text-mist-400">Бонус към всяко възнаграждение</span><span className="num font-semibold text-profit">+{(reputationBonusShare(company.reputation) * 100).toFixed(1)}%</span></li>
              {PREMIUM_LEVELS.map((p) => (
                <li key={p.minReputation} className="flex justify-between gap-3"><span className="text-mist-400">Премиум поръчки ×{p.multiplier.toFixed(2)} (от {p.minReputation})</span><span className={company.reputation >= p.minReputation ? 'font-semibold text-profit' : 'text-mist-400'}>{company.reputation >= p.minReputation ? 'отключени' : 'заключени'}</span></li>
              ))}
            </ul>
          </Card>
        </div>
        <Card id="friends" title={<span className="inline-flex items-center gap-2"><Users className="h-4 w-4 text-cyan-glow" />Приятели</span>}>
          <FriendsPanel {...social} />
        </Card>
      </div>
    </div>
  );
}
