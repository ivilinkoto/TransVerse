import Link from 'next/link';
import { Badge, Card, PageHeader, Table } from '@/components/ui';
import { date, money } from '@/lib/format';
import { searchUsers } from '@/server/admin';
import { adminContext } from '@/server/admin-context';
import { ROLE_LABELS, type Role } from '@/server/auth/roles';

export const metadata = { title: 'Потребители' };

export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { db } = await adminContext();
  const q = ((await searchParams).q ?? '').slice(0, 80);
  const rows = await searchUsers(db, q);
  return (
    <div className="space-y-6">
      <PageHeader title="Потребители" subtitle="Търсене по потребителско име, имейл или име на компания." />
      <form className="flex gap-2" role="search">
        <input name="q" defaultValue={q} className="input max-w-md" placeholder="Търсене…" aria-label="Търсене на потребител" />
        <button className="btn-primary">Търси</button>
      </form>
      <Card>
        <Table head={['Потребител', 'Длъжност', 'Компания', 'Ниво', 'Баланс', 'Регистрация']}>
          {rows.map((u) => (
            <tr key={u.id}>
              <td className="px-3 py-2">
                <Link href={`/admin/users/${u.id}`} className="font-semibold text-cyan-glow hover:underline">{u.username}</Link>
                <div className="text-xs text-mist-400">{u.email}</div>
              </td>
              <td className="px-3 py-2">{u.role === 'player' ? <span className="text-mist-400">Играч</span> : <Badge tone="violet">{ROLE_LABELS[u.role as Role]}</Badge>}{u.bannedAt && <Badge tone="red">блокиран</Badge>}</td>
              <td className="px-3 py-2">{u.kind === 'company' ? u.company : <span className="text-mist-400">самостоятелен шофьор</span>}</td>
              <td className="num px-3 py-2">{u.level}</td>
              <td className="num px-3 py-2">{u.balance != null ? money(u.balance) : '—'}</td>
              <td className="px-3 py-2 text-mist-400">{date(u.createdAt)}</td>
            </tr>
          ))}
        </Table>
        {rows.length === 0 && <p className="mt-3 text-sm text-mist-400">Няма резултати.</p>}
      </Card>
    </div>
  );
}
