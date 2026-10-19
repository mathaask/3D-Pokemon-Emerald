import { describe, it, expect } from 'vitest';
import { classifyGroundColor, soften, dominantColor, bgr555ToSrgb, saturation, type RGB } from '../src/render/kit/palette';

describe('classifyGroundColor', () => {
  const cases: [RGB, string][] = [
    [[0.45, 0.78, 0.65], 'grass'],
    [[0.26, 0.71, 0.52], 'grass'],
    [[0.65, 0.84, 0.78], 'path'],
    [[0.81, 0.81, 0.87], 'paving'],
    [[0.97, 0.97, 0.94], 'paving'],
    [[0.87, 0.81, 0.52], 'sand'],
    [[0.58, 0.55, 0.45], 'gravel'],
    [[0.68, 0.68, 0.55], 'gravel'],
    [[0.74, 0.74, 0.61], 'paving'], // Lilycove's patterned plaza (lighter than Route 113 ash)
    [[0.74, 0.58, 0.55], 'dirt'],
    [[0.87, 0.71, 0.65], 'dirt'],
    [[0.32, 0.42, 0.84], 'water'],
    [[0.05, 0.05, 0.06], 'dark'],
  ];
  for (const [c, want] of cases) it(`${c.join(',')} → ${want}`, () => expect(classifyGroundColor(c)).toBe(want));
});

describe('soften', () => {
  it('lifts black and tames neon saturation', () => {
    const k = soften([0, 0, 0]);
    expect(Math.min(...k)).toBeGreaterThanOrEqual(0.03);
    expect(saturation(soften([1, 0, 0]))).toBeLessThan(saturation([1, 0, 0]));
  });
  it('keeps mid colours close', () => {
    const c: RGB = [0.45, 0.78, 0.65];
    soften(c).forEach((v, i) => expect(Math.abs(v - c[i])).toBeLessThan(0.06));
  });
});

describe('dominantColor', () => {
  it('returns the most frequent accepted opaque colour', () => {
    const px = new Uint16Array(512).fill(0x8000);
    px.fill(31, 0, 100); // red x100 in metatile 0
    px.fill(31 << 5, 256, 300); // green x44 in metatile 1
    px.fill(31 << 10, 300, 330); // blue x30 in metatile 1
    expect(dominantColor(px, [0, 1])).toEqual(bgr555ToSrgb(31));
    expect(dominantColor(px, [0, 1], (c) => c[0] < 0.5)).toEqual(bgr555ToSrgb(31 << 5));
    expect(dominantColor(px, [1], (c) => c[0] > 0.5)).toBeNull();
  });
});
