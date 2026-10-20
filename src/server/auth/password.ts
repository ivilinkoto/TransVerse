// Loaded on first use: the worker bundle (dist/) has no node_modules, and it never hashes passwords.
const argon2 = () => import('@node-rs/argon2');

// argon2id with OWASP-recommended parameters (19 MiB, 2 iterations).
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export const hashPassword = async (password: string) => (await argon2()).hash(password, OPTIONS);
export const verifyPassword = async (passwordHash: string, password: string) => (await argon2()).verify(passwordHash, password).catch(() => false);

/** Burns comparable time when the user does not exist, so login timing does not reveal accounts. */
let dummyHash: Promise<string> | undefined;
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(await dummyHash, password);
  return false;
}
