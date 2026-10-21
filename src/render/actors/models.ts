// Procedural object models (Modern): the Poké Ball, the Strength boulder, the cracked rock, the Cut tree, the
// moving truck and the berry plants (a body per growth stage, flowers and berries), drawn by ObjectModels where
// their sprites stand. Every geometry stands on y = 0, centred on x = z = 0 (a flower or berry: centred on its
// anchor), with position, normal and a 4-component colour: RGB = a shade (× a tint) or a fixed linear colour,
// alpha = a tint code read by the models' material (TINT): 1 fixed colour, 0.5 tint A × shade, 0 tint B × shade.
// The tints are the object's own sprite colours and tones (objectModels.ts). Shapes follow the kit's look:
// noise-displaced icospheres for rocks (props.ts; the boulder a low, softly cut stone, the cracked rock a pile of
// chiselled chunks), a scalloped mushroom cap with a dark under-rim for the Cut tree (the trees' TRUNK convention),
// the kit's bushy foliage under a coat of leaves for the berry bush, darker occluded undersides baked into the
// shade. Cached for the session (`userData.shared`).

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { noise3, rng } from '../kit/geom';
import { blobCrown } from '../kit/trees';
import { SOIL_LINEAR } from '../kit/soil';
import type { RGB } from '../kit/palette';

/** Tint codes (the colour attribute's alpha). */
export const TINT = { fixed: 1, a: 0.5, b: 0 } as const;
type Code = (typeof TINT)[keyof typeof TINT];

/** A vertex's colour RGB (a shade for the tint codes, a linear colour for TINT.fixed): constant or per vertex
 *  (final position, normal, vertex index in the part). */
type Paint = RGB | ((p: THREE.Vector3, n: THREE.Vector3, i: number) => RGB);

const _p = new THREE.Vector3(), _n = new THREE.Vector3();

/** Parts of one model, merged into one non-indexed geometry (position, normal, RGBA colour). */
class Parts {
  private list: THREE.BufferGeometry[] = [];

  /** Adds `g` (taken over and disposed) placed by `m`, with tint `code` and colour `paint`. */
  add(g: THREE.BufferGeometry, code: Code, paint: Paint, m?: THREE.Matrix4): this {
    const p = g.index ? g.toNonIndexed() : g;
    if (p !== g) g.dispose();
    for (const k of Object.keys(p.attributes)) if (k !== 'position' && k !== 'normal') p.deleteAttribute(k);
    p.clearGroups();
    if (m) p.applyMatrix4(m);
    if (!p.getAttribute('normal')) p.computeVertexNormals();
    const pos = p.getAttribute('position'), nor = p.getAttribute('normal');
    const col = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const c = typeof paint === 'function' ? paint(_p.fromBufferAttribute(pos, i), _n.fromBufferAttribute(nor, i), i) : paint;
      col[i * 4] = c[0]; col[i * 4 + 1] = c[1]; col[i * 4 + 2] = c[2]; col[i * 4 + 3] = code;
    }
    p.setAttribute('color', new THREE.BufferAttribute(col, 4));
    this.list.push(p);
    return this;
  }

  /** An axis-aligned box centred at (x, y, z), sized w × h × d. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, code: Code, paint: Paint): this {
    return this.add(new THREE.BoxGeometry(w, h, d), code, paint, new THREE.Matrix4().makeTranslation(x, y, z));
  }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.list)!;
    for (const p of this.list) p.dispose();
    g.computeBoundingSphere();
    g.userData.shared = true;
    return g;
  }
}

const cache = new Map<string, THREE.BufferGeometry>();
function cached(id: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(id);
  if (!g) cache.set(id, (g = make()));
  return g;
}

const smooth = THREE.MathUtils.smoothstep;
const lerp = THREE.MathUtils.lerp;
const k3 = (k: number): RGB => [k, k, k];
const times = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

/** Linear fixed colours. */
const WHITE: RGB = [0.74, 0.74, 0.72];
const BLACK: RGB = [0.022, 0.022, 0.026];

// ---------------------------------------------------------------- Poké Ball

const BALL_R = 0.27;
/** The ball leans back so its button looks up at the camera (and more of its white half shows), as the item
 *  ball sprite draws it. */
const BALL_TILT = 0.38;

/** Radius 0.27 on the ground: the shell (tint A) over the white bottom, a black seam recessed between them, and
 *  the white push button in its black collar facing south (+Z: the default camera), tilted up a little. */
export function pokeBallGeo(): THREE.BufferGeometry {
  return cached('pokeball', () => {
    const r = BALL_R, seam = 0.08; // the seam's half-angle (rad)
    // built about the ball's centre (button on +Z), then leaned back and stood on the ground
    const place = new THREE.Matrix4().makeTranslation(0, r, 0).multiply(new THREE.Matrix4().makeRotationX(-BALL_TILT));
    const unplace = place.clone().invert();
    const q = new THREE.Vector3();
    /** Height in the ball's own frame (−r .. r; the seam at 0). */
    const up = (p: THREE.Vector3) => q.copy(p).applyMatrix4(unplace).y;
    const parts = new Parts();
    // the shell, a little darker into the seam; the bottom darker towards the seam and its ground contact
    parts.add(new THREE.SphereGeometry(r, 32, 9, 0, Math.PI * 2, 0, Math.PI / 2 - seam), TINT.a,
      (p) => k3(lerp(0.8, 1.0, smooth(up(p), 0.03, 0.12))), place);
    parts.add(new THREE.SphereGeometry(r, 32, 9, 0, Math.PI * 2, Math.PI / 2 + seam, Math.PI / 2 - seam), TINT.fixed,
      (p) => times(WHITE, lerp(0.55, 1.0, smooth(p.y, 0.0, 0.2)) * lerp(1.0, 0.85, smooth(up(p), -0.12, -0.03))), place);
    parts.add(new THREE.SphereGeometry(r * 0.955, 32, 2, 0, Math.PI * 2, Math.PI / 2 - seam * 1.6, seam * 3.2), TINT.fixed, BLACK, place);
    // the button: a black collar standing out of the shell, the white button out of the collar
    const front = (rad: number, z0: number, z1: number) => {
      const g = new THREE.CylinderGeometry(rad, rad, z1 - z0, 28);
      g.rotateX(Math.PI / 2); // axis along +Z, top cap facing south
      g.translate(0, 0, (z0 + z1) / 2);
      return g;
    };
    parts.add(front(0.1, 0.2, r + 0.012), TINT.fixed, BLACK, place);
    parts.add(front(0.062, 0.24, r + 0.024), TINT.fixed, (_p, n) => times(WHITE, n.z > 0.8 ? 1.12 : 0.9), place);
    return parts.build();
  });
}

// ---------------------------------------------------------------- rocks

