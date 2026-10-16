import { eq, and } from 'drizzle-orm';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import Link from 'next/link';
import { PaypalReturn } from '@/components/game/PaypalReturn';
import { RefreshWhilePending } from '@/components/game/RefreshWhilePending';
import { Card, PageHeader } from '@/components/ui';
import { euro, paidProduct } from '@/lib/game/payments';
import { payments } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { syncReturn } from '@/server/payments';

export const metadata = { title: 'Плащане' };

export default async function PaymentReturnPage({ searchParams }: { searchParams: Promise<{ session_id?: string; token?: string; provider?: string }> }) {
  const { db, user } = await gameContext();
  const q = await searchParams;
  // PayPal sends the buyer back with ?token=<order id>; Stripe with ?session_id=cs_…
  const orderId = q.provider === 'paypal' && q.token && /^[A-Z0-9]{5,40}$/.test(q.token) ? q.token : null;
  let payment = null;
  if (orderId) [payment] = await db.select().from(payments).where(and(eq(payments.orderId, orderId), eq(payments.userId, user.id)));
  else if (q.session_id && /^cs_[A-Za-z0-9_]+$/.test(q.session_id)) payment = await syncReturn(db, user.id, q.session_id);
  const label = payment ? (paidProduct(payment.productId)?.label ?? payment.productId) : '';
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader title="Плащане" />
      <Card>
        {!payment ? (
          <p className="text-sm text-mist-300">Плащането не е намерено. Ако сте платили, проверете „Моите плащания“ в магазина или пишете на поддръжката.</p>
        ) : payment.status === 'paid' ? (
          <div className="text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-profit" />
            <h2 className="mt-3 font-display text-xl font-bold">Благодарим!</h2>
            <p className="mt-1 text-mist-300">{label} ({euro(payment.amountCents)}) е добавено към профила ти.</p>
          </div>
        ) : payment.status === 'pending' ? (
          <div className="text-center">
            <Clock className="mx-auto h-12 w-12 animate-pulse text-amber-sig" />
            <h2 className="mt-3 font-display text-xl font-bold">Потвърждаваме плащането…</h2>
            <p className="mt-1 text-mist-300">{label} ще бъде добавено автоматично, щом плащането бъде потвърдено. Страницата се обновява сама.</p>
            {orderId && <PaypalReturn orderId={orderId} />}
            <RefreshWhilePending />
          </div>
        ) : (
          <div className="text-center">
            <XCircle className="mx-auto h-12 w-12 text-loss" />
            <h2 className="mt-3 font-display text-xl font-bold">Плащането не е завършено</h2>
            <p className="mt-1 text-mist-300">Не е таксувана сума. Можете да опитате отново от магазина.</p>
          </div>
        )}
        <div className="mt-5 text-center"><Link href="/game/shop" className="btn-primary">Към магазина</Link></div>
      </Card>
    </div>
  );
}
