import { getDb } from '@/server/db/client';
import { AVATAR_MAX_BYTES, removeAvatar, setAvatar } from '@/server/game/avatars';
import { fail } from '@/server/game/errors';
import { handler } from '@/server/http';
import { t } from '@/i18n/t';

/** Uploads the player's profile picture (multipart form: file). Type is checked by content, not by name. */
export const POST = handler({ perMinute: 10 }, async ({ user, request }) => {
  if (Number(request.headers.get('content-length') ?? 0) > AVATAR_MAX_BYTES + 64 * 1024) fail('too_large', t('Снимката е твърде голяма.'));
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof Blob) || file.size === 0) fail('invalid_input', t('Избери снимка.'));
  await setAvatar(getDb(), user.id, new Uint8Array(await (file as Blob).arrayBuffer()));
  return { ok: true };
});

export const DELETE = handler({ perMinute: 10 }, async ({ user }) => {
  await removeAvatar(getDb(), user.id);
  return { ok: true };
});
