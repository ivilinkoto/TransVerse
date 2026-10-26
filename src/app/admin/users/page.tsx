import Link from 'next/link';
import { Badge, Card, PageHeader, Table } from '@/components/ui';
import { date, money } from '@/lib/format';
import { searchUsers } from '@/server/admin';
import { adminContext } from '@/server/admin-context';
import { ROLE_LABELS, type Role } from '@/server/auth/roles';
import { isVip } from '@/lib/game/vip';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Потребители') };
}

export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await initLocale();
  const { db, now } = await adminContext();
  const q = ((await searchParams).q ?? '').slice(0, 80);
  const rows = await searchUsers(db, q);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Потребители')} subtitle={t('Търсене по потребителско име, имейл или име на компания.')} />
      <form className="flex gap-2" role="search">
        <input name="q" defaultValue={q} className="input max-w-md" placeholder={t('Търсене…')} aria-label={t('Търсене на потребител')} />
        <button className="btn-primary">{t('Търси')}</button>
      </form>
      <Card>
        <Table head={[t('Потребител'), t('Длъжност'), t('Компания'), t('Ниво'), t('Баланс'), t('Регистрация')]}>
          {rows.map((u) => (
            <tr key={u.id}>
              <td className="px-3 py-2">
                <Link href={`/admin/users/${u.id}`} className="font-semibold text-cyan-glow hover:underline">{tx(u.username)}</Link>
                <div className="text-xs text-mist-400">{tx(u.email)}</div>
              </td>
              <td className="px-3 py-2">{u.role === 'player' ? <span className="text-mist-400">{t('Играч')}</span> : <Badge tone="violet">{tx(ROLE_LABELS[u.role as Role])}</Badge>}{isVip(u.vipUntil, now) && <Badge tone="gold">VIP</Badge>}{u.bannedAt && <Badge tone="red">{t('блокиран')}</Badge>}</td>
              <td className="px-3 py-2">{u.company ?? <span className="text-mist-400">{t('без компания')}</span>}</td>
              <td className="num px-3 py-2">{tx(u.level)}</td>
              <td className="num px-3 py-2">{u.balance != null ? money(u.balance) : '—'}</td>
              <td className="px-3 py-2 text-mist-400">{date(u.createdAt)}</td>
            </tr>
          ))}
        </Table>
        {rows.length === 0 && <p className="mt-3 text-sm text-mist-400">{t('Няма резултати.')}</p>}
      </Card>
    </div>
  );
}
