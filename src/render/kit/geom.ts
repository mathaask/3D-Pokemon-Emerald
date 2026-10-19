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

  /** Quad a-b-c-d (a=TL, b=TR, c=BR, d=BL of its texture), wound to face `normal`. Colour is linear RGB. */
  quad(a: V3, b: V3, c: V3, d: V3, normal: V3, color: RGB): void {
    _a.fromArray(a); _b.fromArray(b); _d.fromArray(d);
    _n.subVectors(_b, _a).cross(_d.sub(_a));
    const flip = _n.dot(_p.fromArray(normal)) < 0;
    // (b-a)x(d-a) is the normal of triangles (a,b,c) and (a,c,d); three.js front faces are CCW.
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
