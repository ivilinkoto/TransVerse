import { featureLive } from '@/lib/game/features';
import { money } from '@/lib/format';
import type { Database } from '@/server/db/client';
import { BALANCE, economyOverview, fraudSignals } from '@/server/admin-economy';
import { appUrl } from './config';
import { announce } from './outbox';
import { t as tr } from '@/i18n/t';

const footer = { text: 'TransVerse · сигнал за екипа' };
const day = (now: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(now);
const week = (now: Date) => {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return day(d);
};

/**
 * Worker (v1.5): fraud signals and a fast-growing economy go to #сигнали
 * (staff only). Each signal once a day (the economy once a week); nothing is
 * punished automatically — the staff look and decide.
 */
export async function postStaffAlerts(db: Database, now = new Date()) {
  if (!featureLive('staff_alerts', now)) return 0;
  const [fraud, economy] = await Promise.all([fraudSignals(db, now), economyOverview(db, now)]);
  const link = `${appUrl()}/admin/economy`;
  const today = day(now);
  let n = 0;
  const send = async (key: string, title: string, description: string, color = 0xe04545) => {
    await announce(db, `staff-alert:${key}`, 'staffAlerts', { embeds: [{ title, description, url: link, color, footer }] }, now);
    n++;
  };
  for (const t of fraud.sameNetwork) await send(`net:${t.from}:${t.to}:${today}`, tr('🚨 Пари между акаунти от една мрежа'), tr('**{0}** → **{1}**: {2} ({3} превода за седмица).', t.from, t.to, money(t.amount), t.n));
  for (const t of fraud.transfers) await send(`transfer:${t.from}:${t.to}:${today}`, tr('💸 Големи или чести преводи'), tr('**{0}** → **{1}**: {2} ({3} превода за седмица).', t.from, t.to, money(t.amount), t.n), 0xf97316);
  for (const f of fraud.fast) await send(`fast:${f.username}:${today}`, tr('⚡ Бързи пари'), tr('**{0}**: +{1} за 24 ч (от курсове {2}, друго {3}).', f.username, money(f.net), money(f.freight), money(f.other)), 0xf97316);
  if (economy.inflation > BALANCE.highInflation) {
    await send(`inflation:${week(now)}`, tr('📈 Икономиката расте бързо'), tr('Парите в играта са се увеличили с {0} % за седмица (праг {1} %). Виж предложението за баланс в таблото.', (economy.inflation * 100).toFixed(1), (BALANCE.highInflation * 100).toFixed(0)), 0xf6c343);
  }
  return n;
}
