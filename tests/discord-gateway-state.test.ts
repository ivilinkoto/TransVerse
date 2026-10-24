import { describe, expect, it } from 'vitest';
import { gatewayCheck } from '@/server/discord/diagnose';
import { GATEWAY_STALE_MS } from '@/server/discord/gateway';

const now = Date.parse('2026-10-24T12:00:00Z');

describe('the worker connection in the admin panel', () => {
  it('reads the saved state with its age', () => {
    expect(gatewayCheck(undefined, now).ok).toBe(false);
    expect(gatewayCheck({ state: 'ready', at: now - 60_000 }, now)).toEqual({ ok: true, text: 'Свързан.' });
    // A worker that stopped refreshing its state.
    const stale = gatewayCheck({ state: 'ready', at: now - GATEWAY_STALE_MS - 60_000 }, now);
    expect(stale.ok).toBe(false);
    expect(stale.text).toMatch(/спрян/);
    // Connecting for a moment is fine; for an hour it is not.
    expect(gatewayCheck({ state: 'connecting', at: now - 30_000 }, now).ok).toBe(true);
    const stuck = gatewayCheck({ state: 'connecting', at: now - 3_600_000 }, now);
    expect(stuck.ok).toBe(false);
    expect(stuck.text).toMatch(/60 мин|1 ч/);
    expect(gatewayCheck({ state: 'closed', at: now - 120_000, code: 4004 }, now).text).toMatch(/грешен токен/);
    expect(gatewayCheck({ state: 'ready', at: now, limited: true }, now).ok).toBe(false);
  });
});
