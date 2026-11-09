'use client';

import dynamic from 'next/dynamic';
import type { PostcardData } from './PostcardScene';
import { t } from '@/i18n/t';

// three.js needs the browser (WebGL).
const PostcardScene = dynamic(() => import('./PostcardScene').then((m) => m.PostcardScene), {
  ssr: false,
  loading: () => <div className="flex aspect-[1200/630] w-full items-center justify-center rounded-2xl bg-asphalt-900 text-sm text-mist-400">{t('Рисуваме картичката…')}</div>,
});

export function PostcardClient({ data }: { data: PostcardData }) {
  return <PostcardScene data={data} />;
}
