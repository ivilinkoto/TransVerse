import Link from 'next/link';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.2.2: any page that does not exist — a short note and the way home instead of the bare „404“. */
export default async function NotFound() {
  await initLocale();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="font-display text-5xl font-bold text-cyan-glow">404</p>
      <h1 className="font-display text-xl font-bold">{t('Тази страница я няма')}</h1>
      <p className="max-w-sm text-sm text-mist-300">{t('Може връзката да е стара или да има грешка в адреса.')}</p>
      <Link href="/" className="btn-primary mt-2">{t('Към началото')}</Link>
    </main>
  );
}
