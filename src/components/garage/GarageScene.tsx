'use client';

/**
 * 1.2.3.5 „Гараж“: the player's hall in 3D — a turntable with the chosen truck, the
 * other trucks on side platforms, tyre shelves, a tool wall, a trophy cabinet, the
 * retro shelf, a neon sign, real-time day and night; the cab from the inside, a test
 * drive on the yard and photo scenes. The hall grows with the player's level.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Tuning } from '@/lib/game/garage';
import { HALLS, buildHall, buildOutdoor } from './hall3d';
import { box, buildTruck, disposeTree, mat, type BuiltTruck, type TruckLook } from './truck3d';

export type GarageMode = 'orbit' | 'cab' | 'drive';
export type GarageScenery = 'hall' | 'snow' | 'sunset' | 'highway';

export interface GarageSceneProps {
  truck: TruckLook;
  others?: TruckLook[];
  tier: number;
  night: boolean;
  sign: string;
  trophies: number;
  retired?: { modelId: string; color: string }[];
  charms?: string[];
  mode: GarageMode;
  scenery: GarageScenery;
  spin: boolean;
  /** Hands the parent a function that returns the current frame as a PNG data URL. */
  onCapture?: (capture: (() => string) | null) => void;
}

interface Ctx {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  pmrem: THREE.PMREMGenerator;
  roomEnv: THREE.Texture;
  skyEnv: THREE.Texture | null;
  high: boolean;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  world: THREE.Group;
  holder: THREE.Group;
  truck: BuiltTruck | null;
  interior: THREE.Group | null;
  snow: THREE.Points | null;
  drops: { obj: THREE.Object3D; y: number; start: number }[];
  drive: { angle: number; radius: number } | null;
  mode: GarageMode;
}

