// Model colours sampled from an object's own sprite pixels (live OBJ VRAM + OBJ palette), so every
// object model keeps the ROM's colours (a berry's leaves and fruit, an item ball's red).

import type { SpriteSnap } from '../../game/state';
import { bgr555ToSrgb, luma, saturation, type RGB } from '../kit/palette';

export interface SpritePixelSource {
  /** Bus VRAM (OBJ tiles at 0x10000). */
  vram: Uint8Array;
  /** 512 BGR555 colours, OBJ palettes at 256.. (hardware PRAM or the game's unfaded buffer). */
  palette: Uint16Array;
  /** DISPCNT bit 6 == 0 (2D OBJ tile mapping), as passed to SpriteAtlas.update (the overworld maps 1D: false). */
  map2d: boolean;
}

const OBJ_TILES = 0x10000;

/** Palette indices (row 0 = top) of a sprite's current image, decoded exactly like spriteAtlas.ts's shader. */
export function decodeSpriteIndices(vram: Uint8Array, s: Pick<SpriteSnap, 'tileNum' | 'width' | 'height' | 'bpp8' | 'hflip' | 'vflip'>,
  map2d: boolean): Uint8Array {
  const w = s.width, h = s.height;
  const out = new Uint8Array(w * h);
  // tile numbers count 32-byte units: an 8bpp tile spans two
  const step = s.bpp8 ? 2 : 1;
  const rowTiles = map2d ? 32 : (w >> 3) * step;
  for (let oy = 0; oy < h; oy++) {
    const y = s.vflip ? h - 1 - oy : oy;
    const rowTile = s.tileNum + (y >> 3) * rowTiles;
    const py = y & 7;
    for (let ox = 0; ox < w; ox++) {
      const x = s.hflip ? w - 1 - ox : ox;
      const addr = OBJ_TILES + ((rowTile + (x >> 3) * step) & 1023) * 32;
      const px = x & 7;
      let ci: number;
      // past the end of VRAM (an 8bpp tile at 1023) reads 0, like the shader's out-of-range fetch
      if (s.bpp8) ci = vram[addr + py * 8 + px] ?? 0;
      else {
        const b = vram[addr + py * 4 + (px >> 1)] ?? 0;
        ci = px & 1 ? b >> 4 : b & 15;   // even x: low nibble
      }
      out[oy * w + ox] = ci;
    }
  }
  return out;
}

export interface SpriteColors { main: RGB | null; accent: RGB | null; green: RGB | null }

