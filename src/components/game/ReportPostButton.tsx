'use client';

import { Flag } from 'lucide-react';
import { openReport } from './ReportDialog';
import { t } from '@/i18n/t';

/** Reports a recruitment post to the moderators (v1.7). */
export function ReportPostButton({ postId, userId, username, text }: { postId: string; userId: string; username: string; text: string }) {
  return (
    <button type="button" className="inline-flex items-center gap-1 text-xs text-mist-400 hover:text-loss" onClick={() => openReport({ targetUserId: userId, username, kind: 'recruitment', postId, snippet: text })}>
      <Flag className="h-3 w-3" />{t('Докладвай')}
    </button>
  );
}
