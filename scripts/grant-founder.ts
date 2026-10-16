/** Promotes the configured accounts to Founder / Chief administrator. Idempotent. */
import { closeDb, getDb } from '../src/server/db/client';
import { bootstrapFounder } from '../src/server/admin';

// Comma-separated list, e.g. "ANGELov,V3s1chaa".
const list = process.argv[2] ?? process.env.FOUNDER_USERNAMES ?? process.env.FOUNDER_USERNAME ?? 'ANGELov,V3s1chaa';
for (const username of list.split(',').map((u) => u.trim()).filter(Boolean)) {
  const result = await bootstrapFounder(getDb(), username);
  console.log(
    result === 'promoted' ? `${username} is now Founder / Chief administrator.` : result === 'already' ? `${username} is already a founder.` : `Account "${username}" does not exist yet — register it, then deploy again.`,
  );
}
await closeDb();