interface RockShape {
  /** Bounding size (x, y, z) after displacement. */
  size: [number, number, number];
  /** Large and fine noise amplitudes (share of the radius). */
  noise: [number, number];
  /** Plane cuts (chiselled faces): how many, and their distances from the centre (unit sphere: lower = deeper). */
  cuts: number;
  cutDepth: [number, number];
  /** Facet look: share of the face normal in the shading normal (0 smooth, 1 flat). */
  facets: number;
  /** Underside flattening: points below this y are pressed towards it. */
  floor: number;
}

/** Shade of a rock vertex: occlusion from dark flanks and underside up to the top (the lit top reads as the gold
 *  plane by contrast) and ±10 % mottling (noise3 over the surface). The lit tops are the material's: tint A (the sprite's body tone) blends towards its highlight tone
 *  on up-facing normals (objectModels.ts). */
function rockShade(p: THREE.Vector3, height: number, seed: number): RGB {
  const t = smooth(p.y / height, 0.0, 0.85);
  const mottle = 1 + 0.1 * noise3(p.x * 6 + (seed % 97), p.y * 6, p.z * 6);
  return k3(lerp(0.4, 1.0, t) * mottle);
}

/**
 * A rock body (non-indexed): a unit icosphere displaced by two noise octaves, optionally chiselled by plane cuts
 * (flat faces on the top and sides), its underside pressed flat, scaled to `shape.size`, standing on y = 0 and
 * centred on x = z = 0, its shading normals the smooth ones blended with each face's (`facets`).
 */
function rockBody(seed: number, shape: RockShape, detail: number): THREE.BufferGeometry {
  const r = rng(seed);
  const o1 = [r() * 50, r() * 50, r() * 50], o2 = [r() * 50, r() * 50, r() * 50];
  const planes: { n: THREE.Vector3; d: number }[] = [];
  for (let j = 0; j < shape.cuts; j++) {
    const a = (j / shape.cuts) * Math.PI * 2 + r() * 0.9, y = -0.15 + r() * 1.0;
    planes.push({ n: new THREE.Vector3(Math.cos(a), y, Math.sin(a)).normalize(), d: lerp(shape.cutDepth[0], shape.cutDepth[1], r()) });
  }
  const ico = new THREE.IcosahedronGeometry(1, detail);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const g = mergeVertices(ico);
  ico.dispose();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    v.multiplyScalar(1 + shape.noise[0] * noise3(v.x * 1.4 + o1[0], v.y * 1.4 + o1[1], v.z * 1.4 + o1[2])
      + shape.noise[1] * noise3(v.x * 3.2 + o2[0], v.y * 3.2 + o2[1], v.z * 3.2 + o2[2]));
    for (const p of planes) {
      const s = v.dot(p.n) - p.d;
      if (s > 0) v.addScaledVector(p.n, -s);
    }
    if (v.y < shape.floor) v.y = shape.floor + (v.y - shape.floor) * 0.2;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const size = bb.getSize(new THREE.Vector3());
  const k = new THREE.Vector3(shape.size[0] / size.x, shape.size[1] / size.y, shape.size[2] / size.z);
  const shift = new THREE.Vector3(-(bb.min.x + bb.max.x) / 2 * k.x, -bb.min.y * k.y, -(bb.min.z + bb.max.z) / 2 * k.z);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).multiply(k).add(shift);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const flat = g.toNonIndexed();
  g.dispose();
  const fp = flat.getAttribute('position'), fn = flat.getAttribute('normal') as THREE.BufferAttribute;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), face = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < fp.count; t += 3) {
    a.fromBufferAttribute(fp, t); b.fromBufferAttribute(fp, t + 1); c.fromBufferAttribute(fp, t + 2);
    face.subVectors(c, b).cross(a.sub(b)).normalize();
    for (let w = t; w < t + 3; w++) {
      n.fromBufferAttribute(fn, w).multiplyScalar(1 - shape.facets).addScaledVector(face, shape.facets).normalize();
      fn.setXYZ(w, n.x, n.y, n.z);
    }
  }
  return flat;
}

/** Where a ray from `centre` along `dir` leaves a (star-shaped) non-indexed geometry, with that face's normal. */
function surfaceHit(g: THREE.BufferGeometry, centre: THREE.Vector3): (dir: THREE.Vector3) => { p: THREE.Vector3; n: THREE.Vector3 } | null {
  const pos = g.getAttribute('position');
  const ray = new THREE.Ray(), at = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  return (dir) => {
    ray.set(centre, dir);
    let best: { p: THREE.Vector3; n: THREE.Vector3 } | null = null, far = -1;
    for (let t = 0; t < pos.count; t += 3) {
      a.fromBufferAttribute(pos, t); b.fromBufferAttribute(pos, t + 1); c.fromBufferAttribute(pos, t + 2);
      if (!ray.intersectTriangle(a, b, c, false, at)) continue;
      const d = at.distanceTo(centre);
      if (d > far) { far = d; best = { p: at.clone(), n: new THREE.Vector3().subVectors(c, b).cross(a.sub(b)).normalize() }; }
    }
    return best;
  };
}

/** A ribbon along the surface: a path from (elev, azim) (rad from the hit centre; azimuth 0 = +Z) sweeping `sweep`
 *  rad round, dropping `drop` rad, waving ±`wave`, `w0` wide tapering to `w1`, `offset` off each face. */
interface Crease { elev: number; azim: number; sweep: number; drop: number; wave: number; w0: number; w1: number; offset: number }

