import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { extractMentions, splitMentions, typingMention } from '@/lib/game/mentions';
import { closeDb } from '@/server/db/client';
import { notifications, userBlocks } from '@/server/db/schema';
import { postToChannel } from '@/server/game/messages';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const mentionsOf = async (userId: string) => db().select().from(notifications).where(and(eq(notifications.userId, userId), like(notifications.title, '%те спомена%')));

describe('chat mentions', () => {
  it('finds @names, splits the text, and sees what is being typed', () => {
    expect(extractMentions('Здрасти @Ivan и @maria.k, видя ли @ivan? email@test.bg')).toEqual(['ivan', 'maria.k']);
    expect(extractMentions('Край на изречението @Петър.')).toEqual(['петър']);
    expect(splitMentions('Хей @Ivan!')).toEqual([{ text: 'Хей ' }, { text: '@Ivan', mention: 'Ivan' }, { text: '!' }]);
    expect(typingMention('здрасти @iv')).toBe('iv');
    expect(typingMention('здрасти @')).toBe('');
    expect(typingMention('mail@iv')).toBeNull();
  });

  it('notifies the mentioned players, not the author nor who blocked the author', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const c = await newPlayer();
    await db().insert(userBlocks).values({ blockerId: c.userId, blockedId: a.userId });
    await postToChannel(db(), a.userId, 'global', `Здравейте @${b.username} и @${c.username} и @${a.username}`);
    const toB = await mentionsOf(b.userId);
    expect(toB).toHaveLength(1);
    expect(toB[0]!.href).toBe('/game?chat=global');
    expect(await mentionsOf(c.userId)).toHaveLength(0);
    expect(await mentionsOf(a.userId)).toHaveLength(0);
  });
});
