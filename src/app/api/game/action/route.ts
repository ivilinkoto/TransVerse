import { getDb } from '@/server/db/client';
import { Action, runAction } from '@/server/game/actions';
import { clientIp, handler } from '@/server/http';

/** All player commands from the web game (see runAction). */
export const POST = handler({ schema: Action, perMinute: 90 }, async ({ user, input }) => runAction(getDb(), user, input, clientIp));