/** Lays a ribbon (tint `code` × `shade`) along the surface (rays from the hit centre every few degrees). */
function crease(parts: Parts, hit: ReturnType<typeof surfaceHit>, c: Crease, code: Code, shade: number): void {
  const pts: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
  const N = 16, d = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const t = i / N, e = c.elev - c.drop * t + c.wave * Math.sin(t * Math.PI * 3), az = c.azim + c.sweep * t;
    const h = hit(d.set(Math.cos(e) * Math.sin(az), Math.sin(e), Math.cos(e) * Math.cos(az)));
    if (h) pts.push(h);
  }
  if (pts.length < 2) return;
  const pos: number[] = [], nor: number[] = [];
  const tan = new THREE.Vector3();
  const edge = (i: number, s: number) => {
    const { p, n } = pts[i];
    tan.subVectors(pts[Math.min(i + 1, pts.length - 1)].p, pts[Math.max(i - 1, 0)].p).normalize();
    const side = tan.clone().cross(n).normalize();
    return { v: p.clone().addScaledVector(n, c.offset).addScaledVector(side, (s * lerp(c.w0, c.w1, i / (pts.length - 1))) / 2), n };
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const q = [edge(i, 1), edge(i, -1), edge(i + 1, -1), edge(i + 1, 1)];
    for (const [x, y, z] of [[0, 1, 2], [0, 2, 3]]) {
      const f = q[y].v.clone().sub(q[x].v).cross(q[z].v.clone().sub(q[x].v));
      for (const e of f.dot(q[x].n) >= 0 ? [q[x], q[y], q[z]] : [q[x], q[z], q[y]]) { pos.push(e.v.x, e.v.y, e.v.z); nor.push(e.n.x, e.n.y, e.n.z); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  parts.add(g, code, k3(shade));
}

/**
 * ≈0.95 wide, 0.48 tall, 0.84 deep: the Strength boulder, a broad, low stone (the sprite's oval; nearly round in
 * plan, as each boulder turns freely) in tint
 * A, softened by three shallow planar cuts so it reads as stone, mottled ±10 %, darker on its flanks so its lit
 * top reads as the sprite's gold plane (objectModels.ts blends it to the highlight tone). Grooves run round
 * its upper shoulder: a groove in the sprite's crevice tone (tint B, lit ×1.8: a shadowed groove, not ink) over a
 * wider mid-tone bevel (tint A × 0.72), as the sprite's light/dark bevelled lines read. Each boulder turns and
 * mirrors by object (objectModels.ts: one geometry, varied per instance).
 */
export function boulderGeo(seed: number): THREE.BufferGeometry {
  return cached(`boulder:${seed}`, () => {
    const H = 0.48;
    const body = rockBody(seed, { size: [0.95, H, 0.84], noise: [0.08, 0.04], cuts: 3, cutDepth: [0.8, 0.9], facets: 0.45, floor: -0.5 }, 2);
    const parts = new Parts().add(body, TINT.a, (p) => rockShade(p, H, seed));
    const hit = surfaceHit(body, new THREE.Vector3(0, H * 0.45, 0));
    const r = rng(seed ^ 0x2545f491);
    // grooves round the upper shoulder, three on one side, two on the other (each boulder turns freely), within
    // 1.0 rad of the ±Z axis (the width margin: the x extremes stay clear)
    for (let k = 0; k < 5; k++) {
      const sweep = 0.8 + r() * 0.15, back = k >= 3 ? Math.PI : 0, row = k % 3;
      const azim = back - 1.0 + row * 0.06 + r() * (2.0 - sweep - 0.12);
      const g = { elev: 0.45 + row * 0.07 + r() * 0.03, azim, sweep, drop: r() * 0.1, wave: 0.02, offset: 0.004 };
      crease(parts, hit, { ...g, w0: 0.1, w1: 0.03 }, TINT.a, 0.72);
      crease(parts, hit, { ...g, w0: 0.045, w1: 0.012, offset: 0.008 }, TINT.b, 1.8);
    }
    return parts.build();
  });
}

/** A mirror image (x → −x) of a non-indexed geometry, its triangles rewound so they still face out (an instance
 *  matrix with a negative scale would turn them inside out: three only checks the object's determinant).
 *  Cached per geometry for the session (`userData.shared`). */
export function mirroredGeo(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let m = mirrors.get(g);
  if (!m) {
    m = g.clone();
    m.scale(-1, 1, 1);
    for (const name of Object.keys(m.attributes)) {
      const a = m.getAttribute(name) as THREE.BufferAttribute, k = a.itemSize, arr = a.array;
      for (let t = 0; t + 2 < a.count; t += 3) {
        for (let c = 0; c < k; c++) {
          const i1 = (t + 1) * k + c, i2 = (t + 2) * k + c, v = arr[i1];
          arr[i1] = arr[i2];
          arr[i2] = v;
        }
      }
    }
    m.computeBoundingSphere();
    m.userData.shared = true;
    mirrors.set(g, m);
  }
  return m;
}
const mirrors = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/** Chunks of the cracked rock: centre x, base y, centre z and size (x, y, z). Three at the base round the core,
 *  one on top; the gaps between them show the dark core. */
const ROCK_CHUNKS: [number, number, number, [number, number, number]][] = [
  [-0.2, 0, 0.14, [0.5, 0.44, 0.52]],
  [0.22, 0, 0.12, [0.46, 0.4, 0.52]],
  [0.0, 0, -0.16, [0.68, 0.44, 0.5]],
  [0.02, 0.18, 0.0, [0.46, 0.42, 0.46]],
];

/**
 * ≈0.9 wide, 0.6 tall: the breakable rock, a pile of four chiselled chunks (softer facets, tint A) split by wide
 * cracks: the gaps between them open onto a dark core in the sprite's crevice tone (tint B), as the sprite's
 * chunks and dark cracks read.
 */
export function crackedRockGeo(seed: number): THREE.BufferGeometry {
  return cached(`crackedRock:${seed}`, () => {
    const H = 0.6;
    const parts = new Parts();
    const core = rockBody(seed + 1, { size: [0.7, 0.48, 0.62], noise: [0.08, 0.03], cuts: 0, cutDepth: [1, 1], facets: 0.4, floor: -0.5 }, 1);
    parts.add(core, TINT.b, (p) => k3(lerp(0.55, 0.85, smooth(p.y, 0, 0.48))));
    ROCK_CHUNKS.forEach(([x, y, z, size], i) => {
      const chunk = rockBody(seed * 7 + i, { size, noise: [0.1, 0.05], cuts: 5, cutDepth: [0.62, 0.8], facets: 0.75, floor: -0.45 }, 2);
      // (pushed 0.03 apart, out from the centre: the core shows as cracks between them)
      const out = Math.hypot(x, z) > 0.05 ? 0.03 / Math.hypot(x, z) : 0;
      chunk.translate(x * (1 + out), y, z * (1 + out));
      parts.add(chunk, TINT.a, (p) => rockShade(p, H, seed + i));
    });
    return parts.build();
  });
}

// ---------------------------------------------------------------- Cut tree

/** The Cut tree: its cap's width and depth (wider than deep, so it reads squat from above), its height above the
 *  underside, the underside's height above the ground, the stump's radius, the rim's scallops; where the dark
 *  under-rim starts (polar angle, past the equator) and where the overhanging rim ends. */
const CUT_TREE = { width: 1.2, depth: 0.76, cap: 0.46, base: 0.46, stump: 0.12, scallops: 7, band: 0.36 * Math.PI, rim: 0.68 * Math.PI };

/**
 * ≈1.2 wide, 0.92 tall, 0.76 deep: the cuttable tree as the GBA draws it, a squat mushroom cap with a dark under-rim (the
 * sprite's dark base band), so it reads apart from the kit's trees and bushes. The cap is a lumpy dome with a
 * scalloped rim overhanging past its equator, light top to a darker shoulder (alpha 1 × the material colour); the
 * under-rim, the underside and a short stump are flagged in the vertex alpha (0.12–0.3: the trees' TRUNK hook,
 * whose colour objectModels.ts sets to the sprite's dark tone).
 */
export function cutTreeGeo(seed: number): THREE.BufferGeometry {
  return cached(`cutTree:${seed}`, () => {
    const r = rng(seed);
    const o = [r() * 40, r() * 40, r() * 40];
    const SHOULDER = 0.55; // the crown's shade where it meets the band
    const dome = new THREE.SphereGeometry(1, 36, 16, 0, Math.PI * 2, 0, CUT_TREE.rim);
    const under = new THREE.CircleGeometry(Math.sin(CUT_TREE.rim), 36);
    under.rotateX(Math.PI / 2); // facing −Y
    under.translate(0, Math.cos(CUT_TREE.rim), 0);
    // colours on the unit cap: the crown's gradient, the dark band (alpha < 0.5) past `band` and underneath
    const paint = (g: THREE.BufferGeometry, underside: boolean) => {
      g.deleteAttribute('uv');
      g.deleteAttribute('normal');
      const p = g.getAttribute('position');
      const col = new Float32Array(p.count * 4);
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        // (the band's RGB is the crown's shoulder shade: TRUNK_FRAG ignores it, but the triangles straddling the
        // band's edge interpolate it into the crown side; white there left a light seam above the band)
        if (underside) col.set([SHOULDER, SHOULDER, SHOULDER, 0.12], i * 4);
        else if (y < Math.cos(CUT_TREE.band) + 1e-4) col.set([SHOULDER, SHOULDER, SHOULDER, 0.3], i * 4);
        else {
          const t = smooth(y, Math.cos(CUT_TREE.band), 1), k = lerp(SHOULDER, 1.12, t);
          col.set([k * lerp(0.9, 1.03, t), k, k * lerp(1.1, 0.95, t), 1], i * 4);
        }
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 4));
      return g;
    };
    const cap = mergeGeometries([paint(dome, false), paint(under, true)])!;
    dome.dispose();
    under.dispose();
    const p = cap.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const az = Math.atan2(v.z, v.x);
      // scalloped rim, lumpy dome
      const k = 1 + 0.05 * Math.sin(az * CUT_TREE.scallops + o[0]) + 0.05 * noise3(v.x * 2 + o[0], v.y * 2 + o[1], v.z * 2 + o[2]);
      p.setXYZ(i, v.x * k, v.y, v.z * k);
    }
    cap.computeBoundingBox();
    const bb = cap.boundingBox!, size = bb.getSize(new THREE.Vector3());
    cap.applyMatrix4(new THREE.Matrix4().makeTranslation(0, CUT_TREE.base, 0)
      .multiply(new THREE.Matrix4().makeScale(CUT_TREE.width / size.x, CUT_TREE.cap / size.y, CUT_TREE.depth / size.z))
      .multiply(new THREE.Matrix4().makeTranslation(0, -bb.min.y, 0)));
    const capIndexed = mergeVertices(cap);
    cap.dispose();
    capIndexed.computeVertexNormals();
    const stump = new THREE.CylinderGeometry(CUT_TREE.stump * 0.85, CUT_TREE.stump, CUT_TREE.base + 0.08, 10, 1, true);
    stump.translate(0, (CUT_TREE.base + 0.08) / 2, 0);
    stump.deleteAttribute('uv');
    const sp = stump.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) if (sp.getY(i) < 0.01) { sp.setX(i, sp.getX(i) * 1.5); sp.setZ(i, sp.getZ(i) * 1.5); } // root flare
    stump.computeVertexNormals();
    const bark = new Float32Array(sp.count * 4);
    for (let i = 0; i < sp.count; i++) bark.set([1, 1, 1, 0.12 + 0.12 * smooth(sp.getY(i), 0, CUT_TREE.base)], i * 4);
    stump.setAttribute('color', new THREE.BufferAttribute(bark, 4));
    const g = mergeGeometries([capIndexed, stump])!;
    capIndexed.dispose();
    stump.dispose();
    g.computeBoundingSphere();
    g.userData.shared = true;
    return g;
  });
}

