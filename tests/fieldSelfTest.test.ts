import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { compareSlots, xbrErrors, xbrFixture, XBR_FIX_RECT, XBR_POINTS } from '../src/render/actors/selfTest';
import { xbrSample } from '../src/render/kit/upscale';
import { heights, INFLATE } from '../src/render/actors/inflateMath';

// A 128×64 atlas (two slot cells) with one fully opaque 4×4 sprite in slot (0, 0); the field holds
// exactly its CPU heights.
const W = 128, H = 64;
function setup() {
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) rgba[(y * W + x) * 4 + 3] = 255;
  const hs = heights(new Uint8Array(16).fill(1), 4, 4, INFLATE);
  const field = new Float32Array(W * H);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) field[y * W + x] = hs[y * 4 + x];
  const rects = new THREE.InstancedBufferAttribute(new Float32Array([0, 0, 4, 4]), 4);
  return { rgba, field, rects };
}

describe('compareSlots', () => {
  it('is ~0 for the CPU field and the largest error otherwise', () => {
    const { rgba, field, rects } = setup();
    expect(compareSlots(rgba, field, W, H, rects, 1, INFLATE)).toBeLessThan(1e-6);
    field[1] += 0.5;
    field[2] -= 0.1;
    expect(compareSlots(rgba, field, W, H, rects, 1, INFLATE)).toBeCloseTo(0.5, 5);
  });
  it('checks the rest of the slot cell around the sprite rectangle (must be 0)', () => {
    const { rgba, field, rects } = setup();
    field[40 * W + 30] = 0.3;
    expect(compareSlots(rgba, field, W, H, rects, 1, INFLATE)).toBeCloseTo(0.3, 5);
  });
  it('reports NaN once any texel is NaN, even after a larger error and before smaller ones', () => {
    const { rgba, field, rects } = setup();
    field[0] += 0.5; // (scan order: row 0 left to right)
    field[1] = NaN;
    field[2] += 0.001;
    field[3] += 0.002;
    expect(compareSlots(rgba, field, W, H, rects, 1, INFLATE)).toBeNaN();
  });
});

describe('xbrErrors (the xBR self-test: the live shader, the baked path, and the two against each other)', () => {
  // the fixture's CPU reference at the self-test's sample points, as RGBA8 bytes: what a perfect GPU draws
  const src = xbrFixture(), k = 16 / XBR_POINTS;
  const reference = () => {
    const out = new Uint8Array(XBR_POINTS * XBR_POINTS * 4);
    for (let j = 0; j < XBR_POINTS; j++) {
      for (let i = 0; i < XBR_POINTS; i++) {
        const want = xbrSample(src, 16, 16, (i + 0.5) * k, (j + 0.5) * k, 0.1, XBR_FIX_RECT);
        for (let c = 0; c < 4; c++) out[(j * XBR_POINTS + i) * 4 + c] = Math.round(want[c] * 255);
      }
    }
    return out;
  };
  it('reports the live and the baked path against the CPU, and their byte difference inside the rectangle', () => {
    const gpu = reference(), baked = reference();
    const e = xbrErrors(src, gpu, baked);
    expect(e.maxErr).toBeLessThanOrEqual(0.5 / 255 + 1e-9);
    expect(e.bakedMaxErr).toBeLessThanOrEqual(0.5 / 255 + 1e-9);
    expect(e.bakedVsLive).toBe(0);
    // one byte off inside the fixture's rectangle (point (2, 3): texel (0.5, 0.8)): the two paths differ by exactly it
    baked[(3 * XBR_POINTS + 2) * 4 + 1] += 3;
    expect(xbrErrors(src, gpu, baked).bakedVsLive).toBe(3);
    // outside the rectangle (columns 14–15: the bake does not cover them) a difference is not the baked path's
    const outside = reference();
    outside[(5 * XBR_POINTS + 62) * 4] ^= 0x40;
    expect(xbrErrors(src, gpu, outside).bakedVsLive).toBe(0);
  });
});
