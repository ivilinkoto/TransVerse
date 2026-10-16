import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { bootstrapFounder, setBan } from '@/server/admin';
import { closeDb } from '@/server/db/client';
import { companies, organizations, users } from '@/server/db/schema';
import { companyChat, deleteChatMessage, sendChatMessage } from '@/server/game/chat';
import { GameError } from '@/server/game/errors';
import { joinCompany, updateSettings } from '@/server/game/membership';
import { candidates, hireDriver } from '@/server/game/staff';
import { subscribe } from '@/server/realtime';
import { db, newPlayer, playerWithCompany } from './helpers';

afterAll(async () => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const orgOf = async (userId: string) => (await db().select().from(organizations).where(eq(organizations.ownerId, userId)))[0]!;
const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;

describe('company chat', () => {
  it('members talk, outsiders cannot read, authors and moderators delete', async () => {
    const owner = await playerWithCompany();
    const org = await orgOf(owner.userId);
    await updateSettings(db(), owner.userId, { recruitment: 'open', minJoinLevel: 1, contributionRate: 0.05 });
    const driver = await newPlayer();
    const outsider = await newPlayer();
    await joinCompany(db(), driver.userId, org.id);

    const id = await sendChatMessage(db(), driver.userId, '  Здравейте, колеги!  ');
    await sendChatMessage(db(), owner.userId, 'Добре дошъл!');
    const chat = await companyChat(db(), owner.userId);
    expect(chat.messages.map((m) => m.body)).toEqual(['Здравейте, колеги!', 'Добре дошъл!']);
    expect(chat.messages[0]!.rank).toBe('Шофьор');
    expect(chat.canModerate).toBe(true);
    expect((await companyChat(db(), driver.userId)).canModerate).toBe(false);
    expect(await code(companyChat(db(), outsider.userId))).toBe('not_member');
    expect(await code(sendChatMessage(db(), outsider.userId, 'спам'))).toBe('not_member');
    expect(await code(sendChatMessage(db(), driver.userId, '   '))).not.toBe('ok');
    expect(await code(sendChatMessage(db(), driver.userId, 'x'.repeat(501)))).not.toBe('ok');

    // Only newer messages.
    expect((await companyChat(db(), driver.userId, id)).messages).toHaveLength(1);

    // A driver cannot delete the owner's message; the owner (moderator) can delete anyone's.
    const ownerMsg = chat.messages[1]!.id;
    expect(await code(deleteChatMessage(db(), driver.userId, ownerMsg))).toBe('forbidden');
    await deleteChatMessage(db(), owner.userId, id);
    const after = await companyChat(db(), owner.userId);
    expect(after.messages[0]!.deleted).toBe(true);
    expect(after.messages[0]!.body).toBeNull();
  });

  // Live delivery uses Postgres LISTEN/NOTIFY (real Postgres in CI; set TEST_NO_NOTIFY=1 for databases without it).
  it.skipIf(!!process.env.TEST_NO_NOTIFY)('notifies the company live when a message is posted', async () => {
    const owner = await playerWithCompany();
    const org = await orgOf(owner.userId);
    const events: { type: string; companyId?: string }[] = [];
    const stop = subscribe((e) => events.push(e));
    try {
      await new Promise((r) => setTimeout(r, 500)); // LISTEN connection ready
      await sendChatMessage(db(), owner.userId, 'Проверка на живо');
      for (let i = 0; i < 30 && !events.some((e) => e.type === 'chat'); i++) await new Promise((r) => setTimeout(r, 100));
      expect(events.find((e) => e.type === 'chat')?.companyId).toBe(org.id);
    } finally {
      stop();
    }
  });

  it('limits spam to 10 messages a minute', async () => {
    const owner = await playerWithCompany();
    for (let i = 0; i < 10; i++) await sendChatMessage(db(), owner.userId, `съобщение ${i}`);
    expect(await code(sendChatMessage(db(), owner.userId, 'още едно'))).toBe('rate_limited');
  });
});

describe('hiring drivers', () => {
  it('members of a company can hire even without founding one', async () => {
    const owner = await playerWithCompany();
    const org = await orgOf(owner.userId);
    await updateSettings(db(), owner.userId, { recruitment: 'open', minJoinLevel: 1, contributionRate: 0.05 });
    const solo = await newPlayer();
    const account = await accountOf(solo.userId);
    const pool = await candidates(db(), account.id);
    expect(await code(hireDriver(db(), solo.userId, pool[0]!.id))).toBe('company_required');
    await joinCompany(db(), solo.userId, org.id);
    const driver = await hireDriver(db(), solo.userId, pool[0]!.id);
    expect(driver.companyId).toBe(account.id);
    expect(account.kind).toBe('independent');
  });
});

describe('founders', () => {
  it('several accounts can be founders and cannot act against each other', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    expect(await bootstrapFounder(db(), a.username)).toBe('promoted');
    expect(await bootstrapFounder(db(), b.username.toUpperCase())).toBe('promoted');
    expect(await bootstrapFounder(db(), b.username)).toBe('already');
    expect(await bootstrapFounder(db(), 'няма_такъв_акаунт')).toBe('missing');
    const roles = await db().select({ role: users.role }).from(users).where(eq(users.id, b.userId));
    expect(roles[0]!.role).toBe('founder');
    expect(await code(setBan(db(), { id: a.userId, role: 'founder', username: a.username }, b.userId, true, 'тест'))).toBe('forbidden');
  });
});