// ---------------------------------------------------------------- truck

const GLASS: RGB = [0.025, 0.04, 0.065];
const GLASS_SHINE: RGB = [0.2, 0.25, 0.32];
const RUBBER: RGB = [0.03, 0.03, 0.032];
const STEEL: RGB = [0.42, 0.43, 0.45];
const CHASSIS: RGB = [0.045, 0.045, 0.05];
const LAMP: RGB = [0.95, 0.88, 0.62];
const CAB: RGB = [0.76, 0.78, 0.8];

/** Truck size: length (X, cab at −X as the GBA image shows it), cargo box height, depth (Z), cargo floor. */
const TRUCK = { length: 3.0, height: 1.92, depth: 1.6, deck: 0.44 };

/**
 * The moving truck, ≈3.0 (X) × 1.9 (Y) × 1.6 (Z), facing −X as the GBA image does (its cab on the left): a
 * rounded cargo box (tint A: the sprite's navy side) with a ribbed roof (tint B: its blue), a white cab with dark
 * glass and a tint-B trim, black tyres with steel hubs, bumper, lamps and mirrors. The logo on its sides is a
 * second mesh in the sprite's grey-blue (truckLogoGeo).
 */
export function truckGeo(): THREE.BufferGeometry {
  return cached('truck', () => {
    const parts = new Parts();
    const half = TRUCK.length / 2, zd = TRUCK.depth / 2;
    const deck = TRUCK.deck;
    const boxX0 = -0.52, boxX1 = half; // cargo box
    const bx = (boxX0 + boxX1) / 2, bw = boxX1 - boxX0, bh = TRUCK.height - deck;
    const at = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
    // shade: darker towards the deck, lighter at the top
    const body = (y0: number, y1: number) => (p: THREE.Vector3): RGB => k3(lerp(0.82, 1.04, smooth(p.y, y0, y1)));

    // chassis rails under everything
    parts.box(0.02, 0.36, 0, 2.86, 0.16, 1.1, TINT.fixed, CHASSIS);
    // cargo box (tint A), its roof panel and ribs (tint B)
    parts.add(new RoundedBoxGeometry(bw, bh, TRUCK.depth, 2, 0.07), TINT.a, body(deck, TRUCK.height), at(bx, deck + bh / 2, 0));
    parts.box(bx, TRUCK.height + 0.008, 0, bw - 0.14, 0.02, TRUCK.depth - 0.14, TINT.b, k3(0.78));
    for (let k = -2; k <= 2; k++) parts.box(bx, TRUCK.height + 0.025, k * 0.27, bw - 0.18, 0.03, 0.09, TINT.b, k3(1.02));
    // rear doors: a centre seam and two handles
    parts.box(boxX1 + 0.008, deck + bh / 2, 0, 0.016, bh - 0.16, 0.025, TINT.fixed, CHASSIS);
    for (const s of [-1, 1]) parts.box(boxX1 + 0.014, deck + bh * 0.45, s * 0.1, 0.02, 0.22, 0.035, TINT.fixed, STEEL);

    // cab: white, rounded, lower than the box
    const cabX0 = -half + 0.06, cabX1 = boxX0 - 0.05, cabTop = 1.5, cabBase = 0.4, cabD = TRUCK.depth - 0.08;
    const cx = (cabX0 + cabX1) / 2, cw = cabX1 - cabX0;
    parts.add(new RoundedBoxGeometry(cw, cabTop - cabBase, cabD, 3, 0.13), TINT.fixed,
      (p) => times(CAB, lerp(0.8, 1.05, smooth(p.y, cabBase, cabTop))), at(cx, (cabBase + cabTop) / 2, 0));
    // glass: the windscreen across the front, side windows; a pale streak of reflected sky on each
    const winY0 = 1.0, winY1 = 1.38;
    parts.box(cabX0 - 0.004, (winY0 + winY1) / 2, 0, 0.02, winY1 - winY0, cabD - 0.24, TINT.fixed, GLASS);
    parts.box(cabX0 - 0.012, (winY0 + winY1) / 2 + 0.04, -0.18, 0.012, 0.07, 0.42, TINT.fixed, GLASS_SHINE);
    for (const s of [-1, 1]) {
      parts.box(cx - 0.05, (winY0 + winY1) / 2, s * (cabD / 2 + 0.004), cw - 0.36, winY1 - winY0, 0.02, TINT.fixed, GLASS);
      parts.box(cx - 0.1, winY1 - 0.07, s * (cabD / 2 + 0.012), cw - 0.6, 0.05, 0.012, TINT.fixed, GLASS_SHINE);
    }
    // doors: a seam behind each side window, a handle
    for (const s of [-1, 1]) {
      parts.box(cabX1 - 0.1, (0.5 + winY1) / 2, s * (cabD / 2 + 0.012), 0.016, winY1 - 0.5, 0.012, TINT.fixed, times(CAB, 0.45));
      parts.box(cabX1 - 0.22, 0.92, s * (cabD / 2 + 0.012), 0.12, 0.03, 0.02, TINT.fixed, STEEL);
    }
    // cab trim (tint B): a band round the cab's lower half
    const trimY = 0.66, trimH = 0.16;
    parts.box(cabX0 - 0.006, trimY, 0, 0.014, trimH, cabD - 0.18, TINT.b, k3(1.0));
    for (const s of [-1, 1]) parts.box(cx, trimY, s * (cabD / 2 + 0.006), cw - 0.2, trimH, 0.014, TINT.b, k3(1.0));
    // front: bumper, grille between two lamps; side mirrors
    parts.box(-half + 0.04, 0.4, 0, 0.1, 0.16, cabD + 0.04, TINT.fixed, CHASSIS);
    parts.box(cabX0 - 0.006, 0.86, 0, 0.012, 0.12, 0.62, TINT.fixed, CHASSIS);
    for (const s of [-1, 1]) {
      parts.box(cabX0 - 0.008, 0.86, s * 0.5, 0.014, 0.1, 0.16, TINT.fixed, LAMP);
      parts.box(cabX0 + 0.1, 1.24, s * (cabD / 2 + 0.07), 0.05, 0.16, 0.06, TINT.fixed, CHASSIS);
    }

    // wheels: black tyres, steel hubs showing on both faces
    const R = 0.27;
    for (const x of [cx + 0.02, boxX1 - 0.52]) {
      for (const s of [-1, 1]) {
        const tyre = new THREE.CylinderGeometry(R, R, 0.24, 20);
        tyre.rotateX(Math.PI / 2);
        // (sidewalls a little lighter than the tread)
        parts.add(tyre, TINT.fixed, (_p, n) => times(RUBBER, Math.abs(n.z) > 0.5 ? 1.8 : 1.0), at(x, R, s * (zd - 0.14)));
        const hub = new THREE.CylinderGeometry(0.13, 0.13, 0.26, 12);
        hub.rotateX(Math.PI / 2);
        parts.add(hub, TINT.fixed, STEEL, at(x, R, s * (zd - 0.14)));
      }
    }
    return parts.build();
  });
}

