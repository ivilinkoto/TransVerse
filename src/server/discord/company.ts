import { eq } from 'drizzle-orm';
import type { Database } from '@/server/db/client';
import { organizations } from '@/server/db/schema';
import { fail } from '@/server/game/errors';
import { requirePermission } from '@/server/game/membership';
import { logActivity } from '@/server/game/notify';
import { discordConfig } from './config';
import { enqueue } from './outbox';
import { t } from '@/i18n/t';

/** The company's private channel in the Discord server (and its chat bridge): on or off, by ranks with "Настройки". */
export async function setCompanyDiscord(db: Database, actorId: string, on: boolean, now = new Date()) {
  if (!discordConfig().bot) fail('discord_off', t('Discord ботът още не е настроен.'));
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_settings');
    await tx.update(organizations).set({ discordChannel: on }).where(eq(organizations.id, actor.company.id));
    await enqueue(tx, `company-channel:${actor.company.id}:${now.getTime()}`, 'job:company-channel', { organizationId: actor.company.id }, now);
    await logActivity(tx, actorId, 'company_discord', { on });
  });
}
