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
    case 'create_global_event':
      return `Създаде ивент „${String(d.name ?? '')}“${d.startsAt ? ` (от ${new Date(String(d.startsAt)).toLocaleString('bg-BG')})` : ''}`;
    case 'refund_payment':
      return `Върна плащане от ${eur(d.amountCents)} на ${who} (${String(d.provider ?? '')})`;
    case 'cancel_global_event':
      return `Отмени ивент „${String(d.name ?? '')}“`;
    case 'set_vip':
      return `Даде VIP на ${who} за ${Number(d.days ?? 0)} дни${d.until ? ` (до ${new Date(String(d.until)).toLocaleDateString('bg-BG')})` : ''}`;
    case 'grant_coins':
      return `Даде ${Number(d.amount ?? 0)} ТрансКоин на ${who}${d.reason ? ` — ${String(d.reason)}` : ''}`;
    case 'remove_coins':
      return `Отне ${-Number(d.amount ?? 0)} ТрансКоин от ${who}${d.reason ? ` — ${String(d.reason)}` : ''}`;
    case 'remove_vip':
      return `Премахна VIP статуса на ${who}`;
    case 'create_urgent_contract':
      return `Създаде спешна доставка „${String(d.goods ?? '')}“: ${String(d.from ?? '')} → ${String(d.to ?? '')}, ${eur(d.rewardCents)}, срок ${Number(d.windowMinutes ?? 0)} мин, ×${Number(d.speedFactor ?? 1)} по-бързо`;
    case 'reset_company_branding':
      return `Изчисти профила на компанията „${String(d.company ?? '—')}“ на ${who}${d.reason ? ` — ${String(d.reason)}` : ''}`;
    default:
      return entry.action;
  }
}
