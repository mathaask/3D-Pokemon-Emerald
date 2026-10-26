// Boulders: small clusters of faceted rocks on the outdoor arenas' fields — a few round the back of the grass kinds,
// mossy ones on the plain, sandstone on the desert. Each is a noise-displaced icosphere with a flat bottom, lighter on
// top; a cluster merges a large one with smaller ones at its feet. All in one draw, the kit's cliff material (faceted),
// casting and receiving shadows.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noise3, rng } from '../../kit/geom';
import { kitMaterial } from '../../kit/materials';
import { mix, toLinear, type RGB } from '../../kit/palette';
import { CLIFF_MATERIAL } from '../../kit/cliffs';
import type { ArenaKind } from '../arenaKind';
import type { ArenaPart, CatalogueEntry } from '../modernArena';
import type { Stage } from '../stage';
import { groundHeight, moonlitAsGround } from './ground';
import { SCENERY_SEED, scatter, stageKeepOut } from './scatter';
import { duneMounds, duneSurface } from './dunes';
import { arenaClear, treePlacements } from './flora';

/** A boulder's shape: its width `size`, height × SQUASH, displaced ±DISPLACE by noise3; the bottom flat at y = 0. */
const SQUASH = 0.78, DISPLACE = 0.25;

/** One boulder: an icosphere (detail 1) of width `size` displaced ±25 % by noise3, its bottom cut flat at y = 0, flat
 *  normals (one per face), lighter on top (`color` sRGB; `moss`: tops turning that green). position, normal, color(3)
 *  (linear). */
export function boulderGeometry(seed: number, size: number, color: RGB, moss?: RGB): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(size / 2, 1);
  ico.deleteAttribute('uv');
  ico.deleteAttribute('normal');
  const p = ico.getAttribute('position') as THREE.BufferAttribute;
  const o = (seed % 997) * 1.37, k = 2.2 / size;
  const v = new THREE.Vector3();
  // (shared corners have one position: they move together, the faces stay closed)
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = noise3(v.x * k + o, v.y * k + o * 0.7, v.z * k - o);
    v.multiplyScalar(1 + DISPLACE * n);
    v.y = Math.max(0, v.y * SQUASH + size * 0.18);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  ico.computeVertexNormals();
  ico.computeBoundingBox();
  const top = Math.max(1e-3, ico.boundingBox!.max.y);
  const base = toLinear(color), green = moss ? toLinear(moss) : null;
  const nor = ico.getAttribute('normal');
  const col = new Float32Array(p.count * 3);
  const r = rng(seed * 31 + 7);
  for (let f = 0; f < p.count; f += 3) {
    // one shade per face: lighter up the boulder and on faces turned up, a little jitter
    const y = (p.getY(f) + p.getY(f + 1) + p.getY(f + 2)) / 3 / top, ny = nor.getY(f);
    const shade = (0.78 + 0.3 * y + 0.12 * Math.max(0, ny)) * (0.93 + 0.14 * r());
    const c = green && ny > 0.45 ? mix(base, green, THREE.MathUtils.smoothstep(ny, 0.45, 0.8) * 0.85) : base;
    for (let j = 0; j < 3; j++) col.set([c[0] * shade, c[1] * shade, c[2] * shade], (f + j) * 3);
  }
  ico.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ico;
}

/** A cluster: a boulder of width `size` (the first seed's) with a smaller one at its feet for each further seed (0.35–0.6
 *  of its size, around it); merged into one geometry. */
export function rockCluster(seeds: readonly number[], size: number, color: RGB, moss?: RGB): THREE.BufferGeometry {
  const parts = seeds.map((seed, i) => {
    if (i === 0) return boulderGeometry(seed, size, color, moss);
    const r = rng(seed);
    const s = size * (0.35 + 0.25 * r()), a = r() * Math.PI * 2, d = size * (0.45 + 0.2 * r()) + s * 0.3;
    return boulderGeometry(seed, s, color, moss).translate(Math.cos(a) * d, 0, Math.sin(a) * d);
  });
  const g = mergeGeometries(parts)!;
  for (const x of parts) x.dispose();
  return g;
}

