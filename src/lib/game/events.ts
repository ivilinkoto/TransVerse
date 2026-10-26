/**
 * Global events: community goals for every player at once ("move 1 000 000 t
 * together"). Pure rules shared by server and UI.
 *
 * Everyone contributes with ordinary deliveries. When the goal is reached in
 * time, every participant who contributed at least the minimum is rewarded and
 * the top contributors get extra rewards (VIP days included). If the goal is
 * not reached, nobody is rewarded — the point is to pull together.
 */
import { CARGO, type CargoType } from './cargo';
import { hash, LONG_HAUL_KM, sofiaMidnight, sofiaParts, type DeliveryFacts } from './missions';
import { t, tx, intlLocale } from '@/i18n/t';

export const EVENT_METRICS = ['tons', 'deliveries', 'km', 'on_time', 'international', 'heavy', 'long_haul', 'earned_cents', 'holiday'] as const;
export type EventMetric = (typeof EVENT_METRICS)[number];

export interface MetricInfo {
  label: string;
  /** Short unit after a number. */
  unit: string;
  /** Lowest target an automatic event gets, whatever the recent activity. */
  floor: number;
  /** Default minimum contribution to count as a participant. */
  minContribution: number;
}

export const EVENT_METRIC_INFO: Record<EventMetric, MetricInfo> = {
  tons: { label: 'Превозени тонове', unit: 'т', floor: 300, minContribution: 5 },
  deliveries: { label: 'Доставки', unit: 'доставки', floor: 40, minContribution: 1 },
  km: { label: 'Километри с товар', unit: 'км', floor: 15_000, minContribution: 200 },
  on_time: { label: 'Навременни доставки', unit: 'доставки', floor: 30, minContribution: 1 },
  international: { label: 'Международни доставки', unit: 'доставки', floor: 10, minContribution: 1 },
  heavy: { label: 'Товари над 15 т', unit: 'товара', floor: 10, minContribution: 1 },
  long_haul: { label: `Курсове над ${LONG_HAUL_KM} км`, unit: 'курса', floor: 8, minContribution: 1 },
  earned_cents: { label: 'Спечелено навло', unit: 'лв.', floor: 50_000_00, minContribution: 1_000_00 },
  holiday: { label: 'Празнични доставки', unit: 'доставки', floor: 40, minContribution: 1 },
};

export interface EventFilter {
  metric: EventMetric;
  cargoType: string | null;
  countryCode: string | null;
}

/** What one delivery adds to an event (0 when it does not match the event's filters). */
export function eventIncrement(e: EventFilter, f: DeliveryFacts): number {
  if (e.cargoType && f.cargoType !== e.cargoType) return 0;
  if (e.countryCode && !f.countries.includes(e.countryCode)) return 0;
  switch (e.metric) {
    case 'tons':
      return Math.round(f.tons * 10) / 10;
    case 'deliveries':
      return 1;
    case 'km':
      return Math.round(f.loadedKm);
    case 'on_time':
      return f.onTime ? 1 : 0;
    case 'international':
      return new Set(f.countries).size > 1 ? 1 : 0;
    case 'heavy':
      return f.tons >= 15 ? 1 : 0;
    case 'long_haul':
      return f.loadedKm >= LONG_HAUL_KM ? 1 : 0;
    case 'earned_cents':
      return f.rewardCents;
    case 'holiday':
      return f.holiday ? 1 : 0;
  }
}

/** "1 250 т", "48 доставки", "75 000 лв.". */
export function formatAmount(metric: EventMetric, value: number): string {
  if (metric === 'earned_cents') return t('{0} лв.', Math.round(value / 100).toLocaleString(intlLocale()));
  const v = metric === 'tons' ? Math.round(value * 10) / 10 : Math.round(value);
  return `${v.toLocaleString(intlLocale())} ${tx(EVENT_METRIC_INFO[metric].unit)}`;
}

/** Plain-language goal, e.g. "Превозете заедно 1 000 000 т хладилни стоки". */
export function goalText(e: EventFilter & { target: number }, countryName?: string | null): string {
  const cargo = e.cargoType ? CARGO[e.cargoType as CargoType]?.label.toLowerCase() : null;
  const where = e.countryCode ? t(' по маршрути през {0}', countryName ?? e.countryCode) : '';
  const amount = formatAmount(e.metric, e.target);
  switch (e.metric) {
    case 'tons':
      return t('Превозете заедно {0}{1}{2}', amount, cargo ? ` ${cargo}` : t(' товари'), where);
    case 'km':
      return t('Изминете заедно {0} с товар{1}{2}', amount, cargo ? ` (${cargo})` : '', where);
    case 'earned_cents':
      return t('Спечелете заедно {0} навло{1}{2}', amount, cargo ? t(' от {0}', cargo) : '', where);
    default: {
      const n = Math.round(e.target).toLocaleString(intlLocale());
      const what: Record<string, string> = { deliveries: t('доставки'), on_time: t('навременни доставки'), international: t('международни доставки'), heavy: t('доставки на товари над 15 т'), long_haul: t('курса над {0} км', LONG_HAUL_KM), holiday: t('празнични доставки') };
      return t('Изпълнете заедно {0} {1}{2}{3}', n, what[e.metric], cargo ? ` (${cargo})` : '', where);
    }
  }
}

