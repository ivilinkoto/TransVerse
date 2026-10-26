import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/AuthShell';
import { VerifyEmailButton } from '@/components/auth/EmailLinkForms';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Потвърждаване на имейл'), robots: { index: false } };
}

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  await initLocale();
  const token = (await searchParams).token ?? '';
  return (
    <AuthShell title={t('Потвърди имейла си')} subtitle={t('Още една стъпка — натисни бутона.')} aside={<p className="max-w-md font-display text-2xl font-bold leading-snug">{t('С потвърден имейл винаги можеш да си върнеш профила.')}</p>}>
      <VerifyEmailButton token={token} />
    </AuthShell>
  );
}
