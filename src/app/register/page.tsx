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
      title="Основи своята компания"
      subtitle={`Стартов капитал ${money(ECONOMY.startingBalanceCents)}, употребяван ван и опитен шофьор.`}
      aside={
        <ul className="max-w-md space-y-3 text-mist-300">
          <li className="font-display text-2xl font-bold text-mist-100">Какво те чака</li>
          <li>Реални градове и пътни маршрути в 9 държави</li>
          <li>Общ товарен пазар с други играчи</li>
          <li>Депа, шофьори, ремаркета, подобрения</li>
          <li>Сезонни класации без нулиране на компанията</li>
        </ul>
      }
    >
      <RegisterForm cities={cities.map(({ id, nameBg, population }) => ({ id, nameBg, population }))} />
    </AuthShell>
  );
}
