'use client';

import Link from 'next/link';
import { useFeature } from './Features';
import { tx } from '@/i18n/t';

/** 1.2.2: the next step under an empty screen („Още нямаш…“ → a button that takes you there). */
export function EmptyAction({ href, label }: { href: string; label: string }) {
  if (!useFeature('nav_v2')) return null;
  return <Link href={href} className="btn-primary mx-auto mt-4 flex w-fit py-2" data-testid="empty-action">{tx(label)}</Link>;
}
