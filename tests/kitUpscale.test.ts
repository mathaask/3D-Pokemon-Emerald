import { describe, it, expect } from 'vitest';
import { scale2x, scale4x } from '../src/render/kit/upscale';

const X = 0xff0000ff, O = 0xffffffff;

describe('scale2x', () => {
  it('keeps flat areas flat', () => {
    expect([...scale2x(new Uint32Array(4).fill(X), 2, 2)]).toEqual(new Array(16).fill(X));
  });
  it('rounds a diagonal staircase', () => {
    const src = new Uint32Array([X, X, O, X, O, O, O, O, O]);
    const out = scale2x(src, 3, 3);
    // the centre pixel (O) becomes a 2x2 block whose top-left takes the diagonal colour
    expect(out[2 * 6 + 2]).toBe(X);
    expect(out[2 * 6 + 3]).toBe(O);
    expect(out[3 * 6 + 2]).toBe(O);
    expect(out[3 * 6 + 3]).toBe(O);
  });
  it('scale4x is two passes', () => {
    expect(scale4x(new Uint32Array(6).fill(O), 3, 2)).toHaveLength(12 * 8);
  });
});
