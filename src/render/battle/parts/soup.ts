// The indoor and special arenas' geometry writer (the halls: rooms.ts, the stadiums: stadium.ts, the Sky Pillar:
// skyPillar.ts) and the shapes they share: a lathe round a vertical axis, a tube along a path; sRGB → linear colours.

import * as THREE from 'three';
import { toLinear, type RGB } from '../../kit/palette';
import type { V3 } from '../../kit/geom';

/** A colour (sRGB, clamped to 0..1) made linear (toLinear: kit/palette.ts). */
export const lin = (c: RGB): RGB => toLinear([Math.min(1, Math.max(0, c[0])), Math.min(1, Math.max(0, c[1])), Math.min(1, Math.max(0, c[2]))]);

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Triangles (non-indexed) with a normal and a colour per vertex: position, normal, color(3), all Float32 (colours
 *  linear). Quads are wound to face along the direction given (as kit/geom.ts QuadWriter: from the diagonals). */
export class Soup {
  private p: number[] = [];
  private n: number[] = [];
  private c: number[] = [];

  private v(p: V3, n: V3, c: RGB): void {
    this.p.push(p[0], p[1], p[2]);
    this.n.push(n[0], n[1], n[2]);
    this.c.push(c[0], c[1], c[2]);
  }

  /** Triangle a→b→c (wound to face along `face`), corner normals `ns` and colours `cs`. */
  triN(a: V3, b: V3, c: V3, face: V3, ns: [V3, V3, V3], cs: [RGB, RGB, RGB]): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const flip = (uy * vz - uz * vy) * face[0] + (uz * vx - ux * vz) * face[1] + (ux * vy - uy * vx) * face[2] < 0;
    if (flip) { this.v(a, ns[0], cs[0]); this.v(c, ns[2], cs[2]); this.v(b, ns[1], cs[1]); }
    else { this.v(a, ns[0], cs[0]); this.v(b, ns[1], cs[1]); this.v(c, ns[2], cs[2]); }
  }

  /** A flat triangle: one normal (`n`, normalised here), one colour. */
  tri(a: V3, b: V3, c: V3, n: V3, col: RGB): void {
    const l = Math.hypot(n[0], n[1], n[2]) || 1, nn: V3 = [n[0] / l, n[1] / l, n[2] / l];
    this.triN(a, b, c, nn, [nn, nn, nn], [col, col, col]);
  }

  /** Quad a→b→c→d (round its edge), corner normals `ns` and colours `cs`, wound to face along `face`. */
  quadN(a: V3, b: V3, c: V3, d: V3, face: V3, ns: [V3, V3, V3, V3], cs: [RGB, RGB, RGB, RGB]): void {
    const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2], vx = d[0] - b[0], vy = d[1] - b[1], vz = d[2] - b[2];
    const flip = (uy * vz - uz * vy) * face[0] + (uz * vx - ux * vz) * face[1] + (ux * vy - uy * vx) * face[2] < 0;
    const P = [a, b, c, d];
    const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
    for (const i of order) this.v(P[i], ns[i], cs[i]);
  }

  /** A flat quad: one normal (`n`, normalised here), one colour. */
  quad(a: V3, b: V3, c: V3, d: V3, n: V3, col: RGB): void {
    const l = Math.hypot(n[0], n[1], n[2]) || 1, nn: V3 = [n[0] / l, n[1] / l, n[2] / l];
    this.quadN(a, b, c, d, nn, [nn, nn, nn, nn], [col, col, col, col]);
  }

  /** A box spanned by `o` + u·[u0, u1] + y·[y0, y1] + w·[w0, w1] (u, w unit, horizontal, u × y = w or −w: either way),
   *  every face outwards; `bottom` false leaves out its underside (on the floor, never seen). */
  box(o: V3, u: V3, w: V3, u0: number, u1: number, y0: number, y1: number, w0: number, w1: number, col: RGB, bottom = false): void {
    const at = (s: number, h: number, d: number): V3 => [o[0] + u[0] * s + w[0] * d, o[1] + h, o[2] + u[2] * s + w[2] * d];
    const neg = (x: V3): V3 => [-x[0], -x[1], -x[2]];
    this.quad(at(u0, y1, w0), at(u1, y1, w0), at(u1, y1, w1), at(u0, y1, w1), [0, 1, 0], col);
    if (bottom) this.quad(at(u0, y0, w0), at(u1, y0, w0), at(u1, y0, w1), at(u0, y0, w1), [0, -1, 0], col);
    this.quad(at(u0, y0, w1), at(u1, y0, w1), at(u1, y1, w1), at(u0, y1, w1), w, col);
    this.quad(at(u0, y0, w0), at(u1, y0, w0), at(u1, y1, w0), at(u0, y1, w0), neg(w), col);
    this.quad(at(u0, y0, w0), at(u0, y0, w1), at(u0, y1, w1), at(u0, y1, w0), neg(u), col);
    this.quad(at(u1, y0, w0), at(u1, y0, w1), at(u1, y1, w1), at(u1, y1, w0), u, col);
  }

  get empty(): boolean {
    return this.p.length === 0;
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.n), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** A lathe step's colour: one colour, or its start's and its end's (a gradient along the step). */
export type LatheColor = RGB | readonly [RGB, RGB];
const isPair = (c: LatheColor): c is readonly [RGB, RGB] => typeof c[0] !== 'number';

