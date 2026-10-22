import { describe, it, expect } from 'vitest';
import { distanceField, bruteForceDistance, heights, blurWeights, profile, gradientAt, INFLATE } from '../src/render/actors/inflateMath';
import { rng } from '../src/render/kit/geom';

const mask = (w: number, h: number, f: (x: number, y: number) => boolean) => {
  const a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = f(x, y) ? 1 : 0;
  return a;
};

describe('distanceField', () => {
  it('puts an isolated texel half a texel from the edge', () => {
    const d = distanceField(mask(5, 5, (x, y) => x === 2 && y === 2), 5, 5, 12);
    expect(d[12]).toBeCloseTo(0.5);
    expect(d[0]).toBe(0);
  });
  it('treats everything outside the sprite as transparent', () => {
    const d = distanceField(mask(4, 3, () => true), 4, 3, 12);
    expect([...d.subarray(0, 4)]).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect([...d.subarray(4, 8)]).toEqual([0.5, 1.5, 1.5, 0.5]);
  });
  it('is the exact Euclidean distance (separable == brute force)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const r = rng(seed);
      const a = mask(16, 32, () => r() < 0.75);
      const d = distanceField(a, 16, 32, 64), b = bruteForceDistance(a, 16, 32);
      for (let i = 0; i < d.length; i++) expect(Math.abs(d[i] - b[i])).toBeLessThan(1e-5);
    }
  });
  it('stops searching at the window', () => {
    const d = distanceField(mask(40, 40, () => true), 40, 40, 12);
    expect(d[20 * 40 + 20]).toBeCloseTo(12.5);
  });
});

describe('heights', () => {
  it('follows amp·sqrt(d), flat beyond the cap', () => {
    expect(profile(0.5)).toBeCloseTo(INFLATE.amp * Math.sqrt(0.5));
    expect(profile(100)).toBeCloseTo(INFLATE.amp * Math.sqrt(INFLATE.cap));
    expect(profile(0)).toBe(0);
  });
  it('has normalised symmetric blur weights', () => {
    const w = blurWeights(1.25);
    expect(w).toHaveLength(7);
    expect(w.reduce((s, v) => s + v, 0)).toBeCloseTo(1);
    expect(w[0]).toBeCloseTo(w[6]);
  });
  it('is zero outside the silhouette, symmetric and highest in the middle of a disc', () => {
    const a = mask(15, 15, (x, y) => (x - 7) ** 2 + (y - 7) ** 2 <= 36);
    const hs = heights(a, 15, 15);
    expect(hs[0]).toBe(0);
    for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) {
      expect(hs[y * 15 + x]).toBeCloseTo(hs[(14 - y) * 15 + (14 - x)], 5);
      expect(hs[y * 15 + x]).toBeLessThanOrEqual(hs[7 * 15 + 7] + 1e-6);
    }
    expect(gradientAt(hs, 15, 15, 7, 7)[0]).toBeCloseTo(0);
    expect(gradientAt(hs, 15, 15, 3, 7)[0]).toBeGreaterThan(0); // rising towards the middle
  });
});