/**
 * The moving company's logo on both cargo sides, flat just off them (tint A of its own mesh: the sprite's
 * grey-blue swoosh): a half ring round a half disc rising from near the deck, three speed lines running to the
 * back, as the GBA image draws it; mirrored on the far side.
 */
export function truckLogoGeo(): THREE.BufferGeometry {
  return cached('truckLogo', () => {
    const parts = new Parts();
    const base = TRUCK.deck + 0.12, centre = 0.12, off = TRUCK.depth / 2 + 0.005;
    for (const side of [1, -1]) {
      // (the far side's frame is turned half way round: x mirrored, so its logo sits at the same place on the box)
      const at = (x: number, y: number) => new THREE.Matrix4().makeRotationY(side > 0 ? 0 : Math.PI)
        .multiply(new THREE.Matrix4().makeTranslation(side > 0 ? x : -x, y, off));
      parts.add(new THREE.RingGeometry(0.42, 0.6, 32, 1, 0, Math.PI), TINT.a, k3(1), at(centre, base));
      parts.add(new THREE.CircleGeometry(0.28, 24, 0, Math.PI), TINT.a, k3(1), at(centre, base));
      for (let k = 0; k < 3; k++) {
        const len = 0.56 - k * 0.12;
        parts.add(new THREE.PlaneGeometry(len, 0.075), TINT.a, k3(1), at(centre + 0.68 + len / 2, base + 0.5 - k * 0.16));
      }
    }
    return parts.build();
  });
}

// ---------------------------------------------------------------- berry plants

/** A berry tree's growth stage (objectMap.ts berryStage): planted, sprouted, taller, flowering, berries. */
export type BerryStage = 1 | 2 | 3 | 4 | 5;

/** Fixed colours (linear): the plants' turned soil, the flowers' yellow heart, the berries' green calyx. */
const SOIL: RGB = SOIL_LINEAR;
const POLLEN: RGB = [0.95, 0.62, 0.06];
const CALYX: RGB = [0.045, 0.12, 0.03];

/** Adds `g` (taken over) as a part: vertex k (of the indexed geometry, if it is one) painted shade[k] × the code's
 *  tint, or × `fixed`. Smooth normals must be on `g` already (they are kept). */
function addShaded(parts: Parts, g: THREE.BufferGeometry, shade: ArrayLike<number>, code: Code, fixed?: RGB, m?: THREE.Matrix4): void {
  const index = g.index;
  const s = index ? Array.from(index.array as ArrayLike<number>, (k) => shade[k]) : Array.from(shade);
  const flat = index ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  parts.add(flat, code, (_p, _n, i) => (fixed ? times(fixed, s[i]) : k3(s[i])), m);
}

/** An indexed disc grid facing +Y: a centre vertex and `rings` rings of `segs` vertices, vertex placed by
 *  `at(rho, angle, out)` (rho = ring / rings, 0..1; angle 0..2π from +X towards +Z); smooth normals. */
