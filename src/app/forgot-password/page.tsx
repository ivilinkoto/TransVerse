import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/AuthShell';
import { ForgotPasswordForm } from '@/components/auth/EmailLinkForms';

export const metadata: Metadata = { title: 'Забравена парола' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Забравена парола" subtitle="Въведи имейла си и ще ти изпратим линк за нова парола." aside={<p className="max-w-md font-display text-2xl font-bold leading-snug">Камионите те чакат — само си смени паролата.</p>}>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
