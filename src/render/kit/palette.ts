// Colour sampling from the live tiles, and the art-direction adjustments that make ROM colours
// read well under physically based lighting. All colours are sRGB in 0..1 unless noted.

export type RGB = [number, number, number];

export function bgr555ToSrgb(c: number): RGB {
  return [(c & 31) / 31, ((c >> 5) & 31) / 31, ((c >> 10) & 31) / 31];
}

export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function toLinear(c: RGB): RGB {
  return [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
}

export function luma(c: RGB): number {
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
}

export function saturation(c: RGB): number {
  return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
}

export function scale(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Most frequent colour among the opaque pixels of `metatiles` in a 256-px-per-metatile BGR555
 * buffer (TileInfo.both / .bottom; 0x8000 = transparent), optionally filtered.
 */
export function dominantColor(px: Uint16Array, metatiles: Iterable<number>, accept?: (c: RGB) => boolean): RGB | null {
  const counts = new Map<number, number>();
  for (const m of metatiles) {
    for (let p = 0; p < 256; p++) {
      const v = px[m * 256 + p];
      if (v & 0x8000) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  let best = -1;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n <= bestN || (accept && !accept(bgr555ToSrgb(v)))) continue;
    best = v;
    bestN = n;
  }
  return best < 0 ? null : bgr555ToSrgb(best);
}

/** Number of opaque pixels of `metatiles` whose colour passes `accept`. */
export function countPixels(px: Uint16Array, metatiles: Iterable<number>, accept: (c: RGB) => boolean): number {
  let n = 0;
  for (const m of metatiles) {
    for (let p = 0; p < 256; p++) {
      const v = px[m * 256 + p];
      if (!(v & 0x8000) && accept(bgr555ToSrgb(v))) n++;
    }
  }
  return n;
}

/** Tames neon saturation and lifts crushed darks (art direction: soft, bright, clean). */
export function soften(c: RGB, k = 0.12): RGB {
  const l = luma(c);
  const s = saturation(c);
  const desat = s > 0.5 ? k * (s - 0.5) * 2 : 0;
  const lift = 0.04;
  return [0, 1, 2].map((i) => {
    const v = c[i] + (l - c[i]) * desat;
    return v * (1 - lift) + lift;
  }) as RGB;
}

/** A water colour on walkable ground (a puddle, a hot spring, the sea behind an overhang's art):
 *  greyed at the same lightness so it reads as wet sand or mud, not open water. */
export function wetGround(c: RGB): RGB {
  const l = luma(c);
  return mix(c, [l, l, l], 0.7);
}

export type GroundClass = 'grass' | 'path' | 'sand' | 'paving' | 'dirt' | 'gravel' | 'rock' | 'water' | 'dark';

/** Ground material class of a tile's dominant colour (thresholds from measured ROM colours). */
export function classifyGroundColor(c: RGB): GroundClass {
  const [r, g, b] = c;
  const l = luma(c);
  const s = saturation(c);
  if (l < 0.12) return 'dark';
  if (b > r + 0.2 && b > g + 0.05) return 'water';
  if (g > r + 0.15 && s > 0.25) return 'grass';
  if (r > 0.75 && g > 0.65 && b < g - 0.12) return 'sand';
  // Beige-grey: ash / gravel up to luma 0.71 (Route 113 0.67, Sootopolis 0.70), lighter is a
  // patterned plaza (Lilycove 0.73).
  if (Math.abs(r - g) < 0.06 && b < r - 0.08 && s < 0.2 && l < 0.75) return l < 0.71 ? 'gravel' : 'paving';
  if (s < 0.12) return l >= 0.6 ? 'paving' : 'rock';
  if (g >= r - 0.02 && l > 0.6 && s <= 0.25) return 'path';
  if (r > b + 0.1 && r >= g - 0.02) return 'dirt';
  return 'path';
}