function polarGrid(rings: number, segs: number, at: (rho: number, a: number, out: THREE.Vector3) => void): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  const v = new THREE.Vector3();
  at(0, 0, v);
  pos.push(v.x, v.y, v.z);
  for (let k = 1; k <= rings; k++) {
    for (let j = 0; j < segs; j++) {
      at(k / rings, (j / segs) * Math.PI * 2, v);
      pos.push(v.x, v.y, v.z);
    }
  }
  const vi = (k: number, j: number) => (k === 0 ? 0 : 1 + (k - 1) * segs + (j % segs));
  for (let j = 0; j < segs; j++) idx.push(0, vi(1, j + 1), vi(1, j));
  for (let k = 1; k < rings; k++) {
    for (let j = 0; j < segs; j++) idx.push(vi(k, j), vi(k, j + 1), vi(k + 1, j + 1), vi(k, j), vi(k + 1, j + 1), vi(k + 1, j));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A tube through `pts`, its radius tapering r0 → r1, `sides` round, closed to a point past the last; smooth normals. */
function tube(pts: THREE.Vector3[], r0: number, r1: number, sides: number): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  const t = new THREE.Vector3(), n = new THREE.Vector3(), b = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0);
  const last = pts.length - 1;
  for (let i = 0; i <= last; i++) {
    t.subVectors(pts[Math.min(i + 1, last)], pts[Math.max(i - 1, 0)]).normalize();
    n.crossVectors(t, X).normalize();
    b.crossVectors(t, n);
    const r = lerp(r0, r1, i / last);
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2, c = Math.cos(a) * r, s = Math.sin(a) * r;
      pos.push(pts[i].x + c * n.x + s * b.x, pts[i].y + c * n.y + s * b.y, pts[i].z + c * n.z + s * b.z);
    }
  }
  const tip = pts[last].clone().addScaledVector(t, r1 * 1.5);
  pos.push(tip.x, tip.y, tip.z);
  for (let i = 0; i < last; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j, b2 = i * sides + ((j + 1) % sides), c = b2 + sides, d = a + sides;
      idx.push(a, b2, c, a, c, d);
    }
  }
  for (let j = 0; j < sides; j++) idx.push(last * sides + j, last * sides + ((j + 1) % sides), (last + 1) * sides);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

interface BladeShape {
  len: number; wid: number;
  /** The margins this × the half-width above the midrib (a V fold; a cupped petal). */
  fold: number;
  /** The tip bent this × len up (< 0: down). */
  bend: number;
  /** 0: a pointed leaf, widest a third of the way out; 1: a rounded petal or cotyledon. */
  round: number;
}

/**
 * A leaf or petal along +Z from the origin (its stalk end), its face up (+Y): `len` long, `wid` wide, folded
 * along its midrib, its tip bent; a thin closed blade (top and underside meet at the margins). Shade per vertex:
 * lighter towards the tip, the midrib a little darker, the underside darker.
 */