/** A kind's rocks: clusters, annulus, sizes, mossy tops. */
interface RockRule { count: number; r: [number, number]; size: [number, number]; moss: boolean }
const ROCKS: Partial<Record<ArenaKind, RockRule>> = {
  grass: { count: 4, r: [8, 20], size: [0.7, 1.5], moss: false },
  longGrass: { count: 3, r: [8, 20], size: [0.7, 1.5], moss: false },
  plain: { count: 5, r: [9, 20], size: [0.8, 1.7], moss: true },
  sand: { count: 9, r: [7, 24], size: [0.8, 2.2], moss: false },
};
/** A rock of this width or more is tall (scatter.ts's tall rule). */
const TALL_SIZE = 1.1;
/** Rocks keep this far from the trees, and this far to the side (x) of the ground behind each battler. */
const ROCK_TREE_GAP = 2.5, BEHIND_HALF = 3.5;

export interface ArenaRock { x: number; z: number; size: number; seeds: number[] }

/** plain 5 mossy (r 9–20), sand 9 desert rocks, grass 4, longGrass 3: small ones off the platforms and the strip in front
 *  of the player's (arenaClear), tall ones (width ≥ 1.1) on the tall rule; deterministic. */
export function rockPlacements(kind: ArenaKind, stage: Stage, seed: number): ArenaRock[] {
  const rule = ROCKS[kind];
  if (!rule) return [];
  const r = rng(seed * 4099 + 0x70c);
  const sizes = Array.from({ length: rule.count }, () => rule.size[0] + (rule.size[1] - rule.size[0]) * r());
  const ko = stageKeepOut(stage), clear = arenaClear(stage);
  // (off the trees' feet: a palm grows out of no boulder)
  const trees = treePlacements(kind, stage, seed);
  // (and out from behind the battlers: the ground the camera frames over a battler's head stays clear for its silhouette)
  const behind = (p: { x: number; z: number }, x: number, z: number) => z < p.z && Math.abs(x - p.x) < BEHIND_HALF;
  const free = (x: number, z: number) => trees.every((t) => Math.hypot(t.x - x, t.z - z) >= ROCK_TREE_GAP)
    && !behind(stage.player, x, z) && !behind(stage.enemy, x, z);
  const big = sizes.filter((s) => s >= TALL_SIZE), small = sizes.filter((s) => s < TALL_SIZE);
  const at = (n: number, salt: number, accept: (x: number, z: number) => boolean) =>
    scatter(seed * 4099 + salt, { centre: stage.centre, r0: rule.r[0], r1: rule.r[1], count: n, minGap: 3, accept });
  const pts = [...at(big.length, 0xb16, (x, z) => ko.tallOk(x, z) && free(x, z)).map((p, i) => ({ ...p, size: big[i] })),
    ...at(small.length, 0x5a1, (x, z) => clear(x, z) && free(x, z)).map((p, i) => ({ ...p, size: small[i] }))];
  return pts.map((p) => {
    const n = 1 + Math.floor(r() * 3);
    return { x: p.x, z: p.z, size: p.size, seeds: Array.from({ length: n }, () => Math.floor(r() * 1e6)) };
  });
}

const PNC = { position: 3, normal: 3, color: 3 };

export const ROCKS_PART: ArenaPart = {
  name: 'rocks',
  kinds: ['grass', 'longGrass', 'plain', 'sand'],
  catalogue(): readonly CatalogueEntry[] {
    return [{ material: CLIFF_MATERIAL, mesh: 'mesh', attrs: PNC, castShadow: true }];
  },
  build(ctx) {
    const rocks = rockPlacements(ctx.kind, ctx.stage, SCENERY_SEED);
    if (!rocks.length) return null;
    const rule = ROCKS[ctx.kind]!;
    // (moss a light leaf green: between the leaves' and the blades')
    const moss = rule.moss ? mix(ctx.palette.leaf, ctx.palette.blade, 0.5) : undefined;
    const dunes = ctx.kind === 'sand' ? duneMounds(SCENERY_SEED, ctx.stage) : null;
    const parts = rocks.map((k) => {
      const ground = groundHeight(ctx.kind, k.x, k.z, ctx.stage);
      const y = dunes ? Math.max(ground, duneSurface(dunes, ctx.stage, k.x, k.z)) : ground;
      return rockCluster(k.seeds, k.size, ctx.palette.rock, moss).translate(k.x, y - 0.06 * k.size, k.z);
    });
    const g = mergeGeometries(parts)!;
    for (const x of parts) x.dispose();
    g.computeBoundingSphere();
    const material = kitMaterial(ctx.uniforms, CLIFF_MATERIAL).material;
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // (warm stone moonlit at night as the field around it)
    moonlitAsGround(mesh, material, toLinear(ctx.palette.rock), ctx.uniforms.uNight);
    return mesh;
  },
};