// ── Rewards ───────────────────────────────────────────────────────────────

export interface Reward {
  cents: number;
  xp: number;
  coins: number;
  vipDays: number;
}

export interface EventRewards {
  participant: { cents: number; xp: number; coins: number };
  top: Reward[];
}

export const MAX_TOP_PLACES = 10;

export const DEFAULT_REWARDS: EventRewards = {
  participant: { cents: 1_500_00, xp: 300, coins: 0 },
  top: [
    { cents: 15_000_00, xp: 1_500, coins: 150, vipDays: 7 },
    { cents: 10_000_00, xp: 1_000, coins: 100, vipDays: 5 },
    { cents: 7_500_00, xp: 750, coins: 75, vipDays: 3 },
    { cents: 5_000_00, xp: 500, coins: 50, vipDays: 0 },
    { cents: 3_000_00, xp: 300, coins: 30, vipDays: 0 },
  ],
};

/** A participant's total reward: the participant share plus their place's bonus. */
export function rewardFor(rewards: EventRewards, rank: number | null): Reward {
  const base = { ...rewards.participant, vipDays: 0 };
  const top = rank ? rewards.top[rank - 1] : undefined;
  if (!top) return base;
  return { cents: base.cents + top.cents, xp: base.xp + top.xp, coins: base.coins + top.coins, vipDays: top.vipDays };
}

export function rewardText(r: Partial<Reward>): string {
  const parts: string[] = [];
  if (r.vipDays) parts.push(`VIP ${r.vipDays} ${r.vipDays === 1 ? t('ден') : t('дни')}`);
  if (r.coins) parts.push(`${r.coins} TC`);
  if (r.cents) parts.push(t('{0} лв.', Math.round(r.cents / 100).toLocaleString(intlLocale())));
  if (r.xp) parts.push(t('{0} опит', r.xp.toLocaleString(intlLocale())));
  return parts.join(' · ') || '—';
}

// ── Automatic events ──────────────────────────────────────────────────────

export interface EventTemplate {
  id: string;
  name: string;
  description: string;
  metric: EventMetric;
  cargoType?: CargoType;
  countryCode?: string;
}

/** Rotating automatic events. Names are the game's own. */
export const EVENT_TEMPLATES: EventTemplate[] = [
  { id: 'great_move', name: 'Великото преместване', description: 'Всички шофьори на TransVerse превозват заедно огромно количество товари. Всеки тон е важен.', metric: 'tons' },
  { id: 'cold_chain', name: 'Студената верига', description: 'Магазините чакат пресни продукти — хладилните камиони не бива да спират.', metric: 'tons', cargoType: 'refrigerated' },
  { id: 'thousand_km', name: 'Маратонът на хилядите километри', description: 'Пътят е дълъг, но заедно ще го изминем. Брои се всеки километър с товар.', metric: 'km' },
  { id: 'balkan_express', name: 'Балкански експрес', description: 'Границите са само линии на картата. Брои се всяка доставка между две държави.', metric: 'international' },
  { id: 'right_on_time', name: 'Точно навреме', description: 'Клиентите ценят точността. Брои се всяка доставка, пристигнала в срок.', metric: 'on_time' },
  { id: 'steel_caravan', name: 'Стоманеният керван', description: 'Тежки товари за големите строежи. Брои се всеки товар над 15 тона.', metric: 'heavy' },
  { id: 'gold_rush', name: 'Златна треска', description: 'Пазарът е горещ — заедно ще изкараме цяло състояние от навло.', metric: 'earned_cents' },
  { id: 'long_road', name: 'Дългият път', description: `Курсове от край до край на картата. Брои се всеки курс над ${LONG_HAUL_KM} км.`, metric: 'long_haul' },
  { id: 'home_roads', name: 'Родни пътища', description: 'България има нужда от своите шофьори. Брои се всяка доставка по маршрут през България.', metric: 'deliveries', countryCode: 'BG' },
  { id: 'harvest_convoy', name: 'Конвоят на реколтата', description: 'Зърното трябва да стигне до пристанищата и мелниците. Брои се всеки тон насипен товар.', metric: 'tons', cargoType: 'bulk' },
];

