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
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

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
  if (!inviter) return { title: t('Регистрация') };
  const title = t('{0} те кани в TransVerse', inviter.username);
  const description = t('Транспортна стратегия върху реалната карта на Европа. Регистрирай се през поканата и след първите {0} доставки получаваш {1} бонус.', REFERRAL.deliveriesNeeded, money(REFERRAL.inviteeCents));
  return { title: { absolute: title }, description, openGraph: { title, description, type: 'website', siteName: 'TransVerse', locale: 'bg_BG', images: [OG_IMAGE] }, twitter: { card: 'summary_large_image', title, description, images: [OG_IMAGE] } };
}

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  await initLocale();
  if (await currentUser()) redirect('/game');
  const cities = await headquarterOptions(getDb());
  const { code, inviter } = await inviterOf((await searchParams).ref);
  return (
    <AuthShell
      title={t('Стани шофьор в TransVerse')}
      subtitle={t('Започваш като самостоятелен шофьор с нает камион и {0} Компанията основаваш по-късно.', money(ECONOMY.startingBalanceCents))}
      aside={
        <ul className="max-w-md space-y-3 text-mist-300">
          <li className="font-display text-2xl font-bold text-mist-100">{t('Какво те чака')}</li>
          <li>{t('Нает камион без разходи за гориво и сервиз — плащаш наем от всеки курс')}</li>
          <li>{t('Реални градове и пътни маршрути в 9 държави, време за курс според разстоянието')}</li>
          <li>{t('Собствена компания от ниво {0} срещу {1}', ECONOMY.foundingMinLevel, money(ECONOMY.foundingFeeCents))}</li>
          <li>{t('Общ пазар, сезонни класации, обучение за първите стъпки')}</li>
        </ul>
      }
    >
      {inviter && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-gold-400/40 bg-gold-400/10 px-3 py-2 text-sm">
          <Gift className="h-4 w-4 shrink-0 text-gold-400" />
          <span><span className="font-semibold">{tx(inviter.username)}</span>{' '}{t('те кани в TransVerse. След първите {0} доставки получаваш {1} бонус.', REFERRAL.deliveriesNeeded, money(REFERRAL.inviteeCents))}</span>
        </p>
      )}
      <RegisterForm referralCode={inviter ? code : null} cities={cities.map(({ id, nameBg, population }) => ({ id, nameBg, population }))} />
    </AuthShell>
  );
}
