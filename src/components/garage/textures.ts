/**
 * Textures drawn on a canvas at runtime (no image files): number plates, brand badges,
 * curtain folds, corrugated steel, concrete, wood, tyre tread, contour stripes.
 * Original drawings; the brands are the game's fictional ones.
 */
import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

function done(key: string, c: HTMLCanvasElement, opts: { repeat?: [number, number]; color?: boolean } = {}) {
  const tex = new THREE.CanvasTexture(c);
  if (opts.color !== false) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (opts.repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(...opts.repeat);
  }
  cache.set(key, tex);
  return tex;
}

/** A small seeded random, so the same texture looks the same every time. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** An EU-style number plate (blue band, black on white). */
export function plateTexture(text: string) {
  const key = `plate:${text}`;
  if (cache.has(key)) return cache.get(key)!;
  const { c, g } = canvas(520, 112);
  g.fillStyle = '#f8fafc';
  g.fillRect(0, 0, 520, 112);
  g.fillStyle = '#1d4ed8';
  g.fillRect(0, 0, 58, 112);
  g.fillStyle = '#facc15';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath();
    g.arc(29 + Math.cos(a) * 16, 38 + Math.sin(a) * 16, 2.6, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#f8fafc';
  g.font = 'bold 26px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('BG', 29, 96);
  g.fillStyle = '#0b0f17';
  g.font = 'bold 74px "DIN Alternate", "Arial Narrow", system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(text.toUpperCase().slice(0, 10), 290, 60);
  g.strokeStyle = '#0b0f17';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 514, 106);
  return done(key, c);
}

/** The brand name in chrome letters for the grille. */
export function badgeTexture(brand: string) {
  const key = `badge:${brand}`;
  if (cache.has(key)) return cache.get(key)!;
  const { c, g } = canvas(512, 96);
  g.clearRect(0, 0, 512, 96);
  const grad = g.createLinearGradient(0, 10, 0, 86);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.5, '#9aa4b2');
  grad.addColorStop(1, '#e5e7eb');
  g.fillStyle = grad;
  g.font = 'bold 64px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(brand.split(' ')[0]!.toUpperCase(), 256, 50);
  return done(key, c);
}

/** Text on a panel (company name on the cab door or the trailer side). */
export function textTexture(text: string, color = '#0b0f17', bg = 'transparent') {
  const key = `text:${text}:${color}:${bg}`;
  if (cache.has(key)) return cache.get(key)!;
  const { c, g } = canvas(1024, 160);
  if (bg !== 'transparent') {
    g.fillStyle = bg;
    g.fillRect(0, 0, 1024, 160);
  }
  g.fillStyle = color;
  g.font = 'italic bold 110px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text.slice(0, 18), 512, 84);
  return done(key, c);
}

/** Vertical curtain folds as a normal map (light ripples across a curtain-sider). */
export function curtainNormal() {
  const key = 'curtain:n';
  if (cache.has(key)) return cache.get(key)!;
  const { c, g } = canvas(512, 8);
  for (let x = 0; x < 512; x++) {
    const s = Math.sin((x / 512) * Math.PI * 2 * 14) * 0.55 + Math.sin((x / 512) * Math.PI * 2 * 37) * 0.15;
    const r = Math.round(128 + s * 110);
    g.fillStyle = `rgb(${r},128,255)`;
    g.fillRect(x, 0, 1, 8);
  }
  return done(key, c, { color: false });
}

/** Corrugated steel (containers, hall walls) as a normal map: horizontal = ribs along x. */
export function corrugatedNormal(ribs = 24) {
  const key = `corr:${ribs}`;
  if (cache.has(key)) return cache.get(key)!;
  const { c, g } = canvas(512, 8);
  for (let x = 0; x < 512; x++) {
    const p = ((x / 512) * ribs) % 1;
    // A trapezoid rib: flat, slope, flat, slope.
    const s = p < 0.2 ? 0 : p < 0.3 ? 1 : p < 0.7 ? 0 : p < 0.8 ? -1 : 0;
    g.fillStyle = `rgb(${Math.round(128 + s * 120)},128,255)`;
    g.fillRect(x, 0, 1, 8);
  }
  return done(key, c, { color: false });
}

