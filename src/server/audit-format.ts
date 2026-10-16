import { ROLE_LABELS, type Role } from '@/server/auth/roles';

const role = (r: unknown) => ROLE_LABELS[r as Role] ?? String(r ?? '—');
const eur = (cents: unknown) => new Intl.NumberFormat('bg-BG', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(Number(cents ?? 0) / 100);

/** Human-readable Bulgarian description of an administrative action. */
export function describeAudit(entry: { action: string; details: unknown }, actor: string | null, target: string | null): string {
  const d = (entry.details ?? {}) as Record<string, unknown>;
  const who = target ?? 'потребител';
  switch (entry.action) {
    case 'set_role':
      return `Смени длъжността на ${who}: ${role(d.from)} → ${role(d.to)}`;
    case 'ban':
      return `Блокира достъпа на ${who}${d.reason ? ` (причина: ${String(d.reason)})` : ''}`;
    case 'unban':
      return `Възстанови достъпа на ${who}`;
    case 'adjust_balance': {
      const amount = Number(d.amountCents ?? 0);
      return `Корекция на баланса на ${who}: ${amount > 0 ? '+' : ''}${eur(amount)}${d.reason ? ` — ${String(d.reason)}` : ''}`;
    }
    case 'replenish_market':
      return `Попълни товарния пазар ръчно (${Number(d.created ?? 0)} нови поръчки)`;
    case 'bootstrap_founder':
      return `${actor ?? who} получи длъжност ${ROLE_LABELS.founder} (при публикуване)`;
    default:
      return entry.action;
  }
}
