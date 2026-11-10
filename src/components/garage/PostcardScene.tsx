'use client';

import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { buildOutdoor } from './hall3d';
import { buildTruck, disposeTree } from './truck3d';
import type { Cosmetics } from '@/lib/game/cosmetics';
import { t } from '@/i18n/t';

export interface PostcardData {
  scene: 'snow' | 'sunset' | 'highway';
  title: string;
  line: string;
  truck: { modelId: string; color: string; plate: string | null; cosmetics: Cosmetics | null; condition: number; trailerModelId: string | null };
}

const W = 1200;
const H = 630;

/**
 * 1.2.3.6: the 3D postcard — the player's own truck drawn once on the road (snow, sunset or
 * motorway), with the greeting written over it. The result is a picture to keep or share.
 */
export function PostcardScene({ data }: { data: PostcardData }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Drawn again only when the card itself changes (not on every refresh of the page).
  const key = JSON.stringify(data);
  useEffect(() => {
    // Drawn on the next frame (the WebGL work stays out of the effect's own body).
    const frame = requestAnimationFrame(() => {
      const data = JSON.parse(key) as PostcardData;
      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      } catch {
        setFailed(true);
        return;
      }
      renderer.setSize(W, H, false);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.78;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      const world = new THREE.Group();
      scene.add(world);
      const { env } = buildOutdoor(world, scene, data.scene, pmrem);
      scene.environment = env;
      const built = buildTruck({ modelId: data.truck.modelId, color: data.truck.color, cosmetics: data.truck.cosmetics, tuning: data.truck.cosmetics?.tuning ?? null, condition: data.truck.condition, trailerModelId: data.truck.trailerModelId, plate: data.truck.plate });
      const holder = new THREE.Group();
      holder.position.y = 0.16;
      holder.add(built.group);
      scene.add(holder);
      const front = built.cab.frontX;
      const camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 900);
      camera.position.set(front + 8.5, 2.4, 7.5);
      camera.lookAt(front - Math.min(6, built.length * 0.35), 1.7, 0);
      renderer.render(scene, camera);
      renderer.render(scene, camera);
      // The greeting over the picture.
      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const g = out.getContext('2d');
      if (g) {
        g.drawImage(renderer.domElement, 0, 0, W, H);
        const band = g.createLinearGradient(0, H - 190, 0, H);
        band.addColorStop(0, 'rgba(5,7,11,0)');
        band.addColorStop(1, 'rgba(5,7,11,0.85)');
        g.fillStyle = band;
        g.fillRect(0, H - 190, W, 190);
        g.fillStyle = '#ffffff';
        g.font = 'bold 54px Inter, system-ui, sans-serif';
        g.fillText(data.title, 44, H - 78);
        g.fillStyle = '#cbd5e1';
        g.font = '28px Inter, system-ui, sans-serif';
        g.fillText(data.line, 46, H - 34);
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.font = 'bold 24px Inter, system-ui, sans-serif';
        g.textAlign = 'right';
        g.fillText('TransVerse', W - 36, 46);
      }
      setSrc(out.toDataURL('image/jpeg', 0.9));
      disposeTree(scene);
      pmrem.dispose();
      renderer.dispose();
    });
    return () => cancelAnimationFrame(frame);
  }, [key]);
  if (failed) return <p className="text-sm text-mist-400">{t('Браузърът не може да покаже 3D картината.')}</p>;
  if (!src) return <div className="flex aspect-[1200/630] w-full items-center justify-center rounded-2xl bg-asphalt-900 text-sm text-mist-400">{t('Рисуваме картичката…')}</div>;
  return (
    <figure className="space-y-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={data.title} className="w-full rounded-2xl border border-asphalt-700" data-testid="postcard-image" />
      <a href={src} download="transverse-postcard.jpg" className="btn-ghost inline-flex text-sm">{t('📥 Запази картинката')}</a>
    </figure>
  );
}
