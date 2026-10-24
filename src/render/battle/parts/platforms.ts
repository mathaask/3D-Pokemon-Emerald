// The battle platforms, modelled per terrain where today's stand (STAGE.player / STAGE.enemy, PLATFORM_FOOTPRINT): an
// earth disc with a grass skirt (grass, long grass, plain), a sand mound, a stone slab on a plinth (mountain, every
// room, the Sky Pillar), rough cave rock (caves, the sea floor), a lily pad (pond), ripple rings on open water. Their
// tops lie at y ≈ 0, where the battlers' feet, the flat enemy shadow and the stage's maths put the platform top; the
// tops draw with the arena ground's material (its cells paint them: parts/ground.ts), the bodies with the kit's soil
// (smooth) or cliff (faceted) material in vertex colours.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noise2, rng, QuadWriter, type V3 } from '../../kit/geom';
import { applyKitMaterial, kitMaterial, type KitMaterialOptions } from '../../kit/materials';
import { mix, nightSoilScale, scale, toLinear, type RGB } from '../../kit/palette';
import { SOIL_MATERIAL } from '../../kit/soil';
import { CLIFF_MATERIAL } from '../../kit/cliffs';
import { BLADES, GRASS_MATERIAL, clump } from '../../kit/grass';
import type { ArenaKind } from '../arenaKind';
import type { ArenaPalette } from '../palette';
import type { ArenaPart, CatalogueEntry } from '../modernArena';
import { GROUND_Y, WATER_Y, PLATFORM_FOOTPRINT, STAGE, type Footprint } from '../stage';
import { arenaGround, arenaGroundMaterial, uniformCells, GROUND_RENDER_ORDER } from './ground';

export type PlatformStyle = 'earthGrass' | 'sandMound' | 'stoneSlab' | 'lilyPad' | 'rippleRing' | 'caveRock' | 'seabedRock';

/** grass, longGrass, plain → earthGrass; sand → sandMound; water, kyogre, cavePond → rippleRing; pond → lilyPad;
 *  underwater → seabedRock; cave, groudon → caveRock; mountain and every indoor kind, rayquaza → stoneSlab. */
export const PLATFORM_STYLE: Readonly<Record<ArenaKind, PlatformStyle>> = {
  grass: 'earthGrass', longGrass: 'earthGrass', plain: 'earthGrass', sand: 'sandMound',
  water: 'rippleRing', kyogre: 'rippleRing', cavePond: 'rippleRing', pond: 'lilyPad',
  underwater: 'seabedRock', cave: 'caveRock', groudon: 'caveRock',
  mountain: 'stoneSlab', building: 'stoneSlab', gym: 'stoneSlab', leader: 'stoneSlab', frontier: 'stoneSlab',
  magma: 'stoneSlab', aqua: 'stoneSlab', sidney: 'stoneSlab', phoebe: 'stoneSlab', glacia: 'stoneSlab', drake: 'stoneSlab',
  champion: 'stoneSlab', rayquaza: 'stoneSlab',
};

export interface PlatformMeshes {
  body: THREE.BufferGeometry | null;   // position, normal, color(3): SOIL_MATERIAL (smooth) or CLIFF_MATERIAL (stoneSlab, caveRock, seabedRock: faceted)
  top: THREE.BufferGeometry | null;    // position, normal: drawn with the arena ground's material (its cells paint it)
  skirt: Float32Array | null;          // earthGrass: x, z, scale, yaw per grass clump on the rim
  ripple: THREE.BufferGeometry | null; // rippleRing: position, normal (RIPPLE_MATERIAL)
}

/** The shapes' dimensions (world units; e = elliptical radius in units of the footprint). */
const EARTH = { dome: 0.03, rings: 6, segments: 48, rim: 0.1, flare: 0.08, wobble: 0.04, bottom: GROUND_Y - 0.05 };
const SKIRT = { clumps: 48, longClumps: 64, longScale: 1.3, scale: 0.3, e0: 1.0, e1: 1.08, rootY: -0.035 };
const MOUND = { flat: 0.55, edge: 1.35, rings: 10, segments: 64, foot: GROUND_Y - 0.02 };
const SLAB = { segments: 32, chamfer: 0.06, side: GROUND_Y + 0.1, plinth: 1.1, bottom: GROUND_Y - 0.05, shade: 0.05 };
const ROCK = { segments: 64, rows: 4, topRings: 5, bump: 0.02, lump: 0.15, flare: 0.15, bottom: GROUND_Y - 0.1 };
const PAD = { y: WATER_Y + 0.03, size: 1.05, notch: THREE.MathUtils.degToRad(18), rim: 0.02, under: 0.006, rings: 6, segments: 96 };
const RIPPLE = { e0: 0.6, e1: 1.25, y: WATER_Y + 0.01, rings: 4, segments: 64 };

