// The horizon's hills: two bands of rolling hills round the back and sides of the outdoor arenas (a near ring and a far
// one), in the palette's darkened leaf green (sand and mountain: their ground), crests lighter. The battle camera never
// frames the sky (D1): at its top edge it sees the near ring's slopes rise behind the treeline, the fog carrying them
// into the haze; the far ring shows when the camera stands higher (the intro sweep, zoomed out). One draw, the kit's
// soil material, no shadows; the bare kinds' hills moonlit at night as their field (moonlitAsGround).

import * as THREE from 'three';
import { noise2 } from '../../kit/geom';
import { kitMaterial } from '../../kit/materials';
import { scale, toLinear, type RGB } from '../../kit/palette';
import { SOIL_MATERIAL } from '../../kit/soil';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ArenaPart, CatalogueEntry } from '../modernArena';
import { GROUND_Y, type Stage } from '../stage';
import { groundHeight, moonlitAsGround } from './ground';

export interface RidgeOptions {
  /** The crest's radius from the stage centre. */
  r: number;
  /** The crest's height range above the ground (GROUND_Y). */
  height: [number, number];
  /** The band spans angles ±arc (radians) from straight behind the stage (−z). */
  arc: number;
  /** sRGB. */
  color: RGB;
  /** The ground's height under the band (default GROUND_Y everywhere): the hills rise from it. */
  ground?: (x: number, z: number) => number;
}

/** The band's resolution: steps along the arc, and the cross-section (foot → front slope → crest → back). */
const RIDGE = { segments: 120 };
/** The cross-section's rows: (radial offset × the crest's height, height × the crest's height) — a foot under the ground
 *  in front, an eased front slope, a rounded crest, the back falling away — and each row's shade (crest lighter). */
const PROFILE: [number, number, number][] = [
  [-1.6, -0.35, 0.78], [-1.1, 0.25, 0.84], [-0.6, 0.72, 0.93], [-0.25, 0.95, 1.02], [0, 1, 1.08], [0.35, 0.9, 1.04],
  [1.0, 0.45, 0.95], [1.8, -0.2, 0.9],
];

/** A band of rolling hills around the back and sides — angles ±`arc` from straight behind — its crest's height from
 *  noise2 (broad swells, smaller rises on them), crest lighter; position, normal, color(3) (linear). */
export function ridgeGeometry(seed: number, stage: Stage, o: RidgeOptions): THREE.BufferGeometry {
  const cols = RIDGE.segments + 1, rows = PROFILE.length;
  const pos = new Float32Array(cols * rows * 3), col = new Float32Array(cols * rows * 3);
  const base = toLinear(o.color);
  const [h0, h1] = o.height;
  for (let s = 0; s < cols; s++) {
    const a = -o.arc + (2 * o.arc * s) / RIDGE.segments;
    // (the crest: two octaves of noise along the arc, measured in world units so both rings roll alike)
    const u = a * o.r;
    const n = 0.5 + 0.35 * noise2(u * 0.045, seed * 3.1, 0x41d) + 0.15 * noise2(u * 0.13, seed * 1.7, 0x41e);
    const h = h0 + (h1 - h0) * THREE.MathUtils.clamp(n, 0, 1);
    const dx = Math.sin(a), dz = -Math.cos(a);
    // (the band's ends fall to the ground: no cut-off edge in a wide shot)
    const end = 1 - THREE.MathUtils.smoothstep(Math.abs(a), o.arc * 0.85, o.arc);
    for (let k = 0; k < rows; k++) {
      const [dr, dy, shade] = PROFILE[k];
      const rr = o.r + dr * h, x = stage.centre.x + dx * rr, z = stage.centre.z + dz * rr;
      const y = (o.ground ? o.ground(x, z) : GROUND_Y) + dy * h * (dy > 0 ? end : 1);
      const i = (k * cols + s) * 3;
      pos[i] = x; pos[i + 1] = y; pos[i + 2] = z;
      // (a little variation along the band: lighter on the swells)
      const v = shade * (0.94 + 0.12 * n);
      col[i] = base[0] * v; col[i + 1] = base[1] * v; col[i + 2] = base[2] * v;
    }
  }
  const idx: number[] = [];
  for (let k = 0; k + 1 < rows; k++) {
    for (let s = 0; s + 1 < cols; s++) {
      const a = k * cols + s, b = a + 1, c = a + cols + 1, d = a + cols;
      // (row k is nearer the stage than row k + 1, s → s + 1 runs towards +x behind the stage: a → b → c faces up and
      // towards the stage)
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** The rings: near r 34 (height 2–5), far r 44 (height 4–9); the near one darker than the leaf × NEAR, the far × FAR
 *  (the fog lifts them). */
const NEAR = { r: 34, height: [2, 5] as [number, number], arc: THREE.MathUtils.degToRad(105), shade: 0.72 };
const FAR = { r: 44, height: [4, 9] as [number, number], arc: THREE.MathUtils.degToRad(115), shade: 0.62 };
const PNC = { position: 3, normal: 3, color: 3 };

export const HORIZON_PART: ArenaPart = {
  name: 'horizon',
  kinds: ['grass', 'longGrass', 'plain', 'sand', 'pond', 'mountain'],
  catalogue(): readonly CatalogueEntry[] {
    return [{ material: SOIL_MATERIAL, mesh: 'mesh', attrs: PNC, castShadow: false }];
  },
  build(ctx) {
    const p = ctx.palette;
    // (forested hills in the leaf's green; the desert's and the mountain's in their ground's colour)
    const bare = ctx.kind === 'sand' || ctx.kind === 'mountain';
    const color = bare ? p.ground : p.leaf;
    const ground = (x: number, z: number) => groundHeight(ctx.kind, x, z, ctx.stage);
    const near = ridgeGeometry(1, ctx.stage, { ...NEAR, color: scale(color, bare ? 0.92 : NEAR.shade), ground });
    const far = ridgeGeometry(2, ctx.stage, { ...FAR, color: scale(color, bare ? 0.85 : FAR.shade), ground });
    const g = mergeGeometries([near, far])!;
    near.dispose();
    far.dispose();
    g.computeBoundingSphere();
    const material = kitMaterial(ctx.uniforms, SOIL_MATERIAL).material;
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // (the bare kinds' hills, in their ground's warm colour, moonlit at night as their field; leafy hills stay as the trees)
    moonlitAsGround(mesh, material, toLinear(color), ctx.uniforms.uNight);
    return mesh;
  },
};
