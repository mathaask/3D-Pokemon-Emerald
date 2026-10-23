// Tall grass: instanced clumps of curved, tapered blades on every tall, long and ash-covered grass
// cell. They sway with the wind and part around characters, hiding their legs (KIT_BEND; this
// replaces the GBA's grass overlay sprite, which OverworldView hides on the cells the blades stand
// on: CLAIM_BLADES). Blades take the
// tile's blade colour, dark at the root and light at the tip, and are lit like the ground on both
// faces (their normals lean up); the terrain under them takes the same colour (terrain.ts).
//
// One InstancedMesh per 16-cell map chunk (one clump variant each; cells are turned and mirrored),
// so the camera culls far patches. Grass receives shadows but casts none.

import * as THREE from 'three';
import { MB } from '../../game/behaviors';
import { K } from '../overworld/analyze';
import { CLAIM_BLADES, CLAIM_OBJECT, CLAIM_TOP, type Claims } from '../overworld/claims';
import { bgr555ToSrgb, dominantColor, luma, lush, soften, toLinear, type RGB } from './palette';
import { hashCell, noise2, rng } from './geom';
import { applyKitMaterial, kitMaterial, type KitMaterialOptions } from './materials';
import type { Quality } from '../post';
import type { Family, KitContext, SemanticContext } from './semantics';

export interface GrassCell { x: number; y: number; h: number; long: boolean; tint: RGB }
export const BLADES: Record<Quality, number> = { low: 8, medium: 24, high: 48 };

/** Grass behaviours → long grass (Route 119's, taller). Ash grass (Route 113) is tall grass under ash. */
export const GRASS_BEHAVIORS: ReadonlyMap<number, boolean> = new Map([
  [MB.TALL_GRASS, false], [MB.ASHGRASS, false], [MB.LONG_GRASS, true], [MB.LONG_GRASS_SOUTH_EDGE, true],
]);

/** Height of long grass relative to tall grass. */
export const LONG_SCALE = 1.5;
/** Map chunk (cells) per instanced mesh: the unit of view culling. */
const CHUNK = 16;
const VARIANTS = 3;
const FALLBACK: RGB = [0.3, 0.62, 0.42];

/**
 * Blade colour of a grass tile: its most frequent mid-tone colour. The GBA draws blades in a mid
 * green over the lighter bare ground, with dark outlines and light tips (ash grass: grey-beige).
 */
