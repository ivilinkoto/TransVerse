import { desc, eq } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { companyChronicle, organizations } from '@/server/db/schema';
import { t } from '@/i18n/t';

export type ChronicleKind = 'level' | 'build' | 'battle' | 'project' | 'division' | 'anniversary' | 'alliance' | 'driver' | 'specialization' | 'museum' | 'assembly' | 'merger' | 'tradition' | 'key_client' | 'owner' | 'holding' | 'name';

/** A big moment of a company, written to its chronicle (v1.5). */
export async function addChronicle(tx: DbOrTx, organizationId: string, kind: ChronicleKind, text: string, at = new Date()) {
  await tx.insert(companyChronicle).values({ organizationId, kind, text: text.slice(0, 200), at });
}

/** The chronicle, newest first, ending with the founding. */
export async function chronicleOf(db: DbOrTx, organizationId: string, limit = 30) {
  const rows = await db.select({ id: companyChronicle.id, kind: companyChronicle.kind, text: companyChronicle.text, at: companyChronicle.at }).from(companyChronicle).where(eq(companyChronicle.organizationId, organizationId)).orderBy(desc(companyChronicle.at)).limit(limit);
  const [org] = await db.select({ foundedAt: organizations.foundedAt, name: organizations.name }).from(organizations).where(eq(organizations.id, organizationId));
  return org ? [...rows, { id: 'founded', kind: 'founded', text: t('„{0}“ е основана', org.name), at: org.foundedAt }] : rows;
}
