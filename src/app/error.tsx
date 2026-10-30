'use client';

import { ErrorScreen } from '@/components/ui/ErrorScreen';

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="px-4"><ErrorScreen error={error} reset={reset} home="/" report={false} /></main>;
}
