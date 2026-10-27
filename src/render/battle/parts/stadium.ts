// The Stadium rooms: Team Magma's and Team Aqua's hideouts, the four Elite Four rooms and the Champion's — the GBA draws
// them all from one Stadium picture (a pale striped wall under a dark top band) in each room's colours. In 3D each room has
// walls of its theme — rock bands (Magma, Sidney, Drake: rock.ts), a panelled metal ring (Aqua), a marble room with
// pillars along its walls (Phoebe, the Champion: rooms.ts), a ring of ice crystals before an ice band (Glacia) —, a low
// rim round the stage (the arena's edge, outside both platforms) and props: Magma's lava pools and pipes, Aqua's pipes and
// fountains, Sidney's dark spikes, Phoebe's candles, Glacia's crystals, Drake's pillars and spikes, the Champion's
// fountains. The battle camera never frames the horizon (D1): at its top edge it sees the walls' lowest ≈ 1.5–2.2 units
// (scatter.ts frameTop) and the props before them, which stand where the idle frame shows them, never over a battler there
// (battlerOverlap). Draws: the room (BUILDING_BODY: the metal ring, the marble room and its pillars, the rim, pipes,
// basins, Drake's pillars), the rock (CLIFF_MATERIAL, faceted: rock bands, the ice band, crystals, spikes, the lava's
// banks), Magma's lava (MAGMA_LAVA: Groudon's flowing lava, rock.ts), the fountains' water (the arena water, opaque, drawn
// first), Phoebe's candle stands (PROP_BODY) and their flames (PROP_GLOW, glowing for their own draw: the battle's light
// set is fixed, nothing lights the room). The lava and the flames glow just under the bloom's threshold: on the dev iGPU
// any bloom in the frame cost ≈ 1–1.2 ms (same-session A/B), which these rooms could not afford.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noise2, rng, type V3 } from '../../kit/geom';
import { kitMaterial, type KitMaterialOptions } from '../../kit/materials';
import { mix, scale, toLinear, type RGB } from '../../kit/palette';
import { BUILDING_BODY } from '../../kit/buildings';
import { PROP_BODY, PROP_GLOW } from '../../kit/props';
import { CLIFF_MATERIAL } from '../../kit/cliffs';
import type { ArenaColors } from '../bgSample';
import type { ArenaPalette } from '../palette';
import type { ArenaPart, CatalogueEntry } from '../modernArena';
import { GROUND_Y, type Stage } from '../stage';
import {
  LAVA_GLOW, SMALL_FRONT, TIP_SHOWN, WALL_SEED, clusterSpires, lavaBankGeometry, lavaGeometry, lavaMaterial, lavaPools, rockWallGeometry, stalagmiteGeometry,
  type ArenaSpire, type LavaPool, type WallBand,
} from './rock';
import { HALLS, glowMesh, hallLayout, pillarGeometry, roomShell, wallPillars, type RoomSpec, type ShellColors } from './rooms';
import { Soup, cross, lathe, lin, norm, sub, tube } from './soup';
import { WATER_RENDER_ORDER, arenaWaterMaterial, opaqueWater } from './water';
import { arenaClear } from './flora';
import { SCENERY_SEED, frameTop, scatter, sightCap, stageKeepOut } from './scatter';
import { battleFrameCamera, battlerBoxes, frameRect, rectsOverlap } from './frame';

export type StadiumKind = 'magma' | 'aqua' | 'sidney' | 'phoebe' | 'glacia' | 'drake' | 'champion';
export type StadiumProp = 'lava' | 'pipes' | 'candles' | 'crystals' | 'pillars' | 'fountains' | 'spikes';
export interface StadiumTheme { walls: 'rock' | 'metal' | 'ice' | 'marble'; props: readonly StadiumProp[] }
export const STADIUM_THEME: Readonly<Record<StadiumKind, StadiumTheme>> = {
  magma: { walls: 'rock', props: ['lava', 'pipes'] },          aqua: { walls: 'metal', props: ['pipes', 'fountains'] },
  sidney: { walls: 'rock', props: ['spikes'] },                phoebe: { walls: 'marble', props: ['candles', 'pillars'] },
  glacia: { walls: 'ice', props: ['crystals'] },               drake: { walls: 'rock', props: ['pillars', 'spikes'] },
  champion: { walls: 'marble', props: ['pillars', 'fountains'] },
};
export const STADIUM_KINDS: readonly StadiumKind[] = ['magma', 'aqua', 'sidney', 'phoebe', 'glacia', 'drake', 'champion'];

// ------------------------------------------------------------------------------------------------- the walls

/** The rock rooms' band (rock.ts: the caves' cliff band), the ice room's band behind its crystals. */
const ROCK_BAND: WallBand = { r: 18, arc: 1.75, height: [10, 16] };
/** The metal ring: `sides` flat panels round the stage, their inner faces `r` from its centre, `height` tall, the
 *  panels whose ends stand past centre.z + `front` left out (the camera's side, as the halls' rule: rooms.ts). */
const METAL_RING = { sides: 16, r: 17, height: 10, front: 3.9 };
/** The marble rooms: the gyms' room (rooms.ts HALLS.gym) with pillars along their walls as the gyms' (hallLayout('gym')). */
const MARBLE_ROOM: RoomSpec = HALLS.gym;
/** The ice room: crystal clusters every `step` units along r `r` (± `wander`), ± `arc` rad from straight behind,
 *  `height` tall, before an ice band (`band`). */
const ICE_RING = { r: 16.3, wander: 0.7, step: 1.55, arc: 1.55, height: [3.2, 7.5] as const,
  band: { r: 19.5, arc: 1.75, height: [9, 14] } as WallBand };

/** The arena's rim: a ring step round the stage, its inner face `r` from the centre (both platforms reach ≈ 4.4 from it,
 *  their slabs' plinths ≈ 4.6), `height` tall, its outer slope reaching the floor at `outer`. */
export const RIM = { r: 6.0, height: 0.25, outer: 7.4, segments: 128 };