function bladeGeo(s: BladeShape, NU = 8, NV = 4): { g: THREE.BufferGeometry; shade: number[] } {
  const pos: number[] = [], idx: number[] = [], shade: number[] = [];
  const pw = lerp(0.75, 0.5, s.round), pe = lerp(0.9, 0.55, s.round);
  const hw = (u: number) => (s.wid / 2) * Math.pow(Math.sin(Math.PI * Math.pow(u, pw)), pe);
  for (const top of [true, false]) {
    const base = pos.length / 3;
    for (let i = 0; i <= NU; i++) {
      const u = i / NU, w = hw(u);
      for (let j = 0; j <= NV; j++) {
        const v = (j / NV) * 2 - 1;
        // (the underside hangs below the midrib, up to 1 % of the length, meeting the top at the margins)
        const under = top ? 0 : 0.012 * s.len * Math.sin(Math.PI * u) * (1 - Math.abs(v)) + 0.0015;
        pos.push(v * w, s.fold * Math.abs(v) * w + s.bend * s.len * u * u - under, u * s.len);
        shade.push(top ? lerp(0.8, 1.06, u) * (j === NV / 2 ? 0.9 : 1) : 0.66);
      }
    }
    for (let i = 0; i < NU; i++) {
      for (let j = 0; j < NV; j++) {
        const a = base + i * (NV + 1) + j, b = a + 1, c = a + NV + 2, d = a + NV + 1;
        if (top) idx.push(a, d, c, a, c, b);
        else idx.push(a, c, d, a, b, c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { g, shade };
}

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _one = new THREE.Vector3(1, 1, 1);
/** Placement of a blade at `p`: turned `az` about the vertical from +Z, its tip raised `elev` rad, rolled `roll`. */
function bladeAt(p: THREE.Vector3, az: number, elev: number, roll = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(p, _q.setFromEuler(_e.set(-elev, az, roll, 'YXZ')), _one);
}

/** Adds a blade (tint A) placed by `m` (`nu` × `nv` quads a side: fewer for the bush's many leaves). */
function addBlade(parts: Parts, s: BladeShape, m: THREE.Matrix4, nu = 8, nv = 4): void {
  const { g, shade } = bladeGeo(s, nu, nv);
  addShaded(parts, g, shade, TINT.a, undefined, m);
}

/**
 * A soil mound `w` wide and `h` tall on y = 0, in fixed soil brown: a lumpy low bump, its foot flaring into the
 * ground (darker there, lighter on top, mottled), with `clods` crumbs round its foot; `dimple`: a freshly planted
 * mound, a seed hole on top, its drier top lighter still (it reads on its bed at night too).
 */
function soilMound(parts: Parts, seed: number, w: number, h: number, clods: number, dimple = false): void {
  const r = rng(seed);
  const o = [r() * 50, r() * 50, r() * 50];
  const g = polarGrid(7, 28, (rho, a, out) => {
    const ca = Math.cos(a), sa = Math.sin(a);
    const rr = (rho * w) / 2 * (1 + 0.1 * noise3(ca * 1.3 + o[0], sa * 1.3 + o[1], o[2]));
    let y = h * Math.pow(1 - rho * rho, 1.6) * (1 + 0.22 * noise3(ca * rho * 3.5 + o[1], sa * rho * 3.5 + o[2], o[0]));
    if (dimple) y -= h * 0.4 * Math.exp(-((rho / 0.2) ** 2));
    out.set(ca * rr, y, sa * rr);
  });
  const pos = g.getAttribute('position');
  const shade = Array.from({ length: pos.count }, (_, i) => {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const hole = dimple ? lerp(0.55, 1, smooth(Math.hypot(x, z), 0.02, 0.07)) : 1;
    return lerp(0.6, dimple ? 1.5 : 1.3, smooth(y / h, 0, 0.85)) * (1 + 0.16 * noise3(x * 16 + o[0], y * 16, z * 16 + o[1])) * hole;
  });
  addShaded(parts, g, shade, TINT.fixed, SOIL);
  for (let k = 0; k < clods; k++) {
    const a = ((k + r() * 0.6) / clods) * Math.PI * 2, d = (w / 2) * lerp(0.82, 1.08, r()), s = lerp(0.018, 0.032, r());
    const c = new THREE.IcosahedronGeometry(1, 0);
    c.deleteAttribute('uv');
    c.applyMatrix4(new THREE.Matrix4().makeScale(s, s * 0.7, s));
    c.translate(Math.cos(a) * d, s * 0.35, Math.sin(a) * d);
    addShaded(parts, c, new Array(c.getAttribute('position').count).fill(lerp(0.7, 1.0, r())), TINT.fixed, SOIL);
  }
}

/** A plant stem (tint A, darker than the leaves) through `pts`. */
function stem(parts: Parts, pts: THREE.Vector3[], r0: number, r1: number): void {
  const g = tube(pts, r0, r1, 7);
  const pos = g.getAttribute('position');
  const top = pts[pts.length - 1].y;
  addShaded(parts, g, Array.from({ length: pos.count }, (_, i) => lerp(0.45, 0.68, smooth(pos.getY(i), 0, top))), TINT.a);
}

/** Points along a gently swaying stem from (0, y0, 0) to height y1 (`sway` × a seeded wiggle sideways). */
function stemPath(seed: number, y0: number, y1: number, sway: number, n = 7): THREE.Vector3[] {
  const r = rng(seed), p = r() * 6, q = r() * 6;
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return new THREE.Vector3(sway * Math.sin(t * 2.6 + p) * t, lerp(y0, y1, t), sway * 0.8 * Math.sin(t * 2.1 + q) * t);
  });
}

/** The mound at a growing plant's foot (stages 2–5; the bed it stands in is the soil's: kit/soil.ts). */
const FOOT = { w: 0.3, h: 0.045 };

/** Stage 2: a sprout, two round seed leaves opening in a V on a short stem (≈0.35 tall). */
function sproutGeo(seed: number): THREE.BufferGeometry {
  const parts = new Parts();
  const r = rng(seed ^ 0x51ed);
  soilMound(parts, seed, FOOT.w, FOOT.h, 2);
  const path = stemPath(seed, 0.01, 0.19, 0.025, 5);
  stem(parts, path, 0.026, 0.019);
  // (the seed leaves open east and west: the plant's turn (objectModels.ts) keeps their V across the view)
  const top = path[path.length - 1], turn = (r() - 0.5) * 0.4;
  for (const side of [-1, 1]) {
    addBlade(parts, { len: 0.21, wid: 0.17, fold: 0.34, bend: 0.3, round: 0.9 },
      bladeAt(top, turn + (side * Math.PI) / 2, 0.36 + 0.08 * r(), side * 0.12));
  }
  return parts.build();
}

/** Stage 3: a young plant, a slender stem with four leaf pairs (crossing, smaller and steeper up the stem) and a
 *  bud of two small leaves (≈0.65 tall). */
function saplingGeo(seed: number): THREE.BufferGeometry {
  const parts = new Parts();
  const r = rng(seed ^ 0x3ab7);
  soilMound(parts, seed + 1, FOOT.w, FOOT.h, 2);
  const y0 = 0.01, y1 = 0.55;
  const path = stemPath(seed, y0, y1, 0.035, 8);
  stem(parts, path, 0.03, 0.013);
  const along = (y: number) => {
    const f = ((y - y0) / (y1 - y0)) * (path.length - 1), i = Math.min(path.length - 2, Math.floor(f));
    return path[i].clone().lerp(path[i + 1], f - i);
  };
  const pairs = [
    { y: 0.13, len: 0.27, wid: 0.15, elev: 0.28 }, { y: 0.25, len: 0.25, wid: 0.14, elev: 0.38 },
    { y: 0.36, len: 0.21, wid: 0.12, elev: 0.5 }, { y: 0.46, len: 0.16, wid: 0.095, elev: 0.66 },
  ];
  const turn = r() * Math.PI;
  pairs.forEach((p, k) => {
    const az = turn + (k * Math.PI) / 2 + (r() - 0.5) * 0.3;
    for (const side of [0, Math.PI]) {
      addBlade(parts, { len: p.len, wid: p.wid, fold: 0.3, bend: -0.14, round: 0.2 }, bladeAt(along(p.y), az + side, p.elev + (r() - 0.5) * 0.12));
    }
  });
  for (const side of [0, Math.PI]) {
    addBlade(parts, { len: 0.1, wid: 0.065, fold: 0.4, bend: 0.1, round: 0.3 }, bladeAt(path[path.length - 1], turn + side + Math.PI / 4, 1.05));
  }
  return parts.build();
}

/** The flowering / fruiting bush (stages 4 and 5): its body and the crown it hangs flowers and berries on. */
interface Bush { body: THREE.BufferGeometry; hit: ReturnType<typeof surfaceHit>; centre: THREE.Vector3 }

/** The bush: its crown's width and depth, underside and top (≈0.9 tall, ≤ 1 wide with its leaves); the leaves
 *  covering it: how many, how long, how deep their stalk ends sit in the crown. */
const BUSH = { width: 0.64, depth: 0.62, base: 0.3, top: 0.86, leaves: 40, leaf: 0.19, sink: 0.05 };

const bushes = new Map<number, Bush>();
/**
 * A small berry bush: a blobCrown (the kit's bushy trees' foliage, tint A shaded as they are: its dark heart
 * shows between the leaves) on three stems splaying from a mound, covered in leaves standing out of it (spread
 * evenly over all but its underside, pointing out and up, drooping at their tips), so it reads as a leafy plant.
 */
function bushOf(seed: number): Bush {
  let b = bushes.get(seed);
  if (b) return b;
  const parts = new Parts();
  const r = rng(seed ^ 0x6c8e);
  soilMound(parts, seed + 2, FOOT.w + 0.04, FOOT.h, 2);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + r() * 0.8;
    stem(parts, [new THREE.Vector3(0, 0.01, 0), new THREE.Vector3(Math.cos(a) * 0.04, 0.2, Math.sin(a) * 0.04),
      new THREE.Vector3(Math.cos(a) * 0.12, BUSH.base + 0.12, Math.sin(a) * 0.1)], 0.032, 0.02);
  }
  const crown = blobCrown(seed, 7, 0.2, 0.15, 0.22, 0, 0.12, 2);
  crown.computeBoundingBox();
  const bb = crown.boundingBox!, size = bb.getSize(new THREE.Vector3());
  crown.applyMatrix4(new THREE.Matrix4().makeTranslation(0, BUSH.base, 0)
    .multiply(new THREE.Matrix4().makeScale(BUSH.width / size.x, (BUSH.top - BUSH.base) / size.y, BUSH.depth / size.z))
    .multiply(new THREE.Matrix4().makeTranslation(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2)));
  const flat = crown.toNonIndexed();
  crown.dispose();
  const col = flat.getAttribute('color');
  const shade: RGB[] = Array.from({ length: col.count }, (_, i) => [col.getX(i), col.getY(i), col.getZ(i)]);
  const surface = flat.clone();
  parts.add(flat, TINT.a, (_p, _n, i) => shade[i]);
  const centre = new THREE.Vector3(0, (BUSH.base + BUSH.top) / 2, 0);
  const hit = surfaceHit(surface, centre);
  // leaves over the crown: directions on a Fibonacci spiral down to 25° below its middle, each leaf's stalk end
  // sunk into the crown, its blade pointing out (raised towards the vertical over the top) and rolled at random
  const d = new THREE.Vector3(), GOLDEN = Math.PI * (3 - Math.sqrt(5)), low = -Math.sin(0.44);
  for (let k = 0; k < BUSH.leaves; k++) {
    const y = 1 - ((k + 0.5) / BUSH.leaves) * (1 - low), ring = Math.sqrt(1 - y * y), az = k * GOLDEN + r() * 0.3;
    const h = hit(d.set(ring * Math.sin(az), y, ring * Math.cos(az)));
    if (!h) continue;
    const out = h.p.clone().sub(centre).normalize();
    const len = BUSH.leaf * lerp(0.85, 1.1, r());
    addBlade(parts, { len, wid: len * 0.62, fold: 0.35, bend: -0.16, round: 0.45 },
      bladeAt(h.p.clone().addScaledVector(out, -BUSH.sink), Math.atan2(out.x, out.z), Math.asin(out.y) * 0.75 + 0.18, (r() - 0.5) * 0.8), 5, 2);
  }
  b = { body: parts.build(), hit, centre };
  bushes.set(seed, b);
  return b;
}

/** A plant's body and the anchor points (plant space) of its flowers or berries, with the surface normals there. */
export interface BerryPlant { body: THREE.BufferGeometry; anchors: THREE.Vector3[]; normals: THREE.Vector3[] }

/** Lifts of the anchors off the crown along its normal, to the leaves' outer layer: a flower lies on the leaves,
 *  a berry (r 0.07) hangs among their tips. */
const ANCHOR_LIFT = { flower: 0.07, berry: 0.075 };

/**
 * 5–7 anchors on the bush's crown, evenly round it (each plant turns by object, so some face the camera
 * whatever its turn): flowers on its upper sides and top, berries round its sides; seeded per (seed, kind).
 */
function anchorsOn(bush: Bush, seed: number, kind: 'flower' | 'berry'): { anchors: THREE.Vector3[]; normals: THREE.Vector3[] } {
  const r = rng(seed * 31 + (kind === 'flower' ? 4 : 5));
  const n = 5 + Math.floor(r() * 3);
  const anchors: THREE.Vector3[] = [], normals: THREE.Vector3[] = [];
  const d = new THREE.Vector3();
  const [e0, e1] = kind === 'flower' ? [0.3, 1.1] : [-0.25, 0.75];
  for (let k = 0; anchors.length < n && k < n * 3; k++) {
    const az = (((anchors.length + 0.2 + 0.6 * r()) / n) * Math.PI * 2), el = lerp(e0, e1, r());
    const h = bush.hit(d.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)));
    if (!h) continue;
    const nrm = h.p.clone().sub(bush.centre).normalize().add(h.n).normalize();
    anchors.push(h.p.clone().addScaledVector(nrm, ANCHOR_LIFT[kind]));
    normals.push(nrm);
  }
  return { anchors, normals };
}

