'use client';

import dynamic from 'next/dynamic';
import { useFeature } from '@/components/game/Features';
import type { DepotLook } from './depot3d';
import { Loading3D, Modal3D } from './Modal3D';

const DepotViewer = dynamic(() => import('./DepotViewer').then((m) => m.DepotViewer), { ssr: false, loading: Loading3D });

/** 1.2.3.6: „🧊 3D“ on a depot — the yard with its bays and the trucks parked there. */
export function Depot3DButton({ look, title, className = '' }: { look: DepotLook; title: string; className?: string }) {
  const live = useFeature('depot_3d');
  if (!live) return null;
  return <Modal3D title={title} className={className} testId="depot-3d-open">{() => <DepotViewer look={look} />}</Modal3D>;
}
