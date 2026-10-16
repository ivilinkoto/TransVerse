import { redirect } from 'next/navigation';
import { Card, PageHeader, Table } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { auditLog } from '@/server/admin';
import { adminContext } from '@/server/admin-context';
import { describeAudit } from '@/server/audit-format';
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
        <Table head={['Кога', 'Кой', 'Действие']}>
          {rows.map((r) => (
            <tr key={r.entry.id}>
              <td className="whitespace-nowrap px-3 py-2 text-mist-400">{dateTime(r.entry.createdAt)}</td>
              <td className="px-3 py-2">{r.actor}</td>
              <td className="px-3 py-2">{describeAudit(r.entry, r.actor, r.target)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
