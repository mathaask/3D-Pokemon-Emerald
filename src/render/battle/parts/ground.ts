// The arena ground: one polar disc around the stage, shaded by the kit's terrain material (the overworld's painterly
// grass, path, sand, paving, gravel, rock and deck, kit/terrain.ts) over a grid of synthetic cells — the field and the
// pond's bed (the platform tops draw with this very material over cells of their own: parts/platforms.ts) —
// plus a worn ring round the platforms (outdoor kinds, painted analytically), soft cloud shadows drifting over outdoor
// ground and caustics on the sea floor. Flat around the stage, rolling beyond it outdoors, a basin under the pond kinds'
// water, a seabed under open water. The indoor halls (floor.ts FLOOR_STYLE) draw the disc with the hall floor instead:
// wooden boards or polished tiles (the gyms' courts painted in), no terrain shading.

import * as THREE from 'three';
import { noise2 } from '../../kit/geom';
import { kitMaterial, type KitMaterialOptions } from '../../kit/materials';
import { scale, mix, toLinear, type RGB } from '../../kit/palette';
import { terrainMaterial, terrainFragColor, GroundMat } from '../../kit/terrain';
import { KIT_NOISE_GLSL } from '../../kit/noise.glsl';
import { CLOUD_GLSL } from '../clouds.glsl';
import { ARENA_SETTING, type ArenaKind } from '../arenaKind';
import type { ArenaPalette } from '../palette';
import type { ArenaPart, CatalogueEntry } from '../modernArena';
import { GROUND_Y, PLATFORM_FOOTPRINT, STAGE, WATER_Y, type Stage } from '../stage';
import { FLOOR_COURT, FLOOR_STYLE, courtColor, hallFloorMaterial } from './floor';

export const GROUND_GRID = 72;   // cells (1 unit each) around stage.centre
export const POND = { dz: -1, rx: 15, rz: 10 }, CAVE_POND = { dz: -1, rx: 18, rz: 12 };

/** The seabed under open water (water, kyogre) and the pond basins' floor. */
const SEABED_Y = -1.2, BASIN_Y = -0.9;
/** The cave pond's basin shore: it slopes up to GROUND_Y over its last BASIN_SHORE units. */
const BASIN_SHORE = 2;
/** The pond's bank (the pond only; the cave pond keeps its basin): its waterline `waterline` units inside the POND
 *  ellipse (along the ray from the ellipse's centre: pondShore), a sandy lip rising from it to `crest` over WATER_Y at
 *  the ellipse — where the reeds start (flora.ts SHORE) — and easing back down to the field over `back` units beyond it;
 *  under the water the bed falls from the waterline as steeply as the lip rises, to BASIN_Y. One profile, C1 throughout
 *  (pondBank): the water meets the ground on a smooth, analytic waterline, and the camera sees a strip of beach before
 *  the reeds. */
export const POND_BANK = { waterline: 0.9, crest: 0.12, back: 2 };
/** The bed's run from the waterline down to BASIN_Y: its slope at the waterline (2 · depth / run, a parabola) the lip's
 *  (2 · crest / waterline). */
const POND_BED_RUN = ((WATER_Y - BASIN_Y) * POND_BANK.waterline) / POND_BANK.crest;
/** Flat within FLAT_R of the stage centre; outdoors the field rolls in fully by ROLL_R. */
const FLAT_R = 9, ROLL_R = 22;
/** The worn ring round the platforms (outdoor kinds; elliptical radius × footprint): worn from `inner` (a soft edge
 *  under the platform's rim) out to a noise-frayed edge between `outer`'s two radii. Painted in the ground's shader
 *  (analytic: the terrain's warped cell borders broke a cell-painted ring into lobed patches). */
export const WORN_RING = { inner: 1.0, outer: [1.4, 1.62] as const };
/** GLSL's smoothstep(e0, e1, x). */
const smooth = (e0: number, e1: number, x: number) => THREE.MathUtils.smoothstep(x, e0, e1);

