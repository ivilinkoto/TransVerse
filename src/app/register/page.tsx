import type { Metadata } from 'next';
import { eq } from 'drizzle-orm';
import { Gift } from 'lucide-react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/AuthShell';
import { RegisterForm } from '@/components/auth/RegisterForm';
import { money } from '@/lib/format';
import { ECONOMY } from '@/lib/game/economy';
import { REFERRAL, REFERRAL_CODE } from '@/lib/game/referrals';
import { getDb } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { headquarterOptions } from '@/server/game/company';
import { currentUser } from '@/server/http';
import { OG_IMAGE } from '@/server/site';

export const dynamic = 'force-dynamic';

async function inviterOf(ref: string | undefined) {
  const raw = (ref ?? (await cookies()).get('tv_ref')?.value ?? '').toUpperCase();
  const code = REFERRAL_CODE.test(raw) ? raw : null;
  const [inviter] = code ? await getDb().select({ username: users.username }).from(users).where(eq(users.referralCode, code)) : [];
  return { code, inviter };
}

/** An invite link shared on Facebook, Viber… shows who invites and the bonus. */
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ ref?: string }> }): Promise<Metadata> {
  const { inviter } = await inviterOf((await searchParams).ref).catch(() => ({ inviter: undefined }));
  if (!inviter) return { title: 'Регистрация' };
  const title = `${inviter.username} те кани в TransVerse`;
  const description = `Транспортна стратегия върху реалната карта на Европа. Регистрирай се през поканата и след първите ${REFERRAL.deliveriesNeeded} доставки получаваш ${money(REFERRAL.inviteeCents)} бонус.`;
  return { title: { absolute: title }, description, openGraph: { title, description, type: 'website', siteName: 'TransVerse', locale: 'bg_BG', images: [OG_IMAGE] }, twitter: { card: 'summary_large_image', title, description, images: [OG_IMAGE] } };
}

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  if (await currentUser()) redirect('/game');
  const cities = await headquarterOptions(getDb());
  const { code, inviter } = await inviterOf((await searchParams).ref);
  return (
    <AuthShell
      title="Стани шофьор в TransVerse"
      subtitle={`Започваш като самостоятелен шофьор с нает камион и ${money(ECONOMY.startingBalanceCents)}. Компанията основаваш по-късно.`}
      aside={
        <ul className="max-w-md space-y-3 text-mist-300">
          <li className="font-display text-2xl font-bold text-mist-100">Какво те чака</li>
          <li>Нает камион без разходи за гориво и сервиз — плащаш наем от всеки курс</li>
          <li>Реални градове и пътни маршрути в 9 държави, време за курс според разстоянието</li>
          <li>{`Собствена компания от ниво ${ECONOMY.foundingMinLevel} срещу ${money(ECONOMY.foundingFeeCents)}`}</li>
          <li>Общ пазар, сезонни класации, обучение за първите стъпки</li>
        </ul>
      }
    >
      {inviter && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-gold-400/40 bg-gold-400/10 px-3 py-2 text-sm">
          <Gift className="h-4 w-4 shrink-0 text-gold-400" />
          <span><span className="font-semibold">{inviter.username}</span> те кани в TransVerse. След първите {REFERRAL.deliveriesNeeded} доставки получаваш {money(REFERRAL.inviteeCents)} бонус.</span>
        </p>
      )}
      <RegisterForm referralCode={inviter ? code : null} cities={cities.map(({ id, nameBg, population }) => ({ id, nameBg, population }))} />
    </AuthShell>
  );
}
