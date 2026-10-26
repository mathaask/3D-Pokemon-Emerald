// The Sky Pillar's top (Rayquaza): its pale stone floor (the ground part's disc, ending at r 14: ground.ts GROUND_RADIUS)
// broken off at a jagged edge over a sea of clouds, broken pillar stumps and fallen drums standing on it. The battle
// camera never frames the horizon (D1): it looks over the floor's edge, ≈ 25 units off, at its frame's top fifth — the
// rays there pass over the edge and fall onto the cloud layer from ≈ 40 units out (from the stage centre; ≈ 30 in the
// intro sweep's first frames, .scratch/t11/sky.ts), the farthest lost in the haze (the look's fog, 25..90 units from the
// camera: past ≈ 76 from the centre the puffs are all but gone; the sky dome's horizon is the fog's colour) — the sea's
// puffs stand r 30–76 from the centre (CLOUD_SEA). The floor under it hides everything
// nearer: the edge shows as its outline and its lip, its broken face (facing away from the stage) only to a camera outside
// it. Draws: the stone (CLIFF_MATERIAL, faceted: the edge, fallen masonry on it, the stumps, the drums) and the clouds (SOIL_MATERIAL: blobCrown
// puffs, white with a cool underside, drawn after the floor — its early depth rejects the clouds it hides).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noise2, rng, type V3 } from '../../kit/geom';
import { kitMaterial } from '../../kit/materials';
import { mix, scale, toLinear, type RGB } from '../../kit/palette';
import { CLIFF_MATERIAL } from '../../kit/cliffs';
import { SOIL_MATERIAL } from '../../kit/soil';
import { blobCrown } from '../../kit/trees';
import type { ArenaPart, CatalogueEntry } from '../modernArena';
import { BATTLE_CAMERA, GROUND_Y, type Stage } from '../stage';
import { GROUND_RENDER_ORDER } from './ground';
import { Soup } from './rooms';
import { FRAME_ASPECT, SCENERY_SEED, battleCamera } from './scatter';

const lin = (c: RGB): RGB => toLinear([Math.min(1, Math.max(0, c[0])), Math.min(1, Math.max(0, c[1])), Math.min(1, Math.max(0, c[2]))]);

// ------------------------------------------------------------------------------------------------- the broken edge

/** The broken edge: its lip's inner boundary (jagged, inside the floor's rim at GROUND_RADIUS.rayquaza: the lip covers it)
 *  and its outline (outside it), units from the stage centre; the lip `lift` over the floor (each slab its own: a crack
 *  step at its inner boundary); slabs `slab` rad wide (a crack between them `crack` rad); some sag at their outer end
 *  (`sag`: the share of slabs, how far), some are heaved up there (`heave`) — the outline dips and juts as the camera sees
 *  it, almost edge on; the slab's broken face `thick` deep, then the masonry under it receding to `under` units from the
 *  centre and dropping `drop` units under the floor. */
export const EDGE = { inner: [12.7, 13.85] as const, outer: [14.2, 16.2] as const, lift: [0.015, 0.07] as const, slab: [0.07, 0.17] as const,
  crack: 0.005, sag: [0.3, 0.75] as const, heave: [0.14, 0.22] as const, thick: 0.42, under: [13.0, 13.8] as const, drop: 3 };
/** The slabs sag only beyond the floor's rim (r 14): their top is level out to this radius. */
const LEVEL = 14.05;

/** The floor's jagged broken rim at r 14, dropping 3 units (faceted stone): slabs of the floor's stone lying over the
 *  floor's rim — each from a jagged inner crack (inside r 14) out to a jagged broken outline (outside it), a little over
 *  the floor, some sagging at their outer end; between them thin cracks —, their broken faces down to the slab's
 *  thickness, the masonry under them receding and falling 3 units. position, normal, color(3) (`color` sRGB). */