/** The ground at night: warm earth turns this far (× uNight) to a neutral of `lift` × its luminance (the kit's NIGHT_SOIL
 *  is 0.85 / 1.7: on the worn ring a flat slate band), and the worn ring fades this far into the field. (The platform
 *  bodies keep NIGHT_SOIL: with these, their earth went near-black.) */
export const GROUND_NIGHT = { mix: 0.55, lift: 1.4, ringFade: 0.4 };

/** GROUND_COLOR's moonlit earth (below) as a material-colour factor, for a surface coloured `rgb` × k (linear): per
 *  channel mix(rgb, luminance(rgb) × lift, night × mix × warmth) / rgb, with the shader's warmth test on `rgb`. Scenery
 *  in the ground's colours (the dunes, the bare hills, dry tufts, rocks) stays the field's colour under the moon. Into
 *  `out` (a channel of `rgb` at 0 keeps factor 1). */
export function groundNightScale(rgb: RGB, night: number, out: RGB): RGB {
  const warm = smooth(0, 0.08, rgb[0] - rgb[2]) * (1 - smooth(0, 0.08, rgb[1] - rgb[0]));
  const l = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) * GROUND_NIGHT.lift, t = night * GROUND_NIGHT.mix * warm;
  for (let i = 0; i < 3; i++) out[i] = rgb[i] > 0 ? (rgb[i] + (l - rgb[i]) * t) / rgb[i] : 1;
  return out;
}

/** Moonlights `mesh` at night as the arena ground does warm earth (groundNightScale of `rgb`, linear, through its
 *  material's colour, set before each draw from `night`: no program of its own). A cool colour (no warmth) is left as it
 *  is, with no hook. The material is the mesh's own (a pooled kit material, its colour reset when it is handed out again). */
export function moonlitAsGround(mesh: THREE.Object3D, material: THREE.MeshStandardMaterial, rgb: RGB, night: { value: number }): void {
  const k: RGB = [1, 1, 1];
  if (groundNightScale(rgb, 1, k).every((v) => v === 1)) return;
  mesh.onBeforeRender = () => {
    groundNightScale(rgb, night.value, k);
    material.color.setRGB(k[0], k[1], k[2]);
  };
}

/** A cloud's shadow darkens the ground at most this much (soft: arenaClouds' smooth cover, per vertex). */
export const CLOUD_SHADOW = 0.15;

/** The battle ground's border warp reaches this far from the stage centre (cells; faded out over its last 4): beyond,
 *  the field is one material — nothing to bend (WARP_GLSL). */
const WARP_R = 30;
/** The pond bed's muddy sand (its cells' tint: Sand); the pond's beach and lip over the water a warm, dry sand (the
 *  shallows' sandy shelf: water.ts WATER_LOOK.sand), each a little of the field's colour. */
const POND_BED: RGB = [0.6, 0.56, 0.42], POND_BEACH: RGB = [0.86, 0.78, 0.56];

/** The disc's radius (units from the stage centre): 64 (`default`) — beyond the battle camera's sight of the ground —,
 *  but the Sky Pillar's floor ends at its broken edge (parts/skyPillar.ts: the edge's lip covers the disc's rim). */
export const GROUND_RADIUS: { readonly default: number } & Readonly<Partial<Record<ArenaKind, number>>> = { default: 64, rayquaza: 14 };
/** A kind's ground radius (GROUND_RADIUS). */
export const groundRadius = (kind: ArenaKind): number => GROUND_RADIUS[kind] ?? GROUND_RADIUS.default;
/** The disc: segments, rings (densest near the stage: ring k at radius groundRadius · (k / DISC_RINGS)^DISC_POW). */
export const DISC_SEGMENTS = 96;
const DISC_RINGS = 48, DISC_POW = 1.35;

/** Per cell rgb = sRGB tint, a = mat << 4 | 8 (the terrain family's layout): groundMat / ground everywhere, tints ±6 % by
 *  noise2; pond kinds → Sand: the cave pond's ellipse (its bed), the pond's bed, beach and lip (pondSand). The field
 *  runs on under the platforms (their tops paint
 *  themselves: platforms.ts, uniformCells — platform cells here reached out past the slabs' plinths and, shifted 0.28
 *  towards −z in cell space, past the sand mounds' far side, where the worn ring's tint turned them near white); the worn
 *  ring is the shader's (WORN_RING). (The grid is in the terrain shader's cell space, (x, z − y): the field at GROUND_Y.) */