export function bladeColor(px: Uint16Array, m: number): RGB {
  const counts = new Map<number, number>();
  for (let p = 0; p < 256; p++) {
    const v = px[m * 256 + p];
    if (v & 0x8000) continue;
    const l = luma(bgr555ToSrgb(v));
    if (l >= 0.3 && l <= 0.62) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best = -1, bestN = 0;
  for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
  const c = best >= 0 ? bgr555ToSrgb(best) : dominantColor(px, [m], (q) => luma(q) >= 0.3) ?? FALLBACK;
  // greens get the foliage grade (as tree leaves); ash stays grey
  return c[1] > c[0] ? lush(soften(c), 0.42) : soften(c);
}

const clumps = new Map<number, THREE.BufferGeometry>();

/**
 * One cell's worth of blades (roots on a jittered grid over x/z in [-0.5, 0.5], tall-grass heights
 * 0.48..0.7), cached per density and variant (never disposed). Each blade: 3 rings + a tip (5
 * triangles, indexed). Grey vertex colours (root 0.6 → tip 1.15, per-blade lightness, some warmer
 * blades) are tinted per instance.
 */
export function clump(blades: number, variant: number): THREE.BufferGeometry {
  const id = blades * 16 + variant;
  let g = clumps.get(id);
  if (g) return g;
  const r = rng(77 + variant * 13);
  const RINGS = [0, 0.4, 0.75];
  const nv = blades * 7;
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
  const index = new Uint16Array(blades * 15);
  let v = 0, o = 0;
  const put = (x: number, y: number, z: number, nx: number, ny: number, nz: number, k: number, warm: number) => {
    pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
    nor[v * 3] = nx; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = nz;
    col[v * 3] = k * (1 + 0.06 * warm); col[v * 3 + 1] = k; col[v * 3 + 2] = k * (1 - 0.2 * warm);
    v++;
  };
  // Roots on a jittered k x k grid (shuffled slots): even cover with no bare holes.
  const k2 = Math.ceil(Math.sqrt(blades));
  const slots = Array.from({ length: k2 * k2 }, (_, i) => i);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  for (let b = 0; b < blades; b++) {
    const slot = slots[b];
    const x = ((slot % k2) + r()) / k2 - 0.5, z = (Math.floor(slot / k2) + r()) / k2 - 0.5;
    const h = 0.48 + r() * 0.22;
    const w = 0.05 + r() * 0.035; // half-width at the root
    const yaw = r() * Math.PI * 2;
    const lean = 0.12 + r() * 0.24;
    const dx = Math.cos(yaw), dz = Math.sin(yaw); // across the blade
    const lx = -dz, lz = dx;                       // the blade leans along its face normal
    // lit like the ground: mostly up, a little towards the blade's face
    const nl = Math.hypot(lx * 0.4, 1, lz * 0.4);
    const nx = (lx * 0.4) / nl, ny = 1 / nl, nz = (lz * 0.4) / nl;
    const shade = 0.85 + r() * 0.3;
    const warm = r() < 0.3 ? 1 : 0;
    const k = (t: number) => (0.6 + 0.55 * t) * shade;
    const first = v;
    for (const t of RINGS) {
      const cx = x + lx * lean * t * t, cy = h * t, cz = z + lz * lean * t * t, wt = w * (1 - t * 0.8);
      put(cx - dx * wt, cy, cz - dz * wt, nx, ny, nz, k(t), warm);
      put(cx + dx * wt, cy, cz + dz * wt, nx, ny, nz, k(t), warm);
    }
    put(x + lx * lean, h, z + lz * lean, nx, ny, nz, k(1), warm);
    for (let s = 0; s < 2; s++) {
      const a = first + s * 2;
      index.set([a, a + 1, a + 3, a, a + 3, a + 2], o);
      o += 6;
    }
    index.set([first + 4, first + 5, first + 6], o);
    o += 3;
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  g.userData.shared = true;
  clumps.set(id, g);
  return g;
}

/** Both faces of a blade are lit with its (up-leaning) normal: undoes the double-sided flip. */
const BOTH_FACES = /* glsl */ `
normal = normalize(vNormal);
`;

/** The grass blades' material: its only definition (the program catalogue, kit/catalogue.ts, precompiles it). */
export const GRASS_MATERIAL: KitMaterialOptions = {
  vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, wind: 0.08, windHeight: 0.6, bend: true,
  fragNormal: BOTH_FACES, hookKey: 'grass',
};

export const grassFamily: Family<GrassCell[]> = {
  name: 'grass',

  extract({ a }: SemanticContext, claims: Claims): GrassCell[] {
    // (a Dive map's seabed has no grass: its kelp is drawn by the legacy art)
    if (a.opts.indoor || a.opts.underground || a.opts.underwater) return [];
    const out: GrassCell[] = [];
    const tints = new Map<number, RGB>();
    for (let i = 0; i < a.N; i++) {
      if (a.kind[i] !== K.Floor || claims.has(i, CLAIM_OBJECT)) continue;
      const long = GRASS_BEHAVIORS.get(a.beh[i]);
      if (long === undefined) continue;
      const m = a.mt[i];
      let tint = tints.get(m);
      if (!tint) {
        tint = bladeColor(a.info.both, m);
        tints.set(m, tint);
      }
      out.push({ x: a.cellX(i), y: a.cellY(i), h: Math.max(0, a.height[i]), long, tint });
      // the 3D blades replace the drawn grass tips, and the overlay sprite hiding the legs
      claims.claim(i, CLAIM_TOP | CLAIM_BLADES);
    }
    return out;
  },

  build(cells: GrassCell[], _ctx: SemanticContext, kit: KitContext): THREE.Object3D | null {
    if (!cells.length) return null;
    const km = kitMaterial(kit.uniforms, GRASS_MATERIAL);
    const blades = BLADES[kit.quality];
    /** Map chunk of a cell (numeric key: x and y chunk, 4096 apart). */
    const chunks = new Map<number, GrassCell[]>();
    for (const c of cells) {
      const key = (Math.floor(c.y / CHUNK) + 2048) * 4096 + Math.floor(c.x / CHUNK) + 2048;
      const list = chunks.get(key);
      if (list) list.push(c); else chunks.set(key, [c]);
    }
    const root = new THREE.Group();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    const linear = new Map<RGB, RGB>(); // tints are shared by the cells of a metatile
    for (const [key, list] of chunks) {
      const variant = hashCell(key % 4096, Math.floor(key / 4096), 5) % VARIANTS;
      const mesh = new THREE.InstancedMesh(clump(blades, variant), km.material, list.length);
      applyKitMaterial(mesh, km);
      list.forEach((c, i) => {
        // a quarter turn and a mirror per cell, a little height jitter
        const hc = hashCell(c.x, c.y, 9);
        q.setFromAxisAngle(up, (hc & 3) * (Math.PI / 2));
        const k = (0.92 + (((hc >>> 2) & 255) / 255) * 0.16) * (c.long ? LONG_SCALE : 1);
        m.compose(p.set(c.x + 0.5, c.h, c.y + c.h + 0.5), q, s.set(hc & 1024 ? -1 : 1, k, 1));
        mesh.setMatrixAt(i, m);
        let lin = linear.get(c.tint);
        if (!lin) { lin = toLinear(c.tint); linear.set(c.tint, lin); }
        // broad lighter and darker patches across the field
        const v = 0.9 + 0.1 * noise2(c.x * 0.3, c.y * 0.3, 7);
        mesh.setColorAt(i, col.setRGB(lin[0] * v, lin[1] * v, lin[2] * v));
      });
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      root.add(mesh);
    }
    return root;
  },
};
