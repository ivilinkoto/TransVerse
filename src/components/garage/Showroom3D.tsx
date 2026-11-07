'use client';

/**
 * 1.2.8 „Жива картина“: the player's truck in 3D — turn it with a finger, try paint
 * and parts before buying them. The model is built from the catalogue (kind, cab,
 * axles, trailer body), in real proportions (1 unit = 1 m); original, stylised shapes.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { powerUnitModel, trailerModel } from '@/lib/game/catalog';
import { GRILLE_COLORS, LIGHT_COLORS, type Cosmetics } from '@/lib/game/cosmetics';

export interface Showroom3DProps {
  modelId: string;
  trailerModelId: string | null;
  color: string;
  trailerColor?: string;
  cosmetics?: Cosmetics | null;
  night?: boolean;
  spin?: boolean;
}

const CAB_HEIGHT: Record<string, number> = { van: 2.5, day: 2.9, sleeper: 3.3, highline: 3.75 };

function mat(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15, ...opts });
}

function box(w: number, h: number, d: number, m: THREE.Material, r = 0.06) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A wheel (tyre + rim) at x along the vehicle, on both sides. */
function axle(group: THREE.Group, x: number, width: number, radius = 0.52, dual = false) {
  const tyre = mat('#111318', { roughness: 0.9, metalness: 0 });
  const rim = mat('#c7cdd6', { roughness: 0.3, metalness: 0.8 });
  for (const side of [-1, 1]) {
    for (const k of dual ? [0, 1] : [0]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.32, 28), tyre);
      t.rotation.x = Math.PI / 2;
      t.position.set(x, radius, side * (width / 2 - 0.18 - k * 0.34));
      t.castShadow = true;
      group.add(t);
      if (k === 0) {
        const r = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, 0.34, 20), rim);
        r.rotation.x = Math.PI / 2;
        r.position.set(x, radius, side * (width / 2 - 0.16));
        group.add(r);
      }
    }
  }
}

