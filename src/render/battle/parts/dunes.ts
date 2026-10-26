// The desert's dunes: soft sand mounds round the back and sides of the sand arena, where the treeline stands on the
// grass kinds — the battle camera's top band. Twelve half-ellipsoid mounds on the tall rule, softly rounded, noise on
// their flanks, lighter crests; one draw, the kit's soil material in the sand's colour, casting and receiving shadows,
// moonlit at night as the sand field (the ground's GROUND_NIGHT through the material's colour).

import * as THREE from 'three';
import { noise2, rng } from '../../kit/geom';
import { kitMaterial } from '../../kit/materials';
import { toLinear, type RGB } from '../../kit/palette';
import { SOIL_MATERIAL } from '../../kit/soil';
import type { ArenaPart, CatalogueEntry } from '../modernArena';
import type { Stage } from '../stage';
import { groundHeight, moonlitAsGround } from './ground';
import { SCENERY_SEED, stageKeepOut } from './scatter';

/** A mound: centre, half-extents along its own axes (turned by `yaw`), crest height. */
export interface DuneMound { x: number; z: number; rx: number; rz: number; h: number; yaw: number; seed: number }

/** 12 mounds, rx 6–12, rz 3–6, height 1.2–3.5, their centres r 13–42 from the stage centre within ±arc (radians) of
 *  straight behind it (denser towards behind), turned up to ±yaw. */
const DUNES = { count: 12, rx: [6, 12], rz: [3, 6], h: [1.2, 3.5], r: [13, 42], tries: 30, yaw: 0.5, arc: 1.75 } as const;
/** The profile's power ((1 − e²)^P: a soft round top, its foot easing into the field) and the rim's sink under it. */
const P = 1.5, SINK = 0.12;
/** The mesh: rings × segments per mound. */
const RINGS = 8, SEGMENTS = 32;

/** The mound's height above the field at elliptical radius e (0 at e ≥ 1). */
const profile = (e: number) => (e >= 1 ? 0 : Math.pow(1 - e * e, P));
/** A mound's elliptical radius at (x, z). */
function radiusOf(m: DuneMound, x: number, z: number): number {
  const c = Math.cos(m.yaw), s = Math.sin(m.yaw), dx = x - m.x, dz = z - m.z;
  return Math.hypot((dx * c + dz * s) / m.rx, (-dx * s + dz * c) / m.rz);
}

/** The mounds of a (stage, seed), made once (the dunes, the palms and the rocks all ask). */
const MOUNDS = new WeakMap<Stage, Map<number, readonly DuneMound[]>>();

/** The mounds (deterministic): each tried ≤ 30 times in the annulus, kept where all of it taller than 1 unit stands on
 *  the tall rule. (The same list for the same stage and seed: never change it.) */
export function duneMounds(seed: number, stage: Stage): readonly DuneMound[] {
  let byStage = MOUNDS.get(stage);
  if (!byStage) MOUNDS.set(stage, (byStage = new Map()));
  let list = byStage.get(seed);
  if (!list) byStage.set(seed, (list = makeMounds(seed, stage)));
  return list;
}

function makeMounds(seed: number, stage: Stage): DuneMound[] {
  const r = rng(seed * 6007 + 0xd0e);
  const ko = stageKeepOut(stage);
  const out: DuneMound[] = [];
  const [ra, rb] = DUNES.r;
  for (let i = 0; i < DUNES.count; i++) {
    const rx = DUNES.rx[0] + (DUNES.rx[1] - DUNES.rx[0]) * r(), rz = DUNES.rz[0] + (DUNES.rz[1] - DUNES.rz[0]) * r();
    const h = DUNES.h[0] + (DUNES.h[1] - DUNES.h[0]) * r(), yaw = (r() - 0.5) * 2 * DUNES.yaw;
    // (the part above 1 unit: within e < sqrt(1 − h^(−2/P)))
    const eTall = Math.sqrt(Math.max(0, 1 - Math.pow(h, -2 / P)));
    for (let t = 0; t < DUNES.tries; t++) {
      // (round the back and sides, most of them behind the stage: the camera's top band)
      const rad = Math.sqrt(ra * ra + r() * (rb * rb - ra * ra)), a = (r() - 0.5) * 2 * DUNES.arc * Math.sqrt(r());
      const m: DuneMound = { x: stage.centre.x + Math.sin(a) * rad, z: stage.centre.z - Math.cos(a) * rad, rx, rz, h, yaw, seed: i };
      // (apart from the others: no two crests in one place)
      let ok = ko.tallOk(m.x, m.z) && out.every((o) => Math.hypot(o.x - m.x, o.z - m.z) >= 0.55 * (o.rx + m.rx));
      for (let k = 0; ok && k < 16; k++) {
        const b = (k / 16) * Math.PI * 2, lx = Math.cos(b) * rx * eTall, lz = Math.sin(b) * rz * eTall;
        ok = ko.tallOk(m.x + lx * Math.cos(yaw) - lz * Math.sin(yaw), m.z + lx * Math.sin(yaw) + lz * Math.cos(yaw));
      }
      if (ok) { out.push(m); break; }
    }
  }
  return out;
}