/** A lathe round the vertical axis through `at`: the profile (r, y over at's y) walked up its outer faces, inward over its
 *  tops and down its inner ones (so its faces point out of the solid), `sides` round, smooth round and crisp along the
 *  profile; `cols` (linear) one per step (k → k + 1: a colour, or a pair — its start's and its end's) or one per profile
 *  point (a gradient). */
export function lathe(s: Soup, at: V3, prof: readonly (readonly [number, number])[], cols: readonly LatheColor[], sides: number, phase = 0): void {
  const perPoint = cols.length === prof.length;
  for (let k = 0; k + 1 < prof.length; k++) {
    const [r0, y0] = prof[k], [r1, y1] = prof[k + 1];
    const l = Math.hypot(y1 - y0, r1 - r0);
    if (l < 1e-9 || (r0 < 1e-6 && r1 < 1e-6)) continue;
    const nr = (y1 - y0) / l, ny = -(r1 - r0) / l;
    // (the step's colour at its start; at its end its pair's second, the next point's in a gradient, else the same)
    const ck = cols[k];
    const [ca, cb] = isPair(ck) ? ck : [ck, perPoint ? (cols[k + 1] as RGB) : ck];
    for (let q = 0; q < sides; q++) {
      const a0 = phase + (q / sides) * Math.PI * 2, a1 = phase + ((q + 1) / sides) * Math.PI * 2, am = (a0 + a1) / 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const n0: V3 = [nr * c0, ny, nr * s0], n1: V3 = [nr * c1, ny, nr * s1];
      const P = (r: number, y: number, c: number, sn: number): V3 => [at[0] + r * c, at[1] + y, at[2] + r * sn];
      s.quadN(P(r0, y0, c0, s0), P(r0, y0, c1, s1), P(r1, y1, c1, s1), P(r1, y1, c0, s0), [Math.cos(am) * nr, ny, Math.sin(am) * nr],
        [n0, n1, n1, n0], [ca, ca, cb, cb]);
    }
  }
}

/** A tube of radius `rad` along `pts` (each ring across the path's mean direction there: mitred, no cracks at the
 *  joints; `closed`: a loop), `sides` round, smooth; open ends. */
export function tube(s: Soup, pts: readonly V3[], rad: number, col: RGB, sides = 10, closed = false): void {
  const n = pts.length;
  const rings = pts.map((p, i) => {
    const a = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)], b = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    const t = norm(sub(b, a));
    const u = norm(cross(t, Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), v = cross(u, t);
    return { p, u, v };
  });
  const at = (i: number, phi: number): { p: V3; n: V3 } => {
    const r = rings[i], c = Math.cos(phi), sn = Math.sin(phi);
    const n: V3 = [r.u[0] * c + r.v[0] * sn, r.u[1] * c + r.v[1] * sn, r.u[2] * c + r.v[2] * sn];
    return { p: [r.p[0] + n[0] * rad, r.p[1] + n[1] * rad, r.p[2] + n[2] * rad], n };
  };
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const j = (i + 1) % n;
    for (let q = 0; q < sides; q++) {
      const p0 = (q / sides) * Math.PI * 2, p1 = ((q + 1) / sides) * Math.PI * 2;
      const A = at(i, p0), B = at(i, p1), C = at(j, p1), D = at(j, p0), M = at(i, (p0 + p1) / 2);
      s.quadN(A.p, B.p, C.p, D.p, M.n, [A.n, B.n, C.n, D.n], [col, col, col, col]);
    }
  }
}
