import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/AuthShell';
import { ForgotPasswordForm } from '@/components/auth/EmailLinkForms';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Забравена парола') };
}

export default async function ForgotPasswordPage() {
  await initLocale();
  return (
    <AuthShell title={t('Забравена парола')} subtitle={t('Въведи имейла си и ще ти изпратим линк за нова парола.')} aside={<p className="max-w-md font-display text-2xl font-bold leading-snug">{t('Камионите те чакат — само си смени паролата.')}</p>}>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
