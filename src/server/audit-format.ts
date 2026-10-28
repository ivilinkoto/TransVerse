import { ROLE_LABELS, type Role } from '@/server/auth/roles';
import { t, intlLocale } from '@/i18n/t';

const role = (r: unknown) => ROLE_LABELS[r as Role] ?? String(r ?? '—');
const eur = (cents: unknown) => t('{0} лв.', new Intl.NumberFormat(intlLocale(), { minimumFractionDigits: 2 }).format(Number(cents ?? 0) / 100));

/** Human-readable Bulgarian description of an administrative action. */
export function describeAudit(entry: { action: string; details: unknown }, actor: string | null, target: string | null): string {
  const d = (entry.details ?? {}) as Record<string, unknown>;
  const who = target ?? t('потребител');
  switch (entry.action) {
    case 'set_role':
      return t('Смени длъжността на {0}: {1} → {2}', who, role(d.from), role(d.to));
    case 'ban':
      return t('Блокира достъпа на {0}{1}', who, d.reason ? t(' (причина: {0})', String(d.reason)) : '');
    case 'unban':
      return t('Възстанови достъпа на {0}', who);
    case 'adjust_balance': {
      const amount = Number(d.amountCents ?? 0);
      return t('Корекция на баланса на {0}: {1}{2}{3}', who, amount > 0 ? '+' : '', eur(amount), d.reason ? ` — ${String(d.reason)}` : '');
    }
    case 'replenish_market':
      return t('Попълни товарния пазар ръчно ({0} нови поръчки)', Number(d.created ?? 0));
    case 'bootstrap_founder':
      return t('{0} получи длъжност {1} (при публикуване)', actor ?? who, ROLE_LABELS.founder);
    case 'create_global_event':
      return t('Създаде ивент „{0}“{1}', String(d.name ?? ''), d.startsAt ? t(' (от {0})', new Date(String(d.startsAt)).toLocaleString(intlLocale())) : '');
    case 'idea_status':
      return t('Промени идея „{0}“: {1}', String(d.title ?? ''), String(d.status ?? ''));
    case 'broadcast_banner':
      return d.cleared ? t('Махна съобщението на екипа') : t('Пусна съобщение на екипа: „{0}“', String(d.text ?? ''));
    case 'season_mode':
      return t('Смени празничната тема: {0}', d.value === 'auto' ? t('автоматично по дати') : d.value === 'off' ? t('изключена') : t('винаги {0}', String(d.value).replace('on:', '')));
    case 'discord_settings':
      return t('Настройки на Discord: {0}', [d.automod !== undefined ? t('автомодерация {0}', d.automod ? t('включена') : t('изключена')) : '', d.verification !== undefined ? t('проверка на новите {0}', d.verification ? t('включена') : t('изключена')) : ''].filter(Boolean).join(', '));
    case 'discord_appeal_accepted':
      return t('Прие обжалване в Discord{0}', target ? t(' на {0}', who) : '');
    case 'discord_appeal_rejected':
      return t('Отказа обжалване в Discord{0}', target ? t(' на {0}', who) : '');
    case 'discord_layout':
      return t('Подреди Discord сървъра: {0} нови канала/категории{1}', (d.created as string[] | undefined)?.length ?? 0, d.permissions ? t(', с правата') : '');
    case 'discord_warn':
      return t('Предупреждение в Discord{0}: {1}', target ? t(' за {0}', who) : '', String(d.reason ?? ''));
    case 'discord_timeout':
      return t('Заглуши в Discord{0}{1}: {2}', target ? ` ${who}` : '', d.inGame ? t(' (и в играта)') : '', String(d.reason ?? ''));
    case 'discord_ban':
      return t('Бан в Discord{0}: {1}', target ? t(' на {0}', who) : '', String(d.reason ?? ''));
    case 'discord_unban':
      return t('Свален бан в Discord{0}', target ? t(' на {0}', who) : '');
    case 'discord_repair':
      return t('Поправка на Discord бота: {0} команди, роли за {1} свързани играчи', Number(d.commands ?? 0), Number(d.players ?? 0));
    case 'verify_email':
      return t('Потвърди ръчно имейла на {0}', who);
    case 'password_reset_link':
      return t('Създаде линк за нова парола за {0}', who);
    case 'refund_payment':
      return t('Върна плащане от {0} на {1} ({2})', eur(d.amountCents), who, String(d.provider ?? ''));
    case 'cancel_global_event':
      return t('Отмени ивент „{0}“', String(d.name ?? ''));
    case 'set_vip':
      return t('Даде VIP на {0} за {1} дни{2}', who, Number(d.days ?? 0), d.until ? t(' (до {0})', new Date(String(d.until)).toLocaleDateString(intlLocale())) : '');
    case 'grant_coins':
      return t('Даде {0} ТрансКоин на {1}{2}', Number(d.amount ?? 0), who, d.reason ? ` — ${String(d.reason)}` : '');
    case 'remove_coins':
      return t('Отне {0} ТрансКоин от {1}{2}', -Number(d.amount ?? 0), who, d.reason ? ` — ${String(d.reason)}` : '');
    case 'remove_vip':
      return t('Премахна VIP статуса на {0}', who);
    case 'create_urgent_contract':
      return t('Създаде спешна доставка „{0}“: {1} → {2}, {3}, срок {4} мин, ×{5} по-бързо', String(d.goods ?? ''), String(d.from ?? ''), String(d.to ?? ''), eur(d.rewardCents), Number(d.windowMinutes ?? 0), Number(d.speedFactor ?? 1));
    case 'reset_company_branding':
      return t('Изчисти профила на компанията „{0}“ на {1}{2}', String(d.company ?? '—'), who, d.reason ? ` — ${String(d.reason)}` : '');
    default:
      return entry.action;
  }
}
