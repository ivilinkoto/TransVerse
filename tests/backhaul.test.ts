import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the feature as released (before the date it is staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: (id: string) => id !== 'discord_bot' }));
import { closeDb } from '@/server/db/client';
import { companies, notifications, vehicles } from '@/server/db/schema';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { categoryOf, dispatchPush, pushActionsFor, subscribe, type PushSender } from '@/server/push';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

describe('return loads and quick buttons', () => {
  it('a delivery points to the loads back from its destination, with that truck', async () => {
    const p = await newPlayer('Sofia');
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    const job = await makeContract('Sofia', 'Plovdiv');
    const d = await acceptContract(db(), p.userId, job.id, truck!.id);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account!.id);
    const [n] = await db().select().from(notifications).where(and(eq(notifications.userId, p.userId), like(notifications.title, 'Доставено%')));
    expect(n!.href).toBe(`/game/contracts?from=${job.destCityId}&truck=${truck!.id}`);
    expect(n!.body).toContain('Виж товарите обратно');
    expect(categoryOf(n!.href)).toBe('deliveries');
  });

  // Phone notifications until Discord takes over (v1.3).
  it('phone notifications get "Обратен товар" and "Нов курс" buttons', async () => {
    expect(pushActionsFor('/game/contracts?from=12&truck=x')!.map((a) => a.title)).toEqual(['Обратен товар', 'Нов курс']);
    expect(pushActionsFor('/game?chat=global')![0]!.title).toBe('Отвори чата');
    expect(pushActionsFor('/game/finance')).toBeUndefined();
    expect(categoryOf('/game?chat=global')).toBe('chat');

    const p = await newPlayer();
    await subscribe(db(), p.userId, { endpoint: `https://push.example.com/send/${p.userId}`, keys: { p256dh: 'BPp256dh-test-key-value', auth: 'auth-secret-1' } });
    const sent: { actions?: { title: string; url: string }[] }[] = [];
    const fake: PushSender = async (_s, payload) => {
      sent.push(JSON.parse(payload));
      return 201;
    };
    await dispatchPush(db(), new Date(), fake);
    sent.length = 0;
    const { notify } = await import('@/server/game/notify');
    await notify(db(), p.userId, 'success', 'Доставено: Мебели в Пловдив', '…', '/game/contracts?from=5&truck=t1');
    await dispatchPush(db(), new Date(), fake);
    expect(sent.at(-1)!.actions).toEqual([{ action: 'back', title: 'Обратен товар', url: '/game/contracts?from=5&truck=t1' }, { action: 'board', title: 'Нов курс', url: '/game/contracts' }]);
  });
});
