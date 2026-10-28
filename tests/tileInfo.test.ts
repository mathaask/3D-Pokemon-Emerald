import { describe, expect, it } from 'vitest';
import { analyzeMetatiles, type TileInfo } from '../src/render/overworld/tileInfo';

/** A deterministic pseudo-random source (xorshift32). */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s;
  };
}

/** FNV-1a over every output array of a TileInfo (bytes, in field order). */
function digest(info: TileInfo): string {
  let h = 0x811c9dc5;
  const fields = [info.both, info.bottom, info.topCover, info.bottomCover, info.green, info.blue, info.isVoid, info.attributes];
  for (const a of fields) {
    const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function inputs(seed: number) {
  const r = rng(seed);
  const vram = new Uint8Array(0x18000);
  for (let i = 0; i < vram.length; i++) vram[i] = r() & 0xff;
  // (a dark, an empty and a green metatile among the random ones: isVoid / green / cover edge cases)
  for (let i = 0; i < 32; i++) vram[0x20 + i] = 0;
  const entries = new Uint16Array(8 * 1024);
  for (let i = 0; i < entries.length; i++) entries[i] = r() & 0xffff;
  entries.fill(1, 0, 8); // metatile 0: every quarter from the all-zero tile 1 (transparent)
  const attributes = new Uint16Array(1024);
  for (let i = 0; i < attributes.length; i++) attributes[i] = r() & 0xffff;
  const palette = new Uint16Array(256);
  for (let i = 0; i < palette.length; i++) palette[i] = r() & 0xffff;
  for (let i = 16; i < 32; i++) palette[i] = 0x03e0 | (i & 3); // palette 1: green
  for (let i = 32; i < 48; i++) palette[i] = 0x0421 * (i & 1); // palette 2: near black
  return { vram, entries, attributes, palette };
}

describe('analyzeMetatiles', () => {
  // Digests recorded on the implementation before the per-metatile split (one loop over all 1024 metatiles): the split
  // (V8 optimises the per-metatile function by its call count, not by on-stack replacement) must not change a value.
  it.each([
    [1, 0, '9142d34d'],
    [2, 0x4000, '49f15a1d'],
    [3, 0x8000, 'c35527e9'],
  ])('decodes every metatile as before (seed %i, charBase %i)', (seed, charBase, want) => {
    const { vram, entries, attributes, palette } = inputs(seed);
    const info = analyzeMetatiles({ vram }, entries, attributes, charBase, palette);
    expect(digest(info)).toBe(want);
  });

  it('reads the empty metatile as transparent and void', () => {
    const { vram, entries, attributes, palette } = inputs(1);
    const info = analyzeMetatiles({ vram }, entries, attributes, 0, palette);
    expect(info.bottomCover[0]).toBe(0);
    expect(info.topCover[0]).toBe(0);
    expect(info.isVoid[0]).toBe(1);
    expect(info.both[0]).toBe(0x8000);
  });
});
