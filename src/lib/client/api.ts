'use client';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** JSON call to our own API. Throws ApiError with the server's Bulgarian message. */
export async function api<T = { ok: true }>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!response.ok) throw new ApiError(data.error ?? 'error', data.message ?? 'Възникна грешка.');
  return data as T;
}