/** The power unit facing +x; returns the group and where a trailer's kingpin sits (x). */
function buildUnit(modelId: string, color: string, cosmetics: Cosmetics | null | undefined, night: boolean) {
  const unit = powerUnitModel(modelId);
  const g = new THREE.Group();
  const paint = mat(color, { metalness: 0.35, roughness: 0.32 });
  const dark = mat('#1b2230', { roughness: 0.7 });
  const glass = mat('#0f1c2e', { roughness: 0.05, metalness: 0.9, opacity: 0.85, transparent: true });
  const chrome = mat(GRILLE_COLORS[cosmetics?.grille ?? 'chrome'] ?? '#e2e8f0', { roughness: 0.2, metalness: 0.9 });
  const width = unit.kind === 'van' ? 2.0 : 2.5;
  const cabH = CAB_HEIGHT[unit.cab] ?? 3;
  const cabL = unit.kind === 'van' ? 1.7 : unit.cab === 'day' ? 1.9 : 2.3;
  const length = unit.kind === 'tractor' ? 6.2 : unit.kind === 'van' ? 5.6 : 8.4;
  const frontX = length / 2;
  // Chassis.
  const chassis = box(length - 0.4, 0.28, width * 0.62, dark, 0.03);
  chassis.position.set(0, 0.95, 0);
  g.add(chassis);
  // Cab.
  const cab = box(cabL, cabH - 1.1, width, paint, 0.18);
  cab.position.set(frontX - cabL / 2, 1.1 + (cabH - 1.1) / 2, 0);
  g.add(cab);
  // Windscreen and side windows.
  const ws = box(0.06, (cabH - 1.1) * 0.38, width * 0.86, glass, 0.02);
  ws.position.set(frontX + 0.01, 1.1 + (cabH - 1.1) * 0.68, 0);
  g.add(ws);
  for (const side of [-1, 1]) {
    const sw = box(cabL * 0.42, (cabH - 1.1) * 0.32, 0.04, glass, 0.02);
    sw.position.set(frontX - cabL * 0.28, 1.1 + (cabH - 1.1) * 0.68, side * (width / 2 + 0.005));
    g.add(sw);
    // Mirrors.
    const mirror = box(0.12, 0.45, 0.1, dark, 0.03);
    mirror.position.set(frontX + 0.05, 1.1 + (cabH - 1.1) * 0.62, side * (width / 2 + 0.22));
    g.add(mirror);
  }
  // Grille, bumper and lights.
  const grille = box(0.06, 0.75, width * 0.6, chrome, 0.02);
  grille.position.set(frontX + 0.02, 1.55, 0);
  g.add(grille);
  const bumper = box(0.25, 0.4, width, dark, 0.05);
  bumper.position.set(frontX - 0.05, 0.85, 0);
  g.add(bumper);
  const head = mat('#fff7d6', { emissive: new THREE.Color('#fff2b0'), emissiveIntensity: night ? 2.2 : 0.4 });
  for (const side of [-1, 1]) {
    const l = box(0.06, 0.18, 0.42, head, 0.02);
    l.position.set(frontX + 0.04, 1.05, side * (width / 2 - 0.35));
    g.add(l);
  }
  // Sun visor.
  if (cosmetics?.visor) {
    const visorColor = cosmetics.visor === 'body' ? color : cosmetics.visor === 'black' ? '#0b1220' : '#e2e8f0';
    const visor = box(0.5, 0.08, width * 0.95, mat(visorColor, { metalness: cosmetics.visor === 'chrome' ? 0.9 : 0.3, roughness: 0.25 }), 0.03);
    visor.position.set(frontX + 0.15, cabH - 0.02, 0);
    g.add(visor);
  }
  // Roof lights.
  if (cosmetics?.lights) {
    const c = LIGHT_COLORS[cosmetics.lights];
    const lm = mat(c, { emissive: new THREE.Color(c), emissiveIntensity: night ? 2.5 : 0.8 });
    for (let i = -2; i <= 2; i++) {
      const b = box(0.12, 0.12, 0.16, lm, 0.03);
      b.position.set(frontX - 0.2, cabH + 0.08, i * 0.42);
      g.add(b);
    }
  }
  // A snow plough in front of the plough truck.
  if (unit.look === 'plow') {
    const blade = box(0.25, 1.0, width * 1.25, mat('#f59e0b', { roughness: 0.4 }), 0.05);
    blade.position.set(frontX + 0.75, 0.75, 0);
    blade.rotation.y = 0.25;
    g.add(blade);
  }
  // Own body (rigid / van).
  if (unit.kind !== 'tractor') {
    const bodyL = length - cabL - 0.3;
    const bodyH = unit.kind === 'van' ? 1.6 : 2.6;
    const body = box(bodyL, bodyH, width, mat(unit.body === 'reefer' ? '#eef2f7' : '#e5e7eb', { roughness: 0.6 }), 0.08);
    body.position.set(-length / 2 + bodyL / 2, 1.15 + bodyH / 2, 0);
    g.add(body);
  }
  // Axles.
  const axles = Math.max(2, unit.axles);
  axle(g, frontX - (unit.kind === 'van' ? 0.9 : 1.3), width, unit.kind === 'van' ? 0.38 : 0.52);
  for (let i = 0; i < axles - 1; i++) axle(g, -length / 2 + (unit.kind === 'van' ? 1.0 : 1.4) + i * 1.35, width, unit.kind === 'van' ? 0.38 : 0.52, unit.kind !== 'van');
  // Fifth wheel for a tractor.
  if (unit.kind === 'tractor') {
    const fifth = box(1.1, 0.12, 1.4, mat('#3b4252'), 0.04);
    fifth.position.set(-length / 2 + 1.8, 1.15, 0);
    g.add(fifth);
  }
  return { group: g, length, kingpinX: -length / 2 + 1.8, width };
}

