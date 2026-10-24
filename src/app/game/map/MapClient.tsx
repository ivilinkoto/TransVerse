'use client';

import dynamic from 'next/dynamic';
import type { MapProps } from '@/components/game/WorldMap';
import { t } from '@/i18n/t';

// MapLibre needs the browser (WebGL); load it on the client only.
const WorldMap = dynamic(() => import('@/components/game/WorldMap').then((m) => m.WorldMap), {
  ssr: false,
  loading: () => <div className="flex h-[calc(100dvh-210px)] min-h-[420px] items-center justify-center rounded-2xl border border-asphalt-700 text-mist-400">{t('Зареждане на картата…')}</div>,
});

export function MapClient(props: MapProps) {
  return <WorldMap {...props} />;
}
