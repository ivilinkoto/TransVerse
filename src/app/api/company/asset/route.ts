import { COMPANY_LIMITS } from '@/lib/game/company';
import { getDb } from '@/server/db/client';
import { fail } from '@/server/game/errors';
import { uploadAsset } from '@/server/game/membership';
import { handler } from '@/server/http';
import { t } from '@/i18n/t';

/** Uploads a company logo or banner (multipart form: kind, file). Type is checked by content, not by name. */
export const POST = handler({ perMinute: 20 }, async ({ user, request }) => {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > COMPANY_LIMITS.bannerMaxBytes + 64 * 1024) fail('too_large', t('Файлът е твърде голям.'));
  const form = await request.formData().catch(() => null);
  const kind = form?.get('kind');
  const file = form?.get('file');
  if (kind !== 'logo' && kind !== 'banner') fail('invalid_input', t('Невалиден вид изображение.'));
  if (!(file instanceof Blob) || file.size === 0) fail('invalid_input', t('Изберете файл.'));
  await uploadAsset(getDb(), user.id, kind as 'logo' | 'banner', new Uint8Array(await (file as Blob).arrayBuffer()));
  return { ok: true };
});