export function groundCells(kind: ArenaKind, p: ArenaPalette, stage: Stage): { data: Uint8Array; w: number; h: number; min: [number, number] } {
  const w = GROUND_GRID, h = GROUND_GRID;
  const min: [number, number] = [Math.floor(stage.centre.x) - w / 2, Math.floor(stage.centre.z) - h / 2];
  const data = new Uint8Array(w * h * 4);
  const pond = kind === 'cavePond' ? CAVE_POND : null;
  const bed = mix(POND_BED, p.ground, 0.25), beach = mix(POND_BEACH, p.ground, 0.12);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      // the cell's centre in cell space; on ground at GROUND_Y the world's z is that + GROUND_Y
      const x = min[0] + i + 0.5, z = min[1] + j + 0.5, zg = z + GROUND_Y;
      let mat = p.groundMat, tint = p.ground;
      const shore = kind === 'pond' ? pondCellShore(x, z, stage) : 0;
      if (kind === 'pond' ? shore <= POND_BANK.waterline + POND_SAND_PAST_CREST
        : pond && Math.hypot((x - stage.centre.x) / pond.rx, (zg - stage.centre.z - pond.dz) / pond.rz) <= 1) {
        mat = GroundMat.Sand;
        tint = kind === 'pond' && shore > POND_BEACH_FROM ? beach : bed;
      }
      const k = 1 + 0.06 * noise2(x * 0.23, z * 0.23, 0x6a7);
      const o = (j * w + i) * 4;
      const t = scale(tint, k);
      data[o] = Math.min(255, t[0] * 255);
      data[o + 1] = Math.min(255, t[1] * 255);
      data[o + 2] = Math.min(255, t[2] * 255);
      data[o + 3] = (mat << 4) | 8;
    }
  }
  return { data, w, h, min };
}

/** The outdoor field's roll at (x, z), r from the stage centre: 0 within FLAT_R, then up to ±1 (× `amp`). */
function roll(x: number, z: number, r: number, amp: number): number {
  if (r <= FLAT_R) return 0;
  return smooth(FLAT_R, ROLL_R, r) * (0.9 * noise2(x * 0.07, z * 0.07) - 0.25) * amp;
}

/** The pond's signed distance to its waterline at (x, z) (POND_BANK): along the ray from the POND ellipse's centre,
 *  positive on the bank (the ellipse itself at POND_BANK.waterline). */
export function pondShore(x: number, z: number, stage: Stage): number {
  const dx = x - stage.centre.x, dz = z - stage.centre.z - POND.dz;
  const e = Math.hypot(dx / POND.rx, dz / POND.rz), d = Math.hypot(dx, dz);
  // (d / e: the ellipse's radius along the ray; at its centre any)
  return (e < 1e-9 ? -POND.rz : d - d / e) + POND_BANK.waterline;
}

/** The pond's ground at signed distance `s` from its waterline (pondShore) over a field at `field`: the bed (a parabola
 *  from BASIN_Y up to WATER_Y over POND_BED_RUN), the lip (a parabola from WATER_Y up to its crest at the ellipse, the
 *  same slope at the waterline), its back (a smoothstep from the crest down to the field over POND_BANK.back). */
function pondBank(s: number, field: number): number {
  const B = POND_BANK, crest = WATER_Y + B.crest;
  if (s <= 0) {
    const t = Math.min(1, -s / POND_BED_RUN);
    return WATER_Y - (WATER_Y - BASIN_Y) * (1 - (1 - t) * (1 - t));
  }
  if (s <= B.waterline) {
    const t = s / B.waterline;
    return WATER_Y + B.crest * (1 - (1 - t) * (1 - t));
  }
  return crest + (field - crest) * smooth(0, B.back, s - B.waterline);
}

