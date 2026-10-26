'use client';

import { Camera, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { api } from '@/lib/client/api';
import { Avatar } from './Avatar';
import { t } from '@/i18n/t';

const SIZE = 256;

/** Crops the picked image to a centred square and scales it to 256×256 before upload (small files, same look everywhere). */
async function squareImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('Снимката не може да се обработи.')))), 'image/jpeg', 0.88));
}

export function AvatarUpload({ userId, username, version, vip }: { userId: string; username: string; version: number; vip: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', await squareImage(file), 'avatar.jpg');
      const res = await fetch('/api/account/avatar', { method: 'POST', body: form });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message ?? t('Качването не успя.'));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api('/api/account/avatar', {}, 'DELETE');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Avatar userId={userId} username={username} version={version} vip={vip} className="h-20 w-20 text-3xl" rounded="rounded-2xl" />
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary px-3 py-2 text-sm" disabled={busy} onClick={() => input.current?.click()}><Camera className="h-4 w-4" />{version ? t('Смени снимката') : t('Качи снимка')}</button>
          {version > 0 && <button type="button" className="btn-ghost px-3 py-2 text-sm" disabled={busy} onClick={() => void remove()}><Trash2 className="h-4 w-4" />{t('Махни')}</button>}
        </div>
        <p className="text-xs text-mist-400">{t('PNG, JPEG или WebP. Изрязва се до квадрат автоматично. Видима е за всички играчи.')}</p>
        {error && <p role="alert" className="text-xs text-loss">{error}</p>}
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
    </div>
  );
}
