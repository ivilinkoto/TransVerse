import { t as tr, intlLocale } from '@/i18n/t';
/**
 * "Седмичник TransVerse": a weekly newspaper written from the game's own data
 * every Monday (Sofia) for the week that just ended. Everything in it is game
 * data; the shape is stored as JSON so old issues stay as they were.
 */

export interface NewsPlayer {
  username: string;
  value: number;
}

export interface NewsIssue {
  week: { key: string; from: string; to: string };
  totals: { deliveries: number; km: number; tons: number; players: number; newPlayers: number };
  /** Best players by net result and by number of deliveries. */
  topEarners: NewsPlayer[];
  topDrivers: NewsPlayer[];
  topCompanies: { name: string; tag: string | null; deliveries: number }[];
  longest: { username: string; from: string; to: string; km: number; goods: string } | null;
  richest: { username: string; from: string; to: string; rewardCents: number; goods: string } | null;
  fuel: { cheapest: { country: string; cents: number }; dearest: { country: string; cents: number } } | null;
  /** Cargo the market wants most right now (average demand), and the least. */
  demand: { hot: { cargo: string; demand: number } | null; cold: { cargo: string; demand: number } | null };
  upcoming: { name: string; startsAt: string; endsAt: string }[];
  marketEvents: { title: string; endsAt: string }[];
}

const n = (v: number) => Math.round(v).toLocaleString(intlLocale());

/** The front-page headline, picked from what happened. */
export function headline(issue: NewsIssue): string {
  if (issue.longest && issue.longest.km >= 1500) return tr('{0} прекоси {1} км с един товар', issue.longest.username, n(issue.longest.km));
  if (issue.topEarners[0]) return tr('{0} е шофьорът на седмицата', issue.topEarners[0].username);
  if (issue.totals.deliveries > 0) return tr('{0} {1} за една седмица', n(issue.totals.deliveries), issue.totals.deliveries === 1 ? tr('доставка') : tr('доставки'));
  return tr('Тиха седмица по пътищата');
}

/** A short lead paragraph under the headline. */
export function lead(issue: NewsIssue): string {
  const t = issue.totals;
  if (!t.deliveries) return tr('Камионите почиваха тази седмица. Борсата е пълна с поръчки — време е да тръгнем отново.');
  const parts = [tr('Шофьорите на TransVerse изпълниха {0} {1}, изминаха {2} км и превозиха {3} т товари.', n(t.deliveries), t.deliveries === 1 ? tr('доставка') : tr('доставки'), n(t.km), n(t.tons))];
  if (t.players) parts.push(tr('На път {0}.', t.players === 1 ? tr('беше 1 играч') : tr('бяха {0} играчи', n(t.players))));
  if (t.newPlayers) parts.push(tr('В играта {0} — добре дошли!', t.newPlayers === 1 ? tr('влезе 1 нов играч') : tr('влязоха {0} нови играчи', n(t.newPlayers))));
  return parts.join(' ');
}
