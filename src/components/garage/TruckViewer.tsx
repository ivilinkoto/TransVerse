'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildTruck, disposeTree, type TruckLook } from './truck3d';
import { motionEnabled } from '@/lib/client/motion';
import { t } from '@/i18n/t';

/**
 * 1.2.3.7 „Камионът в 3D“: one truck on a studio floor that the player turns with a
 * finger or the mouse (no hall, no post-processing — light enough for a phone).
 */
export function TruckViewer({ look }: { look: TruckLook }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // Built again only when the truck itself changes.
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
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#1b2230');
    scene.fog = new THREE.Fog('#1b2230', 30, 70);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: '#2a3342', roughness: 0.6, metalness: 0.1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    scene.add(new THREE.HemisphereLight('#ffffff', '#4b5563', 0.7));
    const sun = new THREE.DirectionalLight('#fff4e5', 2.2);
    sun.position.set(8, 14, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14 });
    scene.add(sun);
    const built = buildTruck(JSON.parse(key) as TruckLook);
    const holder = new THREE.Group();
    holder.position.y = 0.16;
    holder.add(built.group);
    // The whole combination centred on the turntable.
    holder.position.x = -(built.cab.frontX - built.length / 2);
    scene.add(holder);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 200);
    // The whole combination fits the view, also on a narrow phone screen.
    const radius = built.length / 2 + 0.6;
    const dir = new THREE.Vector3(0.75, 0.32, 0.75).normalize();
    const fit = () => {
      const v = THREE.MathUtils.degToRad(camera.fov) / 2;
      const h = Math.atan(Math.tan(v) * camera.aspect);
      return radius / Math.tan(Math.min(v, h)) + radius * 0.35;
    };
    const reach = Math.max(9, built.length * 1.15);
    let moved = false;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.6, 0);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 4;
    controls.maxDistance = reach * 2.4;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.autoRotate = motionEnabled();
    controls.autoRotateSpeed = 0.8;
    controls.addEventListener('start', () => {
      controls.autoRotate = false;
      moved = true;
    });
    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      if (!moved) camera.position.copy(dir).multiplyScalar(fit()).add(controls.target);
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
  return <div ref={host} className="h-full w-full touch-none [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full" data-testid="truck-3d" />;
}
