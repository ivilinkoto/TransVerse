/**
 * Player companies: ranks, permissions, upgrades, levels and member bonuses.
 * Pure rules shared by server and UI.
 */

export const PERMISSIONS = {
  edit_profile: 'Редактиране на профила (описание, правила, лого, банер)',
  manage_members: 'Управление на членове (кандидатури, длъжности, изключване)',
  manage_ranks: 'Управление на длъжности',
  manage_upgrades: 'Развитие на компанията (покупка на подобрения)',
  manage_settings: 'Настройки (набиране, вноска, минимално ниво)',
  manage_chat: 'Чат (изтриване на съобщения и изчистване на целия чат)',
  manage_tenders: 'Търгове и възлагане на курсове на свободни шофьори',
} as const;
export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export interface RankTemplate {
  name: string;
  priority: number;
  permissions: Permission[];
  isOwner: boolean;
}

/** Ranks every new company starts with. Lower priority = higher rank. */
export const DEFAULT_RANKS: RankTemplate[] = [
  { name: 'Собственик', priority: 0, permissions: [...ALL_PERMISSIONS], isOwner: true },
  { name: 'Заместник', priority: 10, permissions: ['edit_profile', 'manage_members', 'manage_upgrades', 'manage_settings', 'manage_chat', 'manage_tenders'], isOwner: false },
  { name: 'Диспечер', priority: 20, permissions: ['manage_members', 'manage_tenders'], isOwner: false },
  { name: 'Шофьор', priority: 30, permissions: [], isOwner: false },
];

export const RECRUITMENT = { open: 'Отворена — всеки може да се присъедини', application: 'С кандидатура — нужно е одобрение', closed: 'Затворена' } as const;
export type Recruitment = keyof typeof RECRUITMENT;

export const COMPANY_LIMITS = {
  baseMembers: 5,
  contributionMax: 0.2,
  contributionDefault: 0.05,
  descriptionMax: 2000,
  rulesMax: 4000,
  logoMaxBytes: 300 * 1024,
  bannerMaxBytes: 1024 * 1024,
} as const;

/** Company experience needed for a level. */
export function companyXpForLevel(level: number): number {
  return level <= 1 ? 0 : Math.round(5000 * (level - 1) ** 1.6);
}
export function companyLevelForXp(xp: number): number {
  let level = 1;
  while (level < 50 && xp >= companyXpForLevel(level + 1)) level++;
  return level;
}

export interface UpgradeLevel {
  costCents: number;
  /** Company level needed to buy this upgrade level. */
  minCompanyLevel: number;
}

export interface CompanyUpgrade {
  id: 'logistics' | 'rental_partner' | 'training' | 'capacity';
  label: string;
  description: (level: number) => string;
  levels: UpgradeLevel[];
}

export const COMPANY_UPGRADES: CompanyUpgrade[] = [
  {
    id: 'logistics',
    label: 'Логистичен отдел',
    description: (l) => `+${l * 2}% възнаграждение за всеки курс на членовете`,
    levels: [
      { costCents: 8_000_00, minCompanyLevel: 1 },
      { costCents: 16_000_00, minCompanyLevel: 2 },
      { costCents: 30_000_00, minCompanyLevel: 3 },
      { costCents: 55_000_00, minCompanyLevel: 5 },
      { costCents: 90_000_00, minCompanyLevel: 7 },
    ],
  },
  {
    id: 'rental_partner',
    label: 'Договор с наемодател',
    description: (l) => `−${l * 5} процентни пункта наем за наетите камиони на членовете`,
    levels: [
      { costCents: 10_000_00, minCompanyLevel: 1 },
      { costCents: 25_000_00, minCompanyLevel: 3 },
      { costCents: 50_000_00, minCompanyLevel: 5 },
    ],
  },
  {
    id: 'training',
    label: 'Учебен център',
    description: (l) => `+${l * 5}% опит от доставки за членовете`,
    levels: [
      { costCents: 6_000_00, minCompanyLevel: 1 },
      { costCents: 15_000_00, minCompanyLevel: 2 },
      { costCents: 35_000_00, minCompanyLevel: 4 },
    ],
  },
  {
    id: 'capacity',
    label: 'Административна сграда',
    description: (l) => `${COMPANY_LIMITS.baseMembers + l * 5} места за членове`,
    levels: [
      { costCents: 5_000_00, minCompanyLevel: 1 },
      { costCents: 12_000_00, minCompanyLevel: 2 },
      { costCents: 25_000_00, minCompanyLevel: 4 },
      { costCents: 45_000_00, minCompanyLevel: 6 },
      { costCents: 80_000_00, minCompanyLevel: 8 },
      { costCents: 120_000_00, minCompanyLevel: 10 },
      { costCents: 160_000_00, minCompanyLevel: 12 },
      { costCents: 200_000_00, minCompanyLevel: 14 },
      { costCents: 250_000_00, minCompanyLevel: 16 },
    ],
  },
];

export type UpgradeLevels = Partial<Record<CompanyUpgrade['id'], number>>;

export interface MemberBonuses {
  rewardMultiplier: number;
  rentalShareReduction: number;
  xpMultiplier: number;
}

export function memberBonuses(upgrades: UpgradeLevels): MemberBonuses {
  return {
    rewardMultiplier: 1 + 0.02 * (upgrades.logistics ?? 0),
    rentalShareReduction: 0.05 * (upgrades.rental_partner ?? 0),
    xpMultiplier: 1 + 0.05 * (upgrades.training ?? 0),
  };
}

export function memberCapacity(upgrades: UpgradeLevels): number {
  return COMPANY_LIMITS.baseMembers + 5 * (upgrades.capacity ?? 0);
}

/** Features unlocked by company level. */
export const COMPANY_UNLOCKS = [
  { level: 1, key: 'basics', label: 'Лого, описание, правила, 4 длъжности по подразбиране' },
  { level: 2, key: 'custom_ranks', label: 'Собствени длъжности (до 6)' },
  { level: 3, key: 'banner', label: 'Банер и фирмен цвят' },
  { level: 4, key: 'more_ranks', label: 'До 10 длъжности' },
  { level: 5, key: 'tag', label: 'Таг на компанията в класациите' },
] as const;
export type UnlockKey = (typeof COMPANY_UNLOCKS)[number]['key'];

export function hasUnlock(companyLevel: number, key: UnlockKey): boolean {
  return companyLevel >= (COMPANY_UNLOCKS.find((u) => u.key === key)?.level ?? Infinity);
}

export function maxRanks(companyLevel: number): number {
  return hasUnlock(companyLevel, 'more_ranks') ? 10 : hasUnlock(companyLevel, 'custom_ranks') ? 6 : DEFAULT_RANKS.length;
}

/** Recognises PNG, JPEG and WebP by their magic bytes (no SVG — it can carry scripts). */
export function sniffImage(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}
