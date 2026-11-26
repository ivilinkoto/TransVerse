import { describe, expect, it } from 'vitest';
import { RELEASES } from '@/lib/game/releases';
import { withLocale } from '@/i18n/als';
import { releaseAnnouncement } from '@/server/discord/announce';
import { DISCORD_LIMITS, fitMessage } from '@/server/discord/fit';

type Embed = { title?: string; description?: string; fields?: { name: string; value: string }[]; footer?: { text: string } };
const total = (embeds: Embed[]) => embeds.reduce((n, e) => n + (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text.length ?? 0) + (e.fields ?? []).reduce((m, f) => m + f.name.length + f.value.length, 0), 0);

describe('Discord messages fit its size limits in every language', () => {
  it('every release announcement, in BG, EN and RU, fits after fitMessage (no 413)', () => {
    for (const lang of ['bg', 'en', 'ru'] as const) {
      for (const r of RELEASES) {
        const m = fitMessage(withLocale(lang, () => releaseAnnouncement(r)) as unknown as Record<string, unknown>) as { content?: string; embeds: Embed[] };
        expect(total(m.embeds), `${lang} ${r.version}`).toBeLessThanOrEqual(DISCORD_LIMITS.total);
        for (const e of m.embeds) {
          expect(e.description?.length ?? 0).toBeLessThanOrEqual(DISCORD_LIMITS.description);
          expect(e.title?.length ?? 0).toBeLessThanOrEqual(DISCORD_LIMITS.title);
          for (const f of e.fields ?? []) expect(f.value.length).toBeLessThanOrEqual(DISCORD_LIMITS.fieldValue);
        }
        expect((m.content ?? '').length).toBeLessThanOrEqual(DISCORD_LIMITS.content);
      }
    }
  });

  it('cuts an oversized message and keeps a small one as it is', () => {
    const small = { content: 'здравей', embeds: [{ title: 'а', description: 'б' }] };
    expect(fitMessage(small)).toEqual(small);
    const big = fitMessage({ embeds: [{ title: 'x'.repeat(400), description: 'д '.repeat(5000), fields: Array.from({ length: 30 }, (_, i) => ({ name: `п${i}`, value: 'с '.repeat(800) })) }] }) as { embeds: Embed[] };
    expect(big.embeds[0]!.fields!.length).toBeLessThanOrEqual(DISCORD_LIMITS.fields);
    expect(total(big.embeds)).toBeLessThanOrEqual(DISCORD_LIMITS.total);
  });
});
