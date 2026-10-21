// Procedural object models (Modern): the Poké Ball, the Strength boulder, the cracked rock, the Cut tree and the
// moving truck, drawn by ObjectModels where their sprites stand. Every geometry stands on y = 0, centred on
// x = z = 0, with position, normal and a 4-component colour: RGB = a shade (× a tint) or a fixed linear colour,
// alpha = a tint code read by the models' material (TINT): 1 fixed colour, 0.5 tint A × shade, 0 tint B × shade.
// The tints are the object's own sprite colours (objectModels.ts). Shapes follow the kit's look: rounded,
// soft-faceted noise-displaced icospheres for rocks (props.ts), the trees' blob crowns for the Cut tree, light
// tops and darker, occluded undersides baked into the shade. Cached for the session (`userData.shared`).

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { hashCell, noise3, rng } from '../kit/geom';
import { smallTreeGeo } from '../kit/trees';
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
  /** Plane cuts (the chiselled faces): how many, and their distances from the centre (unit sphere: lower = deeper). */
  cuts: number;
  cutDepth: [number, number];
  /** Facet look: share of the face normal in the shading normal (0 smooth, 1 flat). */
  facets: number;
  /** Underside flattening: points below this y are pressed towards it. */
  floor: number;
}

/** Shade of a rock vertex: a dark, occluded underside to a light top, upward faces lit like the sprites' highlight,
 *  a little variation per facet. */
function rockShade(y: number, height: number, ny: number, face: number, seed: number): RGB {
  const t = smooth(y / height, 0.0, 0.9), up = smooth(ny, 0.3, 0.95);
  const jitter = 0.92 + 0.16 * (hashCell(face, seed, 31) / 4294967296);
  const k = lerp(0.45, 1.0, t) * lerp(0.85, 1.75, up) * jitter;
  // (the kit's warm lights and cool shadows, as the trees' crowns)
  const w = t * up;
  return [k * lerp(0.94, 1.05, w), k * lerp(0.98, 1.0, w), k * lerp(1.08, 0.86, w)];
}

interface SurfaceHit { p: THREE.Vector3; n: THREE.Vector3 }

/**
 * A rock body (non-indexed): a unit icosphere displaced by two noise octaves, chiselled by plane cuts (big flat
 * faces), its underside pressed flat, scaled to `shape.size`, standing on y = 0 and centred on x = z = 0, with
 * soft facets (the face normal blended with the smooth one). `hit(dir)` casts a ray from the body's centre:
 * where it leaves the surface, and that facet's normal (the cracks are laid on it).
 */
function rockBody(seed: number, shape: RockShape, detail: number) {
  const r = rng(seed);
  const o1 = [r() * 50, r() * 50, r() * 50], o2 = [r() * 50, r() * 50, r() * 50];
  const planes: { n: THREE.Vector3; d: number }[] = [];
  for (let j = 0; j < shape.cuts; j++) {
    // cuts on the top and the sides (the camera's view), none underneath
    const a = (j / shape.cuts) * Math.PI * 2 + r() * 0.9, y = -0.15 + r() * 1.0;
    const n = new THREE.Vector3(Math.cos(a), y, Math.sin(a)).normalize();
    planes.push({ n, d: lerp(shape.cutDepth[0], shape.cutDepth[1], r()) });
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
  // soft facets: each triangle's own normal blended with the smooth vertex normals
  const fp = flat.getAttribute('position'), fn = flat.getAttribute('normal') as THREE.BufferAttribute;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), face = new THREE.Vector3(), n = new THREE.Vector3();
  const faces: THREE.Vector3[] = [];
  for (let t = 0; t < fp.count; t += 3) {
    a.fromBufferAttribute(fp, t); b.fromBufferAttribute(fp, t + 1); c.fromBufferAttribute(fp, t + 2);
    face.subVectors(c, b).cross(a.sub(b)).normalize();
    faces.push(face.clone());
    for (let w = t; w < t + 3; w++) {
      n.fromBufferAttribute(fn, w).multiplyScalar(1 - shape.facets).addScaledVector(face, shape.facets).normalize();
      fn.setXYZ(w, n.x, n.y, n.z);
    }
  }
  const centre = new THREE.Vector3(0, shape.size[1] * 0.42, 0);
  const ray = new THREE.Ray();
  const hitAt = new THREE.Vector3();
  /** Where a ray from the centre along `dir` leaves the surface, with that facet's normal (null: none). */
  const hit = (dir: THREE.Vector3): SurfaceHit | null => {
    ray.set(centre, dir);
    let best: SurfaceHit | null = null, bestT = -1;
    for (let t = 0; t < fp.count; t += 3) {
      a.fromBufferAttribute(fp, t); b.fromBufferAttribute(fp, t + 1); c.fromBufferAttribute(fp, t + 2);
      if (!ray.intersectTriangle(a, b, c, false, hitAt)) continue;
      const along = hitAt.distanceTo(centre);
      if (along > bestT) { bestT = along; best = { p: hitAt.clone(), n: faces[t / 3].clone() }; }
    }
    return best;
  };
  return { geometry: flat, hit, height: shape.size[1] };
}

