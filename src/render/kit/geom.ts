// Small deterministic helpers shared by the model generators.

import * as THREE from 'three';
import type { RGB } from './palette';

export type V3 = [number, number, number];

/** Deterministic PRNG (mulberry32): the same seed always gives the same sequence. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit hash of a grid cell (plus salt), for per-cell seeds. */
export function hashCell(x: number, y: number, salt = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x1b873593);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Grid cell (x, y) at height h → world position (the un-projection used everywhere). */
export function toWorld(x: number, y: number, h: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(x, h, y + h);
}

const lattice = (x: number, y: number, z: number) => (hashCell(x, y, z) / 4294967296) * 2 - 1;
const fade = (t: number) => t * t * (3 - 2 * t);

/** Smooth 3D value noise in [-1, 1] (CPU-side vertex displacement). */
export function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
  const l = (dx: number, dy: number, dz: number) => lattice(ix + dx, iy + dy, iz + dz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const x00 = lerp(l(0, 0, 0), l(1, 0, 0), fx), x10 = lerp(l(0, 1, 0), l(1, 1, 0), fx);
  const x01 = lerp(l(0, 0, 1), l(1, 0, 1), fx), x11 = lerp(l(0, 1, 1), l(1, 1, 1), fx);
  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
}

/**
 * Smooth 2D value noise in [-1, 1], `salt` picking an independent field. About 4x cheaper than
 * noise3 (4 lattice hashes, no closures): for generators that sample it per vertex by the thousand.
 */
