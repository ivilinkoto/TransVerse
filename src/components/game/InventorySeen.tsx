'use client';

import { useEffect } from 'react';
import { api } from '@/lib/client/api';

/** 1.2.1: opening the inventory clears its „НОВО“ marks and the menu's count (after this visit). */
export function InventorySeen() {
  useEffect(() => {
    const id = setTimeout(() => void api('/api/game/action', { type: 'uiPrefs', inventorySeen: true }).catch(() => {}), 1500);
    return () => clearTimeout(id);
  }, []);
  return null;
}
