'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type { EarningsMap as Map } from '@/components/game/EarningsMap';
import { t } from '@/i18n/t';

// MapLibre needs the browser (WebGL); load it on the client only.
const EarningsMap = dynamic(() => import('@/components/game/EarningsMap').then((m) => m.EarningsMap), {
  ssr: false,
  loading: () => <div className="flex h-[60dvh] min-h-[340px] items-center justify-center rounded-2xl border border-asphalt-700 text-mist-400">{t('Зареждане на картата…')}</div>,
});

export function EarningsClient(props: ComponentProps<typeof Map>) {
  return <EarningsMap {...props} />;
}
