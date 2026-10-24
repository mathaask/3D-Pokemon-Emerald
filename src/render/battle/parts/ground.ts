// The arena ground: one polar disc around the stage, shaded by the kit's terrain material (the overworld's painterly
// grass, path, sand, paving, gravel, rock and deck, kit/terrain.ts) over a grid of synthetic cells — the field, a worn
// ring around the platforms, the platform tops (their top surfaces draw with this very material: parts/platforms.ts) —
// plus soft cloud shadows drifting over outdoor ground and caustics on the sea floor. Flat around the stage, rolling
// beyond it outdoors, a basin under the pond kinds' water, a seabed under open water.

import * as THREE from 'three';
import { noise2 } from '../../kit/geom';
import { kitMaterial, type KitMaterialOptions } from '../../kit/materials';
import { scale, mix, NIGHT_SOIL, type RGB } from '../../kit/palette';
import { terrainMaterial, GroundMat } from '../../kit/terrain';
import { CLOUD_GLSL } from '../clouds.glsl';
import { ARENA_SETTING, type ArenaKind } from '../arenaKind';
import type { ArenaPalette } from '../palette';
import type { ArenaPart, CatalogueEntry } from '../modernArena';
import { GROUND_Y, PLATFORM_FOOTPRINT, type Footprint, type Stage } from '../stage';

export const GROUND_GRID = 72;   // cells (1 unit each) around stage.centre
export const POND = { dz: -1, rx: 15, rz: 10 }, CAVE_POND = { dz: -1, rx: 18, rz: 12 };

/** The seabed under open water (water, kyogre) and the pond basins' floor. */
const SEABED_Y = -1.2, BASIN_Y = -0.9;
/** The pond basin's shore: it slopes up to GROUND_Y over its last BASIN_SHORE units. */
const BASIN_SHORE = 2;
/** Flat within FLAT_R of the stage centre; outdoors the field rolls in fully by ROLL_R. */
const FLAT_R = 9, ROLL_R = 22;
/** The platform tops' cells (× footprint) and the worn ring around them (outdoor kinds; tuned at review from 1.7: the
 *  terrain's warped cell borders made a wider ring blotchy mud patches; sand's ends at its mound's foot). */
const TOP_E = 1.1, RING_E = 1.5, SAND_RING_E = 1.4;
/** The kinds whose platforms float on water (a lily pad, ripple rings: no top to paint, the ground lies under water). */
const FLOATING: ReadonlySet<ArenaKind> = new Set(['water', 'kyogre', 'pond', 'cavePond']);
/** The pond bed's muddy sand (its cells' tint: Sand). */
const POND_BED: RGB = [0.6, 0.56, 0.42];

/** The disc: radius, segments, rings (densest near the stage: ring k at radius DISC_R · (k / DISC_RINGS)^DISC_POW). */
const DISC_R = 64, DISC_SEGMENTS = 96, DISC_RINGS = 48, DISC_POW = 1.35;

const smooth = (e0: number, e1: number, x: number) => THREE.MathUtils.smoothstep(x, e0, e1);
/** Elliptical radius of (dx, dz) in units of a footprint. */
const ell = (dx: number, dz: number, f: Footprint) => Math.hypot(dx / f.rx, dz / f.rz);

/** Per cell rgb = sRGB tint, a = mat << 4 | 8 (the terrain family's layout): platform footprints × 1.1 → platformMat /
 *  platformTop; outdoor kinds a worn ring (1.1..1.5 × footprint, sand 1.4) → pathMat / path; else groundMat / ground; tints ±6 %
 *  by noise2. Pond kinds: the pond ellipse → Sand (its bed). (The grid is in the terrain shader's cell space, (x, z − y):
 *  the platform tops lie at y ≈ 0 where it is the world's (x, z); the ring and the field lie at GROUND_Y.) */