export function brokenEdgeGeometry(seed: number, stage: Stage, color: RGB): THREE.BufferGeometry {
  const s = new Soup(), E = EDGE, r = rng(seed * 6007 + 0xed6e);
  const cx = stage.centre.x, cz = stage.centre.z, o = (seed % 997) * 1.37;
  const top = lin(scale(color, 0.92)), crack = lin(scale(color, 0.45)), face = lin(scale(color, 0.7)), under = lin(scale(color, 0.5));
  const P = (a: number, d: number, y: number): V3 => [cx + Math.cos(a) * d, y, cz + Math.sin(a) * d];
  const out = (a: number): V3 => [Math.cos(a), 0, Math.sin(a)];
  // the outline: broad bites and sharp teeth along it (noise at two scales, a sawtooth of the finer)
  const rOut = (a: number) => {
    const broad = 0.5 + 0.5 * noise2(Math.cos(a) * 2.2 + o, Math.sin(a) * 2.2 - o, 0xed1);
    const teeth = Math.abs(noise2(a * 9.5 + o, 1.7, 0xed2));
    return E.outer[0] + (E.outer[1] - E.outer[0]) * Math.min(1, 0.65 * broad + 0.55 * teeth);
  };
  const rIn = (a: number) => E.inner[0] + (E.inner[1] - E.inner[0]) * (0.5 + 0.5 * noise2(a * 3.3 - o, 4.1, 0xed3));
  const rUnder = (a: number, k: number) => E.under[0] + (E.under[1] - E.under[0]) * (0.5 + 0.5 * noise2(a * 5.1 + k * 1.9, 2.3 + o, 0xed4));
  let a = 0;
  while (a < Math.PI * 2 - 1e-6) {
    const w = Math.min(E.slab[0] + (E.slab[1] - E.slab[0]) * r(), Math.PI * 2 - a);
    const a0 = a + E.crack / 2, a1 = a + w - E.crack / 2;
    a += w;
    const lift = E.lift[0] + (E.lift[1] - E.lift[0]) * r();
    const roll = r();
    const sag = roll < E.sag[0] ? E.sag[1] * (0.4 + 0.6 * r()) : roll < E.sag[0] + E.heave[0] ? -E.heave[1] * (0.5 + 0.5 * r()) : 0;
    const shade = 0.9 + 0.16 * r();
    const m = Math.max(2, Math.ceil((a1 - a0) / 0.03));
    // the slab's rows across it: inner crack, level to just past the floor's rim, then sagging to the outline
    const yAt = (t: number) => GROUND_Y + lift - (t > 0.5 ? sag * (2 * t - 1) ** 2 : 0);
    for (let j = 0; j < m; j++) {
      const b0 = a0 + ((a1 - a0) * j) / m, b1 = a0 + ((a1 - a0) * (j + 1)) / m;
      const i0 = rIn(b0), i1 = rIn(b1), o0 = rOut(b0), o1 = rOut(b1);
      const m0 = LEVEL, m1 = LEVEL;
      const ct = scale(top, shade * (0.96 + 0.08 * noise2(b0 * 40, 0.3, 0xed5)));
      // top: two rows (the sag bends it)
      s.quad(P(b0, i0, yAt(0)), P(b1, i1, yAt(0)), P(b1, m1, yAt(0.5)), P(b0, m0, yAt(0.5)), [0, 1, 0], ct);
      s.quad(P(b0, m0, yAt(0.5)), P(b1, m1, yAt(0.5)), P(b1, o1, yAt(1)), P(b0, o0, yAt(1)), [0, 1, 0], scale(ct, 0.96));
      // the crack step at its inner boundary (facing the stage), down to just under the floor
      const inward: V3 = [-Math.cos((b0 + b1) / 2), 0, -Math.sin((b0 + b1) / 2)];
      s.quad(P(b0, i0, yAt(0)), P(b1, i1, yAt(0)), P(b1, i1, GROUND_Y - 0.02), P(b0, i0, GROUND_Y - 0.02), inward, crack);
      // the broken face: the slab's thickness, then the masonry under it receding and falling
      const f0 = o0 - 0.12, f1 = o1 - 0.12, y1 = GROUND_Y - E.thick;
      const u0 = rUnder(b0, 0), u1 = rUnder(b1, 0), v0 = rUnder(b0, 1), v1 = rUnder(b1, 1);
      const n = out((b0 + b1) / 2);
      s.quad(P(b0, o0, yAt(1)), P(b1, o1, yAt(1)), P(b1, f1, y1 - sag), P(b0, f0, y1 - sag), n, face);
      s.quad(P(b0, f0, y1 - sag), P(b1, f1, y1 - sag), P(b1, u1, y1 - 0.35), P(b0, u0, y1 - 0.35), [n[0], -0.8, n[2]], under);
      s.quad(P(b0, u0, y1 - 0.35), P(b1, u1, y1 - 0.35), P(b1, v1, GROUND_Y - E.drop * 0.6), P(b0, v0, GROUND_Y - E.drop * 0.6), n, scale(face, 0.9));
      s.quad(P(b0, v0, GROUND_Y - E.drop * 0.6), P(b1, v1, GROUND_Y - E.drop * 0.6), P(b1, v1 - 0.3, GROUND_Y - E.drop), P(b0, v0 - 0.3, GROUND_Y - E.drop), n, scale(under, 0.9));
    }
    // the slab's ends (seen through the cracks): its section, from the crack to the outline and down its thickness
    for (const [b, f] of [[a0, -1], [a1, 1]] as const) {
      const side: V3 = [-Math.sin(b) * f, 0, Math.cos(b) * f];
      const i0 = rIn(b), o0 = rOut(b), m0 = LEVEL;
      s.quad(P(b, i0, GROUND_Y - 0.02), P(b, i0, yAt(0)), P(b, m0, yAt(0.5)), P(b, m0, GROUND_Y - 0.02), side, crack);
      s.quad(P(b, m0, GROUND_Y - 0.02), P(b, m0, yAt(0.5)), P(b, o0, yAt(1)), P(b, o0 - 0.12, GROUND_Y - E.thick - sag), side, scale(face, 0.85));
    }
  }
  return s.geometry();
}