/** The inside of the cab: dashboard, wheel, seats, bunk and the player's keepsakes. */
function buildInterior(t: BuiltTruck, charms: string[]) {
  const g = new THREE.Group();
  const { frontX, length: cabL, height: cabH, width } = t.cab;
  const trim = mat('#1f2937', { roughness: 0.8, side: THREE.DoubleSide });
  const soft = mat('#334155', { roughness: 0.95, side: THREE.DoubleSide });
  const floorY = t.cab.floorY + 0.03;
  const floor = box(cabL - 0.1, 0.05, width - 0.1, trim, 0.01);
  floor.position.set(frontX - cabL / 2, floorY, 0);
  g.add(floor);
  // Dashboard with a glowing cluster and a screen.
  const dash = box(0.6, 0.55, width - 0.15, mat('#111827', { roughness: 0.6 }), 0.08);
  dash.position.set(frontX - 0.35, floorY + 0.75, 0);
  g.add(dash);
  const cluster = box(0.04, 0.22, 0.55, mat('#0ea5e9', { emissive: new THREE.Color('#0ea5e9'), emissiveIntensity: 0.9 }), 0.02);
  cluster.position.set(frontX - 0.66, floorY + 0.98, -width * 0.22);
  g.add(cluster);
  const screen = box(0.04, 0.2, 0.35, mat('#22c55e', { emissive: new THREE.Color('#16a34a'), emissiveIntensity: 0.7 }), 0.02);
  screen.position.set(frontX - 0.6, floorY + 0.98, 0.15);
  g.add(screen);
  // Steering wheel.
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.03, 10, 32), mat('#0b0f17', { roughness: 0.5 }));
  wheel.position.set(frontX - 0.85, floorY + 0.95, -width * 0.22);
  wheel.rotation.y = Math.PI / 2;
  wheel.rotation.x = 0.35;
  g.add(wheel);
  // Seats.
  for (const z of [-width * 0.22, width * 0.22]) {
    const seat = box(0.55, 0.15, 0.55, soft, 0.06);
    seat.position.set(frontX - 1.25, floorY + 0.5, z);
    const back = box(0.15, 0.8, 0.55, soft, 0.06);
    back.position.set(frontX - 1.55, floorY + 0.95, z);
    g.add(seat, back);
  }
  // Rear wall with the bunk (sleeper cabs).
  const rear = box(0.05, cabH - floorY - 0.1, width - 0.1, trim, 0.01);
  rear.position.set(frontX - cabL + 0.08, floorY + (cabH - floorY) / 2, 0);
  g.add(rear);
  if (cabL > 2) {
    const bunk = box(0.6, 0.18, width - 0.2, mat('#475569', { roughness: 1 }), 0.06);
    bunk.position.set(frontX - cabL + 0.4, floorY + 0.55, 0);
    g.add(bunk);
    const pillow = box(0.35, 0.12, 0.45, mat('#e2e8f0', { roughness: 1 }), 0.05);
    pillow.position.set(frontX - cabL + 0.4, floorY + 0.7, width / 2 - 0.4);
    g.add(pillow);
  }
  // Roof lining and door panels.
  const roof = box(cabL - 0.1, 0.04, width - 0.1, trim, 0.01);
  roof.position.set(frontX - cabL / 2, cabH - 0.1, 0);
  g.add(roof);
  for (const side of [-1, 1]) {
    const panel = box(cabL - 0.3, 0.7, 0.04, soft, 0.02);
    panel.position.set(frontX - cabL / 2, floorY + 0.5, side * (width / 2 - 0.08));
    g.add(panel);
  }
  const front = box(0.05, 1.05, width - 0.1, trim, 0.01);
  front.position.set(frontX - 0.06, floorY + 0.55, 0);
  g.add(front);
  for (const side of [-1, 1]) {
    // Behind the door window: the wall up to the roof.
    const upper = box(cabL * 0.45, cabH - floorY - 0.8, 0.04, trim, 0.01);
    upper.position.set(frontX - cabL + cabL * 0.25, floorY + 0.8 + (cabH - floorY - 0.8) / 2, side * (width / 2 - 0.08));
    g.add(upper);
  }
  // Keepsakes from the inventory.
  const has = (id: string) => charms.includes(id);
  if (has('truck_keychain')) {
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.25, 4), mat('#e5e7eb'));
    string.position.set(frontX - 0.3, cabH - 0.55, 0);
    const toy = box(0.12, 0.07, 0.06, mat('#dc2626'), 0.01);
    toy.position.set(frontX - 0.3, cabH - 0.72, 0);
    g.add(string, toy);
  }
  if (has('road_atlas')) {
    const atlas = box(0.3, 0.03, 0.22, mat('#1d4ed8'), 0.01);
    atlas.position.set(frontX - 0.45, floorY + 1.04, width * 0.25);
    atlas.rotation.y = 0.3;
    g.add(atlas);
  }
  if (has('cb_mic')) {
    const mic = box(0.06, 0.1, 0.04, mat('#111827'), 0.02);
    mic.position.set(frontX - 0.55, cabH - 0.25, width * 0.05);
    g.add(mic);
  }
  if (has('old_tachograph')) {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.005, 20), mat('#f8fafc'));
    disc.position.set(frontX - 0.62, floorY + 1.04, width * 0.05);
    g.add(disc);
  }
  if (has('trucker_cap')) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('#b91c1c'));
    cap.position.set(frontX - 1.25, floorY + 0.6, width * 0.22);
    g.add(cap);
  }
  if (has('sunglasses')) {
    const glasses = box(0.05, 0.04, 0.16, mat('#0b0f17', { metalness: 0.8 }), 0.01);
    glasses.position.set(frontX - 0.5, floorY + 1.05, -width * 0.05);
    g.add(glasses);
  }
  return g;
}

/** In the cab the outer shell is hidden (the interior has its own walls) and the glass is clear. */
function showShell(t: BuiltTruck | null, on: boolean) {
  t?.group.traverse((o) => {
    if (o.userData.shell) o.visible = on;
    if (o.userData.glass && o instanceof THREE.Mesh) (o.material as THREE.MeshStandardMaterial).opacity = on ? 0.82 : 0.12;
  });
}

/** Moves the camera and drops any leftover spin from a drag (damping would keep turning it). */
function settle(controls: OrbitControls, camera: THREE.PerspectiveCamera, pos: THREE.Vector3) {
  controls.enableDamping = false;
  camera.position.copy(pos);
  controls.update();
  camera.position.copy(pos);
  controls.update();
  controls.enableDamping = true;
}