/** Polished concrete with soft blotches and saw cuts. */
export function concreteTexture(tone = 92) {
  const key = `concrete:${tone}`;
  if (cache.has(key)) return cache.get(key)!;
  const { c, g } = canvas(1024, 1024);
  const r = rng(7);
  g.fillStyle = `rgb(${tone},${tone + 4},${tone + 10})`;
  g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 260; i++) {
    const x = r() * 1024;
    const y = r() * 1024;
    const rad = 20 + r() * 120;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const d = (r() - 0.5) * 22;
    grd.addColorStop(0, `rgba(${tone + d},${tone + d + 4},${tone + d + 10},0.35)`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 9000; i++) {
    const v = tone + (r() - 0.5) * 40;
    g.fillStyle = `rgba(${v},${v},${v + 6},0.25)`;
    g.fillRect(r() * 1024, r() * 1024, 1.5, 1.5);
  }
  g.strokeStyle = 'rgba(20,24,30,0.55)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(512, 0);
  g.lineTo(512, 1024);
  g.moveTo(0, 512);
  g.lineTo(1024, 512);
  g.stroke();
  return done(key, c, { repeat: [4, 4] });
}

/** Rough asphalt. */
export function asphaltTexture() {
  const key = 'asphalt';
  if (cache.has(key)) return cache.get(key)!;
  const { c, g } = canvas(512, 512);
  const r = rng(3);
  g.fillStyle = '#2a2d33';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 26000; i++) {
    const v = 30 + r() * 50;
    g.fillStyle = `rgba(${v},${v},${v + 4},0.6)`;
    g.fillRect(r() * 512, r() * 512, 1 + r() * 1.5, 1 + r() * 1.5);
  }
  return done(key, c, { repeat: [40, 40] });
}

/** Grass or snow ground. */
export function groundTexture(kind: 'grass' | 'snow' | 'dirt') {
  const key = `ground:${kind}`;
  if (cache.has(key)) return cache.get(key)!;
  const { c, g } = canvas(512, 512);
  const r = rng(kind.length * 11);
  const base = kind === 'grass' ? [74, 112, 52] : kind === 'snow' ? [232, 238, 244] : [110, 84, 60];
  g.fillStyle = `rgb(${base.join(',')})`;
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 30000; i++) {
    const d = (r() - 0.5) * (kind === 'snow' ? 18 : 46);
    g.fillStyle = `rgba(${base[0]! + d},${base[1]! + d},${base[2]! + d},0.5)`;
    g.fillRect(r() * 512, r() * 512, 2, 2);
  }
  return done(key, c, { repeat: [60, 60] });
}

/** Wooden deck planks (flatbeds). */
export function woodTexture() {
  const key = 'wood';
  if (cache.has(key)) return cache.get(key)!;
  const { c, g } = canvas(256, 512);
  const r = rng(5);
  for (let i = 0; i < 8; i++) {
    const v = 90 + r() * 40;
    g.fillStyle = `rgb(${v + 30},${v},${v - 30})`;
    g.fillRect(i * 32, 0, 32, 512);
    g.fillStyle = 'rgba(30,20,10,0.6)';
    g.fillRect(i * 32, 0, 2, 512);
    for (let k = 0; k < 40; k++) {
      g.fillStyle = `rgba(60,40,20,${0.1 + r() * 0.2})`;
      g.fillRect(i * 32 + r() * 30, r() * 512, 1, 20 + r() * 80);
    }
  }
  return done(key, c, { repeat: [1, 4] });
}

/** Red-white contour marking (reflective tape along trailers). */
export function contourTexture(colour: 'red' | 'yellow' = 'red') {
  const key = `contour:${colour}`;
  if (cache.has(key)) return cache.get(key)!;
  const { c, g } = canvas(256, 16);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#f8fafc' : colour === 'red' ? '#dc2626' : '#facc15';
    g.fillRect(i * 32, 0, 32, 16);
  }
  return done(key, c, { repeat: [20, 1] });
}

/** Tyre tread / sidewall lettering as a bump-ish colour map. */
export function treadTexture() {
  const key = 'tread';
  if (cache.has(key)) return cache.get(key)!;
  const { c, g } = canvas(512, 64);
  g.fillStyle = '#16181c';
  g.fillRect(0, 0, 512, 64);
  g.fillStyle = '#0b0c0f';
  for (let i = 0; i < 64; i++) {
    g.fillRect(i * 8, 0, 3, 64);
  }
  g.fillRect(0, 28, 512, 8);
  return done(key, c, { repeat: [6, 1] });
}

