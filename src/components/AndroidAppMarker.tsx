'use client';

import { useEffect } from 'react';
import { markAndroidApp } from '@/lib/client/android-app';

/** Remembers that the page runs inside the Google Play app (see lib/client/android-app). */
export function AndroidAppMarker() {
  useEffect(() => markAndroidApp(), []);
  return null;
}
