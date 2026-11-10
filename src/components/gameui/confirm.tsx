'use client';

import { useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GameWindow } from './GameWindow';
import { playSelect } from '@/lib/client/motion';
import { t } from '@/i18n/t';

function ConfirmWindow({ message, danger, ok, onDone }: { message: string; danger: boolean; ok: string; onDone: (yes: boolean) => void }) {
  const answered = useRef(false);
  const answer = (yes: boolean) => {
    if (answered.current) return;
    answered.current = true;
    onDone(yes);
  };
  return (
    <GameWindow title={t('Сигурен ли си?')} icon={danger ? '⚠️' : '❔'} accent={danger ? '#f43f5e' : '#22d3ee'} size="sm" onClose={() => answer(false)} testId="confirm-window">
      <p className="py-2 text-sm leading-relaxed text-mist-100">{message}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" className="game-action flex-row py-2.5 text-sm" onClick={() => answer(false)} data-testid="confirm-no">{t('Отказ')}</button>
        <button type="button" className={`game-action flex-row py-2.5 text-sm ${danger ? 'game-action-danger' : 'game-action-main'}`} onClick={() => (playSelect(), answer(true))} data-testid="confirm-yes" autoFocus>{ok}</button>
      </div>
    </GameWindow>
  );
}

/**
 * 1.3 „Нов облик“: „Сигурен ли си?“ as a small game window instead of the browser's
 * dialog (which stays without the new look). Resolves true on „Потвърди“.
 */
export function askConfirm(message: string, opts: { gameUi: boolean; danger?: boolean; ok?: string }): Promise<boolean> {
  if (!opts.gameUi || typeof document === 'undefined') return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (yes: boolean) => {
      resolve(yes);
      setTimeout(() => {
        root.unmount();
        host.remove();
      }, 0);
    };
    root.render(<ConfirmWindow message={message} danger={!!opts.danger} ok={opts.ok ?? t('Потвърди')} onDone={done} />);
  });
}
