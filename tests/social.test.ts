import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { lastSeenLabel, isOnline } from '@/lib/game/social';
import { reputationBonusShare, reputationTier } from '@/lib/game/progression';
import { closeDb } from '@/server/db/client';
import { companies, companyMembers, ledgerEntries, notifications, organizations, users, vehicles } from '@/server/db/schema';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { channelFeed, conversation, conversations, deleteChannelMessage, deleteConversation, markConversationRead, postToChannel, sendDirectMessage, unreadDirectCount, unsendDirectMessage } from '@/server/game/messages';
import { friendsOf, inviteToCompany, myCompanyInvites, playerCard, removeFriend, respondCompanyInvite, respondFriendRequest, sendFriendRequest } from '@/server/game/social';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(async () => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));

describe('online status', () => {
  it('labels the last time a player was seen', () => {
    const now = new Date('2026-10-17T12:00:00Z');
    expect(isOnline(new Date(now.getTime() - 60_000), now)).toBe(true);
    expect(lastSeenLabel(new Date(now.getTime() - 60_000), now)).toBe('онлайн');
    expect(lastSeenLabel(new Date(now.getTime() - 10 * 60_000), now)).toBe('преди 10 мин');
    expect(lastSeenLabel(new Date(now.getTime() - 3 * 3_600_000), now)).toBe('преди 3 ч');
    expect(lastSeenLabel(new Date(now.getTime() - 86_400_000), now)).toBe('преди 1 ден');
    expect(lastSeenLabel(null, now)).toBe('отдавна');
  });
});

describe('friends', () => {
  it('request, accept, see each other online, remove', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    expect(await code(sendFriendRequest(db(), a.userId, a.userId))).toBe('self');
    expect(await sendFriendRequest(db(), a.userId, b.userId)).toBe('sent');
    expect(await code(sendFriendRequest(db(), a.userId, b.userId))).toBe('already_sent');
    expect((await playerCard(db(), a.userId, b.username))!.relation).toBe('sent');
    const cardForB = (await playerCard(db(), b.userId, a.username))!;
    expect(cardForB.relation).toBe('received');
    const [note] = await db().select().from(notifications).where(and(eq(notifications.userId, b.userId), eq(notifications.title, 'Покана за приятелство')));
    expect(note).toBeDefined();
    expect(await code(respondFriendRequest(db(), a.userId, cardForB.friendshipId!, true))).toBe('request_not_found'); // only the addressee answers
    expect(await respondFriendRequest(db(), b.userId, cardForB.friendshipId!, true)).toBe('accepted');
    await db().update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, b.userId));
    const mine = await friendsOf(db(), a.userId);
    expect(mine.friends.map((f) => [f.username, f.online])).toEqual([[b.username, true]]);
    expect((await playerCard(db(), a.userId, b.username))!).toMatchObject({ relation: 'friends', friends: 1, online: true });
    await removeFriend(db(), b.userId, a.userId);
    expect((await friendsOf(db(), a.userId)).friends).toHaveLength(0);
  });

  it('a request back to someone who asked first becomes a friendship', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    await sendFriendRequest(db(), a.userId, b.userId);
    expect(await sendFriendRequest(db(), b.userId, a.userId)).toBe('accepted');
    expect((await friendsOf(db(), b.userId)).friends).toHaveLength(1);
  });
});

describe('company invites', () => {
  it('a member with the members right invites a player without a company; they join', async () => {
    const owner = await playerWithCompany('Sofia');
    const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, owner.userId));
    const guest = await newPlayer();
    const outsider = await newPlayer();
    expect(await code(inviteToCompany(db(), outsider.userId, guest.userId))).toBe('not_member');
    expect((await playerCard(db(), owner.userId, guest.username))!.canInvite).toBe(true);
    await inviteToCompany(db(), owner.userId, guest.userId);
    expect(await code(inviteToCompany(db(), owner.userId, guest.userId))).toBe('already_invited');
    expect((await playerCard(db(), owner.userId, guest.username))!).toMatchObject({ canInvite: false, invited: true });
    const [invite] = await myCompanyInvites(db(), guest.userId);
    expect(invite!.company.id).toBe(org!.id);
    expect(await respondCompanyInvite(db(), guest.userId, invite!.id, true)).toBe('joined');
    const [member] = await db().select().from(companyMembers).where(eq(companyMembers.userId, guest.userId));
    expect(member!.companyId).toBe(org!.id);
    // Already in a company: cannot be invited anywhere else.
    const other = await playerWithCompany('Varna');
    expect(await code(inviteToCompany(db(), other.userId, guest.userId))).toBe('already_member');
  });
});