const plants = new Map<string, BerryPlant>();

/**
 * A berry tree at growth stage `stage`, standing on y = 0, ≤ 1.0 wide: 1 a soil mound (≈0.5 wide, 0.12 tall,
 * a seed hole on top), 2 a sprout (≈0.35), 3 a young plant (≈0.65), 4 a small bush (≈0.9) with 5–7 flower anchors
 * on its crown, 5 the same bush with 5–7 berry anchors. Body tint codes: leaves and stems A (the plant's green),
 * soil fixed brown. Cached per (stage, seed) for the session (`userData.shared`).
 */
export function berryPlantGeo(stage: BerryStage, seed: number): BerryPlant {
  const key = `${stage}:${seed}`;
  let p = plants.get(key);
  if (p) return p;
  if (stage >= 4) {
    const bush = bushOf(seed);
    p = { body: bush.body, ...anchorsOn(bush, seed, stage === 4 ? 'flower' : 'berry') };
  } else {
    const body = stage === 1
      ? cached(`berry1:${seed}`, () => { const parts = new Parts(); soilMound(parts, seed, 0.5, 0.13, 5, true); return parts.build(); })
      : stage === 2 ? cached(`berry2:${seed}`, () => sproutGeo(seed)) : cached(`berry3:${seed}`, () => saplingGeo(seed));
    p = { body, anchors: [], normals: [] };
  }
  plants.set(key, p);
  return p;
}

/** A berry, r 0.07 round its centre (the origin; tint A, darker underneath), a green calyx and stalk on top. */
export function berryFruitGeo(): THREE.BufferGeometry {
  return cached('berryFruit', () => {
    const parts = new Parts();
    const R = 0.07;
    const ball = new THREE.SphereGeometry(R, 18, 12);
    ball.deleteAttribute('uv');
    // (a little flattened, a dimple where the calyx sits)
    const pos = ball.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), dip = 0.012 * Math.exp(-((Math.hypot(pos.getX(i), pos.getZ(i)) / 0.025) ** 2)) * (y > 0 ? 1 : 0);
      pos.setY(i, y * 0.93 - dip);
    }
    ball.computeVertexNormals();
    addShaded(parts, ball, Array.from({ length: pos.count }, (_, i) => lerp(0.62, 1.08, smooth(pos.getY(i), -R, R * 0.8))), TINT.a);
    // the calyx: a five-pointed star of sepals over the dimple, and the stalk
    const calyx = polarGrid(2, 10, (rho, a, out) => {
      const rad = rho * (Math.round((a / (Math.PI * 2)) * 10) % 2 === 0 ? 0.034 : 0.014);
      out.set(Math.cos(a) * rad, R * 0.93 - 0.006 + 0.008 * (1 - rho), Math.sin(a) * rad);
    });
    addShaded(parts, calyx, new Array(calyx.getAttribute('position').count).fill(1), TINT.fixed, CALYX);
    const stalk = tube([new THREE.Vector3(0, R * 0.85, 0), new THREE.Vector3(0.004, R + 0.02, 0.002), new THREE.Vector3(0.012, R + 0.038, 0.004)], 0.007, 0.005, 5);
    addShaded(parts, stalk, new Array(stalk.getAttribute('position').count).fill(1.3), TINT.fixed, CALYX);
    return parts.build();
  });
}

/** A flower, r 0.09 round its centre (the origin) facing +Y: five rounded petals (tint A) cupped up, lighter to
 *  their tips, round a yellow heart (fixed). */
export function berryFlowerGeo(): THREE.BufferGeometry {
  return cached('berryFlower', () => {
    const parts = new Parts();
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      addBlade(parts, { len: 0.08, wid: 0.062, fold: 0.18, bend: 0.22, round: 1 },
        bladeAt(new THREE.Vector3(Math.sin(a) * 0.01, 0, Math.cos(a) * 0.01), a, 0.18));
    }
    const heart = new THREE.SphereGeometry(0.024, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    heart.deleteAttribute('uv');
    heart.scale(1, 0.6, 1);
    heart.translate(0, 0.004, 0);
    heart.computeVertexNormals();
    const hp = heart.getAttribute('position');
    addShaded(parts, heart, Array.from({ length: hp.count }, (_, i) => lerp(0.8, 1.1, smooth(hp.getY(i), 0.004, 0.018))), TINT.fixed, POLLEN);
    return parts.build();
  });
}
