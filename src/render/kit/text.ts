// Canvas-drawn textures for building signage (text boards and the Poké Ball emblem).
// Generated at runtime — no image assets. Cached for the session: never disposed (so never
// registered in kit.disposables), every world build reuses them.

import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();

/** Width / height of a sign texture (sign boards keep this aspect). */
export const SIGN_ASPECT = 512 / 96;

function canvasTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  let t = cache.get(key);
  if (!t) {
    if (typeof document === 'undefined') {
      // headless (tests, tools): nothing is drawn, an image-less texture stands in
      t = new THREE.CanvasTexture(undefined as unknown as HTMLCanvasElement);
    } else {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      draw(c.getContext('2d')!);
      t = new THREE.CanvasTexture(c);
    }
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    cache.set(key, t);
  }
  return t;
}

/** Frame colour around a sign's rounded panel (signs are opaque: no transparent corners). */
export const SIGN_FRAME = '#1d1d22';

export function signTexture(text: string, fg: string, bg: string): THREE.CanvasTexture {
  return canvasTexture(`sign:${text}:${fg}:${bg}`, 512, 96, (g) => {
    g.fillStyle = SIGN_FRAME;
    g.fillRect(0, 0, 512, 96);
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(4, 4, 504, 88, 18);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.stroke();
    g.fillStyle = fg;
    g.font = 'bold 56px "Trebuchet MS", "Segoe UI", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 52, 470);
  });
}

export function pokeballTexture(): THREE.CanvasTexture {
  return canvasTexture('pokeball', 256, 256, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#e3350d';
    g.beginPath();
    g.arc(128, 128, 120, Math.PI, 0);
    g.fill();
    g.fillStyle = '#1b1b1b';
    g.fillRect(8, 116, 240, 24);
    g.beginPath();
    g.arc(128, 128, 44, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(128, 128, 28, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 10;
    g.strokeStyle = '#1b1b1b';
    g.beginPath();
    g.arc(128, 128, 120, 0, Math.PI * 2);
    g.stroke();
  });
}
