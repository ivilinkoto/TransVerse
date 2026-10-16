import { redirect } from 'next/navigation';
import { Card, PageHeader, Table } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { auditLog } from '@/server/admin';
import { adminContext } from '@/server/admin-context';
import { isAdmin } from '@/server/auth/roles';

export const metadata = { title: 'Одит дневник' };

export default async function AdminAudit() {
  const { db, user } = await adminContext();
  if (!isAdmin(user.role)) redirect('/admin');
  const rows = await auditLog(db, 200);
  return (
    <div className="space-y-6">
      <PageHeader title="Одит дневник" subtitle="Всяко административно действие: кой, какво, кога." />
      <Card>
        <Table head={['Кога', 'Кой', 'Действие', 'Към', 'Детайли']}>
          {rows.map((r) => (
            <tr key={r.entry.id}>
              <td className="whitespace-nowrap px-3 py-2 text-mist-400">{dateTime(r.entry.createdAt)}</td>
              <td className="px-3 py-2">{r.actor}</td>
              <td className="px-3 py-2 font-semibold">{r.entry.action}</td>
              <td className="px-3 py-2">{r.target ?? '—'}</td>
              <td className="px-3 py-2 font-mono text-xs text-mist-400">{JSON.stringify(r.entry.details)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
