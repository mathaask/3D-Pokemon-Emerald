// The rock arenas: the mountain, the cave, the cave pond, Groudon's cave and Kyogre's (Marine Cave). A cliff band closes
// the back of each — an irregular wall facing the stage, layered in soft rounded strata (each stratum a little proud of
// the grooves between them, lighter and darker bands as the GBA's striped top band), darker at its foot, a rounded lip on
// top — with a talus of rubble at its foot. The battle camera never frames the horizon (D1): at its top edge it sees the
// band's lower strata, the top band of the frame. Before it stand stalagmites (the caves; the cave pond's on its bank) and
// boulder clusters (the mountain's sides), scree on the ground; Groudon's cave in volcanic rock has pools of flowing lava
// glowing in the background's accent colour (bloom, no light of their own: the battle's light set is fixed). The rock is
// one draw in the kit's cliff material (faceted), casting and receiving shadows; the lava one more (LAVA_MATERIAL).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noise2, noise3, rng } from '../../kit/geom';
import { kitMaterial, type KitMaterialOptions } from '../../kit/materials';
import { mix, scale, toLinear, type RGB } from '../../kit/palette';
import { CLIFF_MATERIAL } from '../../kit/cliffs';
import { glslFloat } from '../../actors/glsl';
import { ARENA_SETTING, type ArenaKind } from '../arenaKind';
import type { ArenaContext, ArenaPart, CatalogueEntry } from '../modernArena';
import { GROUND_Y, WATER_Y, type Stage } from '../stage';
import { CAVE_POND, groundHeight, moonlitAsGround } from './ground';
import { rockCluster } from './rocks';
import { arenaClear } from './flora';
import { SCENERY_SEED, frameProjector, frameTop, insideEllipse, scatter, sightCap, stageKeepOut } from './scatter';

// ------------------------------------------------------------------------------------------------- the cliff band

/** A cliff band round the stage: its radius from the stage centre, the angles it spans (± `arc` rad from straight behind
 *  the stage, −z) and its height range over the ground. */
export interface WallBand { r: number; arc: number; height: [number, number] }

/** The band's build: a column every `col` units along the arc, `rows` vertex rows per unit of height from `foot` under
 *  the ground; its relief (noise3, radial, ±`displace` at `freq` per unit); its radius wandering ±`wobble` along the arc;
 *  its face leaning back `lean` per unit up; strata `layer` units thick, each bulging `bulge` towards the stage between
 *  grooves (up to: the ledges come and go along the band); buttresses standing out up to `buttress` and alcoves sunk up
 *  to `alcove` along it (a noise2 every ≈ 1 / `bays` units: the camera frames only the band's lowest ≈ 1.2–1.6 units —
 *  they break its line there, the strata stepping `step` up or down across them); a rounded lip of radius `lip` on top;
 *  its heights falling to `endHeight` over the arc's last (1 − `end`). */
const WALL = { col: 1.2, rows: 4, foot: 0.3, displace: 0.35, freq: 0.3, wobble: 1.0, lean: 0.18, layer: [0.45, 0.95] as const,
  bulge: 0.24, buttress: 1.3, alcove: 0.9, bays: 0.17, step: 0.45, lip: 0.6, end: 0.85, endHeight: 0.6 };

/** The seed every band is built with (the talus at its foot must agree on it). */
export const WALL_SEED = SCENERY_SEED * 17 + 3;

/** The band's radius at its foot at angle `a` (radians off straight behind): `band.r` wandering ±WALL.wobble along it. */
export function wallRadius(seed: number, band: WallBand, a: number): number {
  return band.r + WALL.wobble * noise2(a * band.r * 0.06 + (seed % 997) * 1.31, seed * 1.7, 0xa11);
}

/** A soft bump over a stratum (0 at its grooves, 1 in its middle). */
const bump = (f: number) => Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, f))), 0.8);
const smooth = (e0: number, e1: number, x: number) => THREE.MathUtils.smoothstep(x, e0, e1);

/** The band's foot at angle `a` (radians off straight behind): `rs` its wandering radius (wallRadius), `bay` the noise
 *  along the band that stands buttresses out where it is high and sinks alcoves where it is low, `out` and `sunk` their
 *  shares (0..1) there, and `r` the face's radius at the ground — rs less the buttress (WALL.buttress × out, towards
 *  the stage) plus the alcove (WALL.alcove × sunk), before the strata's and the relief's few tenths. The band is built
 *  on it (rockWallGeometry) and its talus piled against it (boulderPlacements). */
export function wallFoot(seed: number, band: WallBand, a: number): { r: number; rs: number; bay: number; out: number; sunk: number } {
  const rs = wallRadius(seed, band, a), u = a * band.r, o = (seed % 997) * 1.31;
  const bay = noise2(u * WALL.bays + o, seed * 0.9, 0xb7e);
  const out = smooth(0.12, 0.5, bay), sunk = smooth(0.15, 0.55, -bay);
  return { r: rs - WALL.buttress * out + WALL.alcove * sunk, rs, bay, out, sunk };
}

/** A band's strata from below its foot to over its top: the boundaries (world y, rising) and each stratum's shade (light
 *  and dark bands alternating, a little jitter; the dark ones a little warmer). */
function strata(seed: number, y0: number, y1: number): { at: number[]; shade: RGB[] } {
  const r = rng(seed * 2909 + 0x57a7);
  const at: number[] = [], shade: RGB[] = [];
  for (let y = y0 - 1, i = 0; y < y1 + 1; i++) {
    at.push(y);
    const k = (i % 2 ? 1.08 : 0.9) * (0.95 + 0.1 * r());
    shade.push(i % 2 ? [k, k, k] : [k, k * 0.96, k * 0.9]);
    y += WALL.layer[0] + (WALL.layer[1] - WALL.layer[0]) * r();
  }
  at.push(Infinity);
  return { at, shade };
}

