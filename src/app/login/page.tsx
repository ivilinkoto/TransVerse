import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth/AuthShell';
import { LoginForm } from '@/components/auth/LoginForm';
import { currentUser } from '@/server/http';

export const metadata: Metadata = { title: 'Вход' };

export default async function LoginPage() {
  if (await currentUser()) redirect('/game');
  return (
    <AuthShell
      title="Добре дошъл обратно"
      subtitle="Камионите ти продължиха да карат, докато те нямаше."
      aside={<p className="max-w-md font-display text-2xl font-bold leading-snug">Доставките се изпълняват на сървъра в реално време, дори когато браузърът е затворен.</p>}
    >
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
