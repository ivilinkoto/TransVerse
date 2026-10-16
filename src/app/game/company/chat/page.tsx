import { redirect } from 'next/navigation';
import { CompanyChat } from '@/components/company/CompanyChat';
import { Card } from '@/components/ui';
import { companyChat } from '@/server/game/chat';
import { gameContext } from '@/server/game/context';
import { companyHub } from '@/server/game/membership';

export const metadata = { title: 'Чат на компанията' };

export default async function CompanyChatPage() {
  const { db, user, now } = await gameContext();
  const hub = await companyHub(db, user.id);
  if (!hub) redirect('/game/company');
  const { messages, canModerate } = await companyChat(db, user.id, 0, 80, now);
  return (
    <Card title="Чат на компанията" actions={<span className="text-xs text-mist-400">Вижда се само от членовете · обновява се на живо</span>}>
      <CompanyChat me={user.id} initial={messages} canModerate={canModerate} />
    </Card>
  );
}