/** The instrument cluster: speedometer, rev counter and a centre display (original design). */
export function clusterTexture() {
  const key = 'cluster';
  if (cache.has(key)) return cache.get(key)!;
  const { c, g } = canvas(1024, 340);
  g.fillStyle = '#05070a';
  g.fillRect(0, 0, 1024, 340);
  const dial = (cx: number, max: number, step: number, label: string, red: number) => {
    const cy = 175;
    const r = 140;
    g.strokeStyle = '#1f2937';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
    const a0 = Math.PI * 0.75;
    const a1 = Math.PI * 2.25;
    for (let v = 0; v <= max; v += step / 2) {
      const a = a0 + ((a1 - a0) * v) / max;
      const major = v % step === 0;
      g.strokeStyle = v >= red ? '#ef4444' : '#e5e7eb';
      g.lineWidth = major ? 4 : 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6));
      g.lineTo(cx + Math.cos(a) * (r - (major ? 26 : 16)), cy + Math.sin(a) * (r - (major ? 26 : 16)));
      g.stroke();
      if (major) {
        g.fillStyle = '#cbd5e1';
        g.font = '22px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(max >= 1000 ? v / 100 : v), cx + Math.cos(a) * (r - 48), cy + Math.sin(a) * (r - 48));
      }
    }
    // Needle at rest.
    const a = a0 + (a1 - a0) * 0.02;
    g.strokeStyle = '#f97316';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * (r - 30), cy + Math.sin(a) * (r - 30));
    g.stroke();
    g.fillStyle = '#111827';
    g.beginPath();
    g.arc(cx, cy, 16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#94a3b8';
    g.font = '18px system-ui, sans-serif';
    g.fillText(label, cx, cy + 60);
  };
  dial(170, 125, 20, 'km/h', 200);
  dial(854, 2500, 500, 'x100 /min', 2000);
  // Centre display: gear, odometer, fuel and AdBlue bars.
  g.fillStyle = '#0b1220';
  g.fillRect(360, 40, 304, 260);
  g.strokeStyle = '#1e293b';
  g.strokeRect(360, 40, 304, 260);
  g.fillStyle = '#e2e8f0';
  g.font = 'bold 64px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('N', 512, 120);
  g.font = '24px system-ui, sans-serif';
  g.fillStyle = '#7dd3fc';
  g.fillText('412 386 km', 512, 175);
  const bar = (y: number, v: number, col: string, label: string) => {
    g.fillStyle = '#1f2937';
    g.fillRect(400, y, 224, 14);
    g.fillStyle = col;
    g.fillRect(400, y, 224 * v, 14);
    g.fillStyle = '#94a3b8';
    g.font = '16px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText(label, 400, y - 8);
  };
  bar(225, 0.78, '#22c55e', 'FUEL');
  bar(270, 0.62, '#38bdf8', 'AdBlue');
  // Warning lights row.
  ['#22c55e', '#f59e0b', '#38bdf8', '#22c55e'].forEach((col, i) => {
    g.fillStyle = col;
    g.globalAlpha = 0.85;
    g.beginPath();
    g.arc(420 + i * 60, 22, 7, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
  });
  return done(key, c);
}

/** The centre screen: a navigation map with a route (original drawing). */
export function navTexture() {
  const key = 'nav';
  if (cache.has(key)) return cache.get(key)!;
  const { c, g } = canvas(512, 320);
  g.fillStyle = '#0f172a';
  g.fillRect(0, 0, 512, 320);
  const r = rng(11);
  g.strokeStyle = '#1e293b';
  g.lineWidth = 6;
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    g.moveTo(r() * 512, r() * 320);
    g.lineTo(r() * 512, r() * 320);
    g.stroke();
  }
  g.strokeStyle = '#38bdf8';
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(40, 290);
  g.bezierCurveTo(140, 220, 200, 240, 260, 160);
  g.bezierCurveTo(300, 110, 400, 90, 470, 40);
  g.stroke();
  g.fillStyle = '#f97316';
  g.beginPath();
  g.moveTo(256, 172);
  g.lineTo(244, 196);
  g.lineTo(256, 190);
  g.lineTo(268, 196);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(15,23,42,0.85)';
  g.fillRect(0, 0, 512, 44);
  g.fillStyle = '#e2e8f0';
  g.font = 'bold 22px system-ui, sans-serif';
  g.fillText('E79  ·  128 km  ·  1:41', 16, 30);
  return done(key, c);
}

/** Seat fabric: fine weave with a darker centre panel. */
export function fabricTexture(base = '#2b313a') {
  const key = `fabric:${base}`;
  if (cache.has(key)) return cache.get(key)!;
  const { c, g } = canvas(256, 256);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  const r = rng(5);
  for (let i = 0; i < 9000; i++) {
    const v = r() * 30 - 15;
    g.fillStyle = `rgba(${128 + v},${128 + v},${140 + v},0.08)`;
    g.fillRect(r() * 256, r() * 256, 1, 2);
  }
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.fillRect(70, 0, 116, 256);
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let y = 0; y < 256; y += 16) g.fillRect(70, y, 116, 2);
  return done(key, c);
}