export function groundCells(kind: ArenaKind, p: ArenaPalette, stage: Stage): { data: Uint8Array; w: number; h: number; min: [number, number] } {
  const w = GROUND_GRID, h = GROUND_GRID;
  const min: [number, number] = [Math.floor(stage.centre.x) - w / 2, Math.floor(stage.centre.z) - h / 2];
  const data = new Uint8Array(w * h * 4);
  const outdoor = ARENA_SETTING[kind] === 'outdoor', tops = !FLOATING.has(kind), ringE = kind === 'sand' ? SAND_RING_E : RING_E;
  const pond = kind === 'pond' ? POND : kind === 'cavePond' ? CAVE_POND : null;
  const plats: [THREE.Vector3, Footprint][] = [[stage.player, PLATFORM_FOOTPRINT.player], [stage.enemy, PLATFORM_FOOTPRINT.enemy]];
  const bed = mix(POND_BED, p.ground, 0.25);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      // the cell's centre in cell space; on ground at GROUND_Y the world's z is that + GROUND_Y
      const x = min[0] + i + 0.5, z = min[1] + j + 0.5, zg = z + GROUND_Y;
      let mat = p.groundMat, tint = p.ground;
      let top = Infinity, ring = Infinity;
      for (const [c, f] of plats) {
        top = Math.min(top, ell(x - c.x, z - c.z, f));
        ring = Math.min(ring, ell(x - c.x, zg - c.z, f));
      }
      if (tops && top <= TOP_E) {
        mat = p.platformMat;
        tint = p.platformTop;
      } else if (outdoor && ring <= ringE) {
        mat = p.pathMat;
        tint = p.path;
      } else if (pond && Math.hypot((x - stage.centre.x) / pond.rx, (zg - stage.centre.z - pond.dz) / pond.rz) <= 1) {
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
const GROUND_HEAD = /* glsl */ `
uniform float uClouds;
uniform float uCaustics;
`;
const GROUND_COLOR = /* glsl */ `
if (uClouds > 0.0) {
  diffuseColor.rgb *= 1.0 - uClouds * 0.18 * arenaClouds((vKitWorld.xz + uTime * vec2(0.6, 0.25)) / 40.0);
}
if (uCaustics > 0.0) {
  vec2 cp = vec2(vKitWorld.x, vKitWorld.z - vKitWorld.y) * 1.7;
  float c1 = kitVoronoi(cp + vec2(uTime * 0.12, uTime * 0.07)).x;
  float c2 = kitVoronoi(cp * 1.3 - vec2(uTime * 0.09, -uTime * 0.11) + 3.1).x;
  float caus = (1.0 - smoothstep(0.0, 0.1, c1)) * 0.6 + (1.0 - smoothstep(0.0, 0.08, c2)) * 0.4;
  diffuseColor.rgb *= mix(1.0, 0.92 + 0.3 * caus, uCaustics);
}
if (uNight > 0.0) {
  // moonlit earth (the kit's NIGHT_SOIL): warm ground — worn paths, sand, gravel; not grass — turns a light neutral after
  // sunset (under the night's blue light it reflected next to nothing: near-black patches)
  vec3 gc = diffuseColor.rgb;
  float warm = smoothstep(0.0, 0.08, gc.r - gc.b) * (1.0 - smoothstep(0.0, 0.08, gc.g - gc.r));
  diffuseColor.rgb = mix(gc, vec3(dot(gc, vec3(0.2126, 0.7152, 0.0722)) * ${NIGHT_SOIL.lift.toFixed(2)}), uNight * ${NIGHT_SOIL.mix.toFixed(2)} * warm);
}
`;

/** terrainMaterial + cloud shadows (uClouds) and seabed caustics (uCaustics), both build-time values; hookKey 'arenaGround'. */
export function arenaGroundMaterial(tex: THREE.Texture, min: THREE.Vector2, size: THREE.Vector2, clouds: number, caustics: number): KitMaterialOptions {
  const t = terrainMaterial(tex, min, size);
  return {
    ...t,
    uniforms: { ...t.uniforms, uClouds: { value: clouds }, uCaustics: { value: caustics } },
    fragHead: (t.fragHead ?? '') + CLOUD_GLSL + GROUND_HEAD,
    fragColor: (t.fragColor ?? '') + GROUND_COLOR,
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

/** The arena ground's material for a build: its cells (default the context's ground) and look from the context. (The
 *  platform tops draw with it too, over cells of their own: platforms.ts.) */
export function arenaGround(ctx: { uniforms: Parameters<typeof kitMaterial>[0]; ground: { tex: THREE.Texture; min: THREE.Vector2; size: THREE.Vector2 };
  look: { clouds: number; caustics: number } }, cells = ctx.ground): THREE.Material {
  return kitMaterial(ctx.uniforms, arenaGroundMaterial(cells.tex, cells.min, cells.size, ctx.look.clouds, ctx.look.caustics)).material;
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
    return [{ material: arenaGroundMaterial(ph(), new THREE.Vector2(), new THREE.Vector2(), 0, 0), mesh: 'mesh', attrs: PN, castShadow: false }];
  },
  build(ctx) {
    const mesh = new THREE.Mesh(groundDisc(ctx.kind, ctx.stage), arenaGround(ctx));
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.renderOrder = GROUND_RENDER_ORDER;
    return mesh;
  },
};
