import { describe, it, expect } from 'vitest';
import { xbrSample, XBR, XBR_TIE } from '../src/render/kit/upscale';
import { XBR_GLSL } from '../src/render/actors/xbr.glsl';
import { xbrFixture, XBR_FIX_RECT } from '../src/render/actors/selfTest';

const X = 0xff0000ff, O = 0x00000000;                       // opaque red, transparent
const a = (img: Uint32Array, w: number, h: number, x: number, y: number) => xbrSample(img, w, h, x, y, 0.1)[3];

describe('xbrSample', () => {
  it('reproduces flat areas exactly', () => {
    expect(xbrSample(new Uint32Array(9).fill(X), 3, 3, 1.3, 1.7, 0.1)).toEqual([1, 0, 0, 1]);
  });
  it('keeps an isolated pixel and a checkerboard at texel centres', () => {
    const dot = new Uint32Array(25); dot[12] = X;
    expect(a(dot, 5, 5, 2.5, 2.5)).toBe(1);
    const cb = new Uint32Array(36).map((_, i) => ((i % 6) + Math.floor(i / 6)) % 2 ? X : O);
    for (let i = 0; i < 36; i++) expect(a(cb, 6, 6, (i % 6) + 0.5, Math.floor(i / 6) + 0.5)).toBe(cb[i] === X ? 1 : 0);
  });
  it('turns a 45° staircase into a straight edge', () => {
    const st = new Uint32Array(64).map((_, i) => ((i % 8) <= Math.floor(i / 8) ? X : O)); // filled where x <= y
    for (let k = 2; k <= 5; k++) {
      expect(a(st, 8, 8, k + 0.9, k + 0.1)).toBeLessThan(0.5);    // the step's outer corner is cut
      expect(a(st, 8, 8, k + 1.1, k + 0.9)).toBeGreaterThan(0.5); // the step's inner notch is filled
    }
  });
  it('never reads outside its rectangle', () => {
    const two = new Uint32Array(8 * 4).fill(X);                 // an 8x4 image: left 4 columns = sprite A, right = sprite B
    const solo = new Uint32Array(8 * 4).map((_, i) => (i % 8) < 4 ? X : O);
    for (const [x, y] of [[3.9, 0.1], [3.6, 2.5], [3.95, 3.9]])
      expect(xbrSample(two, 8, 4, x, y, 0.1, [0, 0, 4, 4])).toEqual(xbrSample(solo, 8, 4, x, y, 0.1, [0, 0, 4, 4]));
  });

  // (added beyond the brief's cases)
  const rgba = (v: number) => [(v & 0xff) / 255, ((v >>> 8) & 0xff) / 255, ((v >>> 16) & 0xff) / 255, (v >>> 24) / 255];
  it('keeps every texel centre\'s colour, whatever the neighbours (one-pixel details stay)', () => {
    let seed = 7;
    const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
    const pal = [O, 0xffa8d0ff, 0xff282020, 0xffc06030];
    const img = new Uint32Array(100).map(() => pal[Math.floor(rnd() * 4)]);
    for (let i = 0; i < 100; i++) expect(xbrSample(img, 10, 10, (i % 10) + 0.5, Math.floor(i / 10) + 0.5, 0.1)).toEqual(rgba(img[i]));
  });
  it('rounds a 2:1 staircase along its 30° line (lv2), beyond the 45° cut', () => {
    const W = 12, H = 8;
    const st = new Uint32Array(W * H).map((_, i) => ((i % W) < 2 * Math.floor(i / W) + 1 ? X : O)); // row y: x < 2y + 1
    for (let y = 2; y <= 4; y++) {
      expect(a(st, W, H, 2 * y + 0.6, y + 0.1)).toBeLessThan(0.5);    // the last filled texel's upper corner is cut
      expect(a(st, W, H, 2 * y + 1.6, y + 0.9)).toBeGreaterThan(0.5); // the next one fills under the line (f' = (0.4, 0.9): lv2 only)
    }
  });
  it('rounds corners only where an edge runs on (xBR-lv2 restriction): small blocks and single pixels keep their shape', () => {
    // a 2x2 block and a single pixel on transparency: features, not lines — no corner is cut
    const img = new Uint32Array(64);
    img[2 * 8 + 2] = img[2 * 8 + 3] = img[3 * 8 + 2] = img[3 * 8 + 3] = X;
    img[5 * 8 + 6] = X;
    for (const [x, y] of [[2.05, 2.05], [3.95, 2.05], [2.05, 3.95], [3.95, 3.95], [6.05, 5.05], [6.95, 5.95]]) expect(a(img, 8, 8, x, y)).toBe(1);
    // … while the same corner on a longer staircase is cut
    const st = new Uint32Array(64).map((_, i) => ((i % 8) <= Math.floor(i / 8) ? X : O));
    expect(a(st, 8, 8, 3.95, 3.05)).toBe(0);
  });
  it('blends opaque colours towards the more similar neighbour, without changing alpha', () => {
    const SKIN = 0xffa8d0ff, RED = 0xff3030e0;
    // a 45° staircase between skin (x <= y) and red
    const img = new Uint32Array(64).map((_, i) => ((i % 8) <= Math.floor(i / 8) ? SKIN : RED));
    const cut = xbrSample(img, 8, 8, 3.9, 3.1, 0.1);   // skin texel (3,3): its outer corner turns red
    expect(cut).toEqual(rgba(RED));
    const mid = xbrSample(img, 8, 8, 3.75, 3.25, 0.1); // on the cut line: half way
    for (let c = 0; c < 3; c++) expect(mid[c]).toBeCloseTo((rgba(SKIN)[c] + rgba(RED)[c]) / 2, 6);
    expect(mid[3]).toBe(1);
  });
  it('shares its constants with the shader, and the GPU fixture stays clear of the "equal" threshold', () => {
    expect(XBR).toEqual({ eq: 0.06, coef: 2.0 });
    expect(XBR_GLSL).toContain(`const float XBR_EQ = ${XBR.eq};`);
    expect(XBR_GLSL).toContain('const float XBR_COEF = 2.0;');
    expect(XBR_GLSL).toContain(`const float XBR_TIE = ${XBR_TIE};`);
    const fix = xbrFixture();
    const key = (v: number) => { const c = rgba(v); return [Math.sqrt(c[0]), Math.sqrt(c[1]), Math.sqrt(c[2]), c[3]]; };
    const colours = [...new Set(fix)];
    expect(colours.length).toBe(6); // transparent, skin, a near-equal skin shade, blue, dark, red
    let equalPairs = 0;
    for (const p of colours) for (const q of colours) {
      if (p === q) continue;
      const kp = key(p), kq = key(q);
      const df = 0.299 * Math.abs(kp[0] - kq[0]) + 0.587 * Math.abs(kp[1] - kq[1]) + 0.114 * Math.abs(kp[2] - kq[2]) + Math.abs(kp[3] - kq[3]);
      expect(Math.abs(df - XBR.eq)).toBeGreaterThan(0.02);
      if (df < XBR.eq) equalPairs++;
    }
    expect(equalPairs).toBe(2); // (the two skin shades, both ways)
    // the neighbour columns outside the rectangle are opaque (a read across it would show)
    for (let y = 0; y < 16; y++) expect(fix[y * 16 + XBR_FIX_RECT[2]] >>> 24).toBe(255);
  });
});