/** A semi-trailer behind the tractor, by its body type. */
function buildTrailer(trailerId: string, color: string) {
  const t = trailerModel(trailerId);
  const g = new THREE.Group();
  const width = 2.55;
  const length = t.body === 'lowbed' ? 16 : 13.6;
  const deckY = t.body === 'lowbed' ? 0.95 : 1.35;
  const frame = box(length, 0.3, width * 0.9, mat('#2b3442', { roughness: 0.7 }), 0.03);
  frame.position.set(0, deckY, 0);
  g.add(frame);
  const paint = mat(color, { roughness: 0.55, metalness: 0.1 });
  const top = deckY + 0.15;
  if (['curtain', 'reefer', 'container', 'livestock'].includes(t.body)) {
    const h = 2.75;
    const body = box(length, h, width, t.body === 'reefer' ? mat('#f1f5f9', { roughness: 0.5 }) : paint, 0.1);
    body.position.set(0, top + h / 2, 0);
    g.add(body);
    if (t.body === 'container') for (let i = -6; i <= 6; i++) {
      const rib = box(0.08, h * 0.96, width + 0.02, mat('#1f2937', { opacity: 0.25, transparent: true }), 0.01);
      rib.position.set(i, top + h / 2, 0);
      g.add(rib);
    }
  } else if (t.body === 'tanker') {
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(1.15, length - 2.6, 8, 24), mat('#cbd5e1', { metalness: 0.8, roughness: 0.25 }));
    tank.rotation.z = Math.PI / 2;
    tank.position.set(0, top + 1.15, 0);
    tank.castShadow = true;
    g.add(tank);
  } else if (t.body === 'tipper') {
    const tub = box(length - 1.5, 1.7, width, paint, 0.12);
    tub.position.set(0.3, top + 0.85, 0);
    g.add(tub);
  } else {
    // flatbed / lowbed: a deck with a few posts.
    const deck = box(length, 0.12, width, mat('#6b4f32', { roughness: 0.9 }), 0.02);
    deck.position.set(0, top, 0);
    g.add(deck);
  }
  for (let i = 0; i < Math.max(2, t.axles ?? 3); i++) axle(g, -length / 2 + 1.4 + i * 1.35, width, 0.5, true);
  // Landing legs.
  for (const side of [-1, 1]) {
    const leg = box(0.12, deckY - 0.2, 0.12, mat('#9ca3af'), 0.02);
    leg.position.set(length / 2 - 3.2, (deckY - 0.2) / 2 + 0.1, side * 0.9);
    g.add(leg);
  }
  return { group: g, length };
}

export function Showroom3D({ modelId, trailerModelId, color, trailerColor = '#e5edf6', cosmetics, night = false, spin = true }: Showroom3DProps) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      el.textContent = '';
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(night ? '#060a14' : '#cfe0f2');
    scene.fog = new THREE.Fog(scene.background, 40, 90);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
    camera.position.set(14, 6, 16);

    // Light: sky and sun by day, a lamp over the yard at night.
    scene.add(new THREE.HemisphereLight(night ? '#33415c' : '#ffffff', night ? '#0b0f18' : '#7c8796', night ? 0.6 : 1.1));
    const sun = new THREE.DirectionalLight(night ? '#9fb4ff' : '#fff4e0', night ? 0.6 : 2.2);
    sun.position.set(12, 20, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16 });
    scene.add(sun);
    if (night) {
      const lamp = new THREE.PointLight('#ffd9a0', 60, 40);
      lamp.position.set(0, 9, 6);
      scene.add(lamp);
    }

    // The floor of the showroom.
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: night ? '#151b26' : '#9aa6b4', roughness: 0.85 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(11.8, 12, 96), new THREE.MeshBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.6 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    scene.add(ring);

    // The vehicle: tractor + trailer coupled on the fifth wheel, centred on the turntable.
    const vehicle = new THREE.Group();
    const unit = buildUnit(modelId, color, cosmetics, night);
    vehicle.add(unit.group);
    let total = unit.length;
    if (trailerModelId && powerUnitModel(modelId).kind === 'tractor') {
      const tr = buildTrailer(trailerModelId, trailerColor);
      tr.group.position.x = unit.kingpinX - tr.length / 2 + 1.2;
      vehicle.add(tr.group);
      total = unit.length / 2 - (unit.kingpinX - tr.length + 1.2);
    }
    const bbox = new THREE.Box3().setFromObject(vehicle);
    vehicle.position.x = -(bbox.min.x + bbox.max.x) / 2;
    const turntable = new THREE.Group();
    turntable.add(vehicle);
    scene.add(turntable);
    const dist = Math.max(14, total * 1.15);
    camera.position.set(dist * 0.75, dist * 0.32, dist * 0.85);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 6;
    controls.maxDistance = 60;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.target.set(0, 1.6, 0);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    controls.autoRotate = spin && !reduce;
    controls.autoRotateSpeed = 0.8;

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    let frame = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [modelId, trailerModelId, color, trailerColor, cosmetics, night, spin]);
  return <div ref={host} className="h-full w-full touch-none" data-testid="showroom-3d" />;
}
