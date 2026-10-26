import { eq } from 'drizzle-orm';
import { Building2, Sparkles, Star, Users } from 'lucide-react';
import { notFound } from 'next/navigation';
import { AvatarUpload } from '@/components/game/AvatarUpload';
import { FriendsPanel } from '@/components/game/FriendsPanel';
import { PlayerCardView } from '@/components/game/PlayerCard';
import { Card, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { date } from '@/lib/format';
import { PREMIUM_LEVELS, REPUTATION_TIERS, reputationBonusShare, reputationTier } from '@/lib/game/progression';
import { gameContext } from '@/server/game/context';
import { ProfileShowcase } from '@/components/game/ProfileShowcase';
import { ShowcaseEditor } from '@/components/game/ShowcaseEditor';
import { users } from '@/server/db/schema';
import { showcaseOf } from '@/server/game/community';
import { badgesOf } from '@/server/game/halloween';
import { fleetView } from '@/server/game/queries';
import { friendsOf, myCompanyInvites, playerCard } from '@/server/game/social';
import { t as tr, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Профил') };
}

export default async function ProfilePage() {
  await initLocale();
  const { db, user, company, now, features } = await gameContext();
  const [card, social, invites] = await Promise.all([playerCard(db, user.id, user.username, now), friendsOf(db, user.id, now), myCompanyInvites(db, user.id)]);
  if (!card) notFound();
  const showcase = features.profile_showcase ? { mine: await showcaseOf(db, user.id), fleet: (await fleetView(db, company.id)).vehicles.filter((v) => v.ownership !== 'rented'), badges: await badgesOf(db, user.id), chosen: (await db.select({ s: users.showcase }).from(users).where(eq(users.id, user.id)))[0]!.s } : null;
  const tier = reputationTier(company.reputation);
  const next = REPUTATION_TIERS.find((t) => t.min > company.reputation);
  return (
    <div className="space-y-6">
      <PageHeader title={tr('Профил')} subtitle={tr('Така те виждат другите играчи. Натисни името на всеки играч, за да видиш неговия профил.')} />
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <Card><PlayerCardView card={card} /></Card>
          {showcase && (
            <Card title={<span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4 text-gold-400" />{tr('Витрина на профила')}</span>}>
              <p className="mb-3 text-sm text-mist-300">{tr('До 3 камиона и 3 значки, които другите виждат в профила ти.')}</p>
              <ProfileShowcase showcase={showcase.mine} />
              <div className="mt-4 border-t border-asphalt-800 pt-4"><ShowcaseEditor trucks={showcase.fleet.map((v) => ({ id: v.id, label: `${v.plate} · ${v.model.brand} ${v.model.name}` }))} badges={showcase.badges.map((b) => ({ id: b.id, label: b.label }))} chosen={showcase.chosen} /></div>
            </Card>
          )}
          <Card title={tr('Снимка на профила')}><AvatarUpload userId={user.id} username={user.username} version={user.avatarVersion} vip={card.vip} /></Card>
          {invites.length > 0 && (
            <Card id="invites" title={<span className="inline-flex items-center gap-2"><Building2 className="h-4 w-4 text-gold-400" />{tr('Покани за компании')}</span>}>
              <ul className="divide-y divide-asphalt-800">
                {invites.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="font-semibold">{i.company.tag && <span style={{ color: i.company.color ?? undefined }}>[{tx(i.company.tag)}] </span>}{tx(i.company.name)}</div>
                      <div className="text-xs text-mist-400">{tr('ниво {0} · покана от {1} · {2}', i.company.level, i.by ?? tr('компанията'), date(i.createdAt))}</div>
                    </div>
                    <div className="flex gap-2">
                      <ActionButton action={{ type: 'companyInviteRespond', inviteId: i.id, accept: true }} className="btn-gold px-3 py-1.5 text-xs" confirm={tr('Да се присъединиш ли към „{0}“?', i.company.name)}>{tr('Присъедини се')}</ActionButton>
                      <ActionButton action={{ type: 'companyInviteRespond', inviteId: i.id, accept: false }} className="btn-ghost px-3 py-1.5 text-xs">{tr('Откажи')}</ActionButton>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title={<span className="inline-flex items-center gap-2"><Star className="h-4 w-4 text-prestige" />{tr('Репутация · {0}', tier.label)}</span>}>
            <p className="text-sm text-mist-300">{tr('Репутацията ти е')}{' '}<span className="num font-semibold text-white">{Math.floor(company.reputation)}</span>{' '}{tr('от 100. Расте с всяка доставка навреме и пада с 3 при закъснение.')}{next && <>{' '}{tr('До „{0}“ остават', next.label)}{' '}<span className="num font-semibold">{Math.ceil(next.min - company.reputation)}</span>.</>}</p>
            <ul className="mt-3 space-y-1.5 text-sm">
              <li className="flex justify-between gap-3"><span className="text-mist-400">{tr('Бонус към всяко възнаграждение')}</span><span className="num font-semibold text-profit">+{(reputationBonusShare(company.reputation) * 100).toFixed(1)}%</span></li>
              {PREMIUM_LEVELS.map((p) => (
                <li key={p.minReputation} className="flex justify-between gap-3"><span className="text-mist-400">{tr('Премиум поръчки ×{0} (от {1})', p.multiplier.toFixed(2), p.minReputation)}</span><span className={company.reputation >= p.minReputation ? 'font-semibold text-profit' : 'text-mist-400'}>{company.reputation >= p.minReputation ? tr('отключени') : tr('заключени')}</span></li>
              ))}
            </ul>
          </Card>
        </div>
        <Card id="friends" title={<span className="inline-flex items-center gap-2"><Users className="h-4 w-4 text-cyan-glow" />{tr('Приятели')}</span>}>
          <FriendsPanel {...social} />
        </Card>
      </div>
    </div>
  );
}
