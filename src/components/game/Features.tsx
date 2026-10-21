'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { FeatureId } from '@/lib/game/features';

const Ctx = createContext<Partial<Record<FeatureId, boolean>>>({});

/** Which release features the viewer has (staff see them before the release date). */
export function FeaturesProvider({ value, children }: { value: Record<FeatureId, boolean>; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** All of them at once, as a check (for lists like the menu tabs). */
export function useFeatures(): (id: FeatureId) => boolean {
  const value = useContext(Ctx);
  return (id) => value[id] ?? true;
}

/** Is a release feature on for the viewer? (outside the game layout: yes) */
export function useFeature(id: FeatureId): boolean {
  return useContext(Ctx)[id] ?? true;
}
