import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { compareSlots } from '../src/render/actors/selfTest';
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
