'use client';

import dynamic from 'next/dynamic';
import { Loading3D, Modal3D } from './Modal3D';
import type { BusModelId } from '@/lib/game/buses';

// three.js loads only when a player opens the 3D view.
const TruckViewer = dynamic(() => import('./TruckViewer').then((m) => m.TruckViewer), { ssr: false, loading: Loading3D });

/** 1.3: „🧊 3D“ next to a bus drawing — the bus in 3D, to turn around. */
export function Bus3DButton({ model, title, color, className = '' }: { model: BusModelId; title: string; color?: string; className?: string }) {
  return <Modal3D title={title} className={className} testId="bus-3d-open">{() => <TruckViewer look={{ modelId: `bus:${model}`, color: color ?? '' }} />}</Modal3D>;
}
