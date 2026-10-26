import Link from 'next/link';
import { ExternalLink, MessagesSquare } from 'lucide-react';
import { GLOSSARY } from '@/lib/game/glossary';
import { gameContext } from '@/server/game/context';
import { DISCORD_URL } from '@/lib/community';
import { Card, PageHeader } from '@/components/ui';
import { CLIENT_RULES } from '@/lib/game/clients';
import { CREW_RULES, TRAIT_IDS, TRAITS } from '@/lib/game/crew';
import { FINE_RULES, INSURANCE } from '@/lib/game/fines';
import { HALLOWEEN } from '@/lib/game/halloween';
import { CHRISTMAS } from '@/lib/game/christmas';
import { ECONOMY } from '@/lib/game/economy';
import { AUTO_DISPATCH_PER_DAY } from '@/server/game/dispatch';
import { AUCTION_RULES } from '@/lib/game/auctions';
import { t as tr, tx, intlLocale } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Помощ и правила') };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const eur = (cents: number) => tr('{0} лв.', Math.round(cents / 100).toLocaleString(intlLocale()));

/** Built while rendering, so the texts are in the player's language. */
const sections = (): { id: string; title: string; items: React.ReactNode[] }[] => [
  {
    id: 'start',
    title: 'Как се играе',
    items: [
      'Избираш поръчка от борсата и камион, който може да я поеме — той кара празен до товара, натоварва и тръгва. Всичко става в реално време, дори когато не си в играта.',
      'Наградата е сумата на поръчката. Плащаш гориво (по цените на държавите по пътя), пътни такси и поддръжка; наетият камион вместо това взима наем.',
      tr('Навреме — бонус {0} при голям запас от време; със закъснение — неустойка {1}. Репутацията расте с доставки навреме и отключва премиум поръчки.', pct(ECONOMY.earlyBonusShare), pct(ECONOMY.latePenaltyShare)),
    ],
  },
  {
    id: 'board',
    title: 'Борсата',
    items: [
      'Диспечер: „Предложи курсове“ избира за всеки свободен камион най-изгодната обикновена поръчка (печалба за минута път), която ще стигне навреме. Ти избираш кои да тръгнат.',
      tr('VIP диспечер (Автопарк): камионът сам поема следващия курс, щом е свободен — до {0} курса на ден.', AUTO_DISPATCH_PER_DAY),
      'Любими линии: звездата в отворена поръчка — поръчките по линията са най-отгоре и получаваш известие за нова (до веднъж на час).',
      'Бързи филтри: любими, празнични, без нужда от лиценз, до 2 часа, над 3 лв./км.',
      tr('Специални товари (Поръчки → Специални товари): търг всеки ден в {0} за {1} минути. Печели най-ниската цена; победителят има {2} часа да изпрати камион, иначе губи товара и {3} репутация.', AUCTION_RULES.hours.map((h) => `${h}:00`).join(', '), AUCTION_RULES.minutes, AUCTION_RULES.sendHours, AUCTION_RULES.forfeitReputation),
    ],
  },
  {
    id: 'crew',
    title: 'Шофьори',
    items: [
      tr('Шофьорът кара до {0} ч преди дневна почивка. Часовете от последния курс се пренасят; след {1} мин престой е отпочинал.', CREW_RULES.soloDailyMin / 60, CREW_RULES.restGameMin),
      tr('Двоен екипаж (втори шофьор в същия камион): до {0} ч без почивки, по-кратки дълги курсове. Не във ван и не в нает камион.', CREW_RULES.teamDailyMin / 60),
      <>{tr('Умения — точка с всяко ниво:')}{' '}{TRAIT_IDS.map((t) => `${tx(TRAITS[t].short)} (${tx(TRAITS[t].perPoint)})`).join('; ')}.</>,
    ],
  },
  {
    id: 'trailers',
    title: 'Ремаркета',
    items: [
      'Полуремаркетата се теглят от влекач; тежкият влекач 6×4 тегли и нискорамно ремарке.',
      'Прикачните ремаркета вървят зад соло камион със същата надстройка и добавят своя товар.',
      'Платформа — метали и дървен материал; автовоз — нови автомобили.',
    ],
  },
  {
    id: 'clients',
    title: 'Клиенти',
    items: [
      tr('Договор: {0}–{1} товара по една линия до срок; всеки товар се плаща с около {2} над борсата.', CLIENT_RULES.loads[0], CLIENT_RULES.loads[1], pct(CLIENT_RULES.rewardMultiplier - 1)),
      tr('Изпълнен — бонус {0} и +{1} репутация (закъснелите товари намаляват бонуса). Неизпълнен — загуба на репутация.', pct(CLIENT_RULES.bonusShare), CLIENT_RULES.successReputation),
      tr('Активни договори: до {0} (VIP — {1}).', CLIENT_RULES.maxActive, CLIENT_RULES.maxActive + CLIENT_RULES.vipExtraActive),
    ],
  },
  {
    id: 'fines',
    title: 'Глоби и застраховка',
    items: [
      tr('Рискът е по избор: без задължителната почивка (проверка с шанс {0}) или претоварване до {1} ({2}).', pct(FINE_RULES.checkChance.hours), pct(FINE_RULES.overloadMax), pct(FINE_RULES.checkChance.overload)),
      tr('Глобата се плаща до {0} ч или се обжалва веднъж: {1} шанс да отпадне, иначе +{2}. След срока се удържа с +{3}.', FINE_RULES.dueHours, pct(FINE_RULES.appealWinChance), pct(FINE_RULES.appealLossShare), pct(FINE_RULES.latePayShare)),
      tr('Застраховка (Сервиз, {0} дни): пътната помощ при повреда е за сметка на застрахователя. Цена {1} + {2}% от стойността.', INSURANCE.days, eur(INSURANCE.baseCents), (INSURANCE.valueShare * 100).toFixed(2)),
    ],
  },
  {
    id: 'more',
    title: 'Още',
    items: [
      <>{tr('Анализ (Автопарк → Анализ): какво носи всеки камион, шофьор, линия и товар.')}</>,
      <>{tr('Седмичник (Състезание): вестник всеки понеделник за изминалата седмица.')}</>,
      tr('Хелуин ({0}–{1}): празнични поръчки с +{2}, общ ивент, мисии, значка и призрачен камион нощем.', HALLOWEEN.from.split('-').reverse().join('.'), HALLOWEEN.to.split('-').reverse().join('.'), pct(HALLOWEEN.rewardMultiplier - 1)),
      tr('Коледа ({0}–{1}): коледни поръчки с +{2}, общ ивент „Коледна треска“ до Бъдни вечер, мисии, значка и боя „Коледа“.', CHRISTMAS.from.split('-').reverse().join('.'), CHRISTMAS.to.split('-').reverse().join('.'), pct(CHRISTMAS.rewardMultiplier - 1)),
      <>{tr('Наставник (меню на профила): нов играч избира опитен шофьор (ниво 15+) — +10 % опит, а при ниво 5 награда и за двамата.')}</>,
      <>{tr('Помощ на пътя: приятел или колега закъса — с камион до 150 км натисни „Помогни на пътя“ на картата.')}</>,
      <>{tr('Обновленията и описанията им са в')}{' '}<Link href="/game/updates" className="text-cyan-glow hover:underline">{tr('Обновления')}</Link>{tr('; въпроси — в')}{' '}<Link href="/game/support" className="text-cyan-glow hover:underline">{tr('Поддръжка')}</Link>.</>,
    ],
  },
];