// ------------------------------------------------------------------------------------------------- stumps and drums

/** A broken pillar on the floor: where, its radius and the height of its break. */
export interface Stump { x: number; z: number; radius: number; height: number; seed: number }

/** The stumps as (angle off straight behind the stage, radius from its centre, the break's height): placed against the
 *  idle frame (.scratch/t11/grid.ts: over the player's head, between the battlers, right of the enemy) and round the
 *  sides (seen as the camera swings), inside the edge. */
const STUMPS: readonly [number, number, number][] = [[-0.06, 10.6, 1.05], [0.66, 10.1, 1.7], [-0.86, 11.2, 2.2], [-1.0, 10.4, 2.7],
  [1.12, 11.2, 1.35], [-1.55, 11.6, 1.9], [1.62, 11.4, 2.5]];
const STUMP_R = 0.5;

export function stumpPlacements(stage: Stage): Stump[] {
  return STUMPS.map(([a, r, h], i) => ({ x: stage.centre.x + Math.sin(a) * r, z: stage.centre.z - Math.cos(a) * r, radius: STUMP_R, height: h, seed: i + 1 }));
}

/** A broken column `height` tall (to its break) at the origin: a square plinth, a rounded base, a shaft of 14 flutes
 *  tapering a little, its top broken off (its rim jagged, a rough break across it, pale where fresh). position, normal,
 *  color(3) (`color` sRGB). */
function stumpGeometry(seed: number, radius: number, height: number, color: RGB): Soup {
  const s = new Soup(), r = rng(seed * 3803 + 0x57a4), N = 14;
  const c = lin(color), dark = lin(scale(color, 0.8)), fresh = lin(mix(color, [1, 1, 1], 0.25));
  const pw = radius * 1.45, ph = 0.22;
  s.box([0, 0, 0], [1, 0, 0], [0, 0, 1], -pw, pw, -0.02, ph, -pw, pw, dark);
  // the shaft's rings: base mouldings, then the shaft up to the jagged break (each column of the break its own height)
  const breakH = Array.from({ length: N }, () => height - (0.15 + 0.5 * r()) * Math.min(1, height * 0.6));
  const ring = (q: number, rad: number, y: number): V3 => { const a = (q / N) * Math.PI * 2; return [Math.cos(a) * rad, y, Math.sin(a) * rad]; };
  const rows: [number, number][] = [[radius * 1.3, ph], [radius * 1.3, ph + 0.08], [radius * 1.1, ph + 0.2], [radius, ph + 0.3]];
  for (let k = 0; k + 1 < rows.length; k++) {
    for (let q = 0; q < N; q++) {
      const am = ((q + 0.5) / N) * Math.PI * 2;
      s.quad(ring(q, rows[k][0], rows[k][1]), ring(q + 1, rows[k][0], rows[k][1]), ring(q + 1, rows[k + 1][0], rows[k + 1][1]), ring(q, rows[k + 1][0], rows[k + 1][1]),
        [Math.cos(am), 0.4, Math.sin(am)], k === 0 ? dark : c);
    }
  }
  const y0 = ph + 0.3, taper = (y: number) => radius * (1 - 0.04 * (y / Math.max(1, height)));
  for (let q = 0; q < N; q++) {
    const am = ((q + 0.5) / N) * Math.PI * 2, h0 = breakH[q], h1 = breakH[(q + 1) % N];
    // (a flute: every other face a little darker)
    s.quad(ring(q, radius, y0), ring(q + 1, radius, y0), ring(q + 1, taper(h1), h1), ring(q, taper(h0), h0), [Math.cos(am), 0, Math.sin(am)], q % 2 ? scale(c, 0.93) : c);
    // the break: a fan to its middle, a little lower
    const mid: V3 = [0, height - 0.35 * Math.min(1, height * 0.6) * (0.5 + r() * 0.5), 0];
    s.tri(ring(q, taper(h0), h0), ring(q + 1, taper(h1), h1), mid, [0, 1, 0], scale(fresh, 0.95 + 0.1 * r()));
  }
  return s;
}