/** A point at elliptical radius `s` (× footprint) plus `d` world units outward, angle `a` (0 = +x, towards +z), height y. */
const at = (f: Footprint, a: number, s: number, d: number, y: number): V3 =>
  [Math.cos(a) * (f.rx * s + d), y, Math.sin(a) * (f.rz * s + d)];

/** An indexed polar surface: the centre (e = 0) and `rings` rings of `segments` vertices at e = eAt(k) (k = 1..rings),
 *  height y(x, z, e); position + normal (smooth). */
function polarTop(f: Footprint, rings: number, segments: number, eAt: (k: number) => number,
  y: (x: number, z: number, e: number) => number): THREE.BufferGeometry {
  const pos = new Float32Array((1 + rings * segments) * 3);
  pos[1] = y(0, 0, 0);
  let o = 3;
  for (let k = 1; k <= rings; k++) {
    const e = eAt(k);
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2, x = Math.cos(a) * f.rx * e, z = Math.sin(a) * f.rz * e;
      pos[o++] = x; pos[o++] = y(x, z, e); pos[o++] = z;
    }
  }
  return polarIndexed(pos, rings, segments);
}

/** Indexes a centre + rings × segments vertex layout (counter-clockwise from above) and computes smooth normals. */
function polarIndexed(pos: Float32Array, rings: number, segments: number): THREE.BufferGeometry {
  const idx: number[] = [];
  const vi = (k: number, s: number) => 1 + (k - 1) * segments + (s % segments);
  for (let s = 0; s < segments; s++) idx.push(0, vi(1, s + 1), vi(1, s));
  for (let k = 1; k < rings; k++) {
    for (let s = 0; s < segments; s++) idx.push(vi(k, s), vi(k, s + 1), vi(k + 1, s + 1), vi(k, s), vi(k + 1, s + 1), vi(k + 1, s));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** An indexed band around the platform: `rows` rings of `segments` vertices (closed around), outward faces; vertex
 *  colours (linear) per vertex; smooth normals. `ring(k, a)` gives a vertex's position and colour. */
function band(rows: number, segments: number, ring: (k: number, a: number, s: number) => { p: V3; c: RGB }): THREE.BufferGeometry {
  const pos = new Float32Array(rows * segments * 3), col = new Float32Array(rows * segments * 3);
  let o = 0;
  for (let k = 0; k < rows; k++) {
    for (let s = 0; s < segments; s++) {
      const { p, c } = ring(k, (s / segments) * Math.PI * 2, s);
      pos.set(p, o);
      col.set(c, o);
      o += 3;
    }
  }
  const idx: number[] = [];
  const vi = (k: number, s: number) => k * segments + (s % segments);
  // (row k above row k + 1; seen from outside, a → a + 1 runs counter-clockwise from above: wound to face outwards)
  for (let k = 0; k + 1 < rows; k++) {
    for (let s = 0; s < segments; s++) idx.push(vi(k, s), vi(k, s + 1), vi(k + 1, s + 1), vi(k, s), vi(k + 1, s + 1), vi(k + 1, s));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // (normal before colour in the attribute order three keys programs by: irrelevant — names are sorted)
  return g;
}

/** Earth disc: a low dome of grass (the ground material's) inside a rounded rim, a flaring soil band below it to just under
 *  the ground, a skirt of grass clumps on the rim. */
function earthGrass(f: Footprint, seed: number, p: ArenaPalette, kind: ArenaKind): PlatformMeshes {
  const E = EARTH;
  const top = polarTop(f, E.rings, E.segments, (k) => k / E.rings, (_x, _z, e) => E.dome * (1 - e * e));
  const soil = toLinear(p.platformSide);
  // the profile: a quarter round from the top's edge out and down by `rim`, then the soil band to the bottom; all soil
  // (soil × k: moonlit exactly by its material colour, nightSoilScale) — the grass skirt covers the shoulder
  const RIM_ROWS = 4, BAND_ROWS = 4;
  const rows = RIM_ROWS + BAND_ROWS - 1;
  const body = band(rows, E.segments, (k, a) => {
    if (k < RIM_ROWS) {
      const phi = (k / (RIM_ROWS - 1)) * (Math.PI / 2);
      const y = -E.rim * (1 - Math.cos(phi));
      return { p: at(f, a, 1, E.rim * Math.sin(phi), y), c: scale(soil, 1.15 - 0.15 * (k / (RIM_ROWS - 1))) };
    }
    const t = (k - RIM_ROWS + 1) / (BAND_ROWS - 1);
    const y = -E.rim + (E.bottom + E.rim) * t;
    const wobble = E.wobble * noise2(Math.cos(a) * 3 + seed * 7.1, Math.sin(a) * 3 + t * 1.7, 0xea7) * Math.min(1, t * 2);
    return { p: at(f, a, 1 + E.flare * t, E.rim + wobble, y), c: scale(soil, 1 - 0.3 * t) };
  });
  // the skirt: clumps around the rim
  const long = kind === 'longGrass';
  const n = long ? SKIRT.longClumps : SKIRT.clumps;
  const r = rng(0x5c1 + seed * 977);
  const skirt = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = ((i + r() * 0.8) / n) * Math.PI * 2;
    const e = SKIRT.e0 + (SKIRT.e1 - SKIRT.e0) * r();
    skirt[i * 4] = Math.cos(a) * f.rx * e;
    skirt[i * 4 + 1] = Math.sin(a) * f.rz * e;
    skirt[i * 4 + 2] = SKIRT.scale * (0.85 + 0.3 * r()) * (long ? SKIRT.longScale : 1);
    skirt[i * 4 + 3] = r() * Math.PI * 2;
  }
  return { body, top, skirt, ripple: null };
}

/** Sand mound: flat at 0 out to e = 0.55, easing down to (just under) the ground by e = 1.35; no body. */
function sandMound(f: Footprint): PlatformMeshes {
  const M = MOUND;
  const top = polarTop(f, M.rings, M.segments, (k) => (M.edge * k) / M.rings,
    (_x, _z, e) => M.foot * THREE.MathUtils.smoothstep(e, M.flat, M.edge));
  return { body: null, top, skirt: null, ripple: null };
}

/** Stone slab: a flat top at 0 (the ground material's paving or rock), a chamfered edge, a vertical side, a plinth step
 *  (× 1.1 footprint) down to just under the ground; faceted, each face shaded ±5 %. */
function stoneSlab(f: Footprint, seed: number, p: ArenaPalette): PlatformMeshes {
  const S = SLAB, N = S.segments;
  const top = polarTop(f, 3, N, (k) => k / 3, () => 0);
  const side = toLinear(p.platformSide);
  const r = rng(0x51ab + seed * 131);
  const w = new QuadWriter();
  // the profile, top down: (scale × footprint, outward d, y) and each step's shade
  const prof: [number, number, number][] = [[1, 0, 0], [1, S.chamfer, -S.chamfer], [1, S.chamfer, S.side], [S.plinth, 0, S.side],
    [S.plinth, 0.02, S.bottom]];
  const shade = [1.12, 1.0, 0.9, 0.82];
  for (let s = 0; s < N; s++) {
    const a0 = (s / N) * Math.PI * 2, a1 = ((s + 1) / N) * Math.PI * 2, am = (a0 + a1) / 2;
    for (let k = 0; k + 1 < prof.length; k++) {
      const [s0, d0, y0] = prof[k], [s1, d1, y1] = prof[k + 1];
      const A = at(f, a0, s0, d0, y0), B = at(f, a1, s0, d0, y0), C = at(f, a1, s1, d1, y1), D = at(f, a0, s1, d1, y1);
      // outward (and up for the chamfer and the plinth's ledge)
      const up = k === 0 ? 0.7 : k === 2 ? 1 : 0;
      const n: V3 = [Math.cos(am) / f.rx * (1 - up * 0.5), up, Math.sin(am) / f.rz * (1 - up * 0.5)];
      w.quad(A, B, C, D, n, side, shade[k] * (1 + S.shade * (2 * r() - 1)));
    }
  }
  return { body: w.geometry(), top, skirt: null, ripple: null };
}

/** Cave / sea-floor rock: a top with a little relief, a lumpy flaring band below it to under the ground; faceted. */
function rockPlatform(f: Footprint, seed: number, p: ArenaPalette): PlatformMeshes {
  const R = ROCK, N = R.segments;
  const bump = (x: number, z: number) => R.bump * noise2(x * 2.3 + seed * 5.3, z * 2.3, 0xc0c);
  const top = polarTop(f, R.topRings, N, (k) => k / R.topRings, (x, z) => bump(x, z));
  const side = toLinear(p.platformSide);
  const r = rng(0x70c + seed * 313);
  // the band's rings, top down: row 0 = the top's edge; then a shoulder and the lumps, flaring to the bottom
  const ring = (k: number, a: number): V3 => {
    if (k === 0) { const x = Math.cos(a) * f.rx, z = Math.sin(a) * f.rz; return [x, bump(x, z), z]; }
    const t = k / R.rows;
    const lump = R.lump * (0.5 + 0.5 * noise2(Math.cos(a) * 4 + seed * 3.7, Math.sin(a) * 4 + k * 1.9, 0x1e4));
    const y = k === 1 ? -0.07 : -0.07 + (R.bottom + 0.07) * ((k - 1) / (R.rows - 1));
    return at(f, a, 1 + R.flare * t * t, 0.06 + lump * Math.min(1, t * 1.6), y);
  };
  const w = new QuadWriter();
  for (let s = 0; s < N; s++) {
    const a0 = (s / N) * Math.PI * 2, a1 = ((s + 1) / N) * Math.PI * 2, am = (a0 + a1) / 2;
    for (let k = 0; k < R.rows; k++) {
      const A = ring(k, a0), B = ring(k, a1), C = ring(k + 1, a1), D = ring(k + 1, a0);
      const n: V3 = [Math.cos(am) / f.rx, k === 0 ? 0.8 : 0.15, Math.sin(am) / f.rz];
      // lighter at the shoulder, darker down the band, each face its own shade
      const k01 = k / (R.rows - 1);
      w.quad(A, B, C, D, n, side, (1.08 - 0.32 * k01) * (0.92 + 0.16 * r()));
    }
  }
  return { body: w.geometry(), top, skirt: null, ripple: null };
}

/** One lily pad (non-indexed into the arrays): a disc of radius (rx, rz) at PAD.y around (cx, cz), its notch of PAD.notch
 *  centred on angle `notchAt` (measured from −z towards +x), its rim raised, an edge band down to the water, and an
 *  underside facing down (the shadow pass draws a FrontSide material's back faces: an upward sheet alone cast no shadow;
 *  the pooled SOIL material keeps its sides); radial veins and a lighter heart in the vertex colours (linear `leaf`). */
function addPad(out: { pos: number[]; col: number[] }, cx: number, cz: number, rx: number, rz: number, notchAt: number, leaf: RGB,
  rings: number, segments: number): void {
  const { pos, col } = out;
  const half = PAD.notch / 2;
  // vertex at (ring k, step s): angle from −z, φ = notchAt + half … notchAt + 2π − half
  // (`down`: the edge band's foot at the water; `under`: the underside, just below the pad)
  const vtx = (k: number, s: number, down = false, under = false): [V3, RGB] => {
    const e = k / rings, phi = notchAt + half + (s / segments) * (Math.PI * 2 - PAD.notch);
    const x = cx + Math.sin(phi) * rx * e, z = cz - Math.cos(phi) * rz * e;
    const y = down ? WATER_Y - 0.02 : under ? PAD.y - PAD.under : PAD.y + PAD.rim * THREE.MathUtils.smoothstep(e, 0.8, 1);
    const vein = Math.pow(Math.abs(Math.cos((phi - notchAt) * 4.5)), 24) * THREE.MathUtils.smoothstep(e, 0.12, 0.35);
    const heart = 1 - THREE.MathUtils.smoothstep(e, 0, 0.45);
    const k0 = down || under ? 0.55 : (0.9 + 0.1 * heart) * (1 + 0.22 * vein) * (e > 0.9 ? 0.86 : 1);
    return [[x, y, z], scale(leaf, k0)];
  };
  const tri = (a: [V3, RGB], b: [V3, RGB], c: [V3, RGB]) => {
    for (const [p, c0] of [a, b, c]) { pos.push(...p); col.push(...c0); }
  };
  // (φ turns as polarTop's angle does, from −z towards +x: the same windings face up, and the edge band outwards)
  for (let s = 0; s < segments; s++) {
    tri(vtx(0, s), vtx(1, s + 1), vtx(1, s));
    for (let k = 1; k < rings; k++) {
      const a = vtx(k, s), b = vtx(k, s + 1), c = vtx(k + 1, s + 1), d = vtx(k + 1, s);
      tri(a, b, c); tri(a, c, d);
    }
    const a = vtx(rings, s), b = vtx(rings, s + 1), c = vtx(rings, s + 1, true), d = vtx(rings, s, true);
    tri(a, b, c); tri(a, c, d);
    // the underside: the top's windings reversed, facing down
    tri(vtx(0, s, false, true), vtx(1, s, false, true), vtx(1, s + 1, false, true));
    for (let k = 1; k < rings; k++) {
      const ua = vtx(k, s, false, true), ub = vtx(k, s + 1, false, true), uc = vtx(k + 1, s + 1, false, true), ud = vtx(k + 1, s, false, true);
      tri(ua, uc, ub); tri(ua, ud, uc);
    }
  }
}

/** Lily pad: a flat pad at the water (× 1.05 footprint) with its notch facing away from the camera, a raised rim, veins,
 *  and three small pads around it; one smooth body (vertex colours). */
function lilyPad(f: Footprint, seed: number, p: ArenaPalette): PlatformMeshes {
  const leaf = toLinear(p.platformTop);
  const out = { pos: [] as number[], col: [] as number[] };
  addPad(out, 0, 0, f.rx * PAD.size, f.rz * PAD.size, 0, leaf, PAD.rings, PAD.segments);
  const r = rng(0x11d + seed * 71);
  // the small pads: beside and in front of the big one (angles from −z), outside it (e ≈ 1.3 of the footprint)
  for (const [phi, size] of [[1.95, 0.3], [3.45, 0.24], [4.5, 0.36]] as [number, number][]) {
    const a = phi + (r() - 0.5) * 0.3, e = 1.28 + 0.06 * r();
    const s = size * (0.9 + 0.2 * r());
    addPad(out, Math.sin(a) * f.rx * e, -Math.cos(a) * f.rz * e, s, s * 0.62, r() * Math.PI * 2, scale(leaf, 0.92 + 0.12 * r()), 3, 24);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(out.col, 3));
  g.computeVertexNormals();
  return { body: g, top: null, skirt: null, ripple: null };
}

/** Ripple rings: an annulus 0.6–1.25 × footprint just over the water, drawn by RIPPLE_MATERIAL. */
function rippleRing(f: Footprint): PlatformMeshes {
  const R = RIPPLE, n = (R.rings + 1) * R.segments;
  const pos = new Float32Array(n * 3);
  let o = 0;
  for (let k = 0; k <= R.rings; k++) {
    const e = R.e0 + ((R.e1 - R.e0) * k) / R.rings;
    for (let s = 0; s < R.segments; s++) {
      const a = (s / R.segments) * Math.PI * 2;
      pos[o++] = Math.cos(a) * f.rx * e; pos[o++] = R.y; pos[o++] = Math.sin(a) * f.rz * e;
    }
  }
  const idx: number[] = [];
  const vi = (k: number, s: number) => k * R.segments + (s % R.segments);
  for (let k = 0; k < R.rings; k++) {
    for (let s = 0; s < R.segments; s++) idx.push(vi(k, s), vi(k, s + 1), vi(k + 1, s + 1), vi(k, s), vi(k + 1, s + 1), vi(k + 1, s));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return { body: null, top: null, skirt: null, ripple: g };
}

/** Centred on the origin (the part places it at STAGE.player / STAGE.enemy); the top at y ≈ 0 over the footprint. */
export function platformMeshes(style: PlatformStyle, f: Footprint, seed: number, p: ArenaPalette, kind: ArenaKind): PlatformMeshes {
  switch (style) {
    case 'earthGrass': return earthGrass(f, seed, p, kind);
    case 'sandMound': return sandMound(f);
    case 'stoneSlab': return stoneSlab(f, seed, p);
    case 'caveRock': case 'seabedRock': return rockPlatform(f, seed, p);
    case 'lilyPad': return lilyPad(f, seed, p);
    case 'rippleRing': return rippleRing(f);
  }
}

// The ripples' rings: elliptical radius e (× footprint) from the nearer platform of the battle stage (its two platforms,
// fixed), three foam rings drifting out from the battler at 0.6 to fade by 1.22, and a soft collar at its feet; the
// annulus' edges soft. Alpha only: the material's colour is the foam's.
const RIPPLE_HEAD = /* glsl */ `
const vec4 RIPPLE_PLATFORMS[2] = vec4[2](
  vec4(${STAGE.player.x.toFixed(4)}, ${STAGE.player.z.toFixed(4)}, ${PLATFORM_FOOTPRINT.player.rx.toFixed(4)}, ${PLATFORM_FOOTPRINT.player.rz.toFixed(4)}),
  vec4(${STAGE.enemy.x.toFixed(4)}, ${STAGE.enemy.z.toFixed(4)}, ${PLATFORM_FOOTPRINT.enemy.rx.toFixed(4)}, ${PLATFORM_FOOTPRINT.enemy.rz.toFixed(4)}));
`;
const RIPPLE_COLOR = /* glsl */ `
{
  vec2 rp = vKitWorld.xz;
  float e = min(length((rp - RIPPLE_PLATFORMS[0].xy) / RIPPLE_PLATFORMS[0].zw), length((rp - RIPPLE_PLATFORMS[1].xy) / RIPPLE_PLATFORMS[1].zw));
  float n = kitNoise2(rp * 2.6 + vec2(uTime * 0.21, -uTime * 0.17));
  float a = 0.0;
  for (int k = 0; k < 3; k++) {
    float ph = fract(uTime * 0.18 + float(k) / 3.0);
    float r = mix(0.62, 1.2, ph) + (n - 0.5) * 0.05;
    float w = mix(0.025, 0.06, ph);
    a = max(a, (1.0 - smoothstep(w * 0.35, w, abs(e - r))) * (1.0 - ph) * smoothstep(0.0, 0.15, ph));
  }
  a = max(a, (1.0 - smoothstep(0.6, 0.74, e + (n - 0.5) * 0.04)) * (0.5 + 0.2 * n));
  a *= smoothstep(0.6, 0.63, e) * (1.0 - smoothstep(1.15, 1.25, e));
  diffuseColor.a *= a;
}
`;

/** transparent, depthWrite false: foam rings expanding from the battler (uTime), soft edges. */
export const RIPPLE_MATERIAL: KitMaterialOptions = {
  transparent: true, depthWrite: false, roughness: 0.35, fragHead: RIPPLE_HEAD, fragColor: RIPPLE_COLOR, hookKey: 'ripple',
};

/** The bodies' materials: smooth soil (earth, lily pads) or faceted cliff (stone, rock). */
const BODY_MATERIAL: Record<PlatformStyle, KitMaterialOptions> = {
  earthGrass: SOIL_MATERIAL, lilyPad: SOIL_MATERIAL, sandMound: SOIL_MATERIAL, rippleRing: SOIL_MATERIAL,
  stoneSlab: CLIFF_MATERIAL, caveRock: CLIFF_MATERIAL, seabedRock: CLIFF_MATERIAL,
};

const PN = { position: 3, normal: 3 }, PNC = { position: 3, normal: 3, color: 3 };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

/** The two platforms' geometries of one kind (`key`), each moved to its platform and merged (one draw for both). */
function merged(meshes: { at: THREE.Vector3; m: PlatformMeshes }[], key: 'top' | 'body' | 'ripple'): THREE.BufferGeometry | null {
  const gs = meshes.map(({ at, m }) => m[key]?.translate(at.x, 0, at.z) ?? null).filter((g): g is THREE.BufferGeometry => g !== null);
  if (!gs.length) return null;
  const g = mergeGeometries(gs)!;
  for (const x of gs) x.dispose();
  g.computeBoundingSphere();
  return g;
}

export const PLATFORM_PART: ArenaPart = {
  name: 'platforms',
  kinds: 'all',
  catalogue(ph): readonly CatalogueEntry[] {
    return [
      { material: SOIL_MATERIAL, mesh: 'mesh', attrs: PNC, castShadow: true },
      { material: CLIFF_MATERIAL, mesh: 'mesh', attrs: PNC, castShadow: true },
      { material: GRASS_MATERIAL, mesh: 'instancedColors', attrs: PNC, castShadow: false },
      { material: RIPPLE_MATERIAL, mesh: 'mesh', attrs: PN, castShadow: false },
      // (the tops: the ground's program)
      { material: arenaGroundMaterial(ph(), new THREE.Vector2(), new THREE.Vector2(), 0, 0), mesh: 'mesh', attrs: PN, castShadow: false },
    ];
  },
  build(ctx) {
    const style = PLATFORM_STYLE[ctx.kind];
    const meshes = ([[ctx.stage.player, PLATFORM_FOOTPRINT.player, 1], [ctx.stage.enemy, PLATFORM_FOOTPRINT.enemy, 2]] as const)
      .map(([at, f, seed]) => ({ at, m: platformMeshes(style, f, seed, ctx.palette, ctx.kind) }));
    const group = new THREE.Group();
    const top = merged(meshes, 'top');
    if (top) {
      // (the tops' own cells, all platform: the field's would show at their rims, where the terrain's warped lookup
      // reaches past the footprint's cells)
      const cells = uniformCells(ctx.palette.platformMat, ctx.palette.platformTop);
      ctx.disposables.push(cells.tex);
      const mesh = new THREE.Mesh(top, arenaGround(ctx, cells));
      mesh.name = 'platformTops';
      // (drawn with the ground, after the battlers: their terrain shading is skipped where a battler covers them)
      mesh.renderOrder = GROUND_RENDER_ORDER;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    const body = merged(meshes, 'body');
    if (body) {
      const km = kitMaterial(ctx.uniforms, BODY_MATERIAL[style]);
      const mesh = new THREE.Mesh(body, km.material);
      applyKitMaterial(mesh, km);
      mesh.name = 'platformBodies';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // soil and stone (their colours: the side's × k) moonlit at night as the kit's berry soil (NIGHT_SOIL, through the
      // material's colour from uNight: no program of their own; never near-black); lily pads stay leaf green
      if (style !== 'lilyPad') {
        const side = toLinear(ctx.palette.platformSide), night = ctx.uniforms.uNight, k: RGB = [1, 1, 1], material = km.material;
        mesh.onBeforeRender = () => {
          nightSoilScale(side, night.value, k);
          material.color.setRGB(k[0], k[1], k[2]);
        };
      }
      group.add(mesh);
    }
    const ripple = merged(meshes, 'ripple');
    if (ripple) {
      const foam = mix(ctx.palette.platformTop, [1, 1, 1], 0.65);
      const mesh = new THREE.Mesh(ripple, kitMaterial(ctx.uniforms, { ...RIPPLE_MATERIAL, color: _c.setRGB(...toLinear(foam)) }).material);
      mesh.name = 'platformRipples';
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    const clumps = meshes.reduce((n, { m }) => n + (m.skirt ? m.skirt.length / 4 : 0), 0);
    if (clumps) {
      const km = kitMaterial(ctx.uniforms, GRASS_MATERIAL);
      const inst = new THREE.InstancedMesh(clump(BLADES[ctx.quality], 0), km.material, clumps);
      applyKitMaterial(inst, km);
      const skirt = toLinear(ctx.palette.skirt), rand = rng(0x5c17);
      let i = 0;
      for (const { at, m } of meshes) {
        const s = m.skirt;
        if (!s) continue;
        for (let k = 0; k < s.length; k += 4) {
          _q.setFromAxisAngle(_up, s[k + 3]);
          _m.compose(_p.set(at.x + s[k], SKIRT.rootY, at.z + s[k + 1]), _q, _s.setScalar(s[k + 2]));
          inst.setMatrixAt(i, _m);
          const v = 0.78 + 0.22 * rand();
          inst.setColorAt(i++, _c.setRGB(skirt[0] * v, skirt[1] * v, skirt[2] * v));
        }
      }
      inst.name = 'platformSkirts';
      inst.receiveShadow = true;
      inst.castShadow = false;
      inst.computeBoundingSphere();
      group.add(inst);
    }
    return group;
  },
};