/** The pond's cells are sand up to this far past its lip's crest (one cell: the terrain's border warp, up to ≈ 0.9 of a
 *  cell, keeps the beach and the crest sand), its dry beach's from this far short of its waterline (a cell straddling it). */
const POND_SAND_PAST_CREST = 1, POND_BEACH_FROM = -0.3;
/** The pond's ground cell at cell-space (x, z) — the terrain's (x, z − y) — as pondShore of its point on the ground (z + y,
 *  the ground's height found in two steps from the water's): on the bed, the beach, the lip or beyond. */
function pondCellShore(x: number, z: number, stage: Stage): number {
  let zw = z + WATER_Y;
  for (let k = 0; k < 2; k++) zw = z + groundHeight('pond', x, zw, stage);
  return pondShore(x, zw, stage);
}

/** Ground height at world (x, z): GROUND_Y within 9 units of the centre; outdoor kinds roll beyond (smoothstep(9, 22, r) ×
 *  (0.9 · noise2(x·0.07, z·0.07) − 0.25), sand ×2); cave/indoor flat; water/kyogre the seabed −1.2; the pond its bank
 *  (POND_BANK: a bed under the water, a lip over it, the rolling field beyond); cavePond a basin (CAVE_POND ellipse
 *  around the centre) at −0.9 sloping up to GROUND_Y over its last 2 units. (Underwater's sea floor rolls as the outdoor
 *  field; the Sky Pillar's top is flat.) */
export function groundHeight(kind: ArenaKind, x: number, z: number, stage: Stage): number {
  const dx = x - stage.centre.x, dz = z - stage.centre.z;
  if (kind === 'water' || kind === 'kyogre') return SEABED_Y;
  if (kind === 'pond') return pondBank(pondShore(x, z, stage), GROUND_Y + roll(x, z, Math.hypot(dx, dz), 1));
  if (kind === 'cavePond') {
    const pond = CAVE_POND, e = Math.hypot(dx / pond.rx, (dz - pond.dz) / pond.rz);
    if (e < 1) {
      // (distance to the shore along the ray from the basin's centre: its radius that way less this point's)
      const d = Math.hypot(dx, dz - pond.dz), shore = d / Math.max(e, 1e-6) - d;
      return GROUND_Y + (BASIN_Y - GROUND_Y) * smooth(0, BASIN_SHORE, shore);
    }
    return GROUND_Y;
  }
  const setting = ARENA_SETTING[kind];
  if (setting === 'outdoor' || setting === 'underwater') return GROUND_Y + roll(x, z, Math.hypot(dx, dz), kind === 'sand' ? 2 : 1);
  return GROUND_Y;
}

// Drifting cloud shadows (outdoor) and the sea floor's caustics (underwater), after the terrain's colour: uniform
// branches (build-time values), so a kind without them pays nothing. The caustics are kit/water.ts's seabed term. At
// night (uNight, outdoor kinds only) warm ground is moonlit.

/** The stage's two platforms (world x, z, footprint rx, rz) and its centre in the terrain's cell space at GROUND_Y. */
const stageGlsl = (stage: Stage) => /* glsl */ `
const vec4 ARENA_PLATFORMS[2] = vec4[2](
  vec4(${stage.player.x.toFixed(4)}, ${stage.player.z.toFixed(4)}, ${PLATFORM_FOOTPRINT.player.rx.toFixed(4)}, ${PLATFORM_FOOTPRINT.player.rz.toFixed(4)}),
  vec4(${stage.enemy.x.toFixed(4)}, ${stage.enemy.z.toFixed(4)}, ${PLATFORM_FOOTPRINT.enemy.rx.toFixed(4)}, ${PLATFORM_FOOTPRINT.enemy.rz.toFixed(4)}));
const vec2 ARENA_CELL_CENTRE = vec2(${stage.centre.x.toFixed(4)}, ${(stage.centre.z - GROUND_Y).toFixed(4)});
`;

