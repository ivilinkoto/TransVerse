import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { searchPlayers } from '@/server/game/search';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

describe('player search', () => {
  it('finds players by part of the name, the ones starting with it first; never banned ones', async () => {
    const tag = Date.now().toString(36);
    const a = await newPlayer();
    const b = await newPlayer();
    const c = await newPlayer();
    await db().update(users).set({ username: `zz${tag}Ivan` }).where(eq(users.id, a.userId));
    await db().update(users).set({ username: `${tag}Ivan` }).where(eq(users.id, b.userId));
    await db().update(users).set({ username: `${tag}Ivanov`, bannedAt: new Date() }).where(eq(users.id, c.userId));
    const r = await searchPlayers(db(), tag.toUpperCase() + 'iv');
    expect(r.players.map((p) => p.username)).toEqual([`${tag}Ivan`, `zz${tag}Ivan`]);
    expect(r.players[0]).toMatchObject({ online: expect.any(Boolean), vip: false });
  });

  it('needs two letters and treats % and _ as plain text', async () => {
    expect((await searchPlayers(db(), 'a')).players).toEqual([]);
    expect((await searchPlayers(db(), '%%')).players).toEqual([]);
    expect((await searchPlayers(db(), '__')).players).toEqual([]);
  });
});