/** ≈0.9 wide, 0.8 tall: a round, softly faceted boulder in tint A with a few shallow creases (tint A × 0.62) round
 *  its sides, like the wavy lines of the sprite. */
export function boulderGeo(seed: number): THREE.BufferGeometry {
  return cached(`boulder:${seed}`, () => {
    const body = rockBody(seed, { size: [0.94, 0.74, 0.86], noise: [0.16, 0.05], cuts: 3, cutDepth: [0.78, 0.88], facets: 0.95, floor: -0.55 }, 1);
    const parts = new Parts().add(body.geometry, TINT.a, (p, n, i) => rockShade(p.y, body.height, n.y, Math.floor(i / 3), seed));
    const r = rng(seed ^ 0x2545f491);
    for (let k = 0; k < 4; k++) {
      const pts = crackPoints(body.hit, r, 0.75 + r() * 0.35, (k / 4) * Math.PI * 2 + r() * 0.8, 2, 0.3, 0.3);
      crackRibbon(parts, pts, 0.04, 0.012, 0.5);
    }
    return parts.build();
  });
}

/**
 * Surface points along a crack: a jagged path through `steps` + 1 control directions from (elev, azim) (rad;
 * azimuth 0 = +Z, the camera's side), dropping by about `drop` and swinging ±`swing` per step, each segment
 * sampled by SUB rays (the points follow the facets closely).
 */
function crackPoints(hit: (d: THREE.Vector3) => SurfaceHit | null, r: () => number,
  elev: number, azim: number, steps: number, drop: number, swing: number): SurfaceHit[] {
  const SUB = 5;
  const dirs: THREE.Vector3[] = [];
  let side = r() < 0.5 ? -1 : 1;
  for (let i = 0; i <= steps; i++) {
    dirs.push(new THREE.Vector3(Math.cos(elev) * Math.sin(azim), Math.sin(elev), Math.cos(elev) * Math.cos(azim)));
    elev -= drop * (0.7 + 0.6 * r());
    azim += side * swing * (0.5 + r());
    side = -side;
  }
  const out: SurfaceHit[] = [];
  const d = new THREE.Vector3();
  for (let i = 0; i + 1 < dirs.length; i++) {
    for (let s = 0; s < SUB || (i + 2 === dirs.length && s === SUB); s++) {
      const h = hit(d.lerpVectors(dirs[i], dirs[i + 1], s / SUB).normalize());
      if (h) out.push(h);
    }
  }
  return out;
}

/** A dark ribbon (tint A × `shade`) laid along the surface points `pts`, just off each facet, `w0` wide tapering
 *  to `w1`. */