export function noise2(x: number, y: number, salt = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hashCell(ix, iy, salt), b = hashCell(ix + 1, iy, salt), c = hashCell(ix, iy + 1, salt), d = hashCell(ix + 1, iy + 1, salt);
  const top = a + (b - a) * fx, bot = c + (d - c) * fx;
  return ((top + (bot - top) * fy) / 4294967296) * 2 - 1;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();
const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _m3 = new THREE.Matrix3();

/** Accumulates coloured triangles; build() returns one non-indexed geometry (position, normal, color, uv). */
export class MeshBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private uv: number[] = [];

  get empty(): boolean {
    return this.pos.length === 0;
  }

  private vert(p: V3 | THREE.Vector3, n: V3 | THREE.Vector3, c: RGB, u = 0, v = 0): void {
    if (Array.isArray(p)) this.pos.push(p[0], p[1], p[2]); else this.pos.push(p.x, p.y, p.z);
    if (Array.isArray(n)) this.nor.push(n[0], n[1], n[2]); else this.nor.push(n.x, n.y, n.z);
    this.col.push(c[0], c[1], c[2]);
    this.uv.push(u, v);
  }

  /** Quad a-b-c-d (a=TL, b=TR, c=BR, d=BL of its texture), wound to face `normal`. Colour is linear RGB.
   *  A quad with two coincident corners (a triangle) works too. */
  quad(a: V3, b: V3, c: V3, d: V3, normal: V3, color: RGB): void {
    _a.fromArray(a); _b.fromArray(b); _d.fromArray(d);
    // The diagonals' cross product (c-a)x(d-b) is the quad's area vector, oriented a→b→c→d; unlike
    // an edge pair it survives a zero-length edge. Three.js front faces are CCW.
    _n.subVectors(_p.fromArray(c), _a).cross(_d.sub(_b));
    const flip = _n.dot(_p.fromArray(normal)) < 0;
    const order: [V3, number, number][] = flip
      ? [[a, 0, 1], [c, 1, 0], [b, 1, 1], [a, 0, 1], [d, 0, 0], [c, 1, 0]]
      : [[a, 0, 1], [b, 1, 1], [c, 1, 0], [a, 0, 1], [c, 1, 0], [d, 0, 0]];
    for (const [p, u, v] of order) this.vert(p, normal, color, u, v);
  }

  /** Appends `g` (indexed or not), transformed by `matrix`, tinted by `color` (× its own colours). */
  add(g: THREE.BufferGeometry, color: RGB, matrix?: THREE.Matrix4): void {
    const src = g.index ? g.toNonIndexed() : g;
    const p = src.getAttribute('position');
    const n = src.getAttribute('normal');
    const c = src.getAttribute('color');
    const t = src.getAttribute('uv');
    if (matrix) _m3.getNormalMatrix(matrix);
    for (let i = 0; i < p.count; i++) {
      _p.fromBufferAttribute(p, i);
      _q.fromBufferAttribute(n, i);
      if (matrix) {
        _p.applyMatrix4(matrix);
        _q.applyMatrix3(_m3).normalize();
      }
      const k: RGB = c ? [c.getX(i) * color[0], c.getY(i) * color[1], c.getZ(i) * color[2]] : color;
      this.vert(_p, _q, k, t ? t.getX(i) : 0, t ? t.getY(i) : 0);
    }
    if (src !== g) src.dispose();
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

const grow = (src: Float32Array) => { const t = new Float32Array(src.length * 2); t.set(src); return t; };

/**
 * Flat-coloured quads written straight into growable typed arrays (position, normal, color; no
 * UVs): for meshes of thousands of quads, where MeshBuilder's per-vertex array pushes cost more
 * than the geometry. Same winding rule as MeshBuilder.quad: a-b-c-d is turned to face `n`, decided
 * from the diagonals, so a quad with two coincident corners (a triangle) works too. Colours are
 * linear RGB. The bounding sphere comes from the corners' bounds (no extra pass over the vertices).
 */
export class QuadWriter {
  private pos = new Float32Array(18 * 512);
  private nor = new Float32Array(18 * 512);
  private col = new Float32Array(18 * 512);
  private o = 0;
  private lo = [Infinity, Infinity, Infinity];
  private hi = [-Infinity, -Infinity, -Infinity];

  get empty(): boolean {
    return this.o === 0;
  }

  /** Quad a-b-c-d facing `n` (any length), coloured `rgb` x `k`. */
  quad(a: V3, b: V3, c: V3, d: V3, n: V3, rgb: RGB, k = 1): void {
    if (this.o + 18 > this.pos.length) {
      this.pos = grow(this.pos); this.nor = grow(this.nor); this.col = grow(this.col);
    }
    // (c-a)x(d-b): the quad's area vector, oriented a→b→c→d
    const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2], vx = d[0] - b[0], vy = d[1] - b[1], vz = d[2] - b[2];
    const flip = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] < 0;
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    const nx = n[0] / l, ny = n[1] / l, nz = n[2] / l, r = rgb[0] * k, g = rgb[1] * k, bl = rgb[2] * k;
    for (let o = this.o, e = o + 18; o < e; o += 3) {
      this.nor[o] = nx; this.nor[o + 1] = ny; this.nor[o + 2] = nz;
      this.col[o] = r; this.col[o + 1] = g; this.col[o + 2] = bl;
    }
    if (flip) { this.put(a); this.put(c); this.put(b); this.put(a); this.put(d); this.put(c); }
    else { this.put(a); this.put(b); this.put(c); this.put(a); this.put(c); this.put(d); }
  }

  /** Axis-aligned box [x0,x1] x [y0,y1] x [z0,z1], all six faces. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, rgb: RGB): void {
    this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], rgb);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], rgb);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1], [0, 0, 1], rgb);
    this.quad([x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [0, 0, -1], rgb);
    this.quad([x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0], [-1, 0, 0], rgb);
    this.quad([x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [1, 0, 0], rgb);
  }

  private put(p: V3): void {
    const o = this.o;
    this.pos[o] = p[0]; this.pos[o + 1] = p[1]; this.pos[o + 2] = p[2];
    this.o = o + 3;
    for (let i = 0; i < 3; i++) {
      if (p[i] < this.lo[i]) this.lo[i] = p[i];
      if (p[i] > this.hi[i]) this.hi[i] = p[i];
    }
  }

  /** The geometry written so far (position, normal, color). */
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.o), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.slice(0, this.o), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, this.o), 3));
    const [x0, y0, z0] = this.lo, [x1, y1, z1] = this.hi;
    g.boundingSphere = this.o
      ? new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2)
      : new THREE.Sphere();
    return g;
  }
}
