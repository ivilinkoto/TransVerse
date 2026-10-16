/** Promotes the configured account to Founder / Chief administrator. Idempotent. */
import { closeDb, getDb } from '../src/server/db/client';
import { bootstrapFounder } from '../src/server/admin';

const username = process.argv[2] ?? process.env.FOUNDER_USERNAME ?? 'ANGELov';
const result = await bootstrapFounder(getDb(), username);
console.log(
  result === 'promoted' ? `${username} is now Founder / Chief administrator.` : result === 'already' ? `${username} is already the founder.` : `Account "${username}" does not exist yet — register it, then deploy again.`,
);
await closeDb();
