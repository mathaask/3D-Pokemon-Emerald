// Procedural object models (Modern): the Poké Ball, the Strength boulder, the cracked rock, the Cut tree and the
// moving truck, drawn by ObjectModels where their sprites stand. Every geometry stands on y = 0, centred on
// x = z = 0, with position, normal and a 4-component colour: RGB = a shade (× a tint) or a fixed linear colour,
// alpha = a tint code read by the models' material (TINT): 1 fixed colour, 0.5 tint A × shade, 0 tint B × shade.
// The tints are the object's own sprite colours and tones (objectModels.ts). Shapes follow the kit's look:
// noise-displaced icospheres for rocks (props.ts; the boulder a low, softly cut stone, the cracked rock a pile of
// chiselled chunks), a scalloped mushroom cap with a dark under-rim for the Cut tree (the trees' TRUNK convention),
// darker occluded undersides baked into the shade. Cached for the session (`userData.shared`).

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { noise3, rng } from '../kit/geom';
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

/** Shade of a rock vertex: occlusion from a dark underside up to the top and ±10 % mottling (noise3 over the
 *  surface). The lit tops are the material's: tint A (the sprite's body tone) blends towards its highlight tone
 *  on up-facing normals (objectModels.ts). */
function rockShade(p: THREE.Vector3, height: number, seed: number): RGB {
  const t = smooth(p.y / height, 0.0, 0.85);
  const mottle = 1 + 0.1 * noise3(p.x * 6 + (seed % 97), p.y * 6, p.z * 6);
  return k3(lerp(0.55, 1.0, t) * mottle);
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

/**
 * A crease (tint B × `shade`: the sprite's crevice tone) laid along the surface: a wavy path from (elev, azim)
 * (rad; azimuth 0 = +Z) sweeping `sweep` rad round and dropping `drop` rad, sampled by rays every few degrees,
 * just off each face, `w0` wide tapering to `w1`.
 */
function crease(parts: Parts, hit: ReturnType<typeof surfaceHit>, elev: number, azim: number, sweep: number, drop: number,
  wave: number, w0: number, w1: number, shade = 1): void {
  const pts: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
  const N = 16, d = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const t = i / N, e = elev - drop * t + wave * Math.sin(t * Math.PI * 3), az = azim + sweep * t;
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
    return { v: p.clone().addScaledVector(n, 0.006).addScaledVector(side, (s * lerp(w0, w1, i / (pts.length - 1))) / 2), n };
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
  parts.add(g, TINT.b, k3(shade));
}

/**
 * ≈0.98 wide, 0.52 tall, 0.66 deep: the Strength boulder, a broad, low stone (the sprite's 16 × 13 px oval: its
 * long side faces the camera, objectModels.ts turns it at most ±0.4 rad) in tint A, softened by three
 * shallow planar cuts so it reads as stone, mottled ±10 %, with three bold creases in the sprite's crevice tone
 * (tint B) round its upper sides, as its dark lines read. Its tops blend to the sprite's gold highlight
 * (objectModels.ts).
 */
export function boulderGeo(seed: number): THREE.BufferGeometry {
  return cached(`boulder:${seed}`, () => {
    const H = 0.52;
    const body = rockBody(seed, { size: [0.98, H, 0.66], noise: [0.08, 0.04], cuts: 3, cutDepth: [0.8, 0.9], facets: 0.45, floor: -0.5 }, 2);
    const parts = new Parts().add(body, TINT.a, (p) => rockShade(p, H, seed));
    const hit = surfaceHit(body, new THREE.Vector3(0, H * 0.45, 0));
    const r = rng(seed ^ 0x2545f491);
    // (on the top and the side the camera sees: the boulder turns at most ±0.4 rad)
    for (let k = 0; k < 3; k++) {
      crease(parts, hit, 0.85 + r() * 0.3, (k - 1) * 0.9 + (r() - 0.5) * 0.3 - 0.25, 0.5 + r() * 0.2, 0.2 + r() * 0.1, 0.07, 0.08, 0.03);
    }
    return parts.build();
  });
}

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
        if (underside) col.set([1, 1, 1, 0.12], i * 4);
        else if (y < Math.cos(CUT_TREE.band) + 1e-4) col.set([1, 1, 1, 0.3], i * 4);
        else {
          const t = smooth(y, Math.cos(CUT_TREE.band), 1), k = lerp(0.55, 1.12, t);
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