/** The mound's noise: ±10 % of its height on the flanks. */
const bump = (m: DuneMound, x: number, z: number) => 1 + 0.1 * noise2(x * 0.35 + m.seed * 3.7, z * 0.35, 0xd17);

/** Whether (x, z) lies on a mound (inside its footprint × `k`). */
export function onDune(mounds: readonly DuneMound[], x: number, z: number, k = 1): boolean {
  return mounds.some((m) => radiusOf(m, x, z) < k);
}

/** The dunes' surface over the field at (x, z): the tallest mound there (its height above the field), 0 off them. */
export function duneSurface(mounds: readonly DuneMound[], stage: Stage, x: number, z: number): number {
  let best = -Infinity;
  for (const m of mounds) {
    const e = radiusOf(m, x, z);
    if (e < 1) best = Math.max(best, m.h * profile(e) * bump(m, x, z) - SINK);
  }
  return best === -Infinity ? -Infinity : groundHeight('sand', x, z, stage) + best;
}

/** 12 soft mounds (half-ellipsoids rx 6–12, rz 3–6, height 1.2–3.5, noise, lighter crests) on the tall rule, rising from
 *  the sand field (groundHeight), their rims just under it; position, normal, color(3) (linear, from sRGB `color`). */
export function duneGeometry(seed: number, stage: Stage, color: RGB): THREE.BufferGeometry {
  const mounds = duneMounds(seed, stage);
  const base = toLinear(color);
  const per = 1 + RINGS * SEGMENTS;
  const pos = new Float32Array(mounds.length * per * 3), col = new Float32Array(mounds.length * per * 3);
  const idx: number[] = [];
  mounds.forEach((m, mi) => {
    const c = Math.cos(m.yaw), s = Math.sin(m.yaw), o = mi * per;
    const put = (v: number, e: number, a: number) => {
      const lx = Math.cos(a) * m.rx * e, lz = Math.sin(a) * m.rz * e;
      const x = m.x + lx * c - lz * s, z = m.z + lx * s + lz * c;
      const up = profile(e) * bump(m, x, z);
      pos.set([x, groundHeight('sand', x, z, stage) - SINK + m.h * up, z], v * 3);
      // lighter towards the crest, a little sand-coloured mottling
      const k = (0.8 + 0.34 * up) * (1 + 0.04 * noise2(x * 0.8, z * 0.8, 0xd18));
      col.set([base[0] * k, base[1] * k, base[2] * k], v * 3);
    };
    put(o, 0, 0);
    for (let k = 1; k <= RINGS; k++) {
      // (rings denser towards the foot, where the slope turns)
      const e = Math.sqrt(k / RINGS);
      for (let j = 0; j < SEGMENTS; j++) put(o + 1 + (k - 1) * SEGMENTS + j, e, (j / SEGMENTS) * Math.PI * 2);
    }
    const vi = (k: number, j: number) => o + 1 + (k - 1) * SEGMENTS + (j % SEGMENTS);
    // (wound as the platforms' polar tops: facing up)
    for (let j = 0; j < SEGMENTS; j++) idx.push(o, vi(1, j + 1), vi(1, j));
    for (let k = 1; k < RINGS; k++) {
      for (let j = 0; j < SEGMENTS; j++) idx.push(vi(k, j), vi(k, j + 1), vi(k + 1, j + 1), vi(k, j), vi(k + 1, j + 1), vi(k + 1, j));
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

const PNC = { position: 3, normal: 3, color: 3 };

export const DUNES_PART: ArenaPart = {
  name: 'dunes',
  kinds: ['sand'],
  catalogue(): readonly CatalogueEntry[] {
    return [{ material: SOIL_MATERIAL, mesh: 'mesh', attrs: PNC, castShadow: true }];
  },
  build(ctx) {
    const km = kitMaterial(ctx.uniforms, SOIL_MATERIAL);
    const mesh = new THREE.Mesh(duneGeometry(SCENERY_SEED, ctx.stage, ctx.palette.ground), km.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    moonlitAsGround(mesh, km.material, toLinear(ctx.palette.ground), ctx.uniforms.uNight);
    return mesh;
  },
};
