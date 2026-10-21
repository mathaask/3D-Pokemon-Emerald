// Inflation field maths: the CPU reference of SpriteField's GPU passes (and the profile Task 5 displaces
// the front sheet with). Per texel of a sprite: the exact Euclidean distance d (px) to the nearest
// transparent texel, the height profile amp·sqrt(min(d, cap)), a 7-tap separable Gaussian blur, masked
// to the opaque texels. Grids are row-major w×h in atlas row order (bottom-up); everything outside the
// grid (the sprite rectangle) counts as transparent.

export interface InflateParams {
  /** Height scale (sprite px per sqrt(px) of distance). */
  amp: number;
  /** Distance (px) beyond which the profile is flat. */
  cap: number;
  /** Search radius (px) of the distance passes. */
  window: number;
  /** Standard deviation (px) of the blur. */
  sigma: number;
}

export const INFLATE: InflateParams = { amp: 1.0, cap: 9, window: 12, sigma: 3.0 }; // tuned in Task 5

/** Height (sprite px) of the flattest-topped point: amp·sqrt(cap). */
export const inflateMax = (p: InflateParams = INFLATE) => p.amp * Math.sqrt(p.cap);

/** Height of a texel `d` px from the edge: amp·sqrt(min(d, cap)); 0 for d <= 0. */
export function profile(d: number, p: InflateParams = INFLATE): number {
  return d <= 0 ? 0 : p.amp * Math.sqrt(Math.min(d, p.cap));
}

const opaqueAt = (alpha: Uint8Array, w: number, h: number, x: number, y: number) =>
  x >= 0 && y >= 0 && x < w && y < h && alpha[y * w + x] !== 0;

/** GPU pass 1: per opaque texel, |dx| to the nearest transparent texel of its row (≤ window, else
 *  window + 1); 0 on transparent texels. */
export function rowDistances(alpha: Uint8Array, w: number, h: number, window: number): Float32Array {
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!opaqueAt(alpha, w, h, x, y)) continue;
      let k = 1;
      while (k <= window && opaqueAt(alpha, w, h, x - k, y) && opaqueAt(alpha, w, h, x + k, y)) k++;
      g[y * w + x] = k; // (window + 1 when none is found)
    }
  }
  return g;
}

/** GPU pass 2's distance: sqrt(min over |k| ≤ window of k² + g(y + k)²) − 0.5 (the distance from the
 *  texel centre to the transparent texel's edge); 0 on transparent texels. */
export function distanceField(alpha: Uint8Array, w: number, h: number, window: number): Float32Array {
  const g = rowDistances(alpha, w, h, window);
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!opaqueAt(alpha, w, h, x, y)) continue;
      let best = Infinity;
      for (let k = -window; k <= window; k++) {
        const yy = y + k;
        const gk = yy >= 0 && yy < h ? g[yy * w + x] : 0; // (a row outside the sprite is transparent)
        best = Math.min(best, k * k + gk * gk);
      }
      d[y * w + x] = Math.sqrt(best) - 0.5;
    }
  }
  return d;
}

/** Test oracle: the distance to the nearest transparent texel of the grid extended by a one-texel
 *  transparent ring, by scanning all of them (no window). */
export function bruteForceDistance(alpha: Uint8Array, w: number, h: number): Float32Array {
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!opaqueAt(alpha, w, h, x, y)) continue;
      let best = Infinity;
      for (let ty = -1; ty <= h; ty++) {
        for (let tx = -1; tx <= w; tx++) {
          if (opaqueAt(alpha, w, h, tx, ty)) continue;
          best = Math.min(best, (tx - x) ** 2 + (ty - y) ** 2);
        }
      }
      d[y * w + x] = Math.sqrt(best) - 0.5;
    }
  }
  return d;
}

/** Gaussian weights of the 7-tap blur (k = −3..3), normalised to sum 1. */
export function blurWeights(sigma: number): number[] {
  const w: number[] = [];
  for (let k = -3; k <= 3; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  const sum = w.reduce((s, v) => s + v, 0);
  return w.map((v) => v / sum);
}

/** The field: profile(distance) → blur along x → blur along y (outside the grid = 0) → masked to the
 *  opaque texels. In sprite px. */
export function heights(alpha: Uint8Array, w: number, h: number, p: InflateParams = INFLATE): Float32Array {
  const d = distanceField(alpha, w, h, p.window);
  const W = blurWeights(p.sigma);
  const n = w * h;
  const prof = new Float64Array(n);
  for (let i = 0; i < n; i++) prof[i] = profile(d[i], p);
  const bx = new Float64Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -3; k <= 3; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < w) s += W[k + 3] * prof[y * w + xx];
      }
      bx[y * w + x] = s;
    }
  }
  const out = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!opaqueAt(alpha, w, h, x, y)) continue;
      let s = 0;
      for (let k = -3; k <= 3; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < h) s += W[k + 3] * bx[yy * w + x];
      }
      out[y * w + x] = s;
    }
  }
  return out;
}

/** Central-difference gradient (per px) of a height grid at (x, y); outside the grid = 0. */
export function gradientAt(hs: Float32Array, w: number, h: number, x: number, y: number): [number, number] {
  const at = (xx: number, yy: number) => (xx >= 0 && yy >= 0 && xx < w && yy < h ? hs[yy * w + xx] : 0);
  return [(at(x + 1, y) - at(x - 1, y)) / 2, (at(x, y + 1) - at(x, y - 1)) / 2];
}
