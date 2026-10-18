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

const n = (v: number) => Math.round(v).toLocaleString('bg-BG');

/** The front-page headline, picked from what happened. */
export function headline(issue: NewsIssue): string {
  if (issue.longest && issue.longest.km >= 1500) return `${issue.longest.username} прекоси ${n(issue.longest.km)} км с един товар`;
  if (issue.topEarners[0]) return `${issue.topEarners[0].username} е шофьорът на седмицата`;
  if (issue.totals.deliveries > 0) return `${n(issue.totals.deliveries)} ${issue.totals.deliveries === 1 ? 'доставка' : 'доставки'} за една седмица`;
  return 'Тиха седмица по пътищата';
}

/** A short lead paragraph under the headline. */
export function lead(issue: NewsIssue): string {
  const t = issue.totals;
  if (!t.deliveries) return 'Камионите почиваха тази седмица. Борсата е пълна с поръчки — време е да тръгнем отново.';
  const parts = [`Шофьорите на TransVerse изпълниха ${n(t.deliveries)} ${t.deliveries === 1 ? 'доставка' : 'доставки'}, изминаха ${n(t.km)} км и превозиха ${n(t.tons)} т товари.`];
  if (t.players) parts.push(`На път ${t.players === 1 ? 'беше 1 играч' : `бяха ${n(t.players)} играчи`}.`);
  if (t.newPlayers) parts.push(`В играта ${t.newPlayers === 1 ? 'влезе 1 нов играч' : `влязоха ${n(t.newPlayers)} нови играчи`} — добре дошли!`);
  return parts.join(' ');
}
