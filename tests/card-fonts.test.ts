import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/server/db/client';
import { playerCardImage } from '@/server/discord/cards';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

describe('Discord cards', () => {
  it('draw with the fonts from public/fonts (no Google Fonts)', async () => {
    const p = await newPlayer();
    const card = await playerCardImage(db(), p.username);
    expect(card).not.toBeNull();
    const png = Buffer.from(await card!.arrayBuffer());
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.length).toBeGreaterThan(5_000);
  });
});
