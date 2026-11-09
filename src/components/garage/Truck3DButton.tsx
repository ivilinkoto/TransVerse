'use client';

import dynamic from 'next/dynamic';
import { useFeature } from '@/components/game/Features';
import { Loading3D, Modal3D } from './Modal3D';
import type { TruckLook } from './truck3d';

// three.js loads only when a player opens the 3D view.
const TruckViewer = dynamic(() => import('./TruckViewer').then((m) => m.TruckViewer), { ssr: false, loading: Loading3D });

/** 1.2.3.6: „🧊 3D“ next to a truck drawing — the same truck in 3D, to turn around. */
export function Truck3DButton({ look, title, className = '' }: { look: TruckLook; title: string; className?: string }) {
  const live = useFeature('truck_3d_view');
  if (!live) return null;
  return <Modal3D title={title} className={className} testId="truck-3d-open">{() => <TruckViewer look={look} />}</Modal3D>;
}