function setOrbit(ctx: Ctx, spin: boolean) {
  const { camera, controls, truck } = ctx;
  const len = truck?.length ?? 8;
  const dist = Math.max(12, len * 1.05);
  controls.enabled = true;
  controls.enableZoom = true;
  controls.minDistance = 5;
  controls.maxDistance = 45;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.target.set(0, 1.8, 0);
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  controls.autoRotate = spin && !reduce;
  controls.autoRotateSpeed = 0.7;
  settle(controls, camera, new THREE.Vector3(dist * 0.8, Math.min(5, dist * 0.26), dist * 0.62));
}

function setCab(ctx: Ctx) {
  const { camera, controls, truck, holder } = ctx;
  if (!truck) return;
  const eye = truck.eye.clone();
  holder.localToWorld(eye);
  controls.autoRotate = false;
  controls.enableZoom = false;
  controls.minDistance = 0.01;
  controls.maxDistance = 0.2;
  controls.maxPolarAngle = Math.PI - 0.2;
  controls.target.copy(eye);
  settle(controls, camera, new THREE.Vector3(eye.x - 0.08, eye.y + 0.02, eye.z));
}

export function GarageScene(props: GarageSceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const prevTuning = useRef<Tuning | null>(null);
  const charmsRef = useRef<string[]>(props.charms ?? []);
  const charmsKey = (props.charms ?? []).join(',');
  useEffect(() => {
    charmsRef.current = charmsKey ? charmsKey.split(',') : [];
  }, [charmsKey]);

  // The renderer and the loop live as long as the component.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 600);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    const world = new THREE.Group();
    const holder = new THREE.Group();
    holder.position.y = 0.16;
    scene.add(world, holder);
    // Desktop gets ambient occlusion and a reflecting floor; phones stay light.
    const high = !window.matchMedia?.('(pointer: coarse)').matches;
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    let gtao: GTAOPass | null = null;
    if (high) {
      gtao = new GTAOPass(scene, camera, 1, 1);
      gtao.blendIntensity = 0.85;
      gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1 });
      composer.addPass(gtao);
    }
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.5, 0.88);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    const ctx: Ctx = { renderer, composer, pmrem, roomEnv: env, skyEnv: null, high, scene, camera, controls, world, holder, truck: null, interior: null, snow: null, drops: [], drive: null, mode: 'orbit' };
    ctxRef.current = ctx;
    props.onCapture?.(() => {
      composer.render();
      return renderer.domElement.toDataURL('image/png');
    });
    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // Parts drop into place when fitted.
      ctx.drops = ctx.drops.filter((d) => {
        const k = Math.min(1, (now - d.start) / 650);
        const ease = 1 - Math.pow(1 - k, 3);
        d.obj.position.y = d.y + (1 - ease) * 2.2;
        return k < 1;
      });
      if (ctx.snow) {
        const p = ctx.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) {
          let y = p.getY(i) - dt * 2.2;
          if (y < 0) y = 30;
          p.setY(i, y);
        }
        p.needsUpdate = true;
      }
      if (ctx.mode === 'drive' && ctx.drive && ctx.truck) {
        const speed = 9; // m/s
        ctx.drive.angle += (speed * dt) / ctx.drive.radius;
        const a = ctx.drive.angle;
        const r = ctx.drive.radius;
        const pos = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
        const dir = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
        holder.position.copy(pos);
        holder.rotation.y = Math.atan2(-dir.z, dir.x);
        for (const w of ctx.truck.wheels) w.rotation.z -= (speed * dt) / 0.5;
        const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        const chase = pos.clone().addScaledVector(dir, -(ctx.truck.length / 2 + 15)).addScaledVector(out, 6).add(new THREE.Vector3(0, 7, 0));
        if (camera.position.distanceTo(chase) > 60) camera.position.copy(chase);
        else camera.position.lerp(chase, 0.12);
        camera.lookAt(pos.x + dir.x * 4, 2.5, pos.z + dir.z * 4);
      } else {
        controls.update();
      }
      composer.render(dt);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      disposeTree(scene);
      env.dispose();
      ctx.skyEnv?.dispose();
      composer.dispose();
      target.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      ctxRef.current = null;
      props.onCapture?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const outdoor: 'track' | GarageScenery = props.mode === 'drive' ? 'track' : props.scenery;
  const othersKey = JSON.stringify(props.others ?? []);
  const retiredKey = JSON.stringify(props.retired ?? []);

  // The world around the truck: the hall or an outdoor scene.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    disposeTree(ctx.world);
    ctx.world.clear();
    ctx.scene.background = null;
    ctx.snow = null;
    if (outdoor === 'hall') {
      ctx.scene.environment = ctx.roomEnv;
      const hall = buildHall(ctx.world, ctx.scene, { tier: props.tier, night: props.night, sign: props.sign, trophies: props.trophies, retired: props.retired ?? [], high: ctx.high });
      // The other trucks on side platforms, facing the turntable.
      (props.others ?? []).slice(0, 2).forEach((o, i) => {
        const t = buildTruck({ ...o, night: props.night });
        const side = i === 0 ? -1 : 1;
        t.group.rotation.y = side * (Math.PI / 2);
        t.group.position.set(side * (hall.w / 2 - 4.5), 0.12, 0);
        const pad = new THREE.Mesh(new THREE.BoxGeometry(5, 0.12, Math.min(hall.d - 4, t.length + 2)), mat('#273244', { metalness: 0.5, roughness: 0.4 }));
        pad.position.set(side * (hall.w / 2 - 4.5), 0.06, 0);
        ctx.world.add(pad, t.group);
      });
      ctx.holder.position.set(0, 0.16, 0);
      ctx.holder.rotation.set(0, 0, 0);
    } else {
      const out = buildOutdoor(ctx.world, ctx.scene, outdoor, ctx.pmrem);
      ctx.skyEnv?.dispose();
      ctx.skyEnv = out.env;
      ctx.scene.environment = out.env;
      ctx.snow = out.snow;
      ctx.holder.position.set(0, 0, outdoor === 'track' ? 30 : 2.2);
      ctx.holder.rotation.set(0, 0, 0);
    }
    if (ctx.mode === 'cab') setCab(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outdoor, props.tier, props.night, props.sign, props.trophies, othersKey, retiredKey]);

  const truckKey = JSON.stringify({ ...props.truck, night: props.night });

  // The chosen truck: rebuilt when its looks change; newly fitted parts drop into place.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (ctx.truck) {
      disposeTree(ctx.truck.group);
      ctx.holder.remove(ctx.truck.group);
    }
    if (ctx.interior) {
      disposeTree(ctx.interior);
      ctx.holder.remove(ctx.interior);
      ctx.interior = null;
    }
    const built = buildTruck({ ...props.truck, night: props.night });
    ctx.holder.add(built.group);
    ctx.truck = built;
    const tuning = props.truck.tuning ?? props.truck.cosmetics?.tuning ?? {};
    const before = prevTuning.current;
    if (before) {
      const now = performance.now();
      for (const [part, objs] of built.parts) {
        if ((before as Record<string, string | undefined>)[part] !== (tuning as Record<string, string | undefined>)[part]) for (const o of objs) ctx.drops.push({ obj: o, y: o.position.y, start: now });
      }
    }
    prevTuning.current = { ...tuning };
    if (ctx.mode === 'cab') {
      ctx.interior = buildInterior(built, charmsRef.current);
      ctx.holder.add(ctx.interior);
      showShell(built, false);
      setCab(ctx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [truckKey]);

  // Camera mode.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.mode = props.mode;
    showShell(ctx.truck, props.mode !== 'cab');
    if (ctx.interior) {
      disposeTree(ctx.interior);
      ctx.holder.remove(ctx.interior);
      ctx.interior = null;
    }
    if (props.mode === 'drive') {
      ctx.drive = { angle: Math.PI / 2, radius: 30 };
      ctx.controls.enabled = false;
      ctx.controls.autoRotate = false;
      return;
    }
    ctx.drive = null;
    if (props.mode === 'cab' && ctx.truck) {
      ctx.interior = buildInterior(ctx.truck, charmsRef.current);
      ctx.holder.add(ctx.interior);
      setCab(ctx);
    } else {
      setOrbit(ctx, props.spin && props.scenery === 'hall');
    }
  }, [props.mode, props.spin, props.scenery]);

  return <div ref={host} className="h-full w-full touch-none" data-testid="garage-3d" />;
}
