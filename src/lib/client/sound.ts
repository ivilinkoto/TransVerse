'use client';

/**
 * A short two-note chime made in the browser (Web Audio, no sound files).
 * Browsers only allow sound after the player has interacted with the page,
 * so the audio context is unlocked on the first tap or click.
 */
const KEY = 'tv-sound';
let ctx: AudioContext | null = null;

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private mode — keep the default */
  }
}

const ARRIVAL_KEY = 'tv-sound-arrival';
const VOLUME_KEY = 'tv-sound-volume';

/** 1.1.3: the arrival sound on its own (on unless switched off). */
export function arrivalSoundEnabled(): boolean {
  try {
    return localStorage.getItem(ARRIVAL_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setArrivalSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(ARRIVAL_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode — keep the default */
  }
}

/** 1.1.3: loudness 0…1 (default 1). */
export function soundVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY) ?? '1');
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  } catch {
    return 1;
  }
}

export function setSoundVolume(v: number) {
  try {
    localStorage.setItem(VOLUME_KEY, String(Math.min(1, Math.max(0, v))));
  } catch {
    /* private mode */
  }
}

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

/** Call once on a user gesture so later chimes are allowed to play. */
export function unlockSound() {
  const c = context();
  if (c && c.state === 'suspended') void c.resume().catch(() => undefined);
}

export function playChime() {
  const c = context();
  if (!c || c.state !== 'running') return;
  const start = c.currentTime;
  for (const [i, freq] of [880, 1318.5].entries()) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = start + i * 0.13;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.18 * soundVolume()), t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  }
}

/**
 * 1.1.3: a truck arrived — two short low "horn" notes (different from the chime)
 * and a short buzz on phones that allow it.
 */
export function playArrival() {
  try {
    navigator.vibrate?.([120, 80, 120]);
  } catch {
    /* not allowed — sound only */
  }
  const c = context();
  if (!c || c.state !== 'running') return;
  const start = c.currentTime;
  for (const [i, freq] of [311.1, 311.1].entries()) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const t = start + i * 0.22;
    gain.gain.setValueAtTime(0.0001, t);
    const peak = Math.max(0.0002, 0.22 * soundVolume());
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    gain.gain.setValueAtTime(peak, t + 0.13);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  }
}
