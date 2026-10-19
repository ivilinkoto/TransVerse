import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { hireCandidates } from '@/server/game/hire';
import { handler } from '@/server/http';

export const dynamic = 'force-dynamic';

/** Players available for a company's load, nearest free truck first. */
export const GET = handler({ perMinute: 60, schema: z.object({ contractId: z.string().uuid() }) }, async ({ user, input }) => hireCandidates(getDb(), user.id, input.contractId));