export default async function HelpPage() {
  await initLocale();
  const { features } = await gameContext();
  const glossary = features.glossary;
  const SECTIONS = sections();
  return (
    <div className="space-y-6">
      <PageHeader title={tr('Помощ и правила')} subtitle={tr('Всички системи на играта накратко. Числата са игрови правила.')} />
      <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="panel flex items-center gap-3 p-3.5 transition hover:border-volt-500/60">
        <MessagesSquare className="h-6 w-6 shrink-0 text-volt-400" />
        <span className="min-w-0 flex-1"><span className="block font-semibold">{tr('Discord сървър на TransVerse')}</span><span className="block text-sm text-mist-300">{tr('Питай другите играчи, следи новините, намери компания.')}</span></span>
        <ExternalLink className="h-4 w-4 shrink-0 text-mist-400" />
      </a>
      <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" aria-label={tr('Раздели')}>
        {glossary && <a href="#glossary" className="shrink-0 rounded-full border border-cyan-glow/40 px-3 py-1.5 text-sm text-cyan-glow hover:text-white">{tr('Речник')}</a>}
        {SECTIONS.map((s) => <a key={s.id} href={`#${s.id}`} className="shrink-0 rounded-full border border-asphalt-700 px-3 py-1.5 text-sm text-mist-300 hover:text-white">{tx(s.title)}</a>)}
      </nav>
      <div className="grid gap-6 lg:grid-cols-2">
        {glossary && (
          <Card id="glossary" title={tr('Речник')} className="lg:col-span-2">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {Object.entries(GLOSSARY).map(([id, g]) => (
                <div key={id}><dt className="font-semibold text-white">{tx(g.term)}</dt><dd className="text-mist-300">{tx(g.text)}</dd></div>
              ))}
            </dl>
          </Card>
        )}
        {SECTIONS.map((s) => (
          <Card key={s.id} id={s.id} title={tx(s.title)}>
            <ul className="space-y-2 text-sm text-mist-200">
              {s.items.map((item, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-glow" aria-hidden="true" /><span>{tx(item)}</span></li>)}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
