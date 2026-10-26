import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { t, tx } from '@/i18n/t';

/** What the player can do about a reason a vehicle cannot take a load, and where. */
export function fixFor(reason: string): { text: string; href: string } | null {
  if (reason.startsWith('Нужна е надстройка')) return { text: t('Прикачи подходящо ремарке в Сервиз или купи камион/ремарке с тази надстройка в Пазар.'), href: '/game/market' };
  if (reason.includes('няма прикачено ремарке')) return { text: t('Прикачи ремарке към влекача в Сервиз.'), href: '/game/garage' };
  if (reason.includes('заето')) return { text: t('Камионът е на курс — изчакай да пристигне.'), href: '/game/fleet' };
  if (reason.includes('шофьор') || reason.includes('Шофьорът')) return { text: t('Назначи шофьор.'), href: '/game/staff' };
  if (reason.includes('лошо състояние')) return { text: t('Ремонтирай в Сервиз.'), href: '/game/garage' };
  if (reason.includes('надвишава капацитета')) return { text: t('Нужен е камион с по-голяма товароподемност.'), href: '/game/market' };
  if (reason.includes('Обявено за продажба')) return { text: t('Свали обявата.'), href: '/game/market' };
  if (reason.startsWith('Изисква ниво')) return { text: t('Карай още курсове — нивото расте с опита.'), href: '/game/progress' };
  return null;
}

/**
 * v1.9: one clear box everywhere a load needs a vehicle — what the load
 * needs, and (grouped) why the player's vehicles cannot take it, with the
 * plates and a link to what fixes it.
 */
export function WhyNot({ needs, blocked, anyUsable }: { needs?: { label: string; value: string }[]; blocked: { label: string; error: string }[]; anyUsable: boolean }) {
  const by = new Map<string, string[]>();
  for (const b of blocked) by.set(b.error, [...(by.get(b.error) ?? []), b.label.split(' · ')[0]!]);
  const reasons = [...by];
  return (
    <div className="space-y-3">
      {needs && needs.length > 0 && (
        <div className="rounded-xl border border-asphalt-600 bg-asphalt-800/60 p-3 text-sm">
          <div className="label">{t('Какво е нужно')}</div>
          <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
            {needs.map((n) => <li key={n.label}><span className="text-mist-400">{tx(n.label)}: </span><span className="font-semibold">{tx(n.value)}</span></li>)}
          </ul>
        </div>
      )}
      {reasons.length > 0 && (
        <div className={`rounded-xl border p-3 text-sm ${anyUsable ? 'border-asphalt-600 bg-asphalt-800/40' : 'border-amber-sig/40 bg-amber-sig/5'}`}>
          <div className={`font-semibold ${anyUsable ? 'text-mist-300' : 'text-amber-sig'}`}>{anyUsable ? t('Защо някои камиони не стават') : t('Нито един твой камион не може да поеме това')}</div>
          <ul className="mt-1.5 space-y-2">
            {reasons.map(([reason, plates]) => {
              const fix = fixFor(reason);
              return (
                <li key={reason}>
                  <div><AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-amber-sig" />{reason}</div>
                  <div className="text-xs text-mist-400">{plates.join(', ')}</div>
                  {fix && <Link href={fix.href} className="mt-0.5 block text-xs text-cyan-glow hover:underline">{tx(fix.text)} →</Link>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
