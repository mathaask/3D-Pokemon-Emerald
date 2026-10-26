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
import { GROUND_Y, PLATFORM_FOOTPRINT, STAGE, type Stage } from '../stage';
import { FLOOR_COURT, FLOOR_STYLE, courtColor, hallFloorMaterial } from './floor';

export const GROUND_GRID = 72;   // cells (1 unit each) around stage.centre
export const POND = { dz: -1, rx: 15, rz: 10 }, CAVE_POND = { dz: -1, rx: 18, rz: 12 };

/** The seabed under open water (water, kyogre) and the pond basins' floor. */
const SEABED_Y = -1.2, BASIN_Y = -0.9;
/** The pond basin's shore: it slopes up to GROUND_Y over its last BASIN_SHORE units. */
const BASIN_SHORE = 2;
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
/** The pond bed's muddy sand (its cells' tint: Sand). */
const POND_BED: RGB = [0.6, 0.56, 0.42];

/** The disc: radius, segments, rings (densest near the stage: ring k at radius DISC_R · (k / DISC_RINGS)^DISC_POW). */
const DISC_R = 64, DISC_SEGMENTS = 96, DISC_RINGS = 48, DISC_POW = 1.35;

/** Per cell rgb = sRGB tint, a = mat << 4 | 8 (the terrain family's layout): groundMat / ground everywhere, tints ±6 % by
 *  noise2; pond kinds: the pond ellipse → Sand (its bed). The field runs on under the platforms (their tops paint
 *  themselves: platforms.ts, uniformCells — platform cells here reached out past the slabs' plinths and, shifted 0.28
 *  towards −z in cell space, past the sand mounds' far side, where the worn ring's tint turned them near white); the worn
 *  ring is the shader's (WORN_RING). (The grid is in the terrain shader's cell space, (x, z − y): the field at GROUND_Y.) */
export function groundCells(kind: ArenaKind, p: ArenaPalette, stage: Stage): { data: Uint8Array; w: number; h: number; min: [number, number] } {
  const w = GROUND_GRID, h = GROUND_GRID;
  const min: [number, number] = [Math.floor(stage.centre.x) - w / 2, Math.floor(stage.centre.z) - h / 2];
  const data = new Uint8Array(w * h * 4);
  const pond = kind === 'pond' ? POND : kind === 'cavePond' ? CAVE_POND : null;
  const bed = mix(POND_BED, p.ground, 0.25);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      // the cell's centre in cell space; on ground at GROUND_Y the world's z is that + GROUND_Y
      const x = min[0] + i + 0.5, z = min[1] + j + 0.5, zg = z + GROUND_Y;
      let mat = p.groundMat, tint = p.ground;
      if (pond && Math.hypot((x - stage.centre.x) / pond.rx, (zg - stage.centre.z - pond.dz) / pond.rz) <= 1) {
        mat = GroundMat.Sand;
        tint = bed;
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

/** Ground height at world (x, z): GROUND_Y within 9 units of the centre; outdoor kinds roll beyond (smoothstep(9, 22, r) ×
 *  (0.9 · noise2(x·0.07, z·0.07) − 0.25), sand ×2); cave/indoor flat; water/kyogre the seabed −1.2; pond/cavePond a basin
 *  (POND / CAVE_POND ellipse around the centre) at −0.9 sloping up to GROUND_Y over its last 2 units. (Underwater's sea
 *  floor rolls as the outdoor field; the pond's shore beyond its basin too; the Sky Pillar's top is flat.) */
export function groundHeight(kind: ArenaKind, x: number, z: number, stage: Stage): number {
  const dx = x - stage.centre.x, dz = z - stage.centre.z;
  if (kind === 'water' || kind === 'kyogre') return SEABED_Y;
  const pond = kind === 'pond' ? POND : kind === 'cavePond' ? CAVE_POND : null;
  if (pond) {
    const e = Math.hypot(dx / pond.rx, (dz - pond.dz) / pond.rz);
    if (e < 1) {
      // (distance to the shore along the ray from the basin's centre: its radius that way less this point's)
      const d = Math.hypot(dx, dz - pond.dz), shore = d / Math.max(e, 1e-6) - d;
      return GROUND_Y + (BASIN_Y - GROUND_Y) * smooth(0, BASIN_SHORE, shore);
    }
    return kind === 'pond' ? GROUND_Y + roll(x, z, Math.hypot(dx, dz), 1) : GROUND_Y;
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

/** The disc's geometry: DISC_RINGS rings of DISC_SEGMENTS vertices around (cx, cz) plus the centre, at groundHeight;
 *  position + normal (smooth). */
export function groundDisc(kind: ArenaKind, stage: Stage): THREE.BufferGeometry {
  const cx = stage.centre.x, cz = stage.centre.z;
  const n = 1 + DISC_RINGS * DISC_SEGMENTS;
  const pos = new Float32Array(n * 3);
  pos.set([cx, groundHeight(kind, cx, cz, stage), cz]);
  let o = 3;
  for (let k = 1; k <= DISC_RINGS; k++) {
    const r = DISC_R * Math.pow(k / DISC_RINGS, DISC_POW);
    for (let s = 0; s < DISC_SEGMENTS; s++) {
      const a = (s / DISC_SEGMENTS) * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      pos[o++] = x; pos[o++] = groundHeight(kind, x, z, stage); pos[o++] = z;
    }
  }
  const idx = new Uint32Array((DISC_SEGMENTS + (DISC_RINGS - 1) * DISC_SEGMENTS * 2) * 3);
  const vi = (k: number, s: number) => 1 + (k - 1) * DISC_SEGMENTS + (s % DISC_SEGMENTS);
  let t = 0;
  // (counter-clockwise seen from above: +y faces up)
  for (let s = 0; s < DISC_SEGMENTS; s++) { idx[t++] = 0; idx[t++] = vi(1, s + 1); idx[t++] = vi(1, s); }
  for (let k = 1; k < DISC_RINGS; k++) {
    for (let s = 0; s < DISC_SEGMENTS; s++) {
      const a = vi(k, s), b = vi(k, s + 1), c = vi(k + 1, s + 1), d = vi(k + 1, s);
      idx[t++] = a; idx[t++] = b; idx[t++] = c;
      idx[t++] = a; idx[t++] = c; idx[t++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

const PN = { position: 3, normal: 3 };
/** The ground draws after every other opaque thing of the battle (the arena's parts at 0, the battlers and cards at 2;
 *  three sorts opaque objects by render order, then material, then depth): the full-screen terrain shading then runs
 *  only where the ground shows — not under the platforms, battlers and props drawn over it (−2.4 ms on b_grass). The
 *  order changes no pixel: nothing it overlaps lies at its depth. */
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
