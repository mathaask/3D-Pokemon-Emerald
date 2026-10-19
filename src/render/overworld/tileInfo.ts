// CPU-side metatile analysis: decodes every metatile of the current tileset pair from
// live VRAM so the classifier can reason about pixels (coverage, greenness, ground
// differences) — the same data the GPU atlas shows.

import type { Bus } from '../../gba/bus';

export interface TileInfo {
  /** Composite colour (BGR555, 0x8000 = transparent) for 1024 metatiles x 256 px, both layers. */
  both: Uint16Array;
  /** Bottom-layer colours (0x8000 = transparent). */
  bottom: Uint16Array;
  /** Number of opaque pixels in the top layer (0..256). */
  topCover: Uint16Array;
  /** Number of opaque pixels in the bottom layer (0..256). */
  bottomCover: Uint16Array;
  /** Fraction of composite pixels that are "foliage green". */
  green: Float32Array;
  /** Fraction of composite pixels that are blue (water-like). */
  blue: Float32Array;
  /** True when both layers are empty or (near) black — void cells around interiors. */
  isVoid: Uint8Array;
  attributes: Uint16Array;
}

export function analyzeMetatiles(
  bus: Bus, entries: Uint16Array, attributes: Uint16Array, charBase: number, palette: Uint16Array,
): TileInfo {
  const both = new Uint16Array(1024 * 256);
  const bottom = new Uint16Array(1024 * 256);
  const topCover = new Uint16Array(1024);
  const bottomCover = new Uint16Array(1024);
  const green = new Float32Array(1024);
  const blue = new Float32Array(1024);
  const isVoid = new Uint8Array(1024);
  const vram = bus.vram;

  for (let m = 0; m < 1024; m++) {
    let greenCount = 0;
    let blueCount = 0;
    let dark = 0;
    for (let layer = 0; layer < 2; layer++) {
      for (let sub = 0; sub < 4; sub++) {
        const e = entries[m * 8 + layer * 4 + sub];
        const tile = e & 0x3ff;
        const hflip = (e & 0x400) !== 0;
        const vflip = (e & 0x800) !== 0;
        const pal = e >>> 12;
        const base = charBase + tile * 32;
        const ox = (sub & 1) * 8;
        const oy = (sub >> 1) * 8;
        for (let py = 0; py < 8; py++) {
          const ty = vflip ? 7 - py : py;
          for (let px = 0; px < 8; px++) {
            const tx = hflip ? 7 - px : px;
            const byte = vram[(base + ty * 4 + (tx >> 1)) & 0xffff];
            const ci = tx & 1 ? byte >> 4 : byte & 15;
            const p = (oy + py) * 16 + ox + px;
            const idx = m * 256 + p;
            if (layer === 0) {
              if (ci === 0) {
                bottom[idx] = 0x8000;
                both[idx] = 0x8000;
              } else {
                const c = palette[pal * 16 + ci] & 0x7fff;
                bottom[idx] = c;
                both[idx] = c;
                bottomCover[m]++;
              }
            } else if (ci !== 0) {
              both[idx] = palette[pal * 16 + ci] & 0x7fff;
              topCover[m]++;
            }
          }
        }
      }
    }
    for (let p = 0; p < 256; p++) {
      const c = both[m * 256 + p];
      if (c & 0x8000) continue;
      const r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
      if (g > r + 2 && g >= b && g > 6) greenCount++;
      if (b > r + 3 && b > g) blueCount++;
      if (r + g + b < 6) dark++;
    }
    green[m] = greenCount / 256;
    blue[m] = blueCount / 256;
    const opaque = bottomCover[m] + topCover[m];
    isVoid[m] = opaque === 0 || dark > 240 ? 1 : 0;
  }
  return { both, bottom, topCover, bottomCover, green, blue, isVoid, attributes };
}

/** Fraction (0..1) of pixels in metatile `m` that differ from the ground metatile `g`. */
export function diffFromGround(info: TileInfo, m: number, g: number): number {
  let diff = 0;
  const a = m * 256, b = g * 256;
  for (let p = 0; p < 256; p++) if (info.both[a + p] !== info.both[b + p]) diff++;
  return diff / 256;
}