/** A fallen drum: a short column section lying on its side on the floor, along `a` (radians). */
function drumGeometry(radius: number, length: number, a: number, color: RGB): Soup {
  const s = new Soup(), N = 12, c = lin(color), end = lin(mix(color, [1, 1, 1], 0.2));
  const ax: V3 = [Math.cos(a), 0, Math.sin(a)];
  const p = (q: number, t: number): V3 => {
    const ang = (q / N) * Math.PI * 2, y = Math.sin(ang) * radius + radius * 0.92, d = Math.cos(ang) * radius;
    return [ax[0] * t - ax[2] * d, y - 0.02, ax[2] * t + ax[0] * d];
  };
  for (let q = 0; q < N; q++) {
    const am = ((q + 0.5) / N) * Math.PI * 2, n: V3 = [-ax[2] * Math.cos(am), Math.sin(am), ax[0] * Math.cos(am)];
    s.quad(p(q, -length / 2), p(q + 1, -length / 2), p(q + 1, length / 2), p(q, length / 2), n, q % 2 ? scale(c, 0.93) : c);
    for (const t of [-1, 1]) s.tri(p(q, (t * length) / 2), p(q + 1, (t * length) / 2), [ax[0] * t * length / 2, radius * 0.9, ax[2] * t * length / 2], [ax[0] * t, 0, ax[2] * t], end);
  }
  return s;
}

/** Fallen masonry on the edge: `count` blocks (`size` across, flattened to `flat` of it), r 13.1–15.4 along the back and
 *  the sides (± `arc` rad from straight behind), none just behind the enemy (`clear`: angles), half sunk, tilted — they
 *  break the edge's line as the camera sees it, almost edge on. */
const RUBBLE = { count: 22, size: [0.32, 0.85] as const, flat: 0.62, arc: 1.75, clear: [0.05, 0.5] as const, r: [13.1, 15.4] as const };

/** The blocks of fallen masonry (RUBBLE): cuboids of the floor's stone, each face its own shade. */
function rubble(seed: number, stage: Stage, color: RGB): Soup {
  const s = new Soup(), R = RUBBLE, r = rng(seed * 4447 + 0x7ab1);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3();
  for (let i = 0; i < R.count; i++) {
    const a = -R.arc + 2 * R.arc * r();
    const rad = R.r[0] + (R.r[1] - R.r[0]) * r(), size = R.size[0] + (R.size[1] - R.size[0]) * r();
    if (a > R.clear[0] && a < R.clear[1]) continue;
    const w = size, h = size * R.flat * (0.7 + 0.5 * r()), d = size * (0.6 + 0.5 * r());
    const x = stage.centre.x + Math.sin(a) * rad, z = stage.centre.z - Math.cos(a) * rad;
    e.set((r() - 0.5) * 0.5, r() * Math.PI * 2, (r() - 0.5) * 0.5);
    m.compose(new THREE.Vector3(x, GROUND_Y + h * 0.3, z), q.setFromEuler(e), new THREE.Vector3(1, 1, 1));
    const c = (sx: number, sy: number, sz: number): V3 => { v.set((sx * w) / 2, (sy * h) / 2, (sz * d) / 2).applyMatrix4(m); return [v.x, v.y, v.z]; };
    const n = (nx: number, ny: number, nz: number): V3 => { v.set(nx, ny, nz).transformDirection(m); return [v.x, v.y, v.z]; };
    const k = 0.82 + 0.2 * r(), col = lin(scale(color, k));
    s.quad(c(-1, 1, -1), c(1, 1, -1), c(1, 1, 1), c(-1, 1, 1), n(0, 1, 0), lin(scale(color, k * 1.06)));
    s.quad(c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1), n(0, 0, 1), col);
    s.quad(c(-1, -1, -1), c(1, -1, -1), c(1, 1, -1), c(-1, 1, -1), n(0, 0, -1), col);
    s.quad(c(-1, -1, -1), c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1), n(-1, 0, 0), scale(col, 0.9));
    s.quad(c(1, -1, -1), c(1, -1, 1), c(1, 1, 1), c(1, 1, -1), n(1, 0, 0), scale(col, 0.9));
  }
  return s;
}

