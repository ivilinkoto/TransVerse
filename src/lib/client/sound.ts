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
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  }
}