/** The battle ground's border warp (terrainFragColor's): the terrain's, cheaper — only within WARP_R of the stage (the
 *  pond's bed; faded out over its last 4 cells), and only the broad warp's two coarse
 *  octaves (renormalised); none on a one-cell grid (the platform tops'). */
const WARP_GLSL = /* glsl */ `  // the battle ground's warp (parts/ground.ts WARP_GLSL)
  vec2 warp = vec2(0.0);
  float warpK = uGridSize.x * uGridSize.y > 1.0 ? 1.0 - smoothstep(${(WARP_R - 4).toFixed(1)}, ${WARP_R.toFixed(1)}, length(cell - ARENA_CELL_CENTRE)) : 0.0;
  if (warpK > 0.0) {
    vec2 w0 = cell * 0.7, w1 = w0 + 17.3;
    vec2 broad = vec2(0.5 * kitNoise2(w0) + 0.25 * kitNoise2(w0 * 2.03 + 17.1), 0.5 * kitNoise2(w1) + 0.25 * kitNoise2(w1 * 2.03 + 17.1)) / 0.75;
    warp = ((broad - 0.5) * 1.5 + (vec2(kitNoise2(cell * 3.3), kitNoise2(cell * 3.3 + 9.1)) - 0.5) * 0.24) * warpK;
  }
`;

// Cloud cover per vertex (40-unit features: the disc and the tops are dense enough) into one varying: no noise per
// fragment.
const GROUND_VERT_HEAD = /* glsl */ `
uniform float uClouds;
varying float vArenaCloud;
${KIT_NOISE_GLSL}
${CLOUD_GLSL}
`;
const GROUND_VERT_WORLD = /* glsl */ `
vArenaCloud = uClouds > 0.0 ? arenaClouds((kitWorldPos.xz + uTime * vec2(0.6, 0.25)) / 40.0) : 0.0;
`;
const GROUND_HEAD = /* glsl */ `
uniform float uClouds;
uniform float uCaustics;
uniform float uRing;
uniform vec3 uRingTint;
varying float vArenaCloud;
`;
// The worn ring (uRing > 0: the field's material, outdoor kinds): the field's own shading recoloured towards the path's
// colour (uRingTint: the path's look over the field's colour, linear — its texture kept, no shading of its own) by the
// elliptical distance from the nearer platform — worn in from a soft inner edge, frayed by noise at the outer one, patchy
// inside; fainter at night.
const GROUND_COLOR = /* glsl */ `
if (uRing > 0.0) {
  vec2 rp = vKitWorld.xz;
  float re = min(length((rp - ARENA_PLATFORMS[0].xy) / ARENA_PLATFORMS[0].zw), length((rp - ARENA_PLATFORMS[1].xy) / ARENA_PLATFORMS[1].zw));
  if (re < ${WORN_RING.outer[1].toFixed(2)}) {
    float fray = kitNoise2(rp * 1.3), wear = kitNoise2(rp * 2.6 + 11.0);
    float outer = mix(${WORN_RING.outer[0].toFixed(2)}, ${WORN_RING.outer[1].toFixed(2)}, fray);
    float worn = smoothstep(${(WORN_RING.inner - 0.04).toFixed(2)}, ${(WORN_RING.inner + 0.08).toFixed(2)}, re) * (1.0 - smoothstep(outer - 0.16, outer, re))
      * (0.7 + 0.3 * wear) * uRing * (1.0 - ${GROUND_NIGHT.ringFade.toFixed(2)} * uNight);
    diffuseColor.rgb *= mix(vec3(1.0), uRingTint, worn);
  }
}
if (uClouds > 0.0) {
  diffuseColor.rgb *= 1.0 - uClouds * ${CLOUD_SHADOW.toFixed(2)} * vArenaCloud;
}
if (uCaustics > 0.0) {
  vec2 cp = vec2(vKitWorld.x, vKitWorld.z - vKitWorld.y) * 1.7;
  float c1 = kitVoronoi(cp + vec2(uTime * 0.12, uTime * 0.07)).x;
  float c2 = kitVoronoi(cp * 1.3 - vec2(uTime * 0.09, -uTime * 0.11) + 3.1).x;
  float caus = (1.0 - smoothstep(0.0, 0.1, c1)) * 0.6 + (1.0 - smoothstep(0.0, 0.08, c2)) * 0.4;
  diffuseColor.rgb *= mix(1.0, 0.92 + 0.3 * caus, uCaustics);
}
if (uNight > 0.0) {
  // moonlit earth (as the kit's NIGHT_SOIL, gentler): warm ground — the worn ring, sand, gravel; not grass — turns part
  // of the way to a light neutral after sunset (under the night's blue light it reflected next to nothing: near-black
  // patches; all the way, a flat slate band)
  vec3 gc = diffuseColor.rgb;
  float warm = smoothstep(0.0, 0.08, gc.r - gc.b) * (1.0 - smoothstep(0.0, 0.08, gc.g - gc.r));
  diffuseColor.rgb = mix(gc, vec3(dot(gc, vec3(0.2126, 0.7152, 0.0722)) * ${GROUND_NIGHT.lift.toFixed(2)}), uNight * ${GROUND_NIGHT.mix.toFixed(2)} * warm);
}
`;

