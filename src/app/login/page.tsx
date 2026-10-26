import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth/AuthShell';
import { LoginForm } from '@/components/auth/LoginForm';
import { currentUser } from '@/server/http';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Вход') };
}

export default async function LoginPage() {
  await initLocale();
  if (await currentUser()) redirect('/game');
  return (
    <AuthShell
      title={t('Добре дошъл обратно')}
      subtitle={t('Камионите ти продължиха да карат, докато те нямаше.')}
      aside={<p className="max-w-md font-display text-2xl font-bold leading-snug">{t('Курсовете продължават на сървъра, дори когато браузърът е затворен.')}</p>}
    >
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
