import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/AuthShell';
import { RegisterForm } from '@/components/auth/RegisterForm';
import { money } from '@/lib/format';
import { ECONOMY } from '@/lib/game/economy';
import { getDb } from '@/server/db/client';
import { headquarterOptions } from '@/server/game/company';
import { currentUser } from '@/server/http';

export const metadata: Metadata = { title: 'Регистрация' };
export const dynamic = 'force-dynamic';

export default async function RegisterPage() {
  if (await currentUser()) redirect('/game');
  const cities = await headquarterOptions(getDb());
  return (
    <AuthShell
      title="Стани шофьор в TransVerse"
      subtitle={`Започваш като самостоятелен шофьор с нает камион и ${money(ECONOMY.startingBalanceCents)}. Компанията основаваш по-късно.`}
      aside={
        <ul className="max-w-md space-y-3 text-mist-300">
          <li className="font-display text-2xl font-bold text-mist-100">Какво те чака</li>
          <li>Нает камион без разходи за гориво и сервиз — плащаш наем от всеки курс</li>
          <li>Реални градове и пътни маршрути в 9 държави, курсове от 10 минути до 2 часа</li>
          <li>{`Собствена компания от ниво ${ECONOMY.foundingMinLevel} срещу ${money(ECONOMY.foundingFeeCents)}`}</li>
          <li>Общ пазар, сезонни класации, обучение за първите стъпки</li>
        </ul>
      }
    >
      <RegisterForm cities={cities.map(({ id, nameBg, population }) => ({ id, nameBg, population }))} />
    </AuthShell>
  );
}
