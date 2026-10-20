import { createPublicKey, verify } from 'node:crypto';

const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');

/** Checks the Ed25519 signature Discord puts on every interaction (timestamp + raw body). */
export function verifyDiscordSignature(publicKeyHex: string, signatureHex: string | null, timestamp: string | null, body: string): boolean {
  if (!publicKeyHex || !signatureHex || !timestamp || !/^[0-9a-f]{64}$/i.test(publicKeyHex) || !/^[0-9a-f]{128}$/i.test(signatureHex)) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI, Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(timestamp + body), key, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}
