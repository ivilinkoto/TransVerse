import { redirect } from 'next/navigation';
import { CompanyChat } from '@/components/company/CompanyChat';
import { CompanyPolls } from '@/components/company/CompanyPolls';
import { Card } from '@/components/ui';
import { companyChat } from '@/server/game/chat';
import { companyKey, markChannelRead } from '@/server/game/chat-reads';
import { gameContext } from '@/server/game/context';
import { can, companyHub } from '@/server/game/membership';
import { companyPollsView } from '@/server/game/polls';

export const metadata = { title: 'Чат на компанията' };

export default async function CompanyChatPage() {
  const { db, user, now, features } = await gameContext();
  const hub = await companyHub(db, user.id);
  if (!hub) redirect('/game/company');
  const { messages, canModerate, canClear } = await companyChat(db, user.id, 0, 80, now);
  await markChannelRead(db, user.id, companyKey(hub.company.id), messages.at(-1)?.id ?? 0, now);
  const chat = (
    <Card title="Чат на компанията" actions={<span className="text-xs text-mist-400">Вижда се само от членовете · обновява се на живо</span>}>
      <CompanyChat me={user.id} initial={messages} canModerate={canModerate} canClear={canClear} replies={features.chat_replies} />
    </Card>
  );
  if (!features.company_polls) return chat;
  const polls = await companyPollsView(db, hub.company.id, user.id, now);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0">{chat}</div>
      <Card title="Анкети">
        <CompanyPolls polls={polls.map((p) => ({ ...p, closesAt: p.closesAt.toISOString() }))} canCreate={can(hub.rank, 'manage_chat')} now={now.getTime()} />
      </Card>
    </div>
  );
}
