import { eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { FEATURES } from '@/lib/game/features';
import { closeDb } from '@/server/db/client';
import { jobState, users } from '@/server/db/schema';
import { runAction } from '@/server/game/actions';
import { GameError } from '@/server/game/errors';
import { cleanPoll, closeDuePolls, discordVoter, endTeamPoll, getTeamPoll, pollsToAnswer, saveTeamPoll, tally, voteTeamPoll, type TeamPoll } from '@/server/game/team-polls';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const NOW = new Date();
const poll = (over: Partial<TeamPoll> = {}): TeamPoll => ({ question: 'Кой ивент да е следващият?', options: ['Конвой', 'Рали', 'Зимни игри'], votes: {}, endsAt: NOW.getTime() + 3_600_000, channelId: null, messageId: null, source: 'game', createdBy: 'admin', createdAt: NOW.getTime(), ...over });

describe('team polls: one poll for Discord and the game', () => {
  it('is a 1.3.2 feature and checks a new poll', () => {
    expect(FEATURES.team_polls).toBe('1.3.2');
    expect(cleanPoll({ question: '  Кой ивент?  ', options: ['А', ' ', 'Б'], hours: 24 })).toEqual({ question: 'Кой ивент?', options: ['А', 'Б'], hours: 24 });
    expect(() => cleanPoll({ question: 'Кой?', options: ['А', 'Б'], hours: 24 })).toThrow(GameError);
    expect(() => cleanPoll({ question: 'Кой ивент?', options: ['А'], hours: 24 })).toThrow(GameError);
    expect(() => cleanPoll({ question: 'Кой ивент?', options: ['А', 'Б'], hours: 500 })).toThrow(GameError);
  });

  it('a player votes on the dashboard once; the poll then leaves their dashboard', async () => {
    const p = await newPlayer();
    const id = await saveTeamPoll(db(), poll());
    expect((await pollsToAnswer(db(), p.userId, NOW)).map((x) => x.id)).toContain(id);
    await runAction(db(), { id: p.userId, role: 'player', username: p.username }, { type: 'voteTeamPoll', pollId: id, option: 1 }, async () => '127.0.0.1');
    expect((await pollsToAnswer(db(), p.userId, NOW)).map((x) => x.id)).not.toContain(id);
    const after = (await getTeamPoll(db(), id))!;
    expect(after.votes[`u:${p.userId}`]).toBe(1);
    expect(tally(after)).toMatchObject({ all: [0, 1, 0], game: [0, 1, 0], discord: [0, 0, 0], total: 1 });
  });

  it('counts a Discord vote together with the game ones; a linked account votes as its player', async () => {
    const linked = await newPlayer();
    const discordId = `d${Date.now()}`;
    await db().update(users).set({ discordId }).where(eq(users.id, linked.userId));
    const id = await saveTeamPoll(db(), poll());
    // A Discord member without an account, and one whose account is linked.
    await voteTeamPoll(db(), await discordVoter(db(), `x${Date.now()}`), id, 0, NOW);
    await voteTeamPoll(db(), await discordVoter(db(), discordId), id, 2, NOW);
    const after = (await getTeamPoll(db(), id))!;
    expect(tally(after)).toMatchObject({ all: [1, 0, 1], game: [0, 0, 1], discord: [1, 0, 0], total: 2 });
    // The linked player already answered in Discord: no card for them in the game.
    expect((await pollsToAnswer(db(), linked.userId, NOW)).map((x) => x.id)).not.toContain(id);
    // A vote from before the voter keys (the bare Discord id) still counts as Discord.
    expect(tally({ ...after, votes: { '123456': 1 } }).discord).toEqual([0, 1, 0]);
  });

  it('refuses a vote after the end; a closed poll keeps its results', async () => {
    const p = await newPlayer();
    const id = await saveTeamPoll(db(), poll({ endsAt: NOW.getTime() - 1000 }));
    expect(await code(voteTeamPoll(db(), `u:${p.userId}`, id, 0, NOW))).toBe('poll_closed');
    expect((await closeDuePolls(db(), NOW)).map((x) => x.id)).toContain(id);
    expect((await getTeamPoll(db(), id))!.closed).toBe(true);
    const early = await saveTeamPoll(db(), poll());
    await voteTeamPoll(db(), `u:${p.userId}`, early, 2, NOW);
    const done = await endTeamPoll(db(), early, NOW);
    expect(done.closed).toBe(true);
    expect(tally(done).all).toEqual([0, 0, 1]);
    expect(await code(voteTeamPoll(db(), `u:${p.userId}`, early, 0, NOW))).toBe('poll_closed');
    expect(await db().select().from(jobState).where(like(jobState.key, `team-poll:${early}`))).toHaveLength(1);
  });
});
