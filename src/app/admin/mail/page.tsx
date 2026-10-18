import { CheckCircle2, MailWarning, XCircle } from 'lucide-react';
import { TestMailForm } from '@/components/admin/TestMailForm';
import { Badge, Card, PageHeader } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { adminContext } from '@/server/admin-context';
import { checkMailSetup, recentMail } from '@/server/mail-check';

export const metadata = { title: 'Имейли' };
export const dynamic = 'force-dynamic';

const STATUS = { sent: { label: 'приет', tone: 'green' }, rejected: { label: 'отказан', tone: 'red' }, failed: { label: 'грешка', tone: 'red' } } as const;
const KIND = { verify: 'потвърждаване', reset: 'нова парола', test: 'проба' } as const;

function Row({ ok, label, value }: { ok: boolean | null; label: string; value: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 py-2 text-sm">
      {ok === null ? <MailWarning className="mt-0.5 h-4 w-4 shrink-0 text-mist-400" /> : ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-profit" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-loss" />}
      <span className="w-24 shrink-0 text-mist-400">{label}</span>
      <span className="min-w-0 break-all">{value}</span>
    </li>
  );
}

export default async function AdminMail() {
  const { db } = await adminContext();
  const [check, log] = await Promise.all([checkMailSetup(), recentMail(db, 100)]);
  return (
    <div className="space-y-6">
      <PageHeader title="Имейли" subtitle="Защо писмата не стигат до някои пощи (abv.bg, mail.bg…) и какво точно отговаря пощенският сървър." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Настройка и DNS на домейна">
          <ul className="divide-y divide-asphalt-800">
            <Row ok={check.enabled} label="Поща" value={check.enabled ? `${check.host}` : `липсват ${check.missing.join(', ')}`} />
            <Row ok={!!check.from && !check.freeMailbox} label="Подател" value={check.from || '—'} />
            <Row ok={check.freeMailbox ? null : !!check.spf && check.spfCoversHost !== false} label="SPF" value={check.freeMailbox ? 'не се проверява (безплатна поща)' : (check.spf ?? 'няма')} />
            <Row ok={check.freeMailbox ? null : check.dkim.length > 0} label="DKIM" value={check.freeMailbox ? 'не се проверява' : check.dkim.length ? check.dkim.map((s) => `${s}._domainkey`).join(', ') : 'не е намерен'} />
            <Row ok={check.freeMailbox ? null : !!check.dmarc} label="DMARC" value={check.freeMailbox ? 'не се проверява' : (check.dmarc ?? 'няма')} />
          </ul>
          {check.problems.length > 0 ? (
            <div className="mt-4 space-y-2 rounded-xl border border-amber-sig/40 bg-amber-sig/10 p-3 text-sm">
              <div className="font-semibold text-amber-sig">Какво да се оправи</div>
              <ol className="list-decimal space-y-1.5 pl-5 text-mist-200">{check.problems.map((p) => <li key={p}>{p}</li>)}</ol>
            </div>
          ) : (
            <p className="mt-4 text-sm text-profit">Домейнът е удостоверен (SPF, DKIM и DMARC). Ако някоя поща пак не получава писма, изпрати проба и виж отговора по-долу.</p>
          )}
        </Card>
        <Card title="Пробно писмо">
          <p className="mb-3 text-sm text-mist-400">Изпрати до адрес в abv.bg или mail.bg и виж дали стига до „Входящи“, „Спам“ или изобщо не стига. Отговорът на сървъра се записва в дневника.</p>
          <TestMailForm />
        </Card>
      </div>
      <Card title="Последни писма" className="p-2 sm:p-3">
        {log.length === 0 ? <p className="p-3 text-sm text-mist-400">Още няма изпратени писма.</p> : (
          <ul className="divide-y divide-asphalt-800">
            {log.map((m) => {
              const st = STATUS[m.status as keyof typeof STATUS] ?? { label: m.status, tone: 'neutral' as const };
              return (
                <li key={m.id} className="px-2 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <span className="font-semibold">{m.recipient}</span>
                    <span className="text-xs text-mist-400">{KIND[m.kind as keyof typeof KIND] ?? m.kind} · {dateTime(m.createdAt)}</span>
                  </div>
                  {m.response && <div className="mt-1 break-all font-mono text-[11px] text-mist-400">{m.response}</div>}
                </li>
              );
            })}
          </ul>
        )}
        <p className="p-2 text-xs text-mist-400">„Приет“ означава, че нашият пощенски сървър (Spacemail) е поел писмото. Ако после то не стигне до получателя, причината обикновено е липсващ SPF/DKIM/DMARC — виж горе. Върнатите писма (bounce) пристигат обратно в пощенската кутия на подателя в Spacemail — там се вижда и отговорът на abv.bg / mail.bg.</p>
      </Card>
    </div>
  );
}
