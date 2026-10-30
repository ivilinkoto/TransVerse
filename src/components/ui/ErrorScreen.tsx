'use client';

import { AlertTriangle, Bug, RotateCcw, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { startTransition, useCallback, useEffect, useState } from 'react';
import { t } from '@/i18n/t';

/**
 * 1.1.3.5: what a page shows when it fails to load — what happened in plain
 * words, "Опитай пак", and (in the game) "Докладвай" with the page and the
 * error's code already filled in.
 */
export function ErrorScreen({ error, reset, home = '/game', report = true }: { error: Error & { digest?: string }; reset: () => void; home?: string; report?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [offline, setOffline] = useState(false);
  const retry = useCallback(() => startTransition(() => {
    router.refresh();
    reset();
  }), [router, reset]);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    // Back online: try again by itself.
    const back = () => {
      update();
      retry();
    };
    update();
    window.addEventListener('online', back);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', back);
      window.removeEventListener('offline', update);
    };
  }, [retry]);
  const Icon = offline ? WifiOff : AlertTriangle;
  const params = new URLSearchParams({ report: pathname });
  if (error.digest) params.set('error', error.digest.slice(0, 40));
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center" role="alert">
      <Icon className={`h-12 w-12 ${offline ? 'text-mist-400' : 'text-amber-sig'}`} />
      <h1 className="font-display text-2xl font-bold">{offline ? t('Няма връзка') : t('Страницата не се зареди')}</h1>
      <p className="text-mist-300">
        {offline
          ? t('Провери интернета си — страницата ще се опита отново, щом връзката се върне.')
          : t('Нещо от наша страна се обърка. Опитай пак след малко; ако се повтаря, кажи ни — ще го оправим.')}
      </p>
      {error.digest && !offline && <p className="num text-xs text-mist-500">{t('Код на грешката: {0}', error.digest)}</p>}
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className="btn-primary" onClick={retry}><RotateCcw className="h-4 w-4" />{t('Опитай пак')}</button>
        <Link href={home} className="btn-ghost">{t('Към началото')}</Link>
        {report && !offline && <Link href={`/game/support?${params}`} className="btn-ghost"><Bug className="h-4 w-4" />{t('Докладвай')}</Link>}
      </div>
    </div>
  );
}
