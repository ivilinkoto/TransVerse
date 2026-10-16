import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { companyChat } from '@/server/game/chat';
import { handler } from '@/server/http';

export const dynamic = 'force-dynamic';

/** Company chat messages for members (`after` = only newer ones). */
export const GET = handler({ perMinute: 60, schema: z.object({ after: z.coerce.number().int().min(0).optional() }) }, async ({ user, input }) => companyChat(getDb(), user.id, input.after ?? 0));
