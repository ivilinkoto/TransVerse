'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type { FootprintMap as Map } from '@/components/game/FootprintMap';

// MapLibre needs the browser (WebGL); load it on the client only.
const FootprintMap = dynamic(() => import('@/components/game/FootprintMap').then((m) => m.FootprintMap), {
  ssr: false,
  loading: () => <div className="flex h-[calc(100dvh-320px)] min-h-[380px] items-center justify-center rounded-2xl border border-asphalt-700 text-mist-400">Зареждане на картата…</div>,
});

export function FootprintClient(props: ComponentProps<typeof Map>) {
  return <FootprintMap {...props} />;
}
