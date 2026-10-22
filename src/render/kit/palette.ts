// Colour sampling from the live tiles, and the art-direction adjustments that make ROM colours
// read well under physically based lighting. All colours are sRGB in 0..1 unless noted.

import * as THREE from 'three';

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

const _hsl = { h: 0, s: 0, l: 0 }, _rgb = { r: 0, g: 0, b: 0 }, _c = new THREE.Color();
/** Art direction for foliage: a little greener and softer than the tile's colour (yellow-greens
 *  move a fifth of the way towards leaf green; ash and jungle tones stay apart; saturation is
 *  capped at `maxSat` because the post grade boosts it again). sRGB. */
export function lush(c: RGB, maxSat = 0.42): RGB {
  _c.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace).getHSL(_hsl, THREE.SRGBColorSpace);
  if (_hsl.h > 0.12 && _hsl.h < 0.45) _hsl.h += (0.34 - _hsl.h) * 0.2;
  _c.setHSL(_hsl.h, Math.min(maxSat, _hsl.s * 0.92), _hsl.l, THREE.SRGBColorSpace).getRGB(_rgb, THREE.SRGBColorSpace);
  return [_rgb.r, _rgb.g, _rgb.b];
}

/** Turned earth's hue, saturation and lightness range (earthTone). */
const EARTH = { hue: 25 / 360, sat: 0.18, l0: 0.4, l1: 0.6 };
/** Art direction for turned earth (berry soil beds, the berry plants' mounds): a tile's soil colour at its own
 *  lightness (kept within EARTH's 0.4..0.6: a mid-tone, never near-black or pale), its hue moved to a warm earth brown and its saturation
 *  set low. The GBA's berry soil is a mauve, (156, 115, 115): as it is, it read pink by day and magenta under the
 *  night's blue light; darker earth went near-black at night. sRGB. */
export function earthTone(c: RGB): RGB {
  _c.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace).getHSL(_hsl, THREE.SRGBColorSpace);
  const l = Math.min(EARTH.l1, Math.max(EARTH.l0, _hsl.l));
  _c.setHSL(EARTH.hue, EARTH.sat, l, THREE.SRGBColorSpace).getRGB(_rgb, THREE.SRGBColorSpace);
  return [_rgb.r, _rgb.g, _rgb.b];
}
/** The berry soil tiles' colour (General and secondary tilesets alike: (156, 115, 115)) as turned earth, linear: the
 *  colour of the berry plants' own mounds (actors: they do not know the map), which the beds derive alike. */
export const SOIL_LINEAR: RGB = toLinear(earthTone(bgr555ToSrgb(19 | (14 << 5) | (14 << 10))));
/** Moonlit soil (the berry beds and the plants' mounds, in their shaders): after sunset their colour turns this far
 *  (× uNight) to a neutral of `lift` × its luminance. Under the night's blue light warm earth reflects next to
 *  nothing (the beds went near-black, the darkest surface in the frame); as a light neutral they read as the kit's
 *  paths do at night. */
export const NIGHT_SOIL = { mix: 0.85, lift: 1.7 };
/**
 * NIGHT_SOIL as a colour factor, linear: per channel mix(soil, luminance(soil) × lift, night × mix) / soil. A surface
 * whose vertex colours are all `soil` × k (k varying: the berry beds) with this as its material colour comes out as
 * NIGHT_SOIL_GLSL would turn it (the luminance of soil × k is k × that of soil), without a shader hook of its own.
 * Into `out` (a channel of `soil` at 0 keeps factor 1).
 */
export function nightSoilScale(soil: RGB, night: number, out: RGB = [1, 1, 1]): RGB {
  // (the shader's luminance: Rec. 709 weights on linear colour)
  const l = (0.2126 * soil[0] + 0.7152 * soil[1] + 0.0722 * soil[2]) * NIGHT_SOIL.lift, t = night * NIGHT_SOIL.mix;
  for (let i = 0; i < 3; i++) out[i] = soil[i] > 0 ? (soil[i] + (l - soil[i]) * t) / soil[i] : 1;
  return out;
}
/** GLSL: NIGHT_SOIL applied to `diffuseColor` (needs the kit's uNight). */
export const NIGHT_SOIL_GLSL = /* glsl */ `
{
  float soilL = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(soilL * ${NIGHT_SOIL.lift.toFixed(2)}), uNight * ${NIGHT_SOIL.mix.toFixed(2)});
}
`;

/** Water is blue by more than this over red (and above green): see classifyGroundColor. */
const WATER_BLUE_OVER_RED = 0.2;

/** A water colour on walkable ground (a puddle, a hot spring, the sea behind an overhang's art):
 *  greyed at the same lightness so it reads as wet sand or mud, not open water. Greyed 70 %, or
 *  more for a deep pure blue, so blue always ends below the water margin over red. */
export function wetGround(c: RGB): RGB {
  const l = luma(c);
  const t = Math.max(0.7, 1 - (WATER_BLUE_OVER_RED - 0.02) / Math.max(c[2] - c[0], 1e-6));
  return mix(c, [l, l, l], t);
}

export type GroundClass = 'grass' | 'path' | 'sand' | 'paving' | 'dirt' | 'gravel' | 'rock' | 'water' | 'dark';

/** Ground material class of a tile's dominant colour (thresholds from measured ROM colours). */
export function classifyGroundColor(c: RGB): GroundClass {
  const [r, g, b] = c;
  const l = luma(c);
  const s = saturation(c);
  if (l < 0.12) return 'dark';
  if (b > r + WATER_BLUE_OVER_RED && b > g + 0.05) return 'water';
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