/**
 * Regional events of "Цяла Европа" (v1.7): one country each, in the rotation
 * once the feature is live.
 */
export const REGIONAL_EVENT_TEMPLATES: EventTemplate[] = [
  { id: 'alpine_run', name: 'Алпийски рейс', description: 'Проходите са отворени, а складовете в Швейцария чакат. Брои се всяка доставка по маршрут през Швейцария.', metric: 'deliveries', countryCode: 'CH' },
  { id: 'italian_summer', name: 'Италианско лято', description: 'Пресни плодове и зеленчуци от Италия за цяла Европа. Брои се всеки тон по маршрути през Италия.', metric: 'tons', countryCode: 'IT' },
  { id: 'iberian_road', name: 'Иберийски път', description: 'Дългият път до Испания и Португалия. Брои се всеки километър с товар по маршрути през Испания.', metric: 'km', countryCode: 'ES' },
  { id: 'french_riviera', name: 'Френска ривиера', description: 'Пристанищата и хотелите по брега имат нужда от доставки. Брои се всяка доставка по маршрут през Франция.', metric: 'deliveries', countryCode: 'FR' },
  { id: 'polish_corridor', name: 'Полски коридор', description: 'Пътят от Балтика до юга минава през Полша. Брои се всеки тон по маршрути през Полша.', metric: 'tons', countryCode: 'PL' },
  { id: 'benelux_ports', name: 'Пристанищата на Бенелюкс', description: 'Ротердам и Антверпен не спят. Брои се всяка доставка по маршрут през Нидерландия.', metric: 'deliveries', countryCode: 'NL' },
];

/** Every template an administrator can start (automatic rotation picks from `rotation()`). */
export const ALL_EVENT_TEMPLATES: EventTemplate[] = [...EVENT_TEMPLATES, ...REGIONAL_EVENT_TEMPLATES];

export const AUTO_EVENT_HOURS = 72;
/** Pause between automatic events (the next one is announced during it). */
export const AUTO_EVENT_GAP_HOURS = 20;

/** 18:00 Bulgarian time on the first day whose 18:00 is at or after `at`. */
export function sofiaEveningOnOrAfter(at: Date): Date {
  const { y, m, d } = sofiaParts(at);
  for (let i = 0; i < 3; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i));
    const evening = new Date(sofiaMidnight(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()).getTime() + 18 * 3_600_000);
    if (evening >= at) return evening;
  }
  return at;
}

/** When the next automatic event starts and ends. The very first one starts right away. */
export function nextAutoWindow(previousEnd: Date | null, now: Date): { startsAt: Date; endsAt: Date } {
  const startsAt = previousEnd ? sofiaEveningOnOrAfter(new Date(Math.max(previousEnd.getTime() + AUTO_EVENT_GAP_HOURS * 3_600_000, now.getTime()))) : now;
  return { startsAt, endsAt: new Date(startsAt.getTime() + AUTO_EVENT_HOURS * 3_600_000) };
}

/** Deterministic template for a start time, never the same as the previous one. */
export function pickTemplate(startsAt: Date, previous: string | null, regional = false): EventTemplate {
  const list = regional ? ALL_EVENT_TEMPLATES : EVENT_TEMPLATES;
  let i = hash(`event:${startsAt.toISOString()}`) % list.length;
  if (list[i]!.id === previous) i = (i + 1) % list.length;
  return list[i]!;
}

/** Rounds a target to two significant digits (12 345 → 12 000). */
export function niceNumber(n: number): number {
  if (n <= 0) return 0;
  const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(n)) - 1));
  return Math.round(n / p) * p;
}

/** Target for an automatic event: a bit more than the recent pace would give, never below the floor. */
export function autoTarget(metric: EventMetric, recentAmount: number, recentHours: number, durationHours: number): number {
  const expected = recentHours > 0 ? (recentAmount * durationHours) / recentHours : 0;
  return niceNumber(Math.max(EVENT_METRIC_INFO[metric].floor, (expected * 115) / 100));
}

export type EventStatus = 'scheduled' | 'active' | 'ending' | 'success' | 'failed' | 'cancelled';

/** Where an event stands: before start, running, finished (awaiting settlement) or settled. */
export function eventStatus(e: { startsAt: Date; endsAt: Date; completedAt: Date | null; outcome: string | null }, now: Date): EventStatus {
  if (e.outcome === 'success' || e.outcome === 'failed' || e.outcome === 'cancelled') return e.outcome;
  if (now < e.startsAt) return 'scheduled';
  if (e.completedAt || now >= e.endsAt) return 'ending';
  return 'active';
}
