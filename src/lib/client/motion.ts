'use client';

import { soundEnabled, soundVolume } from './sound';

/**
 * 1.1.4.3: animations and effects. On unless the player switched them off on
 * this device (Settings) or the system asks for reduced motion.
 */
const KEY = 'tv-motion';

export function motionPreference(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function motionEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  return motionPreference();
}

export function setMotionEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private mode — keep the default */
  }
  applyMotion();
}

/** Marks the page so CSS can switch the effects off as well. */
export function applyMotion() {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.motion = motionEnabled() ? 'on' : 'off';
}

// ── Short sounds for the effects (Web Audio, no files; follow the sound setting) ──

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !soundEnabled()) return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

function tone(freq: number, at: number, length: number, type: OscillatorType, peak: number) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * soundVolume()), t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

/** One click of the roulette. */
export const playTick = () => tone(1800, 0, 0.03, 'square', 0.04);

/** The reveal: a short rising chord, longer and brighter for rarer items. */
export function playReveal(tier: number) {
  const notes = [523.3, 659.3, 784, 1046.5, 1318.5].slice(0, 2 + Math.min(3, tier));
  notes.forEach((f, i) => tone(f, i * 0.08, 0.35 + tier * 0.05, 'triangle', 0.12));
}

/** Money or ТрансКоин coming in. */
export const playCoin = () => {
  tone(1318.5, 0, 0.12, 'sine', 0.1);
  tone(1760, 0.07, 0.18, 'sine', 0.1);
};

/** A level or a stamp. */
export const playStamp = () => {
  tone(196, 0, 0.18, 'square', 0.08);
  tone(392, 0.02, 0.25, 'triangle', 0.1);
};