/** Hue in degrees (0..360). */
function hue([r, g, b]: RGB): number {
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/**
 * main: most frequent opaque colour with luma ≥ 0.2 (outlines excluded); accent: most saturated (≥ 0.35) non-green colour by
 * pixel count × saturation; green: pixel-weighted mean of green-hued colours (hue 70°–170°, saturation ≥ 0.2).
 * `palette16` holds the colours the indices refer to: the sprite's 16-colour OBJ slot (4bpp), or the whole 256-colour OBJ
 * palette (8bpp). Index 0 is transparent; indices sharing a colour count as one colour; ties go to the lower index.
 */
export function pickColors(indices: Uint8Array, palette16: Uint16Array): SpriteColors {
  const perIndex = new Uint32Array(256);
  for (let i = 0; i < indices.length; i++) perIndex[indices[i]]++;
  const counts = new Map<number, number>(); // BGR555 -> pixels
  for (let i = 1; i < 256; i++) {
    const n = perIndex[i];
    if (n === 0) continue;
    const v = (palette16[i] ?? 0) & 0x7fff;
    counts.set(v, (counts.get(v) ?? 0) + n);
  }
  let main: RGB | null = null, mainN = 0;
  let accent: RGB | null = null, accentScore = 0;
  const g: RGB = [0, 0, 0];
  let greenN = 0;
  for (const [v, n] of counts) {
    const c = bgr555ToSrgb(v);
    const sat = saturation(c);
    if (n > mainN && luma(c) >= 0.2) { main = c; mainN = n; }
    const h = hue(c);
    if (sat >= 0.2 && h >= 70 && h <= 170) {
      g[0] += c[0] * n; g[1] += c[1] * n; g[2] += c[2] * n;
      greenN += n;
    } else if (sat >= 0.35 && n * sat > accentScore) {
      accent = c;
      accentScore = n * sat;
    }
  }
  const green: RGB | null = greenN > 0 ? [g[0] / greenN, g[1] / greenN, g[2] / greenN] : null;
  return { main, accent, green };
}

/**
 * A sprite's tones, for the object models' shading (pickColors' statistics land on a sprite's darkest shade or
 * take in its outline). Over the non-outline pixels — opaque, luma ≥ 0.2, not on the silhouette's edge (a pixel
 * with a transparent 4-neighbour: GBA sprites draw their outline there) — sorted by luma: `body` is the median
 * pixel's colour, `highlight` the pixel-weighted mean of the upper quartile, `crevice` the darkest colour holding
 * ≥ 10 % of those pixels. `dark` is the most frequent colour of all the opaque pixels (outline and edge included)
 * darker than the body, near-black (luma < 0.06) left out: a sprite's dark band (the Cut tree's dark green base).
 * All null when there are no non-outline pixels.
 */
export interface SpriteTones { body: RGB | null; highlight: RGB | null; crevice: RGB | null; dark: RGB | null }

/** Share of the non-outline pixels a colour needs to be the crevice (the darkest *frequent* colour). */
const CREVICE_SHARE = 0.1;

/** The tones (SpriteTones) of a `width` × `height` image of palette `indices` (index 0 transparent). */
export function pickTones(indices: Uint8Array, width: number, height: number, palette16: Uint16Array): SpriteTones {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : indices[y * width + x]);
  // non-outline pixel counts per BGR555 colour; every opaque pixel's (the dark tone)
  const counts = new Map<number, number>(), all = new Map<number, number>();
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ci = at(x, y);
      if (!ci) continue;
      const v = (palette16[ci] ?? 0) & 0x7fff;
      all.set(v, (all.get(v) ?? 0) + 1);
      if (!at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1)) continue;
      if (luma(bgr555ToSrgb(v)) < 0.2) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
      n++;
    }
  }
  if (n === 0) return { body: null, highlight: null, crevice: null, dark: null };
  // colours by luma (ties: by value, so the order never depends on the map's)
  const list = [...counts].map(([v, k]) => ({ c: bgr555ToSrgb(v), k, l: luma(bgr555ToSrgb(v)), v }))
    .sort((a, b) => a.l - b.l || a.v - b.v);
  let body: RGB | null = null, crevice: RGB | null = null;
  const hi: RGB = [0, 0, 0];
  const top = n - Math.ceil(n / 4); // pixels below the upper quartile
  let seen = 0, hiN = 0;
  for (const e of list) {
    if (!crevice && e.k >= CREVICE_SHARE * n) crevice = e.c;
    if (!body && seen + e.k > (n - 1) / 2) body = e.c;
    const inTop = Math.min(e.k, Math.max(0, seen + e.k - top));
    for (let i = 0; i < 3; i++) hi[i] += e.c[i] * inTop;
    hiN += inTop;
    seen += e.k;
  }
  let dark: RGB | null = null, darkN = 0, darkV = 0;
  const bodyL = luma(body!);
  for (const [v, k] of all) {
    const c = bgr555ToSrgb(v), l = luma(c);
    if (l >= 0.06 && l < bodyL && (k > darkN || (k === darkN && dark !== null && v < darkV))) { dark = c; darkN = k; darkV = v; }
  }
  return { body, highlight: [hi[0] / hiN, hi[1] / hiN, hi[2] / hiN], crevice, dark };
}

/** A sprite's colours and tones (one decode, one cache entry). */
export interface SpriteSample { colors: SpriteColors; tones: SpriteTones }

const MAX_ENTRIES = 256;

/**
 * Cached per (images, animNum, palette slot contents): the sprite's own OAM palette slot (live play draws berry
 * trees in a per-berry slot, not their graphics info's) — or the whole OBJ palette for an 8bpp sprite — keyed by
 * its contents verbatim (no collisions; a palette change such as a fade step is a new key). At most 256 entries,
 * least recently used evicted first. A fully transparent image (tiles not copied in yet) is not cached, nor is
 * a lookup with `store: false` (a spawn frame).
 */
export class SpriteColorCache {
  private entries = new Map<string, SpriteSample>();

  /** Number of cached entries. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * The colours of `s`'s current image. `store: false` decodes on a miss without caching the result: on the
   * first synced frame of a new object (or of a new image set / anim), the VBlank tile copy may not have run
   * yet and the sprite's OBJ VRAM may still hold another object's pixels (a stored entry is still returned).
   */
  get(s: SpriteSnap, src: SpritePixelSource, opts?: { store?: boolean }): SpriteColors {
    return this.sample(s, src, opts).colors;
  }

  /** The colours and tones of `s`'s current image (as get; the same entry, one object per key). */
  sample(s: SpriteSnap, src: SpritePixelSource, opts?: { store?: boolean }): SpriteSample {
    const base = s.bpp8 ? 256 : 256 + (s.palette & 15) * 16;
    const pal = src.palette.subarray(base, s.bpp8 ? 512 : base + 16);
    const key = `${s.images}:${s.animNum}:${String.fromCharCode(...pal)}`;
    const hit = this.entries.get(key);
    if (hit) {
      // most recently used last
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }
    const indices = decodeSpriteIndices(src.vram, s, src.map2d);
    const sample: SpriteSample = { colors: pickColors(indices, pal), tones: pickTones(indices, s.width, s.height, pal) };
    if (opts?.store === false || !indices.some((ci) => ci !== 0)) return sample;
    this.entries.set(key, sample);
    if (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
    return sample;
  }
}
