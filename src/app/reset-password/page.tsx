import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';
import { ResetPasswordForm } from '@/components/auth/EmailLinkForms';
import { resetLinkValid } from '@/server/auth/email-links';
import { getDb } from '@/server/db/client';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Нова парола'), robots: { index: false } };
}
export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  await initLocale();
  const token = (await searchParams).token ?? '';
  const valid = await resetLinkValid(getDb(), token);
  return (
    <AuthShell title={t('Нова парола')} subtitle={t('Избери нова парола за профила си.')} aside={<p className="max-w-md font-display text-2xl font-bold leading-snug">{t('Линкът важи 1 час и може да се използва веднъж.')}</p>}>
      {valid ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="space-y-4">
          <p role="alert" className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">{t('Линкът е невалиден, изтекъл или вече използван.')}</p>
          <Link href="/forgot-password" className="btn-primary w-full justify-center">{t('Поискай нов линк')}</Link>
        </div>
      )}
    </AuthShell>
  );
}
