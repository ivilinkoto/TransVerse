import { describe, expect, it } from 'vitest';
import { format } from '../src/i18n/t';

describe('format', () => {
  it('shows nothing for a condition that came out false (never "false")', () => {
    expect(format(null, '{0}632 км с товар', [false])).toBe('632 км с товар');
    expect(format(null, '{0}x{1}', [null, undefined])).toBe('x');
  });
  it('keeps zero and true as they are', () => {
    expect(format(null, '{0} / {1}', [0, true])).toBe('0 / true');
  });
});
