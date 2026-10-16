import { subscribe } from '@/server/realtime';
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
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      send({ type: 'hello' });
      unsubscribe = subscribe((event) => {
        if (event.type === 'notification' && event.userId !== user.id) return;
        send({ type: event.type });
      });
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(': ping\n\n')), 25_000);
      request.signal.addEventListener('abort', () => {
        unsubscribe();
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
      clearInterval(heartbeat);
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}
