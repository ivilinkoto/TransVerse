import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/server/db/client';
import { pushSubscriptions } from '@/server/db/schema';
import { job, jobHealth } from '@/server/game/world';
import { pushToUser, subscribe, type PushSender } from '@/server/push';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

describe('worker jobs', () => {
  it('a failing job is recorded and does not stop the ones after it', async () => {
    const key = `test-job-${Date.now()}`;
    const ran: string[] = [];
    await job(db(), key, new Date(), async () => {
      throw new Error('boom');
    });
    await job(db(), `${key}-next`, new Date(), async () => void ran.push('next'));
    expect(ran).toEqual(['next']);
    let health = (await jobHealth(db())).find((j) => j.key === key)!;
    expect(health.failures).toBe(1);
    expect(health.error).toContain('boom');
    await job(db(), key, new Date(Date.now() + 120_000), async () => undefined);
    health = (await jobHealth(db())).find((j) => j.key === key)!;
    expect(health.failures).toBe(0);
    expect(health.okAt).not.toBeNull();
  });

  it('remembers what the push service answered when a send fails', async () => {
    const p = await newPlayer();
    const endpoint = `https://push.example.com/send/health-${Date.now()}`;
    await subscribe(db(), p.userId, { endpoint, keys: { p256dh: 'BPp256dh-test-key-value', auth: 'auth-secret-1' } });
    const failing: PushSender = async () => {
      throw Object.assign(new Error('Received unexpected response code'), { statusCode: 403, body: 'the key does not match' });
    };
    expect(await pushToUser(db(), p.userId, { title: 't', body: 'b', url: '/game' }, failing)).toBe(0);
    const [row] = await db().select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    expect(row!.lastError).toBe('403 the key does not match');
    expect(row!.lastErrorAt).not.toBeNull();
  });
});
