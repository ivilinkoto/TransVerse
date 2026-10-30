'use client';

import { ErrorScreen } from '@/components/ui/ErrorScreen';

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen error={error} reset={reset} home="/admin" report={false} />;
}