/** The worn ring a build paints (WORN_RING): its strength (0: none) and its tint over the field (linear, per channel). */
export interface WornRing { strength: number; tint: RGB }
const NO_RING: WornRing = { strength: 0, tint: [1, 1, 1] };

/** The worn ring of an outdoor kind: the path's colour as the terrain shades its material (a Path: warm earth at its own
 *  lightness, as kitGround) over the field's, linear, each channel at most 4×. */
export function wornRing(p: ArenaPalette): WornRing {
  const ground = toLinear(p.ground);
  let path = toLinear(p.path);
  if (p.pathMat === GroundMat.Path) {
    const l = 0.2126 * path[0] + 0.7152 * path[1] + 0.0722 * path[2];
    path = mix(path, [l / 0.806, (0.78 * l) / 0.806, (0.5 * l) / 0.806], 0.75);
  }
  return { strength: 1, tint: [0, 1, 2].map((i) => Math.min(4, path[i] / Math.max(ground[i], 0.02))) as RGB };
}

/** terrainMaterial + cloud shadows (uClouds, per vertex) and seabed caustics (uCaustics), both build-time values; the
 *  worn ring (`ring`: none by default); the battle ground's cheaper border warp (WARP_GLSL); hookKey 'arenaGround'. */
export function arenaGroundMaterial(tex: THREE.Texture, min: THREE.Vector2, size: THREE.Vector2, clouds: number, caustics: number,
  ring: WornRing = NO_RING, stage: Stage = STAGE): KitMaterialOptions {
  const t = terrainMaterial(tex, min, size);
  return {
    ...t,
    uniforms: { ...t.uniforms, uClouds: { value: clouds }, uCaustics: { value: caustics }, uRing: { value: ring.strength },
      uRingTint: { value: new THREE.Color(...ring.tint) } },
    fragHead: (t.fragHead ?? '') + stageGlsl(stage) + GROUND_HEAD,
    fragColor: terrainFragColor(WARP_GLSL) + GROUND_COLOR,
    vertHead: GROUND_VERT_HEAD,
    vertWorld: GROUND_VERT_WORLD,
    hookKey: 'arenaGround',
  };
}

/** A disc's index: a fan from vertex 0 to its first ring, then `rings` − 1 bands, each ring `segments` vertices from 1. */
function discIndex(rings: number, segments: number): Uint32Array {
  const idx = new Uint32Array((segments + (rings - 1) * segments * 2) * 3);
  const vi = (k: number, s: number) => 1 + (k - 1) * segments + (s % segments);
  let t = 0;
  // (counter-clockwise seen from above: +y faces up)
  for (let s = 0; s < segments; s++) { idx[t++] = 0; idx[t++] = vi(1, s + 1); idx[t++] = vi(1, s); }
  for (let k = 1; k < rings; k++) {
    for (let s = 0; s < segments; s++) {
      const a = vi(k, s), b = vi(k, s + 1), c = vi(k + 1, s + 1), d = vi(k + 1, s);
      idx[t++] = a; idx[t++] = b; idx[t++] = c;
      idx[t++] = a; idx[t++] = c; idx[t++] = d;
    }
  }
  return idx;
}

