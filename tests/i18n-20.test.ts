import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ru from '../messages/ru.json';
import { extractKeys } from '../scripts/i18n/extract';
import { withLocale } from '@/i18n/als';
import { t, tx } from '@/i18n/t';
import { duration, money } from '@/lib/format';

const placeholders = (s: string) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(',');

describe('v2.0 languages', () => {
  it('every text in the game has an English and a Russian translation with the same placeholders', () => {
    const keys = extractKeys();
    const missing = keys.filter((k) => !(k in en) || !(k in ru));
    expect(missing).toEqual([]);
    const bad = keys.filter((k) => placeholders(k) !== placeholders((en as Record<string, string>)[k]!) || placeholders(k) !== placeholders((ru as Record<string, string>)[k]!));
    expect(bad).toEqual([]);
  });

  it('t() and tx() follow the language; Bulgarian stays the source', () => {
    expect(t('{0} д {1} ч', 2, 3)).toBe('2 д 3 ч');
    expect(withLocale('en', () => duration(185))).toBe('3 h 05 min');
    expect(withLocale('ru', () => t('Камиони'))).toBe('Грузовики');
    expect(withLocale('en', () => tx('Непознат текст'))).toBe('Непознат текст');
    expect(withLocale('en', () => money(1_234_00))).toBe('1,234 lv');
  });
});