/** The fallen drums: (angle, radius, its axis' angle, length) — beside the stumps. */
const DRUMS: readonly [number, number, number, number][] = [[0.02, 11.7, 0.5, 0.9], [0.8, 11.0, -0.9, 0.75], [-1.2, 11.6, 1.4, 1.0],
  [1.36, 11.7, 0.2, 0.8]];

// ------------------------------------------------------------------------------------------------- the cloud sea

/** The cloud sea: rows of cloud puffs every `spacing` units (jittered) from `r[0]` to `r[1]` round the stage centre,
 *  ± `arc` rad from straight behind (the camera never looks further round: the intro sweep's first frame from yaw ±0.9
 *  in a 21:9 window, FRAME_ASPECT.widest, sees the cloud layer ≈ 2.06 rad round), centred `depth` units under the floor; each a
 *  blobCrown (radii `blob`, ≤ 1.5) squashed to `squash` of its height — by its distance (`lod`: up to r, blobs, icosphere
 *  detail) five round blobs near the edge, four and three lumpier ones further out. The brief's r 16–40 lies under the
 *  floor's edge in every frame (rays over the edge meet the clouds at r ≥ 40, the intro sweep's from r ≈ 30:
 *  .scratch/t11/sky.ts), and past r 76 the look's fog (25..90) has all but swallowed them (the sky dome's horizon is the
 *  fog's colour): the sea reaches from under the edge into the haze, and only the puffs some battle frame shows are built
 *  (cloudShown). */
export const CLOUD_SEA = { r: [30, 76] as const, arc: 2.15, depth: [4, 7] as const, spacing: 3.1, blob: [0.85, 1.45] as const,
  spread: 1.5, squash: 0.62, lod: [[40, 5, 1], [58, 4, 0], [Infinity, 3, 0]] as const };

/** A cloud puff's template (blobCrown at the origin, its colours turned white with a cool underside, RGB): cached per
 *  variant, blob count and detail (deterministic: the same for every build). */
interface Puff { pos: Float32Array; nor: Float32Array; col: Float32Array; index: ArrayLike<number> }
const PUFFS = new Map<string, Puff>();
const PUFF_VARIANTS = 6;
const UNDERSIDE: RGB = [0.66, 0.73, 0.88];
function puff(variant: number, blobs: number, detail: number): Puff {
  const key = `${variant}:${blobs}:${detail}`;
  let p = PUFFS.get(key);
  if (!p) {
    const C = CLOUD_SEA;
    const g = blobCrown(0xc10d + variant * 131, blobs, C.spread, C.blob[0], C.blob[1], 0, 0.25, detail);
    const pos = g.getAttribute('position'), c4 = g.getAttribute('color');
    g.computeBoundingBox();
    const y0 = g.boundingBox!.min.y, y1 = g.boundingBox!.max.y;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      // (the crown's own shading — dark, cool underside to a light top, occlusion inside — turned to cloud: white tops,
      // a cool blue-grey underside)
      const t = THREE.MathUtils.smoothstep(pos.getY(i), y0, y1), k = Math.min(1, c4.getX(i) * 0.35 + 0.72);
      const c = mix(UNDERSIDE, [1, 1, 1], t);
      col[i * 3] = c[0] * k; col[i * 3 + 1] = c[1] * k; col[i * 3 + 2] = c[2] * k;
    }
    p = { pos: (pos.array as Float32Array).slice(), nor: (g.getAttribute('normal').array as Float32Array).slice(), col, index: g.index!.array.slice() };
    g.dispose();
    PUFFS.set(key, p);
  }
  return p;
}

