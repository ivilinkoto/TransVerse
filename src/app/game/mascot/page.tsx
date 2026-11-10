import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { TextAction } from '@/components/ui/TextAction';
import { MascotAdopt } from '@/components/game/MascotAdopt';
import { MascotArt } from '@/components/game/MascotArt';
import { ACCESSORIES, MASCOT, MASCOTS, tripsToNext, moodWord, type Accessory } from '@/lib/game/mascot';
import { dateTime, int } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { mascotView } from '@/server/game/mascot';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Талисман') };
}

/** 1.3 „Талисман в кабината“: adopt, look after and dress up the companion. */
export default async function MascotPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.mascot) notFound();
  const m = await mascotView(db, user.id, now);
  const header = (
    <PageHeader
      title={t('Талисман')}
      subtitle={t('Спътникът в кабината ти.')}
      help={t('Доставка: +{0} настроение, ден без доставка: −{1}. Под {2} е тъжен и не носи бонус. Галене: +{3} веднъж на {4} ч.', MASCOT.mood.perTrip, MASCOT.mood.perIdleDay, MASCOT.mood.sadBelow, MASCOT.mood.perPet, MASCOT.petEveryHours)}
    />
  );
  if (!m) return <div className="space-y-4">{header}<MascotAdopt /></div>;
  const def = MASCOTS[m.kind];
  const next = tripsToNext(m.trips);
  const share = next ? (m.trips - next.from) / (next.need - next.from) : 1;
  return (
    <div className="space-y-4">
      {header}
      <section className="mascot-card grid gap-4 rounded-3xl p-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:p-5" style={{ '--tile': def.colour } as React.CSSProperties} data-testid="mascot">
        <div className="mascot-stage flex flex-col items-center justify-end rounded-2xl px-6 pt-4">
          <div className={m.sad ? '' : 'mascot-bob'}>
            <MascotArt kind={m.kind} accessory={m.accessory} sad={m.sad} className="h-40 w-40" />
          </div>
        </div>
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="font-display text-2xl font-bold text-white" data-testid="mascot-name-shown">{tx(m.name)}</h2>
            <span className="text-sm text-mist-300">{tx(def.label)} · {t('ниво {0}', m.level)}</span>
          </div>
          <div>
            <div className="flex justify-between text-xs text-mist-300"><span>{t('Настроение: {0}', tx(moodWord(m.mood)))}</span><span className="num">{m.mood}/100</span></div>
            <div className="stat-track mt-1"><div className={`stat-fill ${m.sad ? 'bg-loss' : ''}`} style={{ width: `${m.mood}%`, '--fill': m.sad ? '#f43f5e' : '#34d399' } as React.CSSProperties} /></div>
          </div>
          <div>
            <div className="flex justify-between text-xs text-mist-300"><span>{next ? t('До ниво {0}', m.level + 1) : t('Най-високото ниво')}</span><span className="num">{next ? `${int(m.trips)}/${int(next.need)}` : int(m.trips)} {t('курса')}</span></div>
            <div className="stat-track mt-1"><div className="stat-fill" style={{ width: `${Math.round(share * 100)}%`, '--fill': '#22d3ee' } as React.CSSProperties} /></div>
          </div>
          <ul className="grid grid-cols-2 gap-2 text-sm">
            <li className="stat-tile rounded-xl px-3 py-2"><span className="block text-[11px] text-mist-400">{t('Бонус')}</span><span className="font-bold text-profit">{m.sad ? t('няма (тъжен)') : `+${m.bonusPct}%`}</span></li>
            <li className="stat-tile rounded-xl px-3 py-2"><span className="block text-[11px] text-mist-400">{t('Любим курс (×2)')}</span><span className="font-semibold text-white">{tx(def.favourite)}</span></li>
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            {m.canPet ? (
              <ActionButton action={{ type: 'petMascot' }} className="game-action game-action-main flex-row px-5 py-2 text-sm">🤚 {t('Погали')}</ActionButton>
            ) : (
              <span className="text-xs text-mist-400">{t('Следващо галене: {0}', dateTime(m.nextPetAt!))}</span>
            )}
          </div>
        </div>
      </section>
      <section className="panel space-y-3 p-4">
        <h3 className="font-display font-bold text-white">{t('Аксесоари')}</h3>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.entries(ACCESSORIES) as [Accessory, { label: string; level: number }][]).map(([id, a]) => {
            const open = m.level >= a.level;
            const on = m.accessory === id;
            return (
              <li key={id} className={`mascot-acc flex flex-col items-center gap-1 rounded-2xl p-2 text-center ${on ? 'mascot-acc-on' : ''} ${open ? '' : 'opacity-50'}`}>
                <MascotArt kind={m.kind} accessory={id} className="h-16 w-16" />
                <span className="text-sm font-semibold text-white">{tx(a.label)}</span>
                {open ? (
                  <ActionButton action={{ type: 'setMascotAccessory', accessory: on ? null : id }} className="game-action flex-row px-3 py-1 text-xs">{on ? t('Свали') : t('Сложи')}</ActionButton>
                ) : (
                  <span className="text-[11px] text-mist-400">🔒 {t('ниво {0}', a.level)}</span>
                )}
              </li>
            );
          })}
        </ul>
        <TextAction label={t('Смени името')} action={{ type: 'renameMascot' }} field="name" placeholder={tx(m.name)} ariaLabel={t('Ново име')} maxLength={MASCOT.nameMax} />
      </section>
    </div>
  );
}
