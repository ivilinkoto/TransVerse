'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildDepot, type DepotLook } from './depot3d';
import { disposeTree } from './truck3d';
import { motionEnabled } from '@/lib/client/motion';
import { t } from '@/i18n/t';

/** 1.2.3.6: the depot yard in 3D, seen from above at an angle; the player turns and zooms it. */
export function DepotViewer({ look }: { look: DepotLook }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const key = JSON.stringify(look);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      const id = requestAnimationFrame(() => setFailed(true));
      return () => cancelAnimationFrame(id);
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.85;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#9cc3e6');
    scene.fog = new THREE.Fog('#9cc3e6', 120, 320);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const world = new THREE.Group();
    scene.add(world);
    const size = buildDepot(world, JSON.parse(key) as DepotLook);
    scene.add(new THREE.HemisphereLight('#dbeafe', '#3d4a30', 0.8));
    const sun = new THREE.DirectionalLight('#fff4e5', 2.2);
    sun.position.set(40, 70, 50);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const r = Math.max(size.width, size.depth) / 2 + 6;
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, far: 250 });
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 600);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 12;
    controls.maxDistance = r * 4;
    controls.maxPolarAngle = Math.PI / 2 - 0.08;
    controls.autoRotate = motionEnabled();
    controls.autoRotateSpeed = 0.5;
    let moved = false;
    controls.addEventListener('start', () => {
      controls.autoRotate = false;
      moved = true;
    });
    const dir = new THREE.Vector3(0.55, 0.6, 0.85).normalize();
    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      if (!moved) {
        const v = THREE.MathUtils.degToRad(camera.fov) / 2;
        const fit = r / Math.tan(Math.min(v, Math.atan(Math.tan(v) * camera.aspect)));
        camera.position.copy(dir).multiplyScalar(fit * 0.95);
      }
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
      disposeTree(scene);
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [key]);
  if (failed) return <p className="p-4 text-sm text-mist-400">{t('Браузърът не може да покаже 3D картината.')}</p>;
  return <div ref={host} className="h-full w-full touch-none [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full" data-testid="depot-3d" />;
}