/** A puff of the sea: where (its centre), its yaw, scale, template variant, blob count and detail. */
interface Placed { x: number; y: number; z: number; yaw: number; s: number; v: number; blobs: number; d: number }

/** Whether a battle frame can show a puff whose top stands at (x, y, z): the settled camera at yaw 0 and ±0.45, ±0.9, and
 *  the intro sweep's first frames (ease 0) from yaw 0 and ±0.9, in the widest window the arena is composed for
 *  (FRAME_ASPECT.widest, 21:9) — the top, or a point 1.5 to its side, inside the frame (a little margin) and the ray to it
 *  passing over the floor's edge (crossing the floor's plane beyond r 14.5: the floor hides it otherwise). */
export function cloudShown(stage: Stage): (x: number, y: number, z: number) => boolean {
  const cams = [[1, 0], [1, -0.45], [1, 0.45], [1, -0.9], [1, 0.9], [0, 0], [0, -0.9], [0, 0.9]].map(([ease, yaw]) => {
    const look = new THREE.Vector3(), cam = new THREE.PerspectiveCamera(BATTLE_CAMERA.fov, FRAME_ASPECT.widest, 0.1, 400);
    cam.position.copy(battleCamera(stage, yaw, new THREE.Vector3(), look, ease));
    cam.lookAt(look);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    return cam;
  });
  const cx = stage.centre.x, cz = stage.centre.z, v = new THREE.Vector3();
  const SIDE = [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]];
  return (x, y, z) => cams.some((cam) => SIDE.some(([dx, dz]) => {
    const px = x + dx, pz = z + dz;
    v.set(px, y, pz).project(cam);
    if (v.z >= 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return false;
    const o = cam.position, t = (GROUND_Y - o.y) / (y - o.y);
    return !(t > 0 && t < 1 && Math.hypot(o.x + (px - o.x) * t - cx, o.z + (pz - o.z) * t - cz) <= 14.5);
  }));
}

/** The puffs of a seed (CLOUD_SEA, those some frame shows: cloudShown), nearest first; cached per seed and stage centre
 *  (the same for every build: the frames' check runs once). */
const SEAS = new Map<string, Placed[]>();
function cloudPuffs(seed: number, stage: Stage): Placed[] {
  const key = `${seed}:${stage.centre.x}:${stage.centre.z}`;
  let placed = SEAS.get(key);
  if (placed) return placed;
  const C = CLOUD_SEA, r = rng(seed * 9173 + 0xc10d), shown = cloudShown(stage);
  const cx = stage.centre.x, cz = stage.centre.z;
  placed = [];
  for (let rad = C.r[0]; rad <= C.r[1]; rad += C.spacing * (0.85 + 0.3 * r())) {
    const n = Math.ceil((2 * C.arc * rad) / C.spacing);
    for (let i = 0; i < n; i++) {
      const a = -C.arc + (2 * C.arc * (i + 0.2 + 0.6 * r())) / n, rr = rad + (r() - 0.5) * C.spacing * 0.6;
      const p: Placed = { x: cx + Math.sin(a) * rr, z: cz - Math.cos(a) * rr, y: GROUND_Y - C.depth[0] - (C.depth[1] - C.depth[0]) * r() * r(),
        yaw: r() * Math.PI * 2, s: 0.85 + 0.15 * r(), v: Math.floor(r() * PUFF_VARIANTS), blobs: 0, d: 0 };
      const [, blobs, d] = C.lod.find(([upTo]) => rr < upTo)!;
      p.blobs = blobs;
      p.d = d;
      // (its top: the blobs' tallest over its centre, squashed)
      if (shown(p.x, p.y + 1.25 * p.s, p.z)) placed.push(p);
    }
  }
  SEAS.set(key, placed);
  return placed;
}

/** Soft cloud puffs (blobCrown blobs ≤ 1.5 radius, white with a cool underside) centred 4–7 units below the floor, r
 *  30–76 from the stage centre (CLOUD_SEA; those some frame shows), nearest first (the floor's and the near puffs' depth rejects the far ones
 *  behind them). position, normal, color(3), indexed. */
