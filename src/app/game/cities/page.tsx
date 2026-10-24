import { Building2, Grape } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Badge, Card, Empty, Meter, PageHeader } from '@/components/ui';
import { CITY_LEVELS, CITY_PAY, HARVEST, isHarvest } from '@/lib/game/city-growth';
import { gameContext } from '@/server/game/context';
import { cityRankings, harvestOf } from '@/server/game/city-growth';

export const metadata = { title: 'Градовете растат' };

const t = (n: number) => `${Math.round(n).toLocaleString('bg-BG')} т`;

export default async function CitiesPage() {
  const { db, user, now, features } = await gameContext();
  if (!features.city_growth) notFound();
  const [r, harvest] = await Promise.all([cityRankings(db, now), features.harvest ? harvestOf(db, user.id, now) : null]);
  const season = features.harvest && isHarvest(now);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Градовете растат"
        subtitle="Всеки тон, доставен в град, го вдига за всички играчи. По-развитите градове дават по-добре платени товари."
        help={`Броят се тоновете от всички завършени курсове към града (игрови данни, реални градове). Нивата: ${CITY_LEVELS.map((l) => `${l.name} (${t(l.tons)})`).join(', ')}. Всяко ниво над първото дава +${Math.round(CITY_PAY.perLevel * 100)} % за товарите, които тръгват от града. Всеки понеделник обявяваме града на седмицата.`}
      />
      {season && harvest && (
        <Card title={<span className="inline-flex items-center gap-2"><Grape className="h-4 w-4 text-violet-300" />Гроздобер</span>} actions={<Badge tone="orange">до 15 октомври</Badge>}>
          <p className="text-sm text-mist-300">Есенните товари (грозде, мъст, ябълки, тикви…) плащат +{Math.round((HARVEST.rewardMultiplier - 1) * 100)} %. {HARVEST.loadsForBadge} навреме в сезона — значка „Гроздобер“ и {HARVEST.coins} TC.</p>
          <div className="mt-3 flex justify-between text-xs text-mist-300"><span>{Math.min(harvest.loads, HARVEST.loadsForBadge)} / {HARVEST.loadsForBadge} есенни товара</span>{harvest.rewarded && <span className="text-profit">Взе наградата ✓</span>}</div>
          <Meter value={(Math.min(harvest.loads, HARVEST.loadsForBadge) / HARVEST.loadsForBadge) * 100} tone="violet" className="mt-1.5" />
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Тази седмица">
          {r.thisWeek.length === 0 ? <Empty icon={Building2} title="Още няма доставки тази седмица">Първият курс ще отвори класацията.</Empty> : (
            <ol className="space-y-1.5 text-sm">
              {r.thisWeek.map((c, i) => <li key={c.id} className="flex justify-between gap-2"><span>{i === 0 ? '🏆 ' : `${i + 1}. `}<span className="font-medium">{c.name}</span> <span className="text-xs text-mist-400">{c.country}</span></span><span className="num">{t(c.weekTons)}</span></li>)}
            </ol>
          )}
        </Card>
        <Card title="Най-развитите градове">
          {r.allTime.length === 0 ? <p className="text-sm text-mist-400">Още няма данни.</p> : (
            <ul className="space-y-3 text-sm">
              {r.allTime.map((c) => (
                <li key={c.id}>
                  <div className="flex justify-between gap-2"><span><span className="font-medium">{c.name}</span> <span className="text-xs text-mist-400">{c.country}</span></span><Badge tone="cyan">ниво {c.level} · {CITY_LEVELS[c.level - 1]!.name}</Badge></div>
                  <div className="mt-1 flex justify-between text-xs text-mist-400"><span>{t(c.tons)}</span>{c.next && <span>до ниво {c.next.level}: {t(c.next.tons - c.tons)}</span>}</div>
                  <Meter value={c.progress * 100} tone="cyan" className="mt-1" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <p className="text-xs text-mist-500">Реални градове, игрови данни.</p>
    </div>
  );
}
