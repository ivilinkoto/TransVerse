import type { LucideIcon } from 'lucide-react';
import {
  Backpack, Banknote, Briefcase, Building2, CalendarDays, CassetteTape, Cherry, ClipboardList, Coins, Compass, Crown, Disc3, Egg, Flag, Gem, Ghost, Gift, Hammer, Hash, Heart, Link, Map as MapIcon, Package, Palette, PawPrint, Pencil, ShoppingBag, Siren, Snowflake, Sparkles, Star, Target, TreeDeciduous, TrendingUp, Trophy, Truck, User, Warehouse, Wrench, Zap,
} from 'lucide-react';

export type IconTone = 'gold' | 'green' | 'blue' | 'cyan' | 'pink' | 'violet' | 'red' | 'orange' | 'silver' | 'ice';

/**
 * 1.4 „Нов облик“: a 3D-style icon — a glossy, rounded badge in one of the
 * look's colours with a white glyph, sitting on a darker base. Sized in `em`,
 * so it follows the text size of where it is placed.
 */
export function Icon3D({ icon: Icon, tone = 'blue', size = '1.4em', tilt = false, className = '' }: { icon: LucideIcon; tone?: IconTone; size?: string; tilt?: boolean; className?: string }) {
  return (
    <span className={`ty-icon ty-icon-${tone} ${tilt ? 'ty-icon-tilt' : ''} ${className}`} style={{ width: size, height: size }} aria-hidden>
      <Icon />
    </span>
  );
}

/** The game's emoji and the icon that stands for each in the new look. */
const EMOJI_ICONS: Record<string, [LucideIcon, IconTone]> = {
  '🚛': [Truck, 'blue'], '🚚': [Truck, 'cyan'], '🗺': [MapIcon, 'green'], '📋': [ClipboardList, 'cyan'], '🎯': [Target, 'gold'], '🎒': [Backpack, 'violet'],
  '💎': [Gem, 'pink'], '🏢': [Building2, 'silver'], '🏁': [Flag, 'orange'], '🎁': [Gift, 'pink'], '📅': [CalendarDays, 'red'], '👮': [Siren, 'red'],
  '❄': [Snowflake, 'ice'], '🌳': [TreeDeciduous, 'green'], '🐾': [PawPrint, 'orange'], '📦': [Package, 'orange'], '🔧': [Wrench, 'cyan'], '🧭': [Compass, 'cyan'],
  '🧰': [Briefcase, 'silver'], '💰': [Coins, 'gold'], '👑': [Crown, 'gold'], '⚡': [Zap, 'violet'], '🔢': [Hash, 'blue'], '🎨': [Palette, 'pink'],
  '🎃': [Ghost, 'orange'], '🎄': [Sparkles, 'green'], '🍒': [Cherry, 'red'], '🕺': [Disc3, 'violet'], '📼': [CassetteTape, 'violet'], '💿': [Disc3, 'blue'],
  '🥚': [Egg, 'pink'], '🖤': [Heart, 'silver'], '🛠': [Hammer, 'orange'], '🔗': [Link, 'cyan'], '🏭': [Warehouse, 'silver'], '✏': [Pencil, 'green'],
  '🛍': [ShoppingBag, 'pink'], '🪙': [Coins, 'gold'], '📈': [TrendingUp, 'green'], '💵': [Banknote, 'green'], '🏆': [Trophy, 'gold'], '⭐': [Star, 'gold'], '👤': [User, 'green'],
};

/** The icon for an emoji (the variation selector does not matter), or nothing. */
export function iconForEmoji(emoji: string): [LucideIcon, IconTone] | undefined {
  return EMOJI_ICONS[emoji.replace(/️/g, '')];
}

/**
 * The emoji in the classic look and its 3D icon in the new one — both are
 * rendered and the page's look shows one (`.ty-emoji` / `.ty-only` in tycoon.css),
 * so server pages need not know the player's look. An emoji without an icon stays as it is.
 */
export function Glyph({ emoji, size, tilt, className = '' }: { emoji: string; size?: string; tilt?: boolean; className?: string }) {
  const icon = iconForEmoji(emoji);
  if (!icon) return <span className={className} aria-hidden>{emoji}</span>;
  return (
    <>
      <span className={`ty-emoji ${className}`} aria-hidden>{emoji}</span>
      <Icon3D icon={icon[0]} tone={icon[1]} size={size} tilt={tilt} className="ty-only" />
    </>
  );
}