/** A collar round a pipe: a short cylinder of radius `rad` from `p0` to `p1` with its two annular faces down to `inner`. */
function collar(s: Soup, p0: V3, p1: V3, rad: number, inner: number, col: RGB, sides = 10): void {
  tube(s, [p0, p1], rad, col, sides);
  const t = norm(sub(p1, p0));
  const u = norm(cross(t, Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), v = cross(u, t);
  for (const [p, f] of [[p0, -1], [p1, 1]] as const) {
    const face: V3 = [t[0] * f, t[1] * f, t[2] * f];
    for (let q = 0; q < sides; q++) {
      const a0 = (q / sides) * Math.PI * 2, a1 = ((q + 1) / sides) * Math.PI * 2;
      const d = (a: number, r: number): V3 => [p[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * r, p[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * r,
        p[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * r];
      s.quad(d(a0, inner), d(a1, inner), d(a1, rad), d(a0, rad), face, col);
    }
  }
}

/** The metal ring (METAL_RING): flat panels, each a dark plinth, a lower band of framed panels, a light rail, an upper
 *  band of tall framed panels and a cornice, a dark rib at every joint; the ring's ends at its open front capped by a rib.
 *  position, normal, color(3) (sRGB colours: `panel` the face, `frame` the panels' frames, `seam` the plinth and ribs,
 *  `rail`). */
function metalRingGeometry(stage: Stage, c: { panel: RGB; frame: RGB; seam: RGB; rail: RGB }): THREE.BufferGeometry {
  const s = new Soup(), M = METAL_RING, n = M.sides, H = M.height;
  const cx = stage.centre.x, cz = stage.centre.z;
  const half = M.r * Math.tan(Math.PI / n), corner = M.r / Math.cos(Math.PI / n);
  const panel = lin(c.panel), frame = lin(c.frame), seam = lin(c.seam), rail = lin(c.rail), dark = lin(scale(c.panel, 0.82));
  const vertexZ = (a: number) => cz - Math.cos(a) * corner;
  for (let k = 0; k < n; k++) {
    const am = (k / n) * Math.PI * 2 - (k > n / 2 ? Math.PI * 2 : 0);
    const a0 = am - Math.PI / n, a1 = am + Math.PI / n;
    if (vertexZ(a0) > cz + M.front || vertexZ(a1) > cz + M.front) continue;
    // the panel's frame: its face's middle on the floor, u along it (left to right as the stage sees it), w into the room
    const o: V3 = [cx + Math.sin(am) * M.r, GROUND_Y, cz - Math.cos(am) * M.r];
    const u: V3 = [Math.cos(am), 0, Math.sin(am)], w: V3 = [-Math.sin(am), 0, Math.cos(am)];
    const at = (a: number, h: number, d: number): V3 => [o[0] + u[0] * a + w[0] * d, o[1] + h, o[2] + u[2] * a + w[2] * d];
    const box = (s0: number, s1: number, h0: number, h1: number, d0: number, d1: number, col: RGB) => s.box(o, u, w, s0, s1, h0, h1, d0, d1, col);
    const face = (s0: number, s1: number, h0: number, h1: number, col: RGB) => s.quad(at(s0, h0, 0), at(s1, h0, 0), at(s1, h1, 0), at(s0, h1, 0), w, col);
    // plinth, rail, cornice
    box(-half, half, -0.02, 0.32, 0, 0.1, seam);
    box(-half, half, 1.12, 1.32, 0, 0.09, rail);
    box(-half, half, H - 0.5, H, 0, 0.16, seam);
    // the face (darker in the lower band), the framed panels on it
    face(-half, half, 0.32, 1.12, dark);
    face(-half, half, 1.32, H - 0.5, panel);
    const fw = 0.07, fd = 0.045;
    const framed = (s0: number, s1: number, h0: number, h1: number) => {
      box(s0, s1, h0, h0 + fw, 0, fd, frame);
      box(s0, s1, h1 - fw, h1, 0, fd, frame);
      box(s0, s0 + fw, h0 + fw, h1 - fw, 0, fd, frame);
      box(s1 - fw, s1, h0 + fw, h1 - fw, 0, fd, frame);
    };
    const inset = 0.32;
    framed(-half + inset, half - inset, 0.44, 1.0);
    framed(-half + inset, -0.12, 1.55, H - 0.95);
    framed(0.12, half - inset, 1.55, H - 0.95);
    // a rib at this panel's left joint (and its right one where the ring ends)
    const rib = (a: number) => {
      const ou: V3 = [Math.cos(a), 0, Math.sin(a)], ow: V3 = [-Math.sin(a), 0, Math.cos(a)];
      const oo: V3 = [cx + Math.sin(a) * corner, GROUND_Y, cz - Math.cos(a) * corner];
      s.box(oo, ou, ow, -0.2, 0.2, -0.02, H + 0.04, -0.05, 0.16, seam);
    };
    rib(a0);
    const next = am + (2 * Math.PI) / n;
    if (vertexZ(next + Math.PI / n) > cz + M.front) rib(a1);
  }
  return s.geometry();
}

/** The marble rooms' shell colours: a darker baseboard, the wainscot and its panels in the stone, the trims, the wall. */
function marbleShell(wall: RGB, trim: RGB, base: RGB): ShellColors {
  const wainscot = scale(wall, 0.94);
  return { base, wainscot, panel: scale(wainscot, 1.05), trim, wall };
}

// ------------------------------------------------------------------------------------------------- the rim

/** The arena's rim (RIM): an inner face standing RIM.r from the centre, a rounded top RIM.height over the floor with a
 *  darker inlaid stripe, an outer slope down to the floor at RIM.outer; smooth round. position, normal, color(3)
 *  (`color` sRGB). */
export function arenaRimGeometry(stage: Stage, color: RGB): THREE.BufferGeometry {
  const s = new Soup(), c = lin(color), R = RIM, H = R.height;
  const top = lin(scale(color, 1.06)), inlay = lin(scale(color, 0.72)), inner = lin(scale(color, 0.78)), slope = lin(scale(color, 0.9));
  // (walked up the outer slope, inward over the top, down the inner face: the faces point out of the step)
  const prof: [number, number][] = [[R.outer + 0.05, -0.02], [R.outer, 0], [R.r + 0.98, H - 0.05], [R.r + 0.92, H - 0.015], [R.r + 0.85, H],
    [R.r + 0.6, H], [R.r + 0.6, H], [R.r + 0.38, H], [R.r + 0.38, H], [R.r + 0.08, H], [R.r + 0.03, H - 0.015], [R.r, H - 0.06], [R.r, -0.02]];
  const cols = [slope, slope, top, top, c, inlay, inlay, c, c, top, top, inner];
  lathe(s, [stage.centre.x, GROUND_Y, stage.centre.z], prof, cols, R.segments);
  return s.geometry();
}

// ------------------------------------------------------------------------------------------------- crystals

/** Crystals in a cluster: the crystal's sides, its widest point (share of its height) and its prism's top. */
const CRYSTAL = { sides: 6, belly: 0.14, shoulder: 0.7, width: [0.12, 0.08] as const };

/** Elongated octahedra in a cluster (faceted ice): a main crystal `height` tall from y = 0 (its tip there), up to five
 *  smaller ones (0.25–0.6 of it) leaning out from its foot, each a hexagonal bipyramid stretched into a prism — its lower
 *  point sunk under the floor, its tip pointed —, deeper at the foot and paler to the tips, each facet its own shade.
 *  position, normal, color(3) (`color` sRGB), indexed (one index per vertex: merged with the rock). */
export function crystalGeometry(seed: number, height: number, color: RGB): THREE.BufferGeometry {
  const s = new Soup(), r = rng(seed * 4099 + 0xc7a1);
  const base = lin(color), deep = lin(mix(scale(color, 0.62), [0.2, 0.35, 0.7], 0.25)), pale = lin(mix(color, [1, 1, 1], 0.55));
  const crystal = (h: number, x: number, z: number, tilt: number, dir: number, twist: number) => {
    const w = CRYSTAL.width[0] * h + CRYSTAL.width[1] + 0.05;
    // (the main crystal is lengthened so its leaning tip still stands `height` over the floor)
    const L = h / Math.cos(tilt);
    const rot = (p: V3): V3 => {
      // tilt about the axis across `dir`, at the foot
      const cd = Math.cos(dir), sd = Math.sin(dir), ct = Math.cos(tilt), st = Math.sin(tilt);
      const a = p[0] * cd + p[2] * sd, b = -p[0] * sd + p[2] * cd;
      const a2 = a * ct + p[1] * st, y2 = -a * st + p[1] * ct;
      return [x + a2 * cd - b * sd, y2, z + a2 * sd + b * cd];
    };
    const ring = (y: number, rad: number): V3[] => Array.from({ length: CRYSTAL.sides }, (_, q) => {
      const a = twist + (q / CRYSTAL.sides) * Math.PI * 2;
      return rot([Math.cos(a) * rad, y, Math.sin(a) * rad]);
    });
    const bottom = rot([0, -0.35 * w, 0]), tip = rot([0, L, 0]);
    const r0 = ring(CRYSTAL.belly * L, w), r1 = ring(CRYSTAL.shoulder * L, w * 0.9);
    const k = (t: number) => (t < 0.5 ? mix(deep, base, t * 2) : mix(base, pale, (t - 0.5) * 2));
    for (let q = 0; q < CRYSTAL.sides; q++) {
      const j = (q + 1) % CRYSTAL.sides, f = 0.88 + 0.24 * r();
      const am = twist + ((q + 0.5) / CRYSTAL.sides) * Math.PI * 2;
      const out = norm(sub(rot([Math.cos(am), 0.0, Math.sin(am)]), rot([0, 0, 0])));
      const c0 = scale(k(0.05), f), c1 = scale(k(0.35), f), c2 = scale(k(0.75), f), c3 = scale(k(1), f * 1.05);
      s.triN(bottom, r0[q], r0[j], [out[0], -0.6, out[2]], [out, out, out], [c0, c1, c1]);
      s.quadN(r0[q], r0[j], r1[j], r1[q], out, [out, out, out, out], [c1, c1, c2, c2]);
      s.triN(r1[q], r1[j], tip, [out[0], 0.5, out[2]], [out, out, out], [c2, c2, c3]);
    }
  };
  crystal(height, 0, 0, 0.06 * r(), r() * Math.PI * 2, r());
  const n = 2 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const dir = (i / n) * Math.PI * 2 + r() * 0.8, d = 0.12 + 0.1 * height * r();
    crystal(height * (0.25 + 0.35 * r()), Math.cos(dir) * d, Math.sin(dir) * d, 0.3 + 0.3 * r(), dir, r());
  }
  const g = s.geometry();
  g.setIndex(Array.from({ length: g.getAttribute('position').count }, (_, i) => i));
  return g;
}

// ------------------------------------------------------------------------------------------------- props

/** A prop standing in the arena: what, where, how tall and its footprint's half width. */
interface StadiumItem { kind: 'pillar' | 'fountain' | 'candelabrum' | 'candles' | 'crystal'; x: number; z: number; height: number; half: number }

/** The props' sizes: the pillars' radius and height (Drake's, standing free), the fountains' basin radius and height,
 *  the candelabra's height, the floor candles' cluster. */
const ITEM = {
  pillar: { r: 0.55, height: 7.5 }, fountain: { r: 1.28, height: 1.42 }, candelabrum: { height: 1.3, half: 0.48 },
  candles: { half: 0.36, height: 0.88 },
};
/** The props of each kind as (angle off straight behind the stage, radius from its centre[, crystal height]): placed
 *  against the idle frame (.scratch/t11/grid.ts) — between the battlers (straight behind), over the player's head (left,
 *  12.5 units back and more), right of the enemy — and at the sides (seen as the camera swings). Drake's back pillar
 *  stands between the battlers, far back (r 16.25, before the rock band's alcove there): ≥ 24 px clear of both 64 × 64
 *  sprite boxes through the idle sway (± 0.04 yaw). Left of the player's sprite no place works: there the sway moves a
 *  pillar ≈ 115 px against the sprite, and one clear of the crest at +0.04 stands half out of the frame at −0.04 (at
 *  −0.42 rad its plinth stood on a back sprite's crest). Every prop clear of both battlers' boxes through the idle sway
 *  (Glacia's crystal between the battlers was at (−0.05, 11.6), its small one at −0.07: each over a box at −0.04). */
const ITEMS: Readonly<Partial<Record<StadiumKind, readonly [StadiumItem['kind'], number, number, number?][]>>> = {
  aqua: [['fountain', -0.3, 13.6], ['fountain', 0.72, 10.6], ['fountain', -1.2, 11.6], ['fountain', 1.25, 11.6]],
  champion: [['fountain', -0.06, 12.9], ['fountain', 0.74, 10.6], ['fountain', -1.15, 11.4], ['fountain', 1.2, 11.4]],
  phoebe: [['candelabrum', -0.34, 13.2], ['candelabrum', -0.04, 11.8], ['candelabrum', 0.55, 10.7], ['candelabrum', -1.0, 11.2],
    ['candelabrum', 1.08, 11.2], ['candelabrum', -1.55, 12.2], ['candelabrum', 1.6, 12.2],
    ['candles', -0.06, 8.1], ['candles', 0.72, 8.2], ['candles', -0.95, 8.6], ['candles', 1.15, 8.6]],
  glacia: [['crystal', -0.32, 13.4, 2.5], ['crystal', -0.03, 12.7, 1.9], ['crystal', 0.68, 10.4, 2.3], ['crystal', -1.1, 11.4, 2.8],
    ['crystal', 1.15, 11.6, 2.6], ['crystal', 0.72, 8.1, 0.85], ['crystal', -0.04, 8.0, 0.7], ['crystal', -1.0, 8.6, 0.9],
    ['crystal', 1.2, 8.9, 0.8]],
  drake: [['pillar', -0.03, 16.25], ['pillar', 0.66, 12.6], ['pillar', -1.1, 13.0], ['pillar', 1.15, 13.0], ['pillar', -1.45, 14.2],
    ['pillar', 1.5, 14.2]],
};

/** A kind's props (ITEMS) in world units. */
export function stadiumItems(kind: StadiumKind, stage: Stage): StadiumItem[] {
  return (ITEMS[kind] ?? []).map(([k, a, r, h]) => {
    const x = stage.centre.x + Math.sin(a) * r, z = stage.centre.z - Math.cos(a) * r;
    switch (k) {
      case 'pillar': return { kind: k, x, z, height: ITEM.pillar.height, half: ITEM.pillar.r * 1.5 };
      case 'fountain': return { kind: k, x, z, height: ITEM.fountain.height, half: ITEM.fountain.r + 0.05 };
      case 'candelabrum': return { kind: k, x, z, height: ITEM.candelabrum.height + 0.56, half: ITEM.candelabrum.half };
      case 'candles': return { kind: k, x, z, height: ITEM.candles.height, half: ITEM.candles.half };
      case 'crystal': return { kind: k, x, z, height: h!, half: 0.32 * h! + 0.25 };
    }
  });
}

/** The battlers as the idle frame shows them (frame.ts battlerBoxes: the lava's and the halls' rule, a 2 × 2 box on each
 *  platform, projected by the settled camera at yaw 0): whether a thing `half` wide either side and `height` tall standing
 *  at (x, z) — its part under the frame's top — stands over one of them there. */
function battlerOverlap(stage: Stage): (x: number, z: number, half: number, height: number) => boolean {
  const cam = battleFrameCamera(stage, 0), boxes = battlerBoxes(stage, 0), top = frameTop(stage, [0]);
  return (x, z, half, height) => {
    const h = Math.min(height, top(x, z) - GROUND_Y);
    const r = frameRect(cam, [[x - half, GROUND_Y, z], [x + half, GROUND_Y, z], [x - half, GROUND_Y + h, z], [x + half, GROUND_Y + h, z]]);
    return boxes.some((b) => rectsOverlap(r, b));
  };
}

/** A fountain at `at`: a round basin (a plinth, its wall with a rolled lip), a pedestal rising from its floor to a
 *  shallow upper bowl and a finial; its water's two discs (`water`: centre, height, radius). The basin's water stands
 *  brim-full, level with the top of the lip's inner face (0.5; the lip's crest 0.56): the battle camera sees the
 *  fountains from 5–8° above, and at 0.44 the near lip hid all but a sliver of it. */
function fountain(s: Soup, at: V3, stone: RGB, water: { at: V3; r: number }[]): void {
  const c = lin(stone), light = lin(scale(stone, 1.08)), dark = lin(scale(stone, 0.72)), mid = lin(scale(stone, 0.9));
  const F = ITEM.fountain.r;
  const prof: [number, number][] = [[F + 0.04, -0.02], [F + 0.04, 0.08], [F - 0.06, 0.12], [F - 0.06, 0.42], [F - 0.01, 0.46],
    [F - 0.01, 0.52], [F - 0.1, 0.56], [F - 0.22, 0.56], [F - 0.25, 0.5], [F - 0.25, 0.22], [0.26, 0.22], [0.2, 0.32], [0.13, 0.42],
    [0.12, 0.84], [0.56, 1.02], [0.6, 1.08], [0.57, 1.12], [0.5, 1.12], [0.47, 1.05], [0.13, 1.02], [0.1, 1.1], [0.075, 1.24],
    [0.12, 1.3], [0.1, 1.37], [0, ITEM.fountain.height]];
  const cols = [mid, mid, c, light, light, light, light, dark, dark, dark, dark, c, c, mid, light, light, light, dark, dark, c, c, light, light, light];
  lathe(s, at, prof, cols, 20);
  water.push({ at: [at[0], at[1] + 0.5, at[2]], r: F - 0.24 }, { at: [at[0], at[1] + 1.07, at[2]], r: 0.48 });
}

/** A water disc (position, normal up): the fountains' water. */
function waterDiscs(discs: readonly { at: V3; r: number }[]): THREE.BufferGeometry {
  const S = 24, pos: number[] = [], idx: number[] = [];
  for (const d of discs) {
    const v0 = pos.length / 3;
    pos.push(d.at[0], d.at[1], d.at[2]);
    for (let q = 0; q < S; q++) {
      const a = (q / S) * Math.PI * 2;
      pos.push(d.at[0] + Math.cos(a) * d.r, d.at[1], d.at[2] + Math.sin(a) * d.r);
    }
    // (counter-clockwise seen from above: +y faces up)
    for (let q = 0; q < S; q++) idx.push(v0, v0 + 1 + ((q + 1) % S), v0 + 1 + q);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** A flame: a teardrop `h` tall over `at`, white-yellow at its foot, orange to its tip (linear). */
function flame(glow: Soup, at: V3, h: number): void {
  const w = h * 0.24;
  const prof: [number, number][] = [[0, -0.01], [w * 0.7, 0.08 * h], [w, 0.28 * h], [w * 0.75, 0.55 * h], [w * 0.3, 0.82 * h], [0, h]];
  const core: RGB = [1.0, 0.92, 0.62], tip: RGB = [1.0, 0.5, 0.12];
  lathe(glow, at, prof, prof.map((_, i) => mix(core, tip, i / (prof.length - 1))), 8);
}

/** A candle on `at`: a wax stick `h` tall of radius `r`, its top rounded, a wick's flame. */
function candle(stand: Soup, glow: Soup, at: V3, h: number, r: number, wax: RGB): void {
  const c = lin(wax), top = lin(scale(wax, 1.06)), drip = lin(scale(wax, 0.92));
  lathe(stand, at, [[r * 1.25, 0], [r * 1.18, 0.03], [r, 0.08], [r, h - 0.02], [r * 0.82, h], [0, h]], [drip, drip, c, top, top], 8);
  flame(glow, [at[0], at[1] + h + 0.01, at[2]], Math.max(0.15, 0.2 + h * 0.08));
}

/** A candelabrum at `at`: a flared foot, a slim shaft with a knop, two arms bending up from below its top, three candles
 *  in drip pans (stand: `metal`, candles: `wax`). */
function candelabrum(stand: Soup, glow: Soup, at: V3, metal: RGB, wax: RGB): void {
  const H = ITEM.candelabrum.height, m = lin(metal), hi = lin(scale(metal, 1.25)), lo = lin(scale(metal, 0.75));
  lathe(stand, at, [[0.3, -0.01], [0.3, 0.035], [0.2, 0.085], [0.08, 0.16], [0.05, 0.3], [0.04, H * 0.55], [0.075, H * 0.58],
    [0.075, H * 0.62], [0.04, H * 0.65], [0.035, H - 0.1], [0.15, H - 0.04], [0.15, H], [0.04, H]],
  [lo, m, m, m, m, hi, hi, m, m, hi, hi, m], 10);
  const arm = H - 0.36;
  for (const sx of [-1, 1]) {
    // (an arm: out along x, then up; a drip pan and a candle at its end)
    const pts: V3[] = [[at[0] + sx * 0.03, at[1] + arm, at[2]], [at[0] + sx * 0.2, at[1] + arm + 0.01, at[2]], [at[0] + sx * 0.3, at[1] + arm + 0.06, at[2]],
      [at[0] + sx * 0.34, at[1] + arm + 0.16, at[2]], [at[0] + sx * 0.34, at[1] + arm + 0.24, at[2]]];
    tube(stand, pts, 0.022, m, 6);
    const pan: V3 = [at[0] + sx * 0.34, at[1] + arm + 0.24, at[2]];
    lathe(stand, pan, [[0.03, -0.02], [0.11, 0.02], [0.11, 0.04], [0.03, 0.04]], [m, hi, m], 10);
    candle(stand, glow, [pan[0], pan[1] + 0.04, pan[2]], 0.24, 0.042, wax);
  }
  candle(stand, glow, [at[0], at[1] + H, at[2]], 0.3, 0.048, wax);
}

/** Floor candles: three to five sticks of wax (0.18–0.45 tall) on a puddle of melted wax, lit. */
function floorCandles(stand: Soup, glow: Soup, at: V3, seed: number, wax: RGB): void {
  const r = rng(seed * 811 + 0xca5d);
  lathe(stand, at, [[0.34, -0.01], [0.3, 0.012], [0, 0.016]], [lin(scale(wax, 0.85)), lin(scale(wax, 0.9))], 14);
  const n = 3 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r(), d = i === 0 ? 0 : 0.14 + 0.08 * r();
    candle(stand, glow, [at[0] + Math.cos(a) * d, at[1] + 0.012, at[2] + Math.sin(a) * d], 0.18 + 0.27 * r() * (i === 0 ? 1.3 : 1), 0.045 + 0.025 * r(), wax);
  }
}

/** Pipes along an arc of radius `r` round the stage centre, ± `arc` rad from straight behind: each run of `runs` (height
 *  over the floor, radius) a tube with flanges every few joints, posts with saddles under the runs; risers (vertical
 *  pipes on a foot flange, up past the frame's top, a valve wheel on the first) at the angles `risers`, just behind. */
function pipes(s: Soup, stage: Stage, r: number, arc: number, runs: readonly [number, number][], risers: readonly number[],
  c: { metal: RGB; flange: RGB; post: RGB }): void {
  const cx = stage.centre.x, cz = stage.centre.z, metal = lin(c.metal), flange = lin(c.flange), post = lin(c.post);
  const n = Math.ceil((2 * arc * r) / 1.1);
  const P = (a: number, rad: number, y: number): V3 => [cx + Math.sin(a) * rad, GROUND_Y + y, cz - Math.cos(a) * rad];
  const angles = Array.from({ length: n + 1 }, (_, i) => -arc + (2 * arc * i) / n);
  runs.forEach(([y, rad], ri) => {
    const rr = r - ri * 0.08;
    tube(s, angles.map((a) => P(a, rr, y)), rad, metal, 8);
    angles.forEach((a, i) => {
      if (i % 4 !== 1) return;
      const t: V3 = [Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05], p = P(a, rr, y);
      collar(s, sub(p, t), [p[0] + t[0], p[1], p[2] + t[2]], rad * 1.4, rad * 0.9, flange, 8);
    });
  });
  // posts under the runs, with a saddle round the lower one
  const low = Math.min(...runs.map(([y]) => y)), lowRad = runs.find(([y]) => y === low)![1];
  angles.forEach((a, i) => {
    if (i % 4 !== 2) return;
    const o = P(a, r, 0), u: V3 = [Math.cos(a), 0, Math.sin(a)], w: V3 = [-Math.sin(a), 0, Math.cos(a)];
    s.box(o, u, w, -0.06, 0.06, -0.02, low - lowRad, -0.06, 0.06, post);
    s.box(o, u, w, -0.09, 0.09, low - lowRad - 0.06, low - lowRad + 0.02, -0.22, 0.22, post);
  });
  risers.forEach((a, i) => {
    const rr = r + 0.45, foot = P(a, rr, 0);
    lathe(s, foot, [[0.32, -0.02], [0.32, 0.12], [0.22, 0.12]], [flange, flange], 10);
    tube(s, [P(a, rr, 0.1), P(a, rr, 9)], 0.2, metal, 10);
    for (const y of [1.65, 4.5]) collar(s, P(a, rr, y - 0.05), P(a, rr, y + 0.05), 0.28, 0.18, flange, 10);
    if (i === 0) {
      // a valve wheel facing the stage (in the plane along the arc and up), on a stem
      const hub = P(a, rr - 0.42, 1.05);
      tube(s, [P(a, rr - 0.18, 1.05), hub], 0.04, flange, 8);
      const ring: V3[] = Array.from({ length: 16 }, (_, q) => {
        const t = (q / 16) * Math.PI * 2;
        return [hub[0] + Math.cos(a) * Math.cos(t) * 0.22, hub[1] + Math.sin(t) * 0.22, hub[2] + Math.sin(a) * Math.cos(t) * 0.22];
      });
      tube(s, ring, 0.028, flange, 6, true);
      for (const t of [0, Math.PI / 2]) {
        const d: V3 = [Math.cos(a) * Math.cos(t) * 0.22, Math.sin(t) * 0.22, Math.sin(a) * Math.cos(t) * 0.22];
        tube(s, [sub(hub, d), [hub[0] + d[0], hub[1] + d[1], hub[2] + d[2]]], 0.02, flange, 6);
      }
    }
  });
}

// ------------------------------------------------------------------------------------------------- spikes and lava

/** Sidney's and Drake's spikes (dark stalagmites, rock.ts): how many tall ones (1.5–`height` tall, in the annulus `r`,
 *  inside the rock band) and small ones (≤ 1, outside the rim to r 11). */
const SPIKES: Readonly<Partial<Record<StadiumKind, { tall: number; small: number; r: [number, number]; height: number }>>> = {
  sidney: { tall: 24, small: 9, r: [9.5, 15.5], height: 3.6 },
  drake: { tall: 11, small: 5, r: [10, 15.5], height: 3 },
};

/** A kind's spikes: tall ones on the tall rule, each fitted under the frame's top edge (its tip shows: TIP_SHOWN; one that
 *  would stay under 1.1 units is left out), never over a battler in the idle frame (battlerOverlap), some in clusters
 *  (clusterSpires: a smaller spire at its foot keeps to the rules too); small ones (≤ 1) off the platforms and the strip in
 *  front of the player's, under the camera's sight lines, outside the rim, beside or behind the stage (rock.ts SMALL_FRONT). */
export function spikePlacements(kind: StadiumKind, stage: Stage, seed: number): ArenaSpire[] {
  const rule = SPIKES[kind];
  if (!rule) return [];
  const r = rng(seed * 7307 + 0x5b1e);
  const ko = stageKeepOut(stage), clear = arenaClear(stage), cap = sightCap(stage), top = frameTop(stage), over = battlerOverlap(stage);
  // (a spire's foot: its flared base, leaning and wobbling — rock.ts SPIRE; the tall rule holds round all of it)
  const base = (h: number) => (0.2 + 0.16 * h) * 1.4 + 0.07 * h;
  const tallAround = (x: number, z: number, rad: number) => ko.tallOk(x, z)
    && Array.from({ length: 8 }, (_, q) => (q / 8) * Math.PI * 2).every((a) => ko.tallOk(x + Math.cos(a) * rad, z + Math.sin(a) * rad));
  const out: ArenaSpire[] = [];
  const tall = scatter(seed * 7307 + 0x7a12, { centre: stage.centre, r0: rule.r[0], r1: rule.r[1], count: rule.tall, minGap: 2.0,
    accept: (x, z) => tallAround(x, z, base(1.5)) && !over(x, z, base(1.5), 1.5) });
  for (const p of tall) {
    const want = 1.5 + (rule.height - 1.5) * r();
    const height = Math.min(want, top(p.x, p.z) - TIP_SHOWN - GROUND_Y);
    const all = Array.from({ length: 1 + Math.floor(r() * 3) }, () => Math.floor(r() * 1e6));
    if (height < 1.1 || over(p.x, p.z, base(height), height) || !tallAround(p.x, p.z, base(height))) continue;
    const seeds = clusterSpires(all, height).filter((c, i) => i === 0 || c.height <= 1 || tallAround(p.x + c.dx, p.z + c.dz, base(c.height)))
      .map((c) => c.seed);
    out.push({ x: p.x, z: p.z, height, seeds });
  }
  const small = scatter(seed * 7307 + 0x5a12, { centre: stage.centre, r0: RIM.outer + 0.6, r1: 11, count: rule.small, minGap: 1.8,
    accept: (x, z) => clear(x, z) && z <= stage.centre.z + SMALL_FRONT && !over(x, z, base(1), 1) });
  for (const p of small) {
    const want = 0.45 + 0.5 * r();
    const height = Math.min(want, cap(p.x, p.z) - GROUND_Y);
    const seeds = [Math.floor(r() * 1e6)];
    if (height >= 0.35) out.push({ x: p.x, z: p.z, height, seeds });
  }
  return out;
}

/** Magma's lava pools (rock.ts lavaPools: placed against the frame), 9.5–13.5 from the stage centre: their banks outside
 *  the rim and inside the pipes' line (r 14.2). */
export function stadiumLava(stage: Stage, seed: number): LavaPool[] {
  const cx = stage.centre.x, cz = stage.centre.z;
  return lavaPools(stage, seed, { ring: [9.5, 13.5], keep: (x, z) => { const d = Math.hypot(x - cx, z - cz); return d >= RIM.outer + 0.35 && d <= 14.2; } });
}

// ------------------------------------------------------------------------------------------------- colours

/** A stadium's colours (sRGB), from its palette (`wall`: the room's walls, palette.ts STADIUM_WALL) and its background's
 *  colours (`c`). */
interface StadiumColors {
  rock: RGB; spike: RGB; rim: RGB; pillar: RGB; shell?: ShellColors;
  metal?: { panel: RGB; frame: RGB; seam: RGB; rail: RGB };
  pipe?: { metal: RGB; flange: RGB; post: RGB };
  basin?: RGB; water?: RGB; lava?: RGB; crystal?: RGB; stand?: RGB; wax?: RGB;
}

function stadiumColors(kind: StadiumKind, p: ArenaPalette, c: ArenaColors): StadiumColors {
  const wall = p.wall, platform = p.platformTop;
  switch (kind) {
    case 'magma': return { rock: wall, spike: scale(wall, 0.8), rim: mix(scale(c.rim, 0.62), platform, 0.2), pillar: wall,
      pipe: { metal: mix(scale(c.rim, 0.7), [0.55, 0.16, 0.12], 0.45), flange: scale(c.rim, 0.45), post: scale(c.rim, 0.38) },
      lava: mix(platform, [1.0, 0.36, 0.04], 0.35) };
    case 'aqua': return { rock: wall, spike: wall, rim: mix(c.rim, c.backdrop, 0.3), pillar: wall,
      metal: { panel: wall, frame: mix(wall, c.rim, 0.45), seam: scale(wall, 0.55), rail: mix(c.backdrop, [1, 1, 1], 0.4) },
      pipe: { metal: mix(c.rim, [0.55, 0.6, 0.66], 0.55), flange: scale(wall, 0.6), post: scale(wall, 0.5) },
      basin: mix(c.backdrop, [0.82, 0.86, 0.9], 0.5), water: c.platform };
    case 'sidney': return { rock: wall, spike: scale(wall, 0.85), rim: mix(c.top, wall, 0.4), pillar: wall };
    case 'phoebe': return { rock: wall, spike: wall, rim: mix(c.platform, wall, 0.45), pillar: mix(wall, c.platform, 0.22),
      shell: marbleShell(wall, mix(c.rim, wall, 0.45), scale(wall, 0.55)), stand: [0.36, 0.3, 0.24], wax: mix(c.rim, [1, 1, 1], 0.55) };
    case 'glacia': return { rock: mix(wall, c.platform, 0.18), spike: wall, rim: mix(c.platform, wall, 0.3), pillar: wall,
      crystal: mix(c.rim, [0.78, 0.9, 1.0], 0.3) };
    case 'drake': return { rock: wall, spike: scale(mix(wall, [0.35, 0.28, 0.24], 0.5), 0.85), rim: mix(platform, wall, 0.4),
      pillar: mix(wall, [0.86, 0.8, 0.72], 0.35) };
    case 'champion': return { rock: wall, spike: wall, rim: mix(c.platform, c.top, 0.35), pillar: mix(wall, [1, 1, 1], 0.3),
      shell: marbleShell(wall, mix(c.platform, wall, 0.35), mix(c.top, wall, 0.45)), basin: mix(wall, [1, 1, 1], 0.2), water: c.platform };
  }
}

// ------------------------------------------------------------------------------------------------- the part

const PN = { position: 3, normal: 3 }, PNC = { position: 3, normal: 3, color: 3 };
/** Phoebe's candle flames' glow (linear emissive, set for their draw only: the pooled material keeps black for any other
 *  user): bright, just under the bloom's threshold (post.ts: 1.05) — over it they bloomed, and any bloom in the frame cost
 *  ≈ 1.2 ms on the dev iGPU (same-session A/B: 2.16 → 1.01 at 0.35; the lava's glow pays it too). */
const FLAME_GLOW: RGB = [1.0, 0.56, 0.2], FLAME_STRENGTH = 0.5;
/** Magma's lava: Groudon's (rock.ts lavaMaterial: flowing crust over a hot core), its glow kept under the bloom's
 *  threshold (its emissive × LAVA_DIM of Groudon's): Groudon's lava blooms, and a bloom in the frame cost Magma's room
 *  ≈ 1 ms on the dev iGPU (same-session A/B: +1.95 → +0.90 without its lava) — Magma's walls, pipes and floor left too
 *  little room for it. Its own program (rock.ts lavaMaterial: hookKey 'lavaDim'), compiled at boot as every battle
 *  program. */
const LAVA_DIM = 0.55;
export const MAGMA_LAVA: KitMaterialOptions = lavaMaterial(Math.round(LAVA_GLOW * LAVA_DIM * 1000) / 1000, 'lavaDim');

/** One cell of field for the fountains' water (kit/water.ts: r = shore distance / 15): three cells from any shore — a
 *  pool's clear blue-green, no foam, no sand. */
function fountainField(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([Math.round((3 / 15) * 255), 0, 0, 0]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

export const STADIUM_PART: ArenaPart = {
  name: 'stadium',
  kinds: STADIUM_KINDS,
  catalogue(ph): readonly CatalogueEntry[] {
    return [
      { material: BUILDING_BODY, mesh: 'mesh', attrs: PNC, castShadow: true },
      { material: CLIFF_MATERIAL, mesh: 'mesh', attrs: PNC, castShadow: true },
      { material: MAGMA_LAVA, mesh: 'mesh', attrs: PN, castShadow: false },
      { material: opaqueWater(arenaWaterMaterial(ph(), new THREE.Vector2(), new THREE.Vector2(1, 1), [0, 0, 0])), mesh: 'mesh', attrs: PN, castShadow: false },
      { material: PROP_BODY, mesh: 'mesh', attrs: PNC, castShadow: true },
      { material: PROP_GLOW, mesh: 'mesh', attrs: PNC, castShadow: false },
    ];
  },
  build(ctx) {
    const kind = ctx.kind as StadiumKind, theme = STADIUM_THEME[kind];
    if (!theme) return null;
    const { stage, palette } = ctx;
    const col = stadiumColors(kind, palette, ctx.colors);
    const group = new THREE.Group();
    const room: THREE.BufferGeometry[] = [arenaRimGeometry(stage, col.rim)], rock: THREE.BufferGeometry[] = [];
    const extra = new Soup(), stands = new Soup(), glow = new Soup(), discs: { at: V3; r: number }[] = [];
    const cx = stage.centre.x, cz = stage.centre.z;
    // the walls
    switch (theme.walls) {
      case 'rock': rock.push(rockWallGeometry(WALL_SEED, stage, ROCK_BAND, col.rock)); break;
      case 'metal': room.push(metalRingGeometry(stage, col.metal!)); break;
      case 'marble': {
        room.push(roomShell(MARBLE_ROOM, stage, palette, col.shell), ...wallPillars(MARBLE_ROOM, hallLayout('gym').pillars, stage, col.pillar));
        break;
      }
      case 'ice': {
        rock.push(rockWallGeometry(WALL_SEED, stage, ICE_RING.band, mix(col.crystal!, col.rock, 0.5)));
        const R = ICE_RING, n = Math.ceil((2 * R.arc * R.r) / R.step), r = rng(0x1ce + SCENERY_SEED);
        for (let i = 0; i <= n; i++) {
          const a = -R.arc + (2 * R.arc * i) / n + (r() - 0.5) * 0.04, rad = R.r + R.wander * noise2(a * 3.1, 0.7, 0x1ce);
          const h = R.height[0] + (R.height[1] - R.height[0]) * r();
          rock.push(crystalGeometry(1000 + i, h, scale(col.crystal!, 0.9 + 0.15 * r())).translate(cx + Math.sin(a) * rad, GROUND_Y, cz - Math.cos(a) * rad));
        }
        break;
      }
    }
    // the props
    for (const it of stadiumItems(kind, stage)) {
      const at: V3 = [it.x, GROUND_Y, it.z];
      switch (it.kind) {
        case 'pillar': room.push(pillarGeometry(ITEM.pillar.r, ITEM.pillar.height, col.pillar).translate(it.x, GROUND_Y, it.z)); break;
        case 'fountain': fountain(extra, at, col.basin!, discs); break;
        case 'candelabrum': candelabrum(stands, glow, at, col.stand!, col.wax!); break;
        case 'candles': floorCandles(stands, glow, at, Math.round(it.x * 31 + it.z * 17), col.wax!); break;
        case 'crystal': rock.push(crystalGeometry(Math.round(it.x * 97 + it.z * 13) & 0xffff, it.height, col.crystal!).translate(it.x, GROUND_Y, it.z)); break;
      }
    }
    if (theme.props.includes('pipes')) {
      if (kind === 'magma') pipes(extra, stage, 14.7, 1.45, [[0.42, 0.17], [0.8, 0.12]], [-0.42, 0.98, -1.05, 0.46], col.pipe!);
      else pipes(extra, stage, METAL_RING.r - 1.0, 1.55, [[0.4, 0.15], [0.76, 0.11]], [0.62, -0.62, 1.3, -1.3], col.pipe!);
    }
    for (const s of spikePlacements(kind, stage, SCENERY_SEED)) {
      const parts = clusterSpires(s.seeds, s.height).map((c) => stalagmiteGeometry(c.seed, c.height, col.spike).translate(c.dx, 0, c.dz));
      const g = mergeGeometries(parts)!;
      for (const x of parts) x.dispose();
      rock.push(g.translate(s.x, GROUND_Y, s.z));
    }
    const pools = theme.props.includes('lava') ? stadiumLava(stage, SCENERY_SEED) : [];
    for (const p of pools) rock.push(lavaBankGeometry(p, scale(col.rock, 0.6), mix(col.lava!, col.rock, 0.35), palette.ground));

    if (!extra.empty) room.push(extra.geometry());
    const place = (m: THREE.Mesh, name: string, cast: boolean) => {
      m.geometry.computeBoundingSphere();
      m.name = name;
      m.castShadow = cast;
      m.receiveShadow = true;
      group.add(m);
      return m;
    };
    const add = (name: string, g: THREE.BufferGeometry, material: THREE.Material, cast: boolean) => place(new THREE.Mesh(g, material), name, cast);
    const merged = (gs: THREE.BufferGeometry[]) => { const g = mergeGeometries(gs)!; for (const x of gs) x.dispose(); return g; };
    add('stadiumRoom', merged(room), kitMaterial(ctx.uniforms, BUILDING_BODY).material, true);
    if (rock.length) add('stadiumRock', merged(rock), kitMaterial(ctx.uniforms, CLIFF_MATERIAL).material, true);
    if (pools.length) {
      add('lava', lavaGeometry(SCENERY_SEED, stage, pools),
        kitMaterial(ctx.uniforms, { ...MAGMA_LAVA, uniforms: { uLava: { value: new THREE.Color(...toLinear(col.lava!)) } } }).material, false);
    }
    if (discs.length) {
      const tex = fountainField();
      ctx.disposables.push(tex);
      const options = arenaWaterMaterial(tex, new THREE.Vector2(0, 0), new THREE.Vector2(1, 1), col.water!, ctx.look.clouds);
      add('fountainWater', waterDiscs(discs), kitMaterial(ctx.uniforms, opaqueWater(options)).material, false).renderOrder = WATER_RENDER_ORDER;
    }
    if (!stands.empty) add('candleStands', stands.geometry(), kitMaterial(ctx.uniforms, PROP_BODY).material, true);
    // (the flames glow for their own draw only: rooms.ts glowMesh)
    if (!glow.empty) place(glowMesh(ctx.uniforms, glow.geometry(), toLinear(FLAME_GLOW).map((v) => v * FLAME_STRENGTH) as RGB), 'candleFlames', false);
    return group;
  },
};
