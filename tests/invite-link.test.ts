import { describe, expect, it } from 'vitest';
import { GET } from '@/app/r/[code]/route';

const call = (code: string) => GET(new Request(`http://127.0.0.1:3000/r/${code}`), { params: Promise.resolve({ code }) });

describe('invite link', () => {
  it('redirects to the sign-up page on the address the player used, not the internal one', async () => {
    const res = await call('testab23');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/register?ref=TESTAB23');
    expect(res.headers.get('set-cookie')).toContain('tv_ref=TESTAB23');
  });

  it('ignores a malformed code', async () => {
    const res = await call('nope');
    expect(res.headers.get('location')).toBe('/register');
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
