'use client';

import { Download, Share2 } from 'lucide-react';
import { useState } from 'react';
import { t } from '@/i18n/t';

export interface RecapLine {
  label: string;
  value: string;
}

const W = 1080;
const H = 1350;

/** Draws the year card (portrait, for stories and posts) with the browser's own fonts (Cyrillic included). */
function draw(canvas: HTMLCanvasElement, title: string, name: string, lines: RecapLine[]) {
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0b1220');
  bg.addColorStop(1, '#1e1b4b');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // A road running through the card.
  g.strokeStyle = 'rgba(34,211,238,0.18)';
  g.lineWidth = 28;
  g.beginPath();
  g.moveTo(-40, H - 260);
  g.bezierCurveTo(W * 0.35, H - 420, W * 0.6, H - 120, W + 40, H - 300);
  g.stroke();
  g.setLineDash([36, 30]);
  g.strokeStyle = 'rgba(250,204,21,0.55)';
  g.lineWidth = 5;
  g.stroke();
  g.setLineDash([]);

  const font = (size: number, weight = 700) => `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  g.fillStyle = '#22d3ee';
  g.font = font(40, 600);
  g.fillText('TransVerse', 80, 120);
  g.fillStyle = '#ffffff';
  g.font = font(76, 800);
  g.fillText(title, 80, 230);
  g.fillStyle = '#c7d2fe';
  g.font = font(44, 600);
  g.fillText(name, 80, 300);

  let y = 410;
  for (const l of lines) {
    g.fillStyle = '#94a3b8';
    g.font = font(30, 500);
    g.fillText(l.label, 80, y);
    g.fillStyle = '#ffffff';
    g.font = font(50, 750);
    // Long values (lanes, records) shrink to fit the card.
    let size = 50;
    while (size > 28 && g.measureText(l.value).width > W - 160) g.font = font((size -= 2), 750);
    g.fillText(l.value, 80, y + 56);
    y += 128;
  }
  g.fillStyle = '#64748b';
  g.font = font(30, 500);
  g.fillText(t('transverse-bg.com · игрови данни'), 80, H - 70);
}

/** "Save the picture" and "Share" for the year card. */
export function RecapCard({ title, name, lines, fileName }: { title: string; name: string; lines: RecapLine[]; fileName: string }) {
  const [busy, setBusy] = useState(false);
  const picture = async () => {
    const canvas = document.createElement('canvas');
    draw(canvas, title, name, lines);
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/png'));
  };
  const download = async () => {
    setBusy(true);
    try {
      const url = URL.createObjectURL(await picture());
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setBusy(false);
    }
  };
  const share = async () => {
    setBusy(true);
    try {
      const file = new File([await picture()], fileName, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title });
      else await download();
    } catch {
      // The player closed the share sheet.
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn-primary" onClick={share} disabled={busy}><Share2 className="h-4 w-4" />{t('Сподели картинката')}</button>
      <button type="button" className="btn-ghost" onClick={download} disabled={busy}><Download className="h-4 w-4" />{t('Свали')}</button>
    </div>
  );
}