/** An irregular cliff band facing the stage: columns every ≈ 1.2 units along the arc (± `arc` rad from straight behind),
 *  each a strip from the ground (`ground`, default GROUND_Y) − 0.3 up to a noise height (`band.height` over the ground,
 *  falling to the ground at the arc's ends), 4 rows per unit displaced by noise3 (±0.35), strata in the vertex colours
 *  (darker at the foot, lighter and darker bands) and in its relief (each stratum a soft bulge between grooves), a rounded
 *  lip on top; normals towards the stage; position, normal, color(3) (`color` sRGB, linear in the attribute). */
export function rockWallGeometry(seed: number, stage: Stage, band: WallBand, color: RGB,
  ground: (x: number, z: number) => number = () => GROUND_Y): THREE.BufferGeometry {
  const W = WALL;
  const cx = stage.centre.x, cz = stage.centre.z;
  const segs = Math.max(2, Math.ceil((2 * band.arc * band.r) / W.col)), cols = segs + 1;
  const [h0, h1] = band.height;
  const K = Math.ceil((h1 + W.foot) * W.rows), rows = K + 1;
  const n = cols * rows;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const base = toLinear(color);
  const o = (seed % 997) * 1.31;
  const st = strata(seed, GROUND_Y - W.foot - 2, GROUND_Y + h1 + 2);
  for (let s = 0; s < cols; s++) {
    const a = -band.arc + (2 * band.arc * s) / segs, u = a * band.r;
    const dx = Math.sin(a), dz = -Math.cos(a);
    // (the buttresses and alcoves: out towards the stage where a noise along the band is high, sunk where it is low —
    // wallFoot; a buttress spreads at its foot: wider and further out at the ground, as rock fallen from it)
    const { rs, bay, out, sunk } = wallFoot(seed, band, a);
    const bx = cx + dx * rs, bz = cz + dz * rs;
    const g = ground(bx, bz);
    // the column's height: broad swells along the band and smaller rises on them; falling to the ground at its ends
    const hn = THREE.MathUtils.clamp(0.5 + 0.38 * noise2(u * 0.05 + o, seed * 3.1, 0x41d) + 0.17 * noise2(u * 0.16, seed * 1.3, 0x41e), 0, 1);
    const end = 1 - smooth(band.arc * W.end, band.arc, Math.abs(a));
    const h = W.endHeight + (h0 + (h1 - h0) * hn - W.endHeight) * end;
    const lip = Math.min(W.lip, h * 0.4), top = g + h, foot = g - W.foot;
    // (the strata slant a little along the band, and step across the buttresses)
    const slant = 0.22 * noise2(u * 0.12 + o, seed * 0.7, 0x5a7) + W.step * bay;
    let li = 0;
    for (let k = 0; k < rows; k++) {
      const y = foot + ((top - foot) * k) / K, yy = y - g;
      const ys = y + slant;
      while (st.at[li + 1] <= ys) li++;
      while (li > 0 && st.at[li] > ys) li--;
      const f = (ys - st.at[li]) / (st.at[li + 1] - st.at[li]);
      // (each stratum's ledge comes and goes along the band)
      const ledge = 0.3 + 0.7 * THREE.MathUtils.clamp(0.5 + 0.6 * noise2(u * 0.14 + li * 3.7, li * 1.9, 0xb17), 0, 1);
      let rad = rs + W.lean * Math.max(0, yy) - W.bulge * ledge * bump(f)
        - W.buttress * out * (1 - 0.45 * smooth(0, 3, yy)) + W.alcove * sunk * (1 - 0.6 * smooth(2, 6, yy));
      // (the lip: within its radius of the top the face rounds back over)
      const dl = y - (top - lip);
      if (dl > 0) rad += lip - Math.sqrt(Math.max(0, lip * lip - dl * dl));
      rad += W.displace * noise3(bx * W.freq + o, y * W.freq * 1.2, bz * W.freq - o);
      const i = (s * rows + k) * 3;
      pos[i] = cx + dx * rad; pos[i + 1] = y; pos[i + 2] = cz + dz * rad;
      // darker at the foot, the stratum's shade, darker in the grooves, a little variation along the band, a lighter lip
      const sh = st.shade[li];
      const k0 = (0.8 + 0.2 * smooth(-0.1, 0.6, yy)) * (0.9 + 0.1 * bump(f)) * (0.93 + 0.14 * noise2(u * 0.09, y * 0.15, 0x5ad))
        * (1 + 0.12 * smooth(0, lip, dl)) * (1 + 0.08 * out - 0.16 * sunk * (1 - smooth(2, 6, yy)));
      col[i] = base[0] * sh[0] * k0; col[i + 1] = base[1] * sh[1] * k0; col[i + 2] = base[2] * sh[2] * k0;
    }
  }
  // (column s → s + 1 runs left to right as the stage sees the band, row k → k + 1 upwards: a → b → c faces the stage)
  const idx = new Uint32Array(segs * K * 6);
  let t = 0;
  for (let s = 0; s < segs; s++) {
    for (let k = 0; k < K; k++) {
      const a = s * rows + k, b = a + rows, c = b + 1, d = a + 1;
      idx[t++] = a; idx[t++] = b; idx[t++] = c;
      idx[t++] = a; idx[t++] = c; idx[t++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// ------------------------------------------------------------------------------------------------- stalagmites

/** A stalagmite's build: sides, rows per unit of height, its base radius (`base` + `perHeight` × height), its foot sunk
 *  `sink` under the ground. */
const SPIRE = { sides: 8, rows: 3, base: 0.2, perHeight: 0.16, sink: 0.25, cap: 0.9 };

/** A stalagmite `height` tall from y = 0 (its foot sunk a little under it): a faceted cone, flared at its foot, tapering
 *  to a blunt tip, leaning a little, its rings displaced by noise3 and ridged by growth rings; darker at the foot, lighter to
 *  the tip (`color` sRGB). position, normal, color(3) (linear). */
export function stalagmiteGeometry(seed: number, height: number, color: RGB): THREE.BufferGeometry {
  const S = SPIRE;
  const r = rng(seed * 6151 + 0x57a);
  const rows = Math.max(4, Math.ceil(height * S.rows)), sides = S.sides;
  const R0 = S.base + S.perHeight * height;
  const lx = (r() - 0.5) * 0.14 * height, lz = (r() - 0.5) * 0.14 * height, turn = r() * Math.PI * 2, o = (seed % 991) * 1.73;
  const ph = r() * Math.PI * 2, ring = 6 + 3 * r();
  const n = rows * sides + 1;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const base = toLinear(color);
  for (let k = 0; k < rows; k++) {
    const t = k / (rows - 1), y = -S.sink + (height * S.cap + S.sink) * t, tt = Math.max(0, y / height);
    const lean = tt * tt;
    // (a concave taper, flared at the foot, to a blunt tip — its last ring short of the top; growth rings)
    const rad = R0 * Math.pow(1 - 0.85 * tt, 1.5) * (1 + 0.35 * Math.pow(1 - tt, 6)) * (1 + 0.07 * Math.sin(y * ring + ph));
    for (let q = 0; q < sides; q++) {
      const a = turn + (q / sides) * Math.PI * 2, cxq = Math.cos(a), szq = Math.sin(a);
      const d = rad * (1 + 0.2 * noise3(cxq * 1.4 + o, y * 1.1, szq * 1.4 - o));
      const i = (k * sides + q) * 3;
      pos[i] = cxq * d + lx * lean; pos[i + 1] = y; pos[i + 2] = szq * d + lz * lean;
      const sh = (0.7 + 0.42 * tt) * (0.95 + 0.05 * Math.sin(y * ring + ph)) * (0.94 + 0.12 * ((q * 5 + k * 3) % 7) / 7);
      col[i] = base[0] * sh; col[i + 1] = base[1] * sh; col[i + 2] = base[2] * sh;
    }
  }
  const tip = rows * sides * 3;
  pos[tip] = lx; pos[tip + 1] = height; pos[tip + 2] = lz;
  for (let c = 0; c < 3; c++) col[tip + c] = base[c] * 1.12;
  const idx: number[] = [];
  const vi = (k: number, q: number) => k * sides + (q % sides);
  // (q → q + 1 turns counter-clockwise seen from above: a → b → c faces outwards)
  for (let k = 0; k + 1 < rows; k++) {
    for (let q = 0; q < sides; q++) idx.push(vi(k, q), vi(k + 1, q), vi(k + 1, q + 1), vi(k, q), vi(k + 1, q + 1), vi(k, q + 1));
  }
  for (let q = 0; q < sides; q++) idx.push(vi(rows - 1, q), rows * sides, vi(rows - 1, q + 1));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** A cluster's spires round its first (at its origin): the first `height` tall, a smaller one (0.3–0.6 of it) at its feet
 *  for each further seed; their offsets, heights and seeds. */
export function clusterSpires(seeds: readonly number[], height: number): { dx: number; dz: number; height: number; seed: number }[] {
  return seeds.map((seed, i) => {
    if (i === 0) return { dx: 0, dz: 0, height, seed };
    const r = rng(seed * 31 + 3);
    const h = height * (0.3 + 0.3 * r()), a = r() * Math.PI * 2, d = SPIRE.base + SPIRE.perHeight * height + 0.15 + 0.2 * r();
    return { dx: Math.cos(a) * d, dz: Math.sin(a) * d, height: h, seed };
  });
}

/** A stalagmite cluster (clusterSpires), merged. */
function stalagmiteCluster(seeds: readonly number[], height: number, color: RGB): THREE.BufferGeometry {
  const parts = clusterSpires(seeds, height).map((s) => stalagmiteGeometry(s.seed, s.height, color).translate(s.dx, 0, s.dz));
  const g = mergeGeometries(parts)!;
  for (const x of parts) x.dispose();
  return g;
}

// ------------------------------------------------------------------------------------------------- placements

/** Scenery keeps out of the ground behind each battler (its silhouette's background), this far to its side and up to
 *  `reach` behind it. */
const BEHIND_HALF = 3.5;
function behindBattler(stage: Stage, x: number, z: number, reach: number): boolean {
  return [stage.player, stage.enemy].some((p) => z < p.z && z > p.z - reach && Math.abs(x - p.x) < BEHIND_HALF);
}
/** Far enough behind a battler, a stalagmite or a boulder shows over its head (the frame's top band). */
export const BEHIND_REACH = 12;

/** A kind's band, its rock's colour and what stands before it. */
interface RockRule {
  band: WallBand;
  /** Stalagmites: how many (a range), the annulus; small ones (≤ 1 unit: off the platforms, under the sight lines) too. */
  spires?: { count: [number, number]; r: [number, number]; height: [number, number]; small: [number, number] };
  /** Boulder clusters at the stage's sides (angles off straight behind) and scree on the ground. */
  boulders?: { count: number; r: [number, number]; angle: [number, number]; size: [number, number] };
  scree?: { count: number; r: [number, number]; size: [number, number] };
  /** Rubble along the band's foot: pieces per unit of arc, sizes. */
  talus: { per: number; size: [number, number] };
  /** Lava pools (LAVA). */
  lava?: true;
}

const CAVE_SPIRES = { count: [15, 25] as [number, number], r: [6, 14] as [number, number], height: [1.5, 4] as [number, number],
  small: [0.45, 0.95] as [number, number] };
export const ROCK_RULES: Partial<Record<ArenaKind, RockRule>> = {
  mountain: { band: { r: 22, arc: 1.7, height: [7, 13] }, talus: { per: 0.55, size: [0.5, 1.5] },
    boulders: { count: 5, r: [10, 18], angle: [0.55, 1.5], size: [1.3, 2.4] }, scree: { count: 26, r: [6, 16], size: [0.22, 0.75] } },
  cave: { band: { r: 17, arc: 1.75, height: [10, 16] }, talus: { per: 0.5, size: [0.4, 1.3] }, spires: CAVE_SPIRES,
    scree: { count: 30, r: [6, 14], size: [0.15, 0.55] } },
  groudon: { band: { r: 17, arc: 1.75, height: [10, 16] }, talus: { per: 0.5, size: [0.4, 1.3] }, spires: CAVE_SPIRES,
    scree: { count: 10, r: [6, 14], size: [0.2, 0.6] }, lava: true },
  cavePond: { band: { r: 21, arc: 1.7, height: [10, 16] }, talus: { per: 0.5, size: [0.4, 1.3] },
    spires: { count: [10, 14], r: [13, 20], height: [1.5, 4], small: [0, 0] } },
  kyogre: { band: { r: 19, arc: 1.7, height: [10, 16] }, talus: { per: 0.25, size: [0.8, 1.6] } },
};

/** A kind's lava pools (lavaPools: Groudon's; none elsewhere). */
const kindPools = (kind: ArenaKind, stage: Stage, seed: number): LavaPool[] => (ROCK_RULES[kind]?.lava ? lavaPools(stage, seed) : []);
/** Off `pools` (their banks and a little more). */
function offLava(pools: readonly LavaPool[]): (x: number, z: number) => boolean {
  return (x, z) => pools.every((p) => Math.hypot(p.x - x, p.z - z) > p.r * (1 + LAVA.wobble) + LAVA.margin + 0.4);
}

/** A stalagmite's tip shows at least this far under the frame's top edge (a spire cut by it reads as a pillar). */
export const TIP_SHOWN = 0.3;
/** A kind's stalagmites stand this far inside its band (off the talus); small ones no further forward than this in front
 *  of the stage centre (beside the stage: in the foreground the intro sweep's frame cut their tips at its bottom edge). */
const SPIRE_BAND_GAP = 2.5;
export const SMALL_FRONT = 2;

export interface ArenaSpire { x: number; z: number; height: number; seeds: number[] }

/** The cave pond's bank: the ground between its water (CAVE_POND: off its shore) and its band. */
const onPondBank = (stage: Stage, x: number, z: number) =>
  Math.hypot((x - stage.centre.x) / CAVE_POND.rx, (z - stage.centre.z - CAVE_POND.dz) / CAVE_POND.rz) > 1.12;

/** A kind's stalagmites: tall ones (1.5–4) on the tall rule, in its annulus inside its band, out from behind the
 *  battlers (BEHIND_REACH), each fitted under the frame's top edge (its tip shows: TIP_SHOWN; one that would stay under
 *  1.1 units is left out); small ones (≤ 1 unit) off the platforms and the strip in front of the player's, under the
 *  camera's sight lines to the platforms, beside or behind the stage (SMALL_FRONT); the cave pond's on its bank. Some
 *  stand in clusters (1–3 spires: clusterSpires). */
export function stalagmitePlacements(kind: ArenaKind, stage: Stage, seed: number,
  pools: readonly LavaPool[] = kindPools(kind, stage, seed)): ArenaSpire[] {
  const rule = ROCK_RULES[kind]?.spires;
  if (!rule) return [];
  const band = ROCK_RULES[kind]!.band;
  const r = rng(seed * 7307 + 0x5917);
  const n = rule.count[0] + Math.floor(r() * (rule.count[1] - rule.count[0] + 1));
  const ko = stageKeepOut(stage), clear = arenaClear(stage), cap = sightCap(stage), top = frameTop(stage);
  const lava = offLava(pools);
  const bank = kind === 'cavePond' ? (x: number, z: number) => onPondBank(stage, x, z) : lava;
  const r1 = Math.min(rule.r[1], band.r - SPIRE_BAND_GAP);
  const tall = scatter(seed * 7307 + 0x7a11, { centre: stage.centre, r0: rule.r[0], r1, count: n, minGap: 2.2,
    accept: (x, z) => ko.tallOk(x, z) && !behindBattler(stage, x, z, BEHIND_REACH) && bank(x, z) });
  const out: ArenaSpire[] = [];
  for (const p of tall) {
    const want = rule.height[0] + (rule.height[1] - rule.height[0]) * r();
    const ground = groundHeight(kind, p.x, p.z, stage);
    const height = Math.min(want, top(p.x, p.z) - TIP_SHOWN - ground);
    const all = Array.from({ length: 1 + Math.floor(r() * 3) }, () => Math.floor(r() * 1e6));
    // (a smaller spire at its feet keeps to the rules too: a tall one on the tall rule, none behind a battler)
    const seeds = clusterSpires(all, height).filter((s, i) => i === 0
      || ((s.height <= 1 || ko.tallOk(p.x + s.dx, p.z + s.dz)) && !behindBattler(stage, p.x + s.dx, p.z + s.dz, BEHIND_REACH))).map((s) => s.seed);
    if (height >= 1.1) out.push({ x: p.x, z: p.z, height, seeds });
  }
  if (rule.small[1] > 0) {
    const m = Math.round(n * 0.3);
    const small = scatter(seed * 7307 + 0x5a11, { centre: stage.centre, r0: rule.r[0], r1: 11, count: m, minGap: 2,
      accept: (x, z) => clear(x, z) && z <= stage.centre.z + SMALL_FRONT && !behindBattler(stage, x, z, 6) && bank(x, z) });
    for (const p of small) {
      const want = rule.small[0] + (rule.small[1] - rule.small[0]) * r();
      const height = Math.min(want, cap(p.x, p.z) - groundHeight(kind, p.x, p.z, stage));
      const seeds = [Math.floor(r() * 1e6)];
      if (height >= 0.35) out.push({ x: p.x, z: p.z, height, seeds });
    }
  }
  return out;
}

/** A boulder or a scree stone: its place, width and seeds (rocks.ts rockCluster); `talus`: one of the band's foot. */
export interface ArenaBoulder { x: number; z: number; size: number; seeds: number[]; talus?: true }

/** A boulder's top over the ground for its width (rocks.ts boulderGeometry, sunk 0.12 of its width as the part sets
 *  it), and the width from which a boulder is tall (on the tall rule, as rocks.ts TALL_SIZE). */
export const BOULDER_TOP = 0.65, TALL_SIZE = 1.1;

/** A kind's boulders: clusters at the stage's sides (on the tall rule, out from behind the battlers), scree on the ground
 *  (off the platforms and the strip in front of the player's, under the sight lines: a stone whose top would cross them
 *  is left out; wide ones on the tall rule) and the talus along its band's foot. */
export function boulderPlacements(kind: ArenaKind, stage: Stage, seed: number,
  pools: readonly LavaPool[] = kindPools(kind, stage, seed)): ArenaBoulder[] {
  const rule = ROCK_RULES[kind];
  if (!rule) return [];
  const r = rng(seed * 4241 + 0xb01d);
  const ko = stageKeepOut(stage), clear = arenaClear(stage), cap = sightCap(stage), lava = offLava(pools);
  const cx = stage.centre.x, cz = stage.centre.z;
  const seeds = () => Array.from({ length: 1 + Math.floor(r() * 3) }, () => Math.floor(r() * 1e6));
  const out: ArenaBoulder[] = [];
  const offAngle = (x: number, z: number) => Math.abs(Math.atan2(x - cx, cz - z));
  if (rule.boulders) {
    const b = rule.boulders;
    const pts = scatter(seed * 4241 + 0xc105, { centre: stage.centre, r0: b.r[0], r1: b.r[1], count: b.count, minGap: 4,
      accept: (x, z) => ko.tallOk(x, z) && !behindBattler(stage, x, z, BEHIND_REACH)
        && offAngle(x, z) >= b.angle[0] && offAngle(x, z) <= b.angle[1] });
    for (const p of pts) out.push({ x: p.x, z: p.z, size: b.size[0] + (b.size[1] - b.size[0]) * r(), seeds: seeds() });
  }
  if (rule.scree) {
    const s = rule.scree;
    const pts = scatter(seed * 4241 + 0x5c4e, { centre: stage.centre, r0: s.r[0], r1: s.r[1], count: s.count, minGap: 1.4,
      accept: (x, z) => clear(x, z) && !behindBattler(stage, x, z, 6) && lava(x, z) });
    for (const p of pts) {
      const size = s.size[0] + (s.size[1] - s.size[0]) * r();
      const ground = groundHeight(kind, p.x, p.z, stage);
      if (ground + size * BOULDER_TOP > cap(p.x, p.z) || (size >= TALL_SIZE && !ko.tallOk(p.x, p.z))) continue;
      out.push({ x: p.x, z: p.z, size, seeds: [Math.floor(r() * 1e6)] });
    }
  }
  // the talus: rubble piled against the band's foot, in heaps (a noise along the band: dense and coarse in the heaps,
  // a few stones between them) — against its face there (wallFoot: out on a buttress, back in an alcove)
  const band = rule.band, t = rule.talus;
  const m = Math.round(2 * band.arc * band.r * t.per * 1.6);
  for (let i = 0; i < m; i++) {
    const a = -band.arc * 0.97 + (2 * band.arc * 0.97 * (i + r())) / m;
    const heap = THREE.MathUtils.clamp(0.5 + 0.7 * noise2(a * band.r * 0.11, seed * 2.3, 0x7a1), 0, 1);
    if (r() > 0.15 + 0.85 * heap) continue;
    const size = t.size[0] + (t.size[1] - t.size[0]) * r() * (0.4 + 0.6 * heap);
    const rad = wallFoot(WALL_SEED, band, a).r - 0.25 - size * 0.45 - 1.4 * r() * r() * heap;
    const x = cx + Math.sin(a) * rad, z = cz - Math.cos(a) * rad;
    if ((size >= TALL_SIZE && !ko.tallOk(x, z)) || !lava(x, z)) continue;
    out.push({ x, z, size, seeds: seeds(), talus: true });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------- lava

/** A lava pool: its centre, its radius (its outline wanders ± `wobble` of it) and its seed. */
export interface LavaPool { x: number; z: number; r: number; seed: number }
/** Lava pools: radii, how far their outlines wander, the annulus, their spacing, the margin their banks keep off the
 *  platforms and the strip in front of the player's, the ground behind each battler they keep off (its silhouette's: this
 *  far to its side, up to `reach` behind it); darts per pool; their surface this far over the ground. */
const LAVA = { count: [3, 5] as const, r: [1.2, 2.1] as const, wobble: 0.28, ring: [4.5, 14] as const, gap: 2, margin: 0.8,
  behind: { half: 2.2, reach: 8 }, tries: 400, y: 0.02, rings: 3, segments: 28 };
/** A pool's outline radius at angle `a` (its rim wanders by noise2). */
export function poolRadius(p: LavaPool, a: number): number {
  const o = (p.seed % 991) * 0.71;
  return p.r * (1 + LAVA.wobble * noise2(Math.cos(a) * 1.3 + o, Math.sin(a) * 1.3 - o, 0x1a4a));
}

/** A pool shows in a frame when its middle — its centre and the points half its radius out — projects inside it, this
 *  far in from its sides and its top, over its bottom third (the GBA's text box covers that in play). */
const LAVA_FRAMED = { side: 0.9, top: 0.85, bottom: -0.35, margin: 0.5 };
/** The frames the pools are placed against: the idle camera's (every pool shows there), then the ones it swings to. */
const LAVA_YAWS = [0, -0.9, 0.9];
/** A battler as the pools keep off it in the idle frame: a box this wide and tall (world units: a 64-px sprite is 2) on its
 *  platform, projected — a pool's middle never lies in it (behind or before the battler: its glow round a silhouette;
 *  its rim may peek past one). */
const BATTLER_BOX = { half: 1.0, depth: 0.3, height: 2.0 };
/** A frame (frameProjector) and the battlers' boxes in it (NDC x0, y0, x1, y1). */
interface LavaFrame { project: ReturnType<typeof frameProjector>; boxes: [number, number, number, number][] }
function lavaFrame(stage: Stage, yaw: number): LavaFrame {
  const project = frameProjector(stage, yaw), B = BATTLER_BOX;
  const boxes = [stage.player, stage.enemy].map((p): [number, number, number, number] => {
    const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const dx of [-B.half, B.half]) for (const dz of [-B.depth, B.depth]) for (const y of [0, B.height]) {
      const v = project(p.x + dx, y, p.z + dz, _v);
      box[0] = Math.min(box[0], v.x); box[1] = Math.min(box[1], v.y); box[2] = Math.max(box[2], v.x); box[3] = Math.max(box[3], v.y);
    }
    return box;
  });
  return { project, boxes };
}
/** A pool's middle: its centre and 8 points LAVA_FRAMED.margin of its radius out. */
function poolMiddle(p: LavaPool, each: (x: number, z: number) => boolean): boolean {
  if (!each(p.x, p.z)) return false;
  for (let q = 0; q < 8; q++) {
    const a = (q / 8) * Math.PI * 2, d = poolRadius(p, a) * LAVA_FRAMED.margin;
    if (!each(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d)) return false;
  }
  return true;
}
/** Whether a pool shows in a frame (LAVA_FRAMED); `clear`: and its middle lies over neither battler's box there. */
function poolShows(p: LavaPool, f: LavaFrame, clear = false): boolean {
  return poolMiddle(p, (x, z) => {
    const v = f.project(x, GROUND_Y, z, _v);
    if (v.z >= 1 || Math.abs(v.x) > LAVA_FRAMED.side || v.y > LAVA_FRAMED.top || v.y < LAVA_FRAMED.bottom) return false;
    return !clear || !f.boxes.some((b) => v.x > b[0] && v.x < b[2] && v.y > b[1] && v.y < b[3]);
  });
}
const _v = new THREE.Vector3();

/** Groudon's lava pools: 3–5 (the seed picks), radius 1.2–2.1, r 4.5–14 from the stage centre (the brief's 7–14 left the
 *  mid-ground beside the stage bare), placed against the frame: each shows in the idle camera's frame where one fits
 *  (LAVA_FRAMED: over the text box, its middle off the battlers' boxes) — the first two the nearest darts that do, the rest
 *  those showing in most of the frames the camera swings to (yaw ∓0.9) as well, then the nearest; a pool that fits there
 *  nowhere is tried a quarter smaller, then in any of the three frames (its middle off the battlers' boxes there): the
 *  idle frame, between and round its battlers, holds two; the rest show as the camera swings. Their outlines and banks
 *  (+ LAVA.margin) keep off the platforms × 1.25 (the keep-outs) and the strip in front of the player's, their outlines
 *  off the ground just behind each battler (LAVA.behind); a pool that fits nowhere at all is left out. `o.ring`: another
 *  annulus for the darts (Magma's hideout, parts/stadium.ts: outside its rim); `o.keep`: where the banks may lie besides
 *  (the same rules otherwise; without options Groudon's pools exactly). */
export interface LavaPoolOptions { ring?: readonly [number, number]; keep?: (x: number, z: number) => boolean }
export function lavaPools(stage: Stage, seed: number, o: LavaPoolOptions = {}): LavaPool[] {
  const r = rng(seed * 3371 + 0x1a4a);
  const n = LAVA.count[0] + Math.floor(r() * (LAVA.count[1] - LAVA.count[0] + 1));
  const ko = stageKeepOut(stage), clear = arenaClear(stage), frames = LAVA_YAWS.map((y) => lavaFrame(stage, y));
  const radii = Array.from({ length: n }, () => LAVA.r[0] + (LAVA.r[1] - LAVA.r[0]) * r());
  const seeds = Array.from({ length: n }, () => Math.floor(r() * 1e6));
  const behind = (x: number, z: number) => [stage.player, stage.enemy].some((p) =>
    z < p.z && z > p.z - LAVA.behind.reach && Math.abs(x - p.x) < LAVA.behind.half);
  const fits = (p: LavaPool) => {
    for (let q = 0; q < 24; q++) {
      const a = (q / 24) * Math.PI * 2, d = poolRadius(p, a), c = Math.cos(a), s = Math.sin(a);
      const bx = p.x + c * (d + LAVA.margin), bz = p.z + s * (d + LAVA.margin);
      if (ko.ellipses.some((e) => insideEllipse(e, bx, bz)) || !clear(bx, bz) || behind(p.x + c * d, p.z + s * d)) return false;
      if (o.keep && !o.keep(bx, bz)) return false;
    }
    return true;
  };
  const out: LavaPool[] = [];
  const cx = stage.centre.x, cz = stage.centre.z, [r0, r1] = o.ring ?? LAVA.ring;
  const darts = rng(seed * 3371 + 0x7001);
  const near = (p: LavaPool) => Math.hypot(p.x - cx, p.z - cz);
  for (let k = 0; k < n; k++) {
    // (in the idle frame; else a quarter smaller there; else in any of the frames)
    const passes = [{ idle: true, scale: 1 }, { idle: true, scale: 0.75 }, { idle: false, scale: 1 }];
    let best: { p: LavaPool; score: number } | null = null;
    for (const pass of passes) {
      const pr = Math.max(LAVA.r[0] * 0.75, radii[k] * pass.scale);
      for (let t = 0; t < LAVA.tries; t++) {
        const rad = Math.sqrt(r0 * r0 + darts() * (r1 * r1 - r0 * r0)), ang = darts() * Math.PI * 2;
        const p: LavaPool = { x: cx + Math.cos(ang) * rad, z: cz + Math.sin(ang) * rad, r: pr, seed: seeds[k] };
        if (!out.every((o) => Math.hypot(o.x - p.x, o.z - p.z) >= (o.r + p.r) * (1 + LAVA.wobble) + LAVA.gap)) continue;
        if (pass.idle ? !poolShows(p, frames[0], true) : !frames.some((f) => poolShows(p, f, true))) continue;
        if (!fits(p)) continue;
        // (the first two: the nearest; the rest: shown in most of the swung frames, then the nearest)
        const swung = k < 2 ? 0 : (poolShows(p, frames[1]) ? 1 : 0) + (poolShows(p, frames[2]) ? 1 : 0);
        const score = swung * 100 - near(p);
        if (!best || score > best.score) best = { p, score };
      }
      if (best) break;
    }
    if (best) out.push(best.p);
  }
  return out;
}

/** Irregular flat lava pools at GROUND_Y + 0.02 (position, normal), outside the keep-outs (lavaPools). */
export function lavaGeometry(seed: number, stage: Stage, pools: readonly LavaPool[] = lavaPools(stage, seed)): THREE.BufferGeometry {
  const R = LAVA.rings, S = LAVA.segments, per = 1 + R * S;
  const pos = new Float32Array(Math.max(1, pools.length * per) * 3), nor = new Float32Array(pos.length);
  const idx: number[] = [];
  const y = GROUND_Y + LAVA.y;
  pools.forEach((p, j) => {
    const v0 = j * per;
    pos.set([p.x, y, p.z], v0 * 3);
    for (let k = 1; k <= R; k++) {
      for (let q = 0; q < S; q++) {
        const a = (q / S) * Math.PI * 2, d = (poolRadius(p, a) * k) / R, i = (v0 + 1 + (k - 1) * S + q) * 3;
        pos[i] = p.x + Math.cos(a) * d; pos[i + 1] = y; pos[i + 2] = p.z + Math.sin(a) * d;
      }
    }
    const vi = (k: number, q: number) => v0 + 1 + (k - 1) * S + (q % S);
    // (counter-clockwise seen from above: +y faces up)
    for (let q = 0; q < S; q++) idx.push(v0, vi(1, q + 1), vi(1, q));
    for (let k = 1; k < R; k++) for (let q = 0; q < S; q++) idx.push(vi(k, q), vi(k, q + 1), vi(k + 1, q + 1), vi(k, q), vi(k + 1, q + 1), vi(k + 1, q));
  });
  for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pools.length ? pos : new Float32Array(0), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(pools.length ? nor : new Float32Array(0), 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

/** A pool's bank: a low lumpy ring of cooled crust round its outline — its inner slope over the lava's edge, warm with
 *  the glow (`glow`), its crest dark crust, its outer foot the ground's colour (`crust`, `ground` sRGB). position, normal,
 *  color(3) (linear). */
export function lavaBankGeometry(p: LavaPool, crust: RGB, glow: RGB, ground: RGB): THREE.BufferGeometry {
  // the cross-section: (radial offset from the outline, height over the ground, colour: 0 glow, 1 crust, 2 ground)
  const PROFILE: [number, number, number][] = [[-0.15, -0.02, 0], [-0.04, 0.05, 0], [0.1, 0.09, 1], [0.32, 0.06, 1], [0.55, 0.0, 2], [0.7, -0.03, 2]];
  const S = 40, rows = PROFILE.length;
  const pos = new Float32Array(S * rows * 3), col = new Float32Array(S * rows * 3);
  const cols = [toLinear(glow), toLinear(crust), toLinear(ground)];
  const o = (p.seed % 997) * 0.53;
  for (let q = 0; q < S; q++) {
    const a = (q / S) * Math.PI * 2, R = poolRadius(p, a), c = Math.cos(a), s = Math.sin(a);
    const lump = 1 + 0.45 * noise2(c * 2.4 + o, s * 2.4 - o, 0xba4c);
    for (let k = 0; k < rows; k++) {
      const [dr, dy, ci] = PROFILE[k], d = R + dr * (0.85 + 0.3 * lump);
      const i = (q * rows + k) * 3;
      pos[i] = p.x + c * d; pos[i + 1] = GROUND_Y + dy * (dy > 0 ? lump : 1); pos[i + 2] = p.z + s * d;
      const k0 = 0.9 + 0.2 * noise2(c * 5.1 - o, s * 5.1 + o, 0xba4d);
      for (let j = 0; j < 3; j++) col[i + j] = cols[ci][j] * k0;
    }
  }
  const idx: number[] = [];
  const vi = (q: number, k: number) => (q % S) * rows + k;
  // (row k → k + 1 runs outwards, q → q + 1 counter-clockwise seen from above: a → b → c faces up)
  for (let q = 0; q < S; q++) for (let k = 0; k + 1 < rows; k++) idx.push(vi(q, k), vi(q + 1, k), vi(q + 1, k + 1), vi(q, k), vi(q + 1, k + 1), vi(q, k + 1));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Flowing lava: plates of dark crust (kitFbm2) drifting slowly over the molten surface (uTime), a finer churn breaking
// them up; the molten surface glows in uLava (the background's accent, linear), its hottest parts turning to a yellow
// white — over the bloom's threshold: the lava glows, the battlers do not. The crust is lit as rock; the glow is the
// emissive, pulsing slowly.
const LAVA_HEAD = /* glsl */ `
uniform vec3 uLava;
float lavaHeat;
`;
const LAVA_COLOR = /* glsl */ `
{
  vec2 lp = vKitWorld.xz;
  vec2 flow = vec2(uTime * 0.06, uTime * 0.035);
  float churn = kitNoise2(lp * 2.7 - flow * 1.8);
  float crust = smoothstep(0.56, 0.7, kitFbm2(lp * 0.75 + flow) + 0.14 * (churn - 0.5));
  lavaHeat = (1.0 - crust) * (0.7 + 0.3 * churn);
  diffuseColor.rgb = mix(uLava * 0.6, vec3(0.07, 0.045, 0.04), crust);
}
`;
/** The glow's emissive, × `glow` (a GLSL float literal). */
const lavaEmissive = (glow: number) => /* glsl */ `
{
  float pulse = 0.88 + 0.12 * sin(uTime * 1.1 + vKitWorld.x * 0.7 + vKitWorld.z * 0.5);
  totalEmissiveRadiance += mix(uLava, vec3(1.0, 0.62, 0.12), lavaHeat * lavaHeat) * lavaHeat * ${glslFloat(glow)} * pulse;
}
`;

/** Groudon's lava glow: its hottest parts well over the bloom's threshold. */
export const LAVA_GLOW = 1.7;

/** Emissive flowing lava: kitFbm2 crust over a hot core, slow flow with uTime, its glow × `glow` (a build-time constant
 *  in its shader: each glow its own program, under its own `hookKey`). Its glow colour is the uniform uLava (linear: a
 *  build sets the background's accent colour). */
export function lavaMaterial(glow: number, hookKey: string): KitMaterialOptions {
  return {
    roughness: 0.7,
    uniforms: { uLava: { value: new THREE.Color(1, 0.4, 0.1) } },
    fragHead: LAVA_HEAD, fragColor: LAVA_COLOR, fragEmissive: lavaEmissive(glow), hookKey,
  };
}

/** Groudon's lava (lavaMaterial at LAVA_GLOW, hookKey 'lava'). */
export const LAVA_MATERIAL: KitMaterialOptions = lavaMaterial(LAVA_GLOW, 'lava');

// ------------------------------------------------------------------------------------------------- the part

const PN = { position: 3, normal: 3 }, PNC = { position: 3, normal: 3, color: 3 };

/** Wet rock at a waterline: under it and up to WET.band[0] over it, the vertex colours × (1 − WET.dark) — a dark wet band
 *  where the band and its rubble meet Kyogre's water (they read as grey lumps on it) —, fading out by WET.band[1]. */
const WET = { dark: 0.45, band: [0.04, 0.42] as const };
export function wetBand(g: THREE.BufferGeometry, waterY: number): void {
  const p = g.getAttribute('position'), c = g.getAttribute('color');
  for (let i = 0; i < p.count; i++) {
    const k = 1 - WET.dark * (1 - smooth(WET.band[0], WET.band[1], p.getY(i) - waterY));
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
}

/** `g` (non-indexed: the boulders) with an index of its own vertices in order (merged with the indexed band). */
function indexed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!g.index) g.setIndex(Array.from({ length: g.getAttribute('position').count }, (_, i) => i));
  return g;
}

/** The rock's colours of a kind: the band, the stalagmites and the boulders (sRGB). (The palette's rock: the caves' tan
 *  and brown, Groudon's volcanic red-brown, Kyogre's wet blue-grey, the mountain's stone.) */
function rockColors(ctx: ArenaContext): { wall: RGB; spire: RGB; boulder: RGB } {
  const p = ctx.palette;
  return { wall: p.rock, spire: scale(p.rock, 1.06), boulder: mix(p.rock, p.ground, 0.35) };
}

export const ROCK_PART: ArenaPart = {
  name: 'rock',
  kinds: ['mountain', 'cave', 'cavePond', 'groudon', 'kyogre'],
  catalogue(): readonly CatalogueEntry[] {
    return [
      { material: CLIFF_MATERIAL, mesh: 'mesh', attrs: PNC, castShadow: true },
      { material: LAVA_MATERIAL, mesh: 'mesh', attrs: PN, castShadow: false },
    ];
  },
  build(ctx) {
    const rule = ROCK_RULES[ctx.kind];
    if (!rule) return null;
    const { kind, stage, palette } = ctx;
    const colors = rockColors(ctx);
    const group = new THREE.Group();
    // (the band rises from the ground the arena lies on: the mountain's rolls; Kyogre's stands in its water)
    const ground = kind === 'mountain' ? (x: number, z: number) => groundHeight(kind, x, z, stage) : () => GROUND_Y;
    // (the lava pools once: the stalagmites and the boulders keep off them)
    const pools = kindPools(kind, stage, SCENERY_SEED);
    const parts: THREE.BufferGeometry[] = [rockWallGeometry(WALL_SEED, stage, rule.band, colors.wall, ground)];
    for (const s of stalagmitePlacements(kind, stage, SCENERY_SEED, pools)) {
      parts.push(stalagmiteCluster(s.seeds, s.height, colors.spire).translate(s.x, groundHeight(kind, s.x, s.z, stage), s.z));
    }
    for (const b of boulderPlacements(kind, stage, SCENERY_SEED, pools)) {
      // (Kyogre's stand in its water, a quarter of their width under it, as the sea's rocks: water.ts ROCK_SINK)
      const y = kind === 'kyogre' ? WATER_Y - 0.13 * b.size : groundHeight(kind, b.x, b.z, stage);
      parts.push(indexed(rockCluster(b.seeds, b.size, colors.boulder)).translate(b.x, y - 0.12 * b.size, b.z));
    }
    for (const p of pools) parts.push(lavaBankGeometry(p, scale(palette.rock, 0.55), mix(palette.accent, palette.rock, 0.35), palette.ground));
    const g = mergeGeometries(parts)!;
    for (const x of parts) x.dispose();
    if (kind === 'kyogre') wetBand(g, WATER_Y);
    g.computeBoundingSphere();
    const material = kitMaterial(ctx.uniforms, CLIFF_MATERIAL).material;
    const mesh = new THREE.Mesh(g, material);
    mesh.name = 'rockWalls';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // (the mountain's stone moonlit at night as its field: the caves keep their own light)
    if (ARENA_SETTING[kind] === 'outdoor') moonlitAsGround(mesh, material, toLinear(palette.rock), ctx.uniforms.uNight);
    group.add(mesh);
    if (pools.length) {
      const lava = new THREE.Mesh(lavaGeometry(SCENERY_SEED, stage, pools),
        kitMaterial(ctx.uniforms, { ...LAVA_MATERIAL, uniforms: { uLava: { value: new THREE.Color(...toLinear(palette.accent)) } } }).material);
      lava.name = 'lava';
      lava.receiveShadow = true;
      group.add(lava);
    }
    return group;
  },
};
