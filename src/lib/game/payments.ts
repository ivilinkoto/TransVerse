/**
 * What can be bought for real money. Pure data shared by server and UI; the
 * server always charges these prices — never an amount sent by the browser.
 * Game money (€ in the game) is never sold.
 */

export type PaidProductId = 'tc_100' | 'tc_550' | 'tc_1200' | 'tc_3200' | 'vip_30_direct';

export interface PaidProduct {
  id: PaidProductId;
  label: string;
  description: string;
  /** Final price to the buyer, euro cents. */
  priceCents: number;
  coins: number;
  /** Gift coins included in `coins` (shown as a bonus). */
  bonus: number;
  vipDays: number;
}

export const PAID_PRODUCTS: PaidProduct[] = [
  { id: 'tc_100', label: '100 ТрансКоин', description: '100 TC за магазина на играта.', priceCents: 199, coins: 100, bonus: 0, vipDays: 0 },
  { id: 'tc_550', label: '550 ТрансКоин', description: '500 TC + 50 подарък.', priceCents: 999, coins: 550, bonus: 50, vipDays: 0 },
  { id: 'tc_1200', label: '1 200 ТрансКоин', description: '1 000 TC + 200 подарък.', priceCents: 1999, coins: 1200, bonus: 200, vipDays: 0 },
  { id: 'tc_3200', label: '3 200 ТрансКоин', description: '2 500 TC + 700 подарък.', priceCents: 4999, coins: 3200, bonus: 700, vipDays: 0 },
  { id: 'vip_30_direct', label: 'VIP · 30 дни', description: 'Всички VIP предимства за 30 дни, добавени към текущия ти VIP.', priceCents: 999, coins: 0, bonus: 0, vipDays: 30 },
];

export const paidProduct = (id: string) => PAID_PRODUCTS.find((p) => p.id === id);

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'очаква плащане',
  paid: 'платено',
  failed: 'неуспешно',
  expired: 'изтекло',
  refunded: 'възстановено',
};

export const euro = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;