export function cloudSeaGeometry(seed: number, stage: Stage): THREE.BufferGeometry {
  const C = CLOUD_SEA, placed = cloudPuffs(seed, stage);
  let nv = 0, ni = 0;
  for (const p of placed) { const t = puff(p.v, p.blobs, p.d); nv += t.pos.length / 3; ni += t.index.length; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), index = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const p of placed) {
    const t = puff(p.v, p.blobs, p.d), c = Math.cos(p.yaw), sn = Math.sin(p.yaw), k = t.pos.length / 3;
    for (let i = 0; i < k; i++) {
      const x = t.pos[i * 3] * p.s, y = t.pos[i * 3 + 1] * p.s * C.squash, z = t.pos[i * 3 + 2] * p.s;
      const o = (ov + i) * 3;
      pos[o] = p.x + x * c - z * sn; pos[o + 1] = p.y + y; pos[o + 2] = p.z + x * sn + z * c;
      // (the normal through the squash: its y stretched back, renormalised)
      const nx = t.nor[i * 3], ny = t.nor[i * 3 + 1] / C.squash, nz = t.nor[i * 3 + 2], l = Math.hypot(nx, ny, nz) || 1;
      nor[o] = (nx * c - nz * sn) / l; nor[o + 1] = ny / l; nor[o + 2] = (nx * sn + nz * c) / l;
      col[o] = t.col[i * 3]; col[o + 1] = t.col[i * 3 + 1]; col[o + 2] = t.col[i * 3 + 2];
    }
    for (let i = 0; i < t.index.length; i++) index[oi + i] = ov + t.index[i];
    ov += k;
    oi += t.index.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------------------------------------- the part

const PNC = { position: 3, normal: 3, color: 3 };
/** The clouds draw after the floor, above the ground's render order (GROUND_RENDER_ORDER, 3): an opaque draw sorts by
 *  render order first — the floor, nearer, then writes the depth that rejects the clouds it hides (most of the sea's
 *  fragments, before they are shaded); drawn first, they would be shaded and then overdrawn by the floor. Before the sky
 *  (10). */
export const CLOUD_RENDER_ORDER = GROUND_RENDER_ORDER + 0.5;

export const SKY_PILLAR_PART: ArenaPart = {
  name: 'skyPillar',
  kinds: ['rayquaza'],
  catalogue(): readonly CatalogueEntry[] {
    return [
      { material: CLIFF_MATERIAL, mesh: 'mesh', attrs: PNC, castShadow: true },
      { material: SOIL_MATERIAL, mesh: 'mesh', attrs: PNC, castShadow: false },
    ];
  },
  build(ctx) {
    const { stage, palette } = ctx;
    const group = new THREE.Group();
    // the stone: the floor's (palette.ground: the Sky Pillar's pale stone), the stumps a little warmer and darker
    const stone = palette.ground, column = mix(scale(stone, 0.9), [0.86, 0.84, 0.78], 0.2);
    const parts: THREE.BufferGeometry[] = [brokenEdgeGeometry(SCENERY_SEED, stage, stone), rubble(SCENERY_SEED, stage, scale(stone, 0.9)).geometry()];
    for (const st of stumpPlacements(stage)) parts.push(stumpGeometry(st.seed, st.radius, st.height, column).geometry().translate(st.x, GROUND_Y, st.z));
    for (const [a, r, axis, len] of DRUMS) {
      const x = stage.centre.x + Math.sin(a) * r, z = stage.centre.z - Math.cos(a) * r;
      parts.push(drumGeometry(STUMP_R * 0.95, len, axis, column).geometry().translate(x, GROUND_Y, z));
    }
    const g = mergeGeometries(parts)!;
    for (const x of parts) x.dispose();
    g.computeBoundingSphere();
    const stoneMesh = new THREE.Mesh(g, kitMaterial(ctx.uniforms, CLIFF_MATERIAL).material);
    stoneMesh.name = 'skyPillarStone';
    stoneMesh.castShadow = true;
    stoneMesh.receiveShadow = true;
    group.add(stoneMesh);
    const clouds = new THREE.Mesh(cloudSeaGeometry(SCENERY_SEED, stage), kitMaterial(ctx.uniforms, SOIL_MATERIAL).material);
    clouds.name = 'cloudSea';
    clouds.castShadow = false;
    clouds.receiveShadow = false;
    clouds.renderOrder = CLOUD_RENDER_ORDER;
    group.add(clouds);
    return group;
  },
};