/** The pond's disc: rings round the POND ellipse's centre along the rays from it (the ellipse's parametric angle, evenly
 *  along its shore), `segments` round — `inner` rings scaling the ellipse (to `innerE` of it), then rings at the signed
 *  distances `shore` from the waterline (pondShore: one ring on the waterline, dense over the beach and the lip: the water
 *  meets the ground on the analytic waterline), then `outer` rings out to `reach` units past the ellipse (every ray past 64
 *  from the stage centre, as the default disc). */
const POND_DISC = { segments: 128, inner: 6, innerE: 0.55,
  shore: [-3, -2.3, -1.7, -1.2, -0.8, -0.5, -0.3, -0.15, 0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.15, 1.5, 1.95, 2.45, 2.9] as const,
  outer: 18, reach: 56 };
function pondDisc(stage: Stage): THREE.BufferGeometry {
  const P = POND_DISC, cx = stage.centre.x, cz = stage.centre.z + POND.dz, W = POND_BANK.waterline;
  const last = P.shore[P.shore.length - 1];
  // (each ring's distance along the ray from the centre, for the ray's ellipse radius R)
  const rings: ((R: number) => number)[] = [
    ...Array.from({ length: P.inner }, (_, k) => (R: number) => R * P.innerE * ((k + 1) / P.inner)),
    ...P.shore.map((s) => (R: number) => R - W + s),
    ...Array.from({ length: P.outer }, (_, k) => (R: number) => R - W + last + (P.reach + W - last) * Math.pow((k + 1) / P.outer, 1.6)),
  ];
  const n = 1 + rings.length * P.segments, pos = new Float32Array(n * 3);
  pos.set([cx, groundHeight('pond', cx, cz, stage), cz]);
  let o = 3;
  for (const ring of rings) {
    for (let s = 0; s < P.segments; s++) {
      const t = (s / P.segments) * Math.PI * 2, ex = Math.cos(t) * POND.rx, ez = Math.sin(t) * POND.rz;
      const R = Math.hypot(ex, ez), d = ring(R), x = cx + (ex / R) * d, z = cz + (ez / R) * d;
      pos[o++] = x; pos[o++] = groundHeight('pond', x, z, stage); pos[o++] = z;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(discIndex(rings.length, P.segments), 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** The disc's geometry: DISC_RINGS rings of DISC_SEGMENTS vertices around (cx, cz) out to the kind's groundRadius, plus
 *  the centre, at groundHeight; position + normal (smooth). (The pond's follows its shore: pondDisc.) */
export function groundDisc(kind: ArenaKind, stage: Stage): THREE.BufferGeometry {
  if (kind === 'pond') return pondDisc(stage);
  const cx = stage.centre.x, cz = stage.centre.z, R = groundRadius(kind);
  const n = 1 + DISC_RINGS * DISC_SEGMENTS;
  const pos = new Float32Array(n * 3);
  pos.set([cx, groundHeight(kind, cx, cz, stage), cz]);
  let o = 3;
  for (let k = 1; k <= DISC_RINGS; k++) {
    const r = R * Math.pow(k / DISC_RINGS, DISC_POW);
    for (let s = 0; s < DISC_SEGMENTS; s++) {
      const a = (s / DISC_SEGMENTS) * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      pos[o++] = x; pos[o++] = groundHeight(kind, x, z, stage); pos[o++] = z;
    }
  }
  const idx = discIndex(DISC_RINGS, DISC_SEGMENTS);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

const PN = { position: 3, normal: 3 };
/**
 * The battle's opaque draw order. three sorts opaque objects by group order (the render order of their nearest Group:
 * 0 for every battle mesh — the arena's parts, the actors' group), then render order, then material, then depth:
 *   −1   deep water (parts/water.ts WATER_RENDER_ORDER: the seabed and basins under it are never shaded)
 *    0   the arena's scenery and rooms (and today's arena: the Retro look)
 *    2   the battlers and their cards (ACTOR_RENDER_ORDER)
 *    2.5 the platform tops (TOPS_RENDER_ORDER)
 *    3   the ground (GROUND_RENDER_ORDER)
 *    3.5 the Sky Pillar's clouds (parts/skyPillar.ts CLOUD_RENDER_ORDER: under the floor's depth)
 *   10   the sky (BattleSky: at the far plane, depth-tested; today's sky, under today's arena: −10, drawn first)
 * (tests/battleRenderOrder.test.ts holds a build to it.) The ground draws after every other opaque thing of the battle
 * but the clouds and the sky: the full-screen terrain shading then runs only where the ground shows — not under the
 * platforms, battlers and props drawn over it (−2.4 ms on b_grass). The order changes no pixel: nothing it overlaps lies
 * at its depth.
 */
export const GROUND_RENDER_ORDER = 3;
/** The platform tops (parts/platforms.ts: the ground's material over cells of their own) draw after the battlers too, but
 *  before the ground: at one render order three draws the lower material id first — the ground's, built first — and the
 *  ground's terrain shading ran under both tops, overwritten (−0.2 to −0.36 ms). The order changes no pixel either. */
export const TOPS_RENDER_ORDER = 2.5;

/** The arena ground's material for a build: its cells (default the context's ground), its worn ring (default none) and
 *  the look from the context. (The platform tops draw with it too, over cells of their own: platforms.ts.) */
export function arenaGround(ctx: { uniforms: Parameters<typeof kitMaterial>[0]; ground: { tex: THREE.Texture; min: THREE.Vector2; size: THREE.Vector2 };
  look: { clouds: number; caustics: number }; stage: Stage }, cells = ctx.ground, ring: WornRing = NO_RING): THREE.Material {
  return kitMaterial(ctx.uniforms, arenaGroundMaterial(cells.tex, cells.min, cells.size, ctx.look.clouds, ctx.look.caustics, ring, ctx.stage)).material;
}

/** One cell of material `mat` in sRGB `tint` everywhere (the terrain shader clamps its lookups to the grid): a texture
 *  of cells (the caller frees it) over which the ground's material paints a surface all alike. */
export function uniformCells(mat: GroundMat, tint: RGB): { tex: THREE.DataTexture; min: THREE.Vector2; size: THREE.Vector2 } {
  const tex = new THREE.DataTexture(new Uint8Array([tint[0] * 255, tint[1] * 255, tint[2] * 255, (mat << 4) | 8]), 1, 1,
    THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  return { tex, min: new THREE.Vector2(0, 0), size: new THREE.Vector2(1, 1) };
}

export const GROUND_PART: ArenaPart = {
  name: 'ground',
  kinds: 'all',
  catalogue(ph): readonly CatalogueEntry[] {
    return [
      { material: arenaGroundMaterial(ph(), new THREE.Vector2(), new THREE.Vector2(), 0, 0), mesh: 'mesh', attrs: PN, castShadow: false },
      // (the halls' floors: floor.ts)
      { material: hallFloorMaterial('tiles', [1, 1, 1]), mesh: 'mesh', attrs: PN, castShadow: false },
    ];
  },
  build(ctx) {
    // (the worn ring round the platforms: outdoor kinds, in their path's look; a hall's floor: its boards or tiles)
    const ring = ARENA_SETTING[ctx.kind] === 'outdoor' ? wornRing(ctx.palette) : NO_RING;
    const floor = FLOOR_STYLE[ctx.kind];
    const shade = FLOOR_COURT[ctx.kind];
    const court = shade ? { stage: ctx.stage, color: courtColor(ctx.palette, shade) } : null;
    const material = floor ? kitMaterial(ctx.uniforms, hallFloorMaterial(floor, ctx.palette.ground, court)).material
      : arenaGround(ctx, ctx.ground, ring);
    const mesh = new THREE.Mesh(groundDisc(ctx.kind, ctx.stage), material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.renderOrder = GROUND_RENDER_ORDER;
    return mesh;
  },
};