describe('private messages', () => {
  it('send, read, unsend, delete the conversation only for me', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const id1 = await sendDirectMessage(db(), a.userId, b.userId, 'Здрасти!');
    await sendDirectMessage(db(), a.userId, b.userId, 'Ще караме ли заедно?');
    expect(await unreadDirectCount(db(), b.userId)).toBe(2);
    // One notification per unread conversation (b is offline), not one per message.
    const notes = await db().select().from(notifications).where(and(eq(notifications.userId, b.userId), eq(notifications.title, `Ново съобщение от ${a.username}`)));
    expect(notes).toHaveLength(1);
    const [conv] = await conversations(db(), b.userId);
    expect(conv).toMatchObject({ userId: a.userId, unread: 2, last: 'Ще караме ли заедно?' });
    await markConversationRead(db(), b.userId, a.userId);
    expect(await unreadDirectCount(db(), b.userId)).toBe(0);
    expect(await code(unsendDirectMessage(db(), b.userId, id1))).toBe('message_not_found');
    await unsendDirectMessage(db(), a.userId, id1);
    const seen = await conversation(db(), b.userId, a.userId);
    expect(seen.map((m) => (m.deleted ? null : m.body))).toEqual([null, 'Ще караме ли заедно?']);
    await deleteConversation(db(), b.userId, a.userId);
    expect(await conversation(db(), b.userId, a.userId)).toHaveLength(0);
    expect(await conversations(db(), b.userId)).toHaveLength(0);
    // The other player still has it.
    expect(await conversation(db(), a.userId, b.userId)).toHaveLength(2);
    expect(await code(sendDirectMessage(db(), a.userId, a.userId, 'аз'))).toBe('self');
  });
});

describe('world chat', () => {
  it('global and trade channels; authors and staff delete; spam is limited', async () => {
    const a = await newPlayer();
    const staff = await newPlayer();
    await db().update(users).set({ role: 'support' }).where(eq(users.id, staff.userId));
    const id = await postToChannel(db(), a.userId, 'trade', 'Продавам Sokol Courier, 22 000 €');
    expect((await channelFeed(db(), 'trade')).some((m) => m.id === id && m.body?.startsWith('Продавам'))).toBe(true);
    expect((await channelFeed(db(), 'global')).some((m) => m.id === id)).toBe(false);
    const other = await newPlayer();
    expect(await code(deleteChannelMessage(db(), other.userId, 'player', id))).toBe('forbidden');
    await deleteChannelMessage(db(), staff.userId, 'support', id);
    expect((await channelFeed(db(), 'trade')).find((m) => m.id === id)!.deleted).toBe(true);
    for (let i = 0; i < 6; i++) await postToChannel(db(), a.userId, 'global', `съобщение ${i}`);
    expect(await code(postToChannel(db(), a.userId, 'global', 'още едно'))).toBe('rate_limited');
  });
});

describe('reputation', () => {
  it('tiers and the reward bonus', () => {
    expect(reputationTier(0).label).toBe('Нов превозвач');
    expect(reputationTier(55).label).toBe('Доверен');
    expect(reputationTier(100).label).toBe('Елитен');
    expect(reputationBonusShare(0)).toBe(0);
    expect(reputationBonusShare(50)).toBeCloseTo(0.05);
    expect(reputationBonusShare(100)).toBeCloseTo(0.1);
  });

  it('premium contracts need reputation; deliveries pay the reputation bonus', async () => {
    const p = await newPlayer();
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [van] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    const premium = await makeContract('Sofia', 'Plovdiv', { minReputation: 50 });
    expect(await code(acceptContract(db(), p.userId, premium.id, van!.id))).toBe('reputation_required');
    await db().update(companies).set({ reputation: 60 }).where(eq(companies.id, account!.id));
    const d = await acceptContract(db(), p.userId, premium.id, van!.id);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account!.id);
    const [bonus] = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, account!.id), eq(ledgerEntries.category, 'reputation_bonus')));
    expect(bonus!.amountCents).toBe(Math.round(premium.rewardCents * 0.06));
  });
});
