'use client';

import { Send, UserRoundCheck, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import { money } from '@/lib/format';
import { commissionCents, HIRE_RULES } from '@/lib/game/hire';
import { t, tx } from '@/i18n/t';

interface Candidate {
  userId: string;
  username: string;
  level: number;
  online: boolean;
  city: string;
  km: number;
}

/** A company hands a board load to a free player for a commission. */
export function HireDialog({ contract, onClose }: { contract: { id: string; goods: string; rewardCents: number; origin: string; destination: string }; onClose: () => void }) {
  const router = useRouter();
  const [list, setList] = useState<Candidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<number>(HIRE_RULES.defaultShare);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    api<Candidate[]>(`/api/players/for-hire?contractId=${contract.id}`).then(setList, (e: Error) => setError(e.message));
  }, [contract.id]);

  const send = async (c: Candidate) => {
    setBusy(c.userId);
    setError(null);
    try {
      await api('/api/game/action', { type: 'offerJob', offer: { contractId: contract.id, toUserId: c.userId, share } });
      setDone(t('Предложението е изпратено на {0}. Поръчката е запазена за него {1} минути.', c.username, HIRE_RULES.offerMinutes));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={t('Възложи курс на шофьор')}>
      <button type="button" className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-label={t('Затвори')} onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-t-3xl border border-asphalt-700 bg-asphalt-900 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl sm:pb-5">
        <button type="button" className="absolute right-3 top-3 rounded-full p-1.5 text-mist-400 hover:bg-asphalt-800 hover:text-white" onClick={onClose} aria-label={t('Затвори')}><X className="h-5 w-5" /></button>
        <h2 className="flex items-center gap-2 font-display text-lg font-bold"><UserRoundCheck className="h-5 w-5 text-prestige" />{t('Възложи на шофьор')}</h2>
        <p className="mt-1 text-sm text-mist-300">{tx(contract.goods)}: {tx(contract.origin)} → {tx(contract.destination)} · {money(contract.rewardCents)}</p>
        <label className="mt-4 block text-sm">
          <span className="flex justify-between"><span>{t('Комисиона към касата')}</span><span className="num font-semibold text-gold-400">{Math.round(share * 100)} % · {money(commissionCents(contract.rewardCents, share))}</span></span>
          <input type="range" min={HIRE_RULES.minShare * 100} max={HIRE_RULES.maxShare * 100} step={1} value={Math.round(share * 100)} onChange={(e) => setShare(Number(e.target.value) / 100)} className="mt-2 w-full accent-[var(--color-gold-400)]" aria-label={t('Комисиона в проценти')} />
        </label>
        <p className="mt-1 text-xs text-mist-400">{t('Шофьорът кара със своя камион и плаща разходите си; при доставката плаща комисионата на компанията.')}</p>
        {done ? <p role="status" className="mt-4 text-sm text-profit">{done}</p> : (
          <div className="mt-4 max-h-[50dvh] overflow-y-auto">
            {error && <p role="alert" className="mb-2 text-sm text-loss">{error}</p>}
            {!list ? <p className="text-sm text-mist-400">{t('Зареждане…')}</p> : list.length === 0 ? (
              <p className="text-sm text-mist-400">{t('В момента няма свободни шофьори. Играчите се записват от Настройки → „На разположение за компании“.')}</p>
            ) : (
              <ul className="divide-y divide-asphalt-800">
                {list.map((c) => (
                  <li key={c.userId} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 font-semibold"><span className={`h-2 w-2 rounded-full ${c.online ? 'bg-profit' : 'bg-asphalt-500'}`} />{tx(c.username)}<span className="text-xs font-normal text-mist-400">{t('ниво {0}', c.level)}</span></span>
                      <span className="block truncate text-xs text-mist-400">{t('свободен камион в {0}{1}', c.city, c.km ? t(' · {0} км до товара', c.km) : t(' · на място'))}</span>
                    </span>
                    <button type="button" className="btn-primary shrink-0 px-3 py-1.5 text-xs" disabled={!!busy} onClick={() => void send(c)}><Send className="h-3.5 w-3.5" />{busy === c.userId ? '…' : t('Възложи')}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
