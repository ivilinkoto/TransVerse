import Link from 'next/link';
import type { Metadata } from 'next';
import { desc, ilike, or } from 'drizzle-orm';
import { Card, Empty, PageHeader } from '@/components/ui';
import { Search } from 'lucide-react';
import { dateTime } from '@/lib/format';
import { adminContext } from '@/server/admin-context';
import { searchUsers } from '@/server/admin';
import { organizations, supportTickets } from '@/server/db/schema';
import { recentServerErrors } from '@/server/error-log';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Търсене') };
}
export const dynamic = 'force-dynamic';

/** 1.1.4.1: one search for the whole admin panel — players, companies, tickets, server errors. */
export default async function AdminSearch({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await initLocale();
  const { db } = await adminContext();
  const q = ((await searchParams).q ?? '').trim().slice(0, 80);
  const term = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const [players, orgs, tickets, errors] = q
    ? await Promise.all([
        searchUsers(db, q).then((r) => r.slice(0, 15)),
        db.select({ id: organizations.id, name: organizations.name, tag: organizations.tag }).from(organizations).where(or(ilike(organizations.name, term), ilike(organizations.tag, term))).limit(10),
        db.select({ id: supportTickets.id, subject: supportTickets.subject, status: supportTickets.status, at: supportTickets.updatedAt }).from(supportTickets).where(ilike(supportTickets.subject, term)).orderBy(desc(supportTickets.updatedAt)).limit(10),
        recentServerErrors(db).then((all) => all.filter((e) => `${e.where} ${e.message} ${e.digest ?? ''}`.toLowerCase().includes(q.toLowerCase())).slice(0, 10)),
      ])
    : [[], [], [], []];
  const none = q && !players.length && !orgs.length && !tickets.length && !errors.length;
  return (
    <div className="space-y-6">
      <PageHeader title={t('Търсене')} subtitle={t('Играчи, компании, запитвания и грешки — на едно място.')} />
      <form action="/admin/search" className="flex gap-2">
        <input name="q" defaultValue={q} autoFocus className="input" placeholder={t('Име, имейл, Discord, компания, тема, код на грешка…')} aria-label={t('Търсене')} />
        <button className="btn-primary"><Search className="h-4 w-4" />{t('Търси')}</button>
      </form>
      {none && <Empty icon={Search} title={t('Нищо не е намерено')} />}
      {players.length > 0 && (
        <Card title={t('Играчи')}>
          <ul className="divide-y divide-asphalt-800 text-sm">{players.map((p) => <li key={p.id} className="py-1.5"><Link href={`/admin/users/${p.id}`} className="font-semibold hover:underline">{tx(p.username)}</Link> <span className="text-xs text-mist-400">· {tx(p.email)}{p.company ? ` · ${p.company}` : ''}</span></li>)}</ul>
        </Card>
      )}
      {orgs.length > 0 && (
        <Card title={t('Компании')}>
          <ul className="divide-y divide-asphalt-800 text-sm">{orgs.map((o) => <li key={o.id} className="py-1.5"><Link href={`/game/companies/${o.id}`} className="font-semibold hover:underline">{tx(o.name)}</Link> <span className="text-xs text-mist-400">[{tx(o.tag)}]</span></li>)}</ul>
        </Card>
      )}
      {tickets.length > 0 && (
        <Card title={t('Запитвания')}>
          <ul className="divide-y divide-asphalt-800 text-sm">{tickets.map((x) => <li key={x.id} className="py-1.5"><Link href={`/admin/tickets/${x.id}`} className="font-semibold hover:underline">{tx(x.subject)}</Link> <span className="text-xs text-mist-400">· {tx(x.status)} · {dateTime(x.at)}</span></li>)}</ul>
        </Card>
      )}
      {errors.length > 0 && (
        <Card title={t('Грешки на сървъра')}>
          <ul className="space-y-1.5 text-sm">{errors.map((e, i) => <li key={i}><span className="font-mono text-xs">{tx(e.where)}</span> <span className="text-xs text-mist-400">{dateTime(new Date(e.at))}</span><div className="break-words text-xs text-loss">{tx(e.message)}</div></li>)}</ul>
          <Link href={`/admin/system?errors=${encodeURIComponent(q)}`} className="mt-2 inline-block text-xs text-cyan-glow hover:underline">{t('Всички в Система →')}</Link>
        </Card>
      )}
    </div>
  );
}
