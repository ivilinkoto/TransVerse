/**
 * 1.4 „Нов облик“: the bright „Тайкун“ look (chunky 3D buttons, rendered-style
 * icons, Unbounded and Rubik). It is the default once the feature is out; a
 * player can go back to the classic look in Settings.
 */
export type LookStyle = 'classic' | 'tycoon';

export function tycoonLook(featureOn: boolean | undefined, style: LookStyle | undefined): boolean {
  return !!featureOn && style !== 'classic';
}
