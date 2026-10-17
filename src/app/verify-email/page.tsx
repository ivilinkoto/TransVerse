import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/AuthShell';
import { VerifyEmailButton } from '@/components/auth/EmailLinkForms';

export const metadata: Metadata = { title: 'Потвърждаване на имейл', robots: { index: false } };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? '';
  return (
    <AuthShell title="Потвърди имейла си" subtitle="Още една стъпка — натисни бутона." aside={<p className="max-w-md font-display text-2xl font-bold leading-snug">С потвърден имейл винаги можеш да си върнеш профила.</p>}>
      <VerifyEmailButton token={token} />
    </AuthShell>
  );
}
