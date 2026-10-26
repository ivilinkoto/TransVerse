/**
 * 1.1.2: the sign-up captcha is a small proof-of-work puzzle we host
 * ourselves (no third party sees the visitor). The server picks a secret
 * number below `max` and publishes SHA-256(salt + number); the browser finds
 * the number by trying them all, which takes a person's browser about a
 * second and makes mass sign-ups expensive.
 */
export const CAPTCHA = {
  /** The secret number is below this. */
  max: 60_000,
  /** A puzzle must be solved within this many minutes. */
  ttlMinutes: 10,
  /** Wrong passwords (per address or account, 15 min) after which the login asks for it too (1.1.2). */
  loginAfter: 3,
} as const;

export interface CaptchaPuzzle {
  id: string;
  salt: string;
  challenge: string;
  max: number;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Browser: finds the secret number (null when there is none below max). */
export async function solveCaptcha(p: CaptchaPuzzle, batch = 500): Promise<number | null> {
  const enc = new TextEncoder();
  for (let start = 0; start < p.max; start += batch) {
    const nums = Array.from({ length: Math.min(batch, p.max - start) }, (_, i) => start + i);
    const hashes = await Promise.all(nums.map((n) => crypto.subtle.digest('SHA-256', enc.encode(`${p.salt}${n}`))));
    const hit = hashes.findIndex((h) => hex(h) === p.challenge);
    if (hit >= 0) return nums[hit]!;
  }
  return null;
}