function crackRibbon(parts: Parts, pts: SurfaceHit[], w0: number, w1: number, shade = 0.45): void {
  if (pts.length < 2) return;
  const pos: number[] = [], nor: number[] = [];
  const t = new THREE.Vector3();
  const edge = (i: number, s: number) => {
    const { p, n } = pts[i];
    t.subVectors(pts[Math.min(i + 1, pts.length - 1)].p, pts[Math.max(i - 1, 0)].p).normalize();
    const side = t.clone().cross(n).normalize();
    const w = lerp(w0, w1, i / (pts.length - 1)) / 2;
    return { v: p.clone().addScaledVector(n, 0.006).addScaledVector(side, s * w), n };
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = edge(i, 1), b = edge(i, -1), c = edge(i + 1, -1), d = edge(i + 1, 1);
    // two triangles, wound to face outwards
    const tri = (p: typeof a, q: typeof a, s: typeof a) => {
      const f = q.v.clone().sub(p.v).cross(s.v.clone().sub(p.v));
      const list = f.dot(p.n) >= 0 ? [p, q, s] : [p, s, q];
      for (const e of list) { pos.push(e.v.x, e.v.y, e.v.z); nor.push(e.n.x, e.n.y, e.n.z); }
    };
    tri(a, b, c);
    tri(a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  parts.add(g, TINT.a, k3(shade));
}

/** ≈0.9 wide, 0.6 tall: a flatter, more angular rock in tint A, split by three dark crack grooves (tint A × 0.45)
 *  running down from its top over the side the camera sees. */
export function crackedRockGeo(seed: number): THREE.BufferGeometry {
  return cached(`crackedRock:${seed}`, () => {
    const body = rockBody(seed, { size: [0.9, 0.6, 0.82], noise: [0.14, 0.05], cuts: 8, cutDepth: [0.58, 0.76], facets: 0.95, floor: -0.4 }, 2);
    const parts = new Parts().add(body.geometry, TINT.a, (p, n, i) => rockShade(p.y, body.height, n.y, Math.floor(i / 3), seed));
    const r = rng(seed ^ 0x5bd1e995);
    // a long crack from the crown down the south face, a second one towards the east, a branch off the first
    const main = crackPoints(body.hit, r, 1.3, -0.2 + r() * 0.2, 5, 0.26, 0.2);
    const second = crackPoints(body.hit, r, 1.15, 0.85 + r() * 0.3, 4, 0.26, 0.2);
    crackRibbon(parts, main, 0.06, 0.016);
    crackRibbon(parts, second, 0.05, 0.014);
    const fork = main[Math.floor(main.length * 0.35)]?.p.clone().sub(new THREE.Vector3(0, body.height * 0.42, 0)).normalize();
    if (fork) crackRibbon(parts, crackPoints(body.hit, r, Math.asin(fork.y) - 0.04, Math.atan2(fork.x, fork.z) - 0.1, 3, 0.18, 0.22), 0.035, 0.01);
    return parts.build();
  });
}

// ---------------------------------------------------------------- Cut tree

/** ≈1.1 tall: the kit's small tree (trees.ts: crown alpha 1 × the material colour, trunk alpha 0.1–0.4 = bark). */
export function cutTreeGeo(seed: number): THREE.BufferGeometry {
  return smallTreeGeo(seed);
}

// ---------------------------------------------------------------- truck

const GLASS: RGB = [0.025, 0.04, 0.065];
const GLASS_SHINE: RGB = [0.2, 0.25, 0.32];
const RUBBER: RGB = [0.03, 0.03, 0.032];
const STEEL: RGB = [0.42, 0.43, 0.45];
const CHASSIS: RGB = [0.045, 0.045, 0.05];
const LAMP: RGB = [0.95, 0.88, 0.62];
const CAB: RGB = [0.76, 0.78, 0.8];

/** Truck size: length (X, cab at −X as the GBA image shows it), cargo box height, depth (Z). */
const TRUCK = { length: 3.0, height: 1.92, depth: 1.6 };

/**
 * The moving truck, ≈3.0 (X) × 1.9 (Y) × 1.6 (Z), facing −X as the GBA image does (its cab on the left): a
 * rounded cargo box (tint A) with a ribbed roof and a side stripe (tint B), a white cab with dark glass and a
 * tint-B trim, black tyres with steel hubs, bumper, lamps and mirrors.
 */
export function truckGeo(): THREE.BufferGeometry {
  return cached('truck', () => {
    const parts = new Parts();
    const half = TRUCK.length / 2, zd = TRUCK.depth / 2;
    const deck = 0.44; // cargo floor
    const boxX0 = -0.52, boxX1 = half; // cargo box
    const bx = (boxX0 + boxX1) / 2, bw = boxX1 - boxX0, bh = TRUCK.height - deck;
    const at = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
    // shade: darker towards the deck, lighter at the top
    const body = (y0: number, y1: number) => (p: THREE.Vector3): RGB => k3(lerp(0.82, 1.04, smooth(p.y, y0, y1)));

    // chassis rails under everything
    parts.box(0.02, 0.36, 0, 2.86, 0.16, 1.1, TINT.fixed, CHASSIS);
    // cargo box (tint A), its roof panel and ribs (tint B), a stripe along both sides and the back (tint B)
    parts.add(new RoundedBoxGeometry(bw, bh, TRUCK.depth, 2, 0.07), TINT.a, body(deck, TRUCK.height), at(bx, deck + bh / 2, 0));
    parts.box(bx, TRUCK.height + 0.008, 0, bw - 0.14, 0.02, TRUCK.depth - 0.14, TINT.b, k3(0.78));
    for (let k = -2; k <= 2; k++) parts.box(bx, TRUCK.height + 0.025, k * 0.27, bw - 0.18, 0.03, 0.09, TINT.b, k3(1.02));
    const stripeY = deck + bh * 0.42, stripeH = 0.2;
    for (const s of [-1, 1]) parts.box(bx, stripeY, s * (zd + 0.006), bw - 0.12, stripeH, 0.012, TINT.b, k3(1.0));
    parts.box(boxX1 + 0.006, stripeY, 0, 0.012, stripeH, TRUCK.depth - 0.12, TINT.b, k3(1.0));
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
