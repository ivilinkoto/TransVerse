import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui';
import { CLIENT_RULES } from '@/lib/game/clients';
import { CREW_RULES, TRAIT_IDS, TRAITS } from '@/lib/game/crew';
import { FINE_RULES, INSURANCE } from '@/lib/game/fines';
import { HALLOWEEN } from '@/lib/game/halloween';
import { ECONOMY } from '@/lib/game/economy';
import { AUTO_DISPATCH_PER_DAY } from '@/server/game/dispatch';
import { AUCTION_RULES } from '@/lib/game/auctions';

export const metadata = { title: 'Помощ и правила' };

const pct = (x: number) => `${Math.round(x * 100)}%`;
const eur = (cents: number) => `${Math.round(cents / 100).toLocaleString('bg-BG')} €`;

const SECTIONS: { id: string; title: string; items: React.ReactNode[] }[] = [
  {
    id: 'start',
    title: 'Как се играе',
    items: [
      'Избираш поръчка от борсата и камион, който може да я поеме — той кара празен до товара, натоварва и тръгва. Всичко става в реално време, дори когато не си в играта.',
      'Наградата е сумата на поръчката. Плащаш гориво (по цените на държавите по пътя), пътни такси и поддръжка; наетият камион вместо това взима наем.',
      `Навреме — бонус ${pct(ECONOMY.earlyBonusShare)} при голям запас от време; със закъснение — неустойка ${pct(ECONOMY.latePenaltyShare)}. Репутацията расте с доставки навреме и отключва премиум поръчки.`,
    ],
  },
  {
    id: 'board',
    title: 'Борсата',
    items: [
      'Диспечер: „Предложи курсове“ избира за всеки свободен камион най-изгодната обикновена поръчка (печалба за минута път), която ще стигне навреме. Ти избираш кои да тръгнат.',
      `VIP диспечер (Автопарк): камионът сам поема следващия курс, щом е свободен — до ${AUTO_DISPATCH_PER_DAY} курса на ден.`,
      'Любими линии: звездата в отворена поръчка — поръчките по линията са най-отгоре и получаваш известие за нова (до веднъж на час).',
      'Бързи филтри: любими, празнични, без нужда от лиценз, до 2 часа, над 3 €/км.',
      `Специални товари (Поръчки → Специални товари): търг всеки ден в ${AUCTION_RULES.hours.map((h) => `${h}:00`).join(', ')} за ${AUCTION_RULES.minutes} минути. Печели най-ниската цена; победителят има ${AUCTION_RULES.sendHours} часа да изпрати камион, иначе губи товара и ${AUCTION_RULES.forfeitReputation} репутация.`,
    ],
  },
  {
    id: 'crew',
    title: 'Шофьори',
    items: [
      `Шофьорът кара до ${CREW_RULES.soloDailyMin / 60} ч преди дневна почивка. Часовете от последния курс се пренасят; след ${CREW_RULES.restGameMin} мин престой е отпочинал.`,
      `Двоен екипаж (втори шофьор в същия камион): до ${CREW_RULES.teamDailyMin / 60} ч без почивки, по-кратки дълги курсове. Не във ван и не в нает камион.`,
      <>Умения — точка с всяко ниво: {TRAIT_IDS.map((t) => `${TRAITS[t].short} (${TRAITS[t].perPoint})`).join('; ')}.</>,
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
      `Договор: ${CLIENT_RULES.loads[0]}–${CLIENT_RULES.loads[1]} товара по една линия до срок; всеки товар се плаща с около ${pct(CLIENT_RULES.rewardMultiplier - 1)} над борсата.`,
      `Изпълнен — бонус ${pct(CLIENT_RULES.bonusShare)} и +${CLIENT_RULES.successReputation} репутация (закъснелите товари намаляват бонуса). Неизпълнен — загуба на репутация.`,
      `Активни договори: до ${CLIENT_RULES.maxActive} (VIP — ${CLIENT_RULES.maxActive + CLIENT_RULES.vipExtraActive}).`,
    ],
  },
  {
    id: 'fines',
    title: 'Глоби и застраховка',
    items: [
      `Рискът е по избор: без задължителната почивка (проверка с шанс ${pct(FINE_RULES.checkChance.hours)}) или претоварване до ${pct(FINE_RULES.overloadMax)} (${pct(FINE_RULES.checkChance.overload)}).`,
      `Глобата се плаща до ${FINE_RULES.dueHours} ч или се обжалва веднъж: ${pct(FINE_RULES.appealWinChance)} шанс да отпадне, иначе +${pct(FINE_RULES.appealLossShare)}. След срока се удържа с +${pct(FINE_RULES.latePayShare)}.`,
      `Застраховка (Сервиз, ${INSURANCE.days} дни): пътната помощ при повреда е за сметка на застрахователя. Цена ${eur(INSURANCE.baseCents)} + ${(INSURANCE.valueShare * 100).toFixed(2)}% от стойността.`,
    ],
  },
  {
    id: 'more',
    title: 'Още',
    items: [
      <>Анализ (Автопарк → Анализ): какво носи всеки камион, шофьор, линия и товар.</>,
      <>Седмичник (Състезание): вестник всеки понеделник за изминалата седмица.</>,
      `Хелуин (${HALLOWEEN.from.split('-').reverse().join('.')}–${HALLOWEEN.to.split('-').reverse().join('.')}): празнични поръчки с +${pct(HALLOWEEN.rewardMultiplier - 1)}, общ ивент, мисии, значка и призрачен камион нощем.`,
      <>Обновленията и описанията им са в <Link href="/game/updates" className="text-cyan-glow hover:underline">Обновления</Link>; въпроси — в <Link href="/game/support" className="text-cyan-glow hover:underline">Поддръжка</Link>.</>,
    ],
  },
];

export default function HelpPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Помощ и правила" subtitle="Всички системи на играта накратко. Числата са игрови правила." />
      <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" aria-label="Раздели">
        {SECTIONS.map((s) => <a key={s.id} href={`#${s.id}`} className="shrink-0 rounded-full border border-asphalt-700 px-3 py-1.5 text-sm text-mist-300 hover:text-white">{s.title}</a>)}
      </nav>
      <div className="grid gap-6 lg:grid-cols-2">
        {SECTIONS.map((s) => (
          <Card key={s.id} id={s.id} title={s.title}>
            <ul className="space-y-2 text-sm text-mist-200">
              {s.items.map((item, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-glow" aria-hidden="true" /><span>{item}</span></li>)}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
