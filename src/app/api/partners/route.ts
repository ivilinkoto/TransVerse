import { z } from 'zod';
import { featureLive } from '@/lib/game/features';
import { PARTNER_LIMITS } from '@/lib/game/partners';
import { recordCaptchaFailure, verifyCaptcha } from '@/server/auth/captcha';
import { rateLimit } from '@/server/auth/rate-limit';
import { getDb } from '@/server/db/client';
import { fail } from '@/server/game/errors';
import { hashIp } from '@/server/game/referrals';
import { clientIp, currentUser, handler } from '@/server/http';
import { partnerInquirySchema, sendPartnerInquiry } from '@/server/partners';
import { t } from '@/i18n/t';

const schema = partnerInquirySchema.extend({ captcha: z.object({ id: z.string().uuid(), number: z.number().int().min(0) }, 'Потвърдете, че не сте робот.') });

/** 1.2.3.1: the form of the „За партньори“ page (anyone, with „Не съм робот“; 3 an hour per address). */
export const POST = handler({ auth: false, schema, perMinute: 10 }, async ({ input }) => {
  const db = getDb();
  if (!featureLive('partners', new Date())) fail('not_released', t('Това идва със следващото обновление.'), 403);
  const ip = await clientIp();
  await rateLimit(db, `partners:${ip}`, PARTNER_LIMITS.perHour, 3600);
  const ipHash = await hashIp(db, ip);
  await verifyCaptcha(db, input.captcha).catch(async (e: unknown) => {
    await recordCaptchaFailure(db, ipHash);
    throw e;
  });
  const user = await currentUser().catch(() => null);
  await sendPartnerInquiry(db, input, { userId: user?.id ?? null, ipHash });
  return { ok: true };
});
