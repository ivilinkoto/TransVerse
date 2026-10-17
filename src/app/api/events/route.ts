import { subscribe, trackOnline } from '@/server/realtime';
import { touchLastSeen } from '@/server/presence';
import { getDb } from '@/server/db/client';
import { membershipOf } from '@/server/game/membership';
import { errorResponse, requireUser } from '@/server/http';

export const dynamic = 'force-dynamic';

/** Server-Sent Events: only the user's own notifications plus shared market/leaderboard pings. */
export async function GET(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    return errorResponse(error);
  }
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  const offline = trackOnline(user.id);
  // Online status: refreshed while the game is open, stamped once more when it closes.
  const seen = (force = false) => void touchLastSeen(getDb(), user.id, force).catch(() => {});
  seen(true);
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      send({ type: 'hello' });
      // Which company this player belongs to (re-checked at most every 30 s) — chat events go to members only.
      let member: { companyId: string | null; at: number } = { companyId: null, at: 0 };
      const myCompany = async () => {
        if (Date.now() - member.at > 30_000) member = { companyId: (await membershipOf(getDb(), user.id))?.company.id ?? null, at: Date.now() };
        return member.companyId;
      };
      unsubscribe = subscribe((event) => {
        if (event.type === 'notification' && event.userId !== user.id) return;
        // Private messages: only the two players of the conversation.
        if (event.type === 'dm') {
          if (event.userId === user.id || event.fromId === user.id) send({ type: 'dm', with: event.userId === user.id ? event.fromId : event.userId });
          return;
        }
        if (event.type === 'channel') {
          send({ type: 'channel', channel: event.channel });
          return;
        }
        if (event.type === 'chat') {
          void myCompany().then((id) => {
            if (id && id === event.companyId) send({ type: 'chat' });
          }).catch(() => {});
          return;
        }
        send({ type: event.type });
      });
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(': ping\n\n'));
        seen();
      }, 25_000);
      request.signal.addEventListener('abort', () => {
        unsubscribe();
        offline();
        seen(true);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      unsubscribe();
      offline();
      clearInterval(heartbeat);
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}
