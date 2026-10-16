'use client';

import { GraduationCap, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import type { TutorialStep } from '@/lib/game/tutorial';

/** Onboarding coach shown under the top bar until every step is done or the player skips it. */
export function TutorialCoach({ step, index, total }: { step: TutorialStep; index: number; total: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const send = async (action: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api('/api/game/action', action);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="border-b border-volt-500/30 bg-gradient-to-r from-volt-500/15 via-asphalt-900 to-asphalt-900 px-4 py-3 sm:px-6" aria-label="Обучение">
      <div className="flex flex-wrap items-start gap-3">
        <GraduationCap className="mt-0.5 h-5 w-5 shrink-0 text-cyan-glow" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label text-cyan-glow">Обучение · стъпка {index + 1} от {total}</span>
            <span className="flex gap-1" aria-hidden="true">
              {Array.from({ length: total }, (_, i) => <span key={i} className={`h-1.5 w-5 rounded-full ${i < index ? 'bg-profit' : i === index ? 'bg-cyan-glow' : 'bg-asphalt-600'}`} />)}
            </span>
          </div>
          <p className="mt-1 font-semibold">{step.title}</p>
          <p className="max-w-3xl text-sm text-mist-300">{step.body}</p>
        </div>
        <div className="flex items-center gap-2">
          {step.completion === 'ack' ? (
            <button className="btn-primary py-2" disabled={busy} onClick={() => send({ type: 'tutorialStep', step: step.key })}>{step.cta}</button>
          ) : (
            <Link className="btn-primary py-2" href={step.href}>{step.cta}</Link>
          )}
          <button className="btn-ghost px-2.5 py-2" disabled={busy} onClick={() => send({ type: 'tutorialDismiss', dismissed: true })} aria-label="Пропусни обучението" title="Пропусни обучението">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
