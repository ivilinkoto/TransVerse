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

/** v1.9: the player's level and menu choice, for the menu that grows with the level. */
const PlayerCtx = createContext<{ level: number; showAll: boolean }>({ level: 99, showAll: true });

export function PlayerUiProvider({ value, children }: { value: { level: number; showAll: boolean }; children: ReactNode }) {
  return <PlayerCtx.Provider value={value}>{children}</PlayerCtx.Provider>;
}

/** The menu's view of the player, or null when the menu shows everything (feature off). */
export function useNavPlayer() {
  const player = useContext(PlayerCtx);
  return useFeature('progressive_unlock') ? player : null;
}
