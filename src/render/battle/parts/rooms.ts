// The indoor halls: the building (a wooden floor, bookcases and windows), the gym (court lines round the platforms,
// pillars, banners in the arena's accent colour), the Leader's gym (the gym with darker walls and more banners) and the
// Battle Frontier (a stadium: an arc of seat tiers behind a low barrier with glowing light panels, pillars along its
// walls). A room shell closes the back and both sides — walls with thickness, a darker baseboard, a lighter wainscot of
// raised panels under a chair rail, the upper wall, a crown — and never the camera's side. The battle camera never
// frames the horizon (D1): at its top edge it sees the back wall's lowest ≈ 1.55–1.8 units at yaw 0, the side walls'
// lowest 0.6–1.7 as it swings (scatter.ts frameTop) — so the walls' detail sits there: the baseboard, the wainscot's
// panels and the chair rail, the windows' sills, the bookcases' lower shelves, the banners' pointed ends, the pillars'
// bases, the first rows of seats. The room is one draw in the kit's building material (BUILDING_BODY: shell, pillars,
// banners, shelves, seats), its windows a second (BUILDING_GLASS), the Frontier's light panels a third (PROP_GLOW,
// glowing softly by day through their material's emissive), the gyms' court lines a fourth (SOIL_MATERIAL); the floor is
// the hall floor (floor.ts), drawn by the ground part.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { kitMaterial } from '../../kit/materials';
import { BUILDING_BODY, BUILDING_GLASS } from '../../kit/buildings';
import { PROP_GLOW } from '../../kit/props';
import { SOIL_MATERIAL } from '../../kit/soil';
import { luma, mix, scale, type RGB } from '../../kit/palette';
import type { V3 } from '../../kit/geom';
import { Soup, lathe, lin, type LatheColor } from '../../kit/soup';
import { glowMesh } from '../../kit/glow';
import {
  SHELF, SHELL, addShelf, addWindow, shellPalette, shellProfile, wallFrameAt, wallPath, type ShellColors, type WallFrame,
} from '../../kit/interior/wallParts';
import type { ArenaPalette } from '../palette';
import type { ArenaPart, CatalogueEntry } from '../modernArena';
import { GROUND_Y, PLATFORM_FOOTPRINT, type Stage } from '../stage';
import { COURT_BOUNDS } from './floor';

// (the shell's profile, windows, bookcases and the glow mesh moved to the kit in Phase 4: re-exported for the stadium
// rooms and the tests)
export { SHELF, SHELL, glowMesh, type ShellColors };

// ------------------------------------------------------------------------------------------------- the halls

/** A room's walls: the back wall's inner face at z = centre.z + back, the side walls' at x = centre.x ± halfWidth running
 *  to z = centre.z + front, `height` tall from the floor (GROUND_Y). */
export interface RoomSpec { back: number; halfWidth: number; height: number; front: number }
export type HallKind = 'building' | 'gym' | 'leader' | 'frontier';
type Hall = RoomSpec & { pillars: number; windows: number; banners: number; seats: boolean; lights: number };

/** The four halls (front 3.9 everywhere: 0.1 inside the tall rule's z ≤ centre.z + 4, so Float32 vertex positions never
 *  round past it). */
export const HALLS: Readonly<Record<HallKind, Hall>> = {
  building: { back: -15, halfWidth: 20, height: 8, front: 3.9, pillars: 0, windows: 4, banners: 0, seats: false, lights: 0 },
  gym: { back: -17, halfWidth: 22, height: 10, front: 3.9, pillars: 6, windows: 0, banners: 3, seats: false, lights: 0 },
  leader: { back: -17, halfWidth: 22, height: 10, front: 3.9, pillars: 6, windows: 0, banners: 5, seats: false, lights: 0 },
  frontier: { back: -18, halfWidth: 24, height: 11, front: 3.9, pillars: 8, windows: 0, banners: 0, seats: true, lights: 6 },
};

// ------------------------------------------------------------------------------------------------- the walls

export type Wall = 'back' | 'left' | 'right';

/** A wall of the room seen from inside it (kit/interior/wallParts.ts WallFrame): its inner face's origin on the floor (the
 *  back wall's at x = centre.x, the side walls' at z = centre.z), `u` along it to the right, `w` into the room; its run
 *  of s (the side walls' from their front ends to the back wall). */
export function wallFrame(wall: Wall, spec: RoomSpec, stage: Stage): WallFrame {
  const cx = stage.centre.x, cz = stage.centre.z, hw = spec.halfWidth;
  const f = wallFrameAt;
  switch (wall) {
    case 'back': return f([cx, GROUND_Y, cz + spec.back], [1, 0, 0], [0, 0, 1], [-hw, hw]);
    case 'left': return f([cx - hw, GROUND_Y, cz], [0, 0, -1], [1, 0, 0], [-spec.front, -spec.back]);
    case 'right': return f([cx + hw, GROUND_Y, cz], [0, 0, 1], [-1, 0, 0], [spec.back, spec.front]);
  }
}

/** The default shell colours of a palette: a darker baseboard (the accent darkened), a lighter wainscot (the wall a
 *  little towards the accent), white trims, the upper wall the GBA's top-band stripe (the wall 0.45 towards the
 *  accent). */
function shellColors(p: ArenaPalette): ShellColors {
  const wainscot = mix(p.wall, p.accent, 0.12);
  return { base: scale(p.accent, 0.55), wainscot, panel: scale(wainscot, 1.04), trim: mix(p.wall, [1, 1, 1], 0.5), wall: mix(p.wall, p.accent, 0.45) };
}

/**
 * Walls 0.4 thick across the back (z = centre.z + back) and down both sides to z = centre.z + front (3.9 in every hall:
 * 0.1 inside the tall rule's z ≤ centre.z + 4, so Float32 vertex positions never round past it), a darker 0.35 baseboard,
 * a lighter wainscot to SHELL.wainscot with a trim line (a chair rail) and raised panels, the upper wall, a crown trim;
 * the corners mitred, the side walls' front ends capped. position, normal, color(3) (`colors` sRGB, default shellColors(p)).
 */
export function roomShell(spec: RoomSpec, stage: Stage, p: ArenaPalette, colors: ShellColors = shellColors(p)): THREE.BufferGeometry {
  const s = new Soup();
  const cx = stage.centre.x, cz = stage.centre.z, hw = spec.halfWidth;
  const C = shellPalette(colors);
  const zf = cz + spec.front;
  // the U path (kit wallPath: the corners mitred, the side walls' front ends capped): left front → left back → right
  // back → right front
  wallPath(s, [[cx - hw, zf], [cx - hw, cz + spec.back], [cx + hw, cz + spec.back], [cx + hw, zf]], [[1, 0], [0, 1], [-1, 0]], GROUND_Y,
    shellProfile(spec.height, SHELL.wainscot), C, true);
  // the wainscot's raised panels along each wall
  const P = SHELL.panel, pitch = P.width + P.gap, h0 = P.bottom, h1 = SHELL.wainscot - P.top;
  for (const wall of ['back', 'left', 'right'] as Wall[]) {
    const F = wallFrame(wall, spec, stage);
    // (the side walls' run starts at the back wall's wainscot face)
    const s0 = F.s[0] + (wall === 'right' ? 0.3 : 0), s1 = F.s[1] - (wall === 'left' ? 0.3 : 0);
    const n = Math.floor((s1 - s0 - P.gap) / pitch), start = (s0 + s1) / 2 - (n * pitch - P.gap) / 2;
    const d0 = 0.02, d1 = 0.02 + P.raise, e = P.inset;
    const up: V3 = [0, 1, 0], neg = (x: V3): V3 => [-x[0], -x[1], -x[2]];
    for (let i = 0; i < n; i++) {
      const a = start + i * pitch, b = a + P.width;
      const A = F.at(a, h0, d0), B = F.at(b, h0, d0), Cc = F.at(b, h1, d0), D = F.at(a, h1, d0);
      const a1 = F.at(a + e, h0 + e, d1), b1 = F.at(b - e, h0 + e, d1), c1 = F.at(b - e, h1 - e, d1), d1v = F.at(a + e, h1 - e, d1);
      s.quad(a1, b1, c1, d1v, F.w, C.panel);
      const bevel = (dir: V3): V3 => [F.w[0] + dir[0], F.w[1] + dir[1], F.w[2] + dir[2]];
      s.quad(D, Cc, c1, d1v, bevel(up), scale(C.panel, 1.06));
      s.quad(A, B, b1, a1, bevel(neg(up)), scale(C.panel, 0.88));
      s.quad(A, a1, d1v, D, bevel(neg(F.u)), scale(C.panel, 0.95));
      s.quad(B, b1, c1, Cc, bevel(F.u), scale(C.panel, 0.95));
    }
  }
  return s.geometry();
}

// ------------------------------------------------------------------------------------------------- pillars

/** A pillar's build: sides; its square plinth and abacus (half-widths × radius, heights); its base mouldings and capital
 *  (a lathe profile in units of the radius and over the plinth / under the abacus). */
const PILLAR = { sides: 16, plinth: [1.5, 0.3] as const, abacus: [1.45, 0.34] as const };

/** A column `height` tall from y = 0 at the origin: a square plinth, rounded base mouldings, a smooth slightly tapering
 *  shaft, a flared capital under a square abacus; smooth round, crisp along its profile; the shaft a little darker at its
 *  foot. position, normal, color(3) (`color` sRGB). */
export function pillarGeometry(radius: number, height: number, color: RGB): THREE.BufferGeometry {
  const s = new Soup();
  const r = radius, c = lin(color), light = lin(scale(color, 1.07)), [pw, ph] = PILLAR.plinth, [aw, ah] = PILLAR.abacus;
  const top = height - ah;
  // (r, y) profile and each step's colour: the mouldings and the capital light, the shaft (the fifth step) darker at its foot
  const prof: [number, number][] = [[1.36 * r, ph], [1.36 * r, ph + 0.1], [1.2 * r, ph + 0.22], [1.08 * r, ph + 0.28], [r, ph + 0.38],
    [0.93 * r, top - 0.42], [1.02 * r, top - 0.3], [1.18 * r, top - 0.14], [1.3 * r, top]];
  lathe(s, [0, 0, 0], prof, prof.slice(1).map((_, k): LatheColor => (k === 4 ? [scale(c, 0.9), c] : light)), PILLAR.sides);
  s.box([0, 0, 0], [1, 0, 0], [0, 0, 1], -pw * r, pw * r, 0, ph, -pw * r, pw * r, light);
  s.box([0, 0, 0], [1, 0, 0], [0, 0, 1], -aw * r, aw * r, top, height, -aw * r, aw * r, light, true);
  return s.geometry();
}

/** The pillars along a room's walls: their radius, and how far off their wall they stand (engaged: their plinth meets the
 *  wall). */
const PILLAR_R = 0.5, PILLAR_OFF = 0.62;

/** Pillars against the walls of the room `spec` (the halls', the marble stadium rooms': stadium.ts), one at each of `at`
 *  (a wall, s along it): PILLAR_R round, PILLAR_OFF off the wall, up to the crown; `color` sRGB. One geometry each, in
 *  place. */
export function wallPillars(spec: RoomSpec, at: readonly { wall: Wall; s: number }[], stage: Stage, color: RGB): THREE.BufferGeometry[] {
  return at.map((p) => {
    const o = wallFrame(p.wall, spec, stage).at(p.s, 0, PILLAR_OFF);
    return pillarGeometry(PILLAR_R, spec.height - SHELL.crown, color).translate(o[0], o[1], o[2]);
  });
}

// ------------------------------------------------------------------------------------------------- court lines

/** The court's lines: `width` wide at GROUND_Y + `y`; a ring 1.15–1.25 × each platform's footprint; the centre line
 *  across the court (along x through the stage centre, to its boundary) and the ball circle on it (`ball` its outer
 *  radius, a button `button` across); the court's boundary (floor.ts COURT_BOUNDS: the floor paints the court inside it). */
const COURT = { width: 0.1, y: 0.005, ring: [1.15, 1.25] as const, ball: 0.72, button: 0.17, segments: 64 };

/** Painted floor markings at GROUND_Y + 0.005 (a ring 1.15–1.25 × each footprint, a centre line, a ball circle at the
 *  centre; the court's boundary): flat, facing up. position, normal, color(3) (`color` sRGB). */
export function courtLines(stage: Stage, color: RGB): THREE.BufferGeometry {
  const s = new Soup(), c = lin(color), y = GROUND_Y + COURT.y, up: V3 = [0, 1, 0], N = COURT.segments;
  const cx = stage.centre.x, cz = stage.centre.z, w = COURT.width / 2;
  // an elliptical band round (x, z) between radii (rx, rz) × e0 and × e1
  const band = (x: number, z: number, rx: number, rz: number, e0: number, e1: number, n = N) => {
    for (let q = 0; q < n; q++) {
      const a0 = (q / n) * Math.PI * 2, a1 = ((q + 1) / n) * Math.PI * 2;
      const p = (a: number, e: number): V3 => [x + Math.cos(a) * rx * e, y, z + Math.sin(a) * rz * e];
      s.quad(p(a0, e0), p(a1, e0), p(a1, e1), p(a0, e1), up, c);
    }
  };
  for (const [p, f] of [[stage.player, PLATFORM_FOOTPRINT.player], [stage.enemy, PLATFORM_FOOTPRINT.enemy]] as const) {
    band(p.x, p.z, f.rx, f.rz, COURT.ring[0], COURT.ring[1]);
  }
  // the centre line (broken where the ball circle's middle is: its button) and the ball circle
  const line = (x0: number, z0: number, x1: number, z1: number) => {
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz), nx = (-dz / l) * w, nz = (dx / l) * w;
    s.quad([x0 + nx, y, z0 + nz], [x1 + nx, y, z1 + nz], [x1 - nx, y, z1 - nz], [x0 - nx, y, z0 - nz], up, c);
  };
  line(cx - COURT_BOUNDS.x, cz, cx - COURT.ball + w, cz);
  line(cx + COURT.ball - w, cz, cx + COURT_BOUNDS.x, cz);
  band(cx, cz, 1, 1, COURT.ball - 2 * w, COURT.ball, 48);
  line(cx - COURT.ball + w, cz, cx - COURT.button * 1.6, cz);
  line(cx + COURT.button * 1.6, cz, cx + COURT.ball - w, cz);
  band(cx, cz, 1, 1, COURT.button, COURT.button * 1.6, 24);
  // the boundary
  const { x: bx, z: [bz0, bz1] } = COURT_BOUNDS;
  line(cx - bx - w, cz + bz0, cx + bx + w, cz + bz0);
  line(cx - bx, cz + bz0, cx - bx, cz + bz1);
  line(cx + bx, cz + bz0, cx + bx, cz + bz1);
  return s.geometry();
}

// ------------------------------------------------------------------------------------------------- banners

/** A banner `height` tall and `width` wide hanging from its rod at y = height down to the point of its tip at y = 0,
 *  centred on x = 0 and facing +z: soft cloth (a gentle wave across it), its lower end cut to a point, a stripe band over
 *  the point and a thin one under the rod, a ball emblem in the stripe colour at 0.62 of its height; a rod across its top.
 *  position, normal, color(3) (sRGB colours). */
export function bannerGeometry(width: number, height: number, color: RGB, stripe: RGB): THREE.BufferGeometry {
  const s = new Soup(), main = lin(color), band = lin(stripe), back = lin(scale(color, 0.7));
  const hw = width / 2, v = 0.32 * width, cols = 6;
  const wave = (x: number) => 0.035 * (1 + Math.cos((x / width) * Math.PI * 2));
  const slope = (x: number) => -0.035 * Math.sin((x / width) * Math.PI * 2) * (Math.PI * 2 / width);
  const nrm = (x: number): V3 => { const d = slope(x), l = Math.hypot(d, 1); return [-d / l, 0, 1 / l]; };
  const bottom = (x: number) => v * Math.abs(x) / hw;
  // the rows (y, colour of the row above): the point, the stripe over it, the cloth, the top stripe, the cloth to the rod
  const rows: [number, RGB][] = [[0, main], [v + 0.1, band], [v + 0.32, main], [height - 0.48, band], [height - 0.36, main], [height, main]];
  for (let q = 0; q < cols; q++) {
    const x0 = -hw + (width * q) / cols, x1 = -hw + (width * (q + 1)) / cols;
    for (let k = 0; k + 1 < rows.length; k++) {
      const ya = rows[k][0], yb = rows[k + 1][0], col = rows[k][1];
      // (the lowest row starts at the point's edge)
      const y00 = k === 0 ? bottom(x0) : ya, y10 = k === 0 ? bottom(x1) : ya;
      if (yb <= Math.max(y00, y10) - 1e-6 && k === 0) continue;
      s.quadN([x0, y00, wave(x0)], [x1, y10, wave(x1)], [x1, yb, wave(x1)], [x0, yb, wave(x0)], [0, 0, 1],
        [nrm(x0), nrm(x1), nrm(x1), nrm(x0)], [col, col, col, col]);
    }
    // the back: flat, darker
    s.quad([x0, bottom(x0), -0.005], [x1, bottom(x1), -0.005], [x1, height, -0.005], [x0, height, -0.005], [0, 0, -1], back);
  }
  // the emblem: a ball in the stripe colour, its middle band the cloth's, on the cloth
  const ey = height * 0.62, er = 0.26 * width, M = 20;
  for (let q = 0; q < M; q++) {
    const a0 = (q / M) * Math.PI * 2, a1 = ((q + 1) / M) * Math.PI * 2;
    const pt = (a: number, r: number): V3 => { const x = Math.cos(a) * r; return [x, ey + Math.sin(a) * r, wave(x) + 0.006]; };
    s.quad(pt(a0, er * 0.42), pt(a1, er * 0.42), pt(a1, er), pt(a0, er), [0, 0, 1], band);
  }
  for (let q = 0; q < 4; q++) {
    const x0 = -er + (2 * er * q) / 4, x1 = -er + (2 * er * (q + 1)) / 4;
    s.quad([x0, ey - 0.03, wave(x0) + 0.007], [x1, ey - 0.03, wave(x1) + 0.007], [x1, ey + 0.03, wave(x1) + 0.007],
      [x0, ey + 0.03, wave(x0) + 0.007], [0, 0, 1], main);
  }
  // the rod
  s.box([0, 0, 0], [1, 0, 0], [0, 0, 1], -hw - 0.14, hw + 0.14, height - 0.04, height + 0.05, -0.02, 0.08, lin(scale(stripe, 0.75)), true);
  return s.geometry();
}

// ------------------------------------------------------------------------------------------------- seat tiers

/** The Frontier's stands: an arc ± `arc` rad from straight behind the stage centre; a barrier `barrier` tall and
 *  `wall` thick whose face stands `r0` from the centre, then rows `depth` deep rising `rise` each from `h0`; seats every
 *  `pitch` units along a row, `aisle` to a section (an aisle's gap between sections); the arc's chords at most `chord`. */
export const SEATS = { arc: 1.25, r0: 12.4, wall: 0.3, barrier: 0.8, h0: 0.42, depth: 0.95, rise: 0.42, pitch: 0.62, aisle: 9, chord: 0.7 };

/** Stepped rows behind the back wall's arc — the barrier (the arc's wall, facing the stage, its top capped) and `rows`
 *  rows of seats rising behind it, each a riser and a tread with a row of seats (a pan and a back) in `color`, sections
 *  alternating a little in tone, split by aisles; the stand's structure the colour lightened; its back and ends closed.
 *  position, normal, color(3) (`color` sRGB). */
export function seatTiers(stage: Stage, rows: number, color: RGB): THREE.BufferGeometry {
  const S = SEATS, s = new Soup();
  const cx = stage.centre.x, cz = stage.centre.z;
  const concrete = lin(mix(color, [1, 1, 1], 0.62)), dark = lin(mix(color, [1, 1, 1], 0.4)), seatA = lin(color), seatB = lin(scale(color, 0.86));
  const rMax = S.r0 + rows * S.depth;
  const segs = Math.ceil((2 * S.arc * rMax) / S.chord);
  const at = (a: number, r: number, h: number): V3 => [cx + Math.sin(a) * r, GROUND_Y + h, cz - Math.cos(a) * r];
  const radial = (a: number): V3 => [Math.sin(a), 0, -Math.cos(a)];
  const inward = (a: number): V3 => [-Math.sin(a), 0, Math.cos(a)];
  const tread = (k: number) => S.h0 + k * S.rise;
  for (let q = 0; q < segs; q++) {
    const a0 = -S.arc + (2 * S.arc * q) / segs, a1 = -S.arc + (2 * S.arc * (q + 1)) / segs, am = (a0 + a1) / 2;
    const quadArc = (r0: number, h0: number, r1: number, h1: number, n: V3, col: RGB) =>
      s.quad(at(a0, r0, h0), at(a1, r0, h0), at(a1, r1, h1), at(a0, r1, h1), n, col);
    // the barrier: its face, its cap, its back (down to the first row)
    const rb = S.r0 - S.wall;
    quadArc(rb, -0.02, rb, S.barrier, inward(am), dark);
    quadArc(rb, S.barrier, S.r0, S.barrier, [0, 1, 0], concrete);
    // the rows: a riser at the row's front, its tread
    for (let k = 0; k < rows; k++) {
      const r = S.r0 + k * S.depth, h = tread(k), below = k === 0 ? 0 : tread(k - 1);
      if (k > 0) quadArc(r, below, r, h, inward(am), scale(concrete, 0.9));
      else quadArc(r, h, r, S.barrier, radial(am), scale(concrete, 0.85));
      quadArc(r, h, r + S.depth, h, [0, 1, 0], concrete);
    }
    // the back
    quadArc(rMax, tread(rows - 1), rMax, -0.02, radial(am), scale(concrete, 0.8));
  }
  // the ends: the stepped section, facing out along the arc
  for (const sa of [-1, 1]) {
    const a = sa * S.arc, n: V3 = [sa * Math.cos(a), 0, sa * Math.sin(a)];
    s.quad(at(a, S.r0 - S.wall, -0.02), at(a, S.r0, -0.02), at(a, S.r0, S.barrier), at(a, S.r0 - S.wall, S.barrier), n, dark);
    for (let k = 0; k < rows; k++) {
      const r = S.r0 + k * S.depth;
      s.quad(at(a, r, -0.02), at(a, r + S.depth, -0.02), at(a, r + S.depth, tread(k)), at(a, r, tread(k)), n, scale(concrete, 0.85));
    }
  }
  // the seats: a pan and a back, facing the stage
  for (let k = 0; k < rows; k++) {
    const r = S.r0 + k * S.depth, h = tread(k);
    const rs = r + S.depth * 0.55, n = Math.floor((2 * S.arc * rs) / S.pitch);
    for (let i = 0; i < n; i++) {
      // (an aisle every S.aisle seats: one left out)
      if ((i + 1) % (S.aisle + 1) === 0) continue;
      const sec = Math.floor(i / (S.aisle + 1)), col = sec % 2 ? seatB : seatA;
      const a = -S.arc + (2 * S.arc * (i + 0.5)) / n, u: V3 = [Math.cos(a), 0, Math.sin(a)], w = inward(a);
      const o = at(a, 0, h);
      const half = S.pitch * 0.38;
      // pan (from 0.2 to 0.62 of the row's depth), back (at 0.66–0.78, up 0.5)
      s.box([o[0], o[1], o[2]], u, w, -half, half, 0, 0.2, -(r + S.depth * 0.62), -(r + S.depth * 0.2), col);
      s.box([o[0], o[1], o[2]], u, w, -half, half, 0.12, 0.52, -(r + S.depth * 0.78), -(r + S.depth * 0.64), scale(col, 0.94));
    }
  }
  return s.geometry();
}

// ------------------------------------------------------------------------------------------------- the halls' furniture

/** Where a hall's things stand: pillars, banners, windows, bookcases on their walls (s along the wall), the light panels
 *  on the barrier (angles off straight behind). Counts as HALLS gives them. */
interface HallLayout {
  pillars: { wall: Wall; s: number }[];
  banners: { wall: Wall; s: number }[];
  windows: { wall: Wall; s: number }[];
  shelves: { wall: Wall; s: number }[];
  lights: number[];
}

/** The layouts. The idle camera (yaw 0) frames the back wall within s ≈ ±8.5 (the building's) / ±9 (the gyms'), the
 *  barrier within ±0.6 rad, and the enemy battler's silhouette covers s ≈ 1.5–6 there / the barrier's 0.15–0.40 rad
 *  (.scratch: a 2 × 2 box on its platform, projected): what draws the eye — a window, a bookcase, a banner, a light
 *  panel — keeps out of it, the plain wall stands behind the enemy. The building: four windows and four bookcases
 *  alternating along its back wall (a window and a bookcase each side of the enemy's stretch of wall in the idle frame);
 *  the gyms: four pillars on the back wall (the inner pair at the frame's edges) and one on each side wall, a banner in
 *  the middle bay and one in each bay beyond the inner pillars — the Leader's two more on its side walls; the
 *  Frontier: three pillars along each side wall and one in each back corner, its six light panels along the barrier,
 *  four left of the enemy's stretch (the outer one clear of the player's) and two right of it. All of them clear of both
 *  battlers' boxes through the idle sway (± 0.04 yaw: the building's middle window was at s −0.3 and the Frontier's
 *  second panel at −0.72 rad, each touching a box at +0.04). Counts as HALLS gives them. */
export function hallLayout(kind: HallKind): HallLayout {
  const h = HALLS[kind], hw = h.halfWidth;
  const sym = (xs: number[]) => xs.flatMap((x) => (x === 0 ? [0] : [-x, x])).sort((a, b) => a - b);
  const on = (wall: Wall) => (s: number) => ({ wall, s });
  switch (kind) {
    case 'building':
      return { pillars: [], banners: [], windows: [-16.5, -8.9, -0.6, 11.8].map(on('back')), shelves: [-12.7, -4.6, 7.6, 15.7].map(on('back')),
        lights: [] };
    case 'gym': case 'leader': {
      const pillars = [...sym([7.5, 16]).map(on('back')), on('left')(8), on('right')(-8)];
      const banners = sym([0, 11.75]).map(on('back'));
      if (kind === 'leader') banners.push(on('left')(13), on('right')(-13));
      return { pillars, banners, windows: [], shelves: [], lights: [] };
    }
    case 'frontier': {
      const side = [16, 9.5, 3].flatMap((z) => [on('left')(z), on('right')(-z)]);
      return { pillars: [...side, ...sym([hw - 3.5]).map(on('back'))], banners: [], windows: [], shelves: [], lights: [-1.02, -0.74, -0.3, -0.06, 0.62, 0.95] };
    }
  }
}

/** A light panel on the barrier: `width` along the arc, from `y0` to `y1` over the floor, just in front of its face,
 *  curved with it; a soft vertical gradient in its vertex colours (brighter in the middle). */
export const PANEL = { width: 2.2, y0: 0.2, y1: 0.62, segs: 6 };
function addLightPanel(glow: Soup, stage: Stage, a: number, color: RGB): void {
  const r = SEATS.r0 - SEATS.wall - 0.025, half = PANEL.width / 2 / r;
  const cx = stage.centre.x, cz = stage.centre.z;
  const at = (b: number, h: number): V3 => [cx + Math.sin(b) * r, GROUND_Y + h, cz - Math.cos(b) * r];
  const c = lin(color), edge = lin(scale(color, 0.78)), ym = (PANEL.y0 + PANEL.y1) / 2;
  for (let q = 0; q < PANEL.segs; q++) {
    const b0 = a - half + (2 * half * q) / PANEL.segs, b1 = a - half + (2 * half * (q + 1)) / PANEL.segs, bm = (b0 + b1) / 2;
    const n: V3 = [-Math.sin(bm), 0, Math.cos(bm)];
    glow.quadN(at(b0, PANEL.y0), at(b1, PANEL.y0), at(b1, ym), at(b0, ym), n, [n, n, n, n], [edge, edge, c, c]);
    glow.quadN(at(b0, ym), at(b1, ym), at(b1, PANEL.y1), at(b0, PANEL.y1), n, [n, n, n, n], [c, c, edge, edge]);
  }
}

// ------------------------------------------------------------------------------------------------- colours

/** A hall's colours (sRGB), from its palette: the shell's, the pillars', the banners' (the accent, deepened, with a
 *  light stripe), the bookcases' wood, the seats' (the accent deepened), the court lines', the light panels'. */
export interface HallColors { shell: ShellColors; pillar: RGB; banner: RGB; stripe: RGB; wood: RGB; seat: RGB; lines: RGB; glow: RGB }

/** The accent made deeper: its hue pushed away from grey by `sat`, darkened by `k`. */
function deepen(c: RGB, sat: number, k: number): RGB {
  const l = luma(c);
  return [0, 1, 2].map((i) => Math.min(1, Math.max(0, (l + (c[i] - l) * sat) * k))) as RGB;
}

export function hallColors(kind: HallKind, p: ArenaPalette): HallColors {
  const white = mix(p.wall, [1, 1, 1], 0.5);
  const shell = shellColors(p);
  const banner = deepen(p.accent, 1.6, 0.82);
  const base = { shell, pillar: mix(p.wall, p.accent, 0.18), banner, stripe: white, wood: [0.55, 0.38, 0.25] as RGB, seat: deepen(p.accent, 6, 0.75),
    lines: white, glow: mix(p.accent, [0.9, 0.97, 1.0], 0.7) };
  switch (kind) {
    case 'gym': {
      // the GBA's tan band in the wainscot under a cream wall, a dark tan baseboard
      const wainscot = mix(p.wall, p.accent, 0.5);
      return { ...base, shell: { base: scale(p.accent, 0.5), wainscot, panel: scale(wainscot, 1.05), trim: white, wall: mix(p.wall, p.accent, 0.12) } };
    }
    case 'building': {
      // a warm wooden wainscot and baseboard under a cream wall (the GBA's pale yellow band), bookcases in a darker wood
      const wood = mix(p.ground, [0.58, 0.4, 0.26], 0.55);
      return { ...base, wood: scale(wood, 0.82),
        shell: { base: scale(wood, 0.62), wainscot: wood, panel: scale(wood, 1.06), trim: white, wall: mix(p.wall, p.accent, 0.4) } };
    }
    case 'leader': {
      // the gym's, darker: a deep tan wainscot and a darker baseboard under a mid-tone wall, richer banners
      const wall = scale(mix(p.wall, p.accent, 0.45), 0.86), wainscot = scale(mix(p.wall, p.accent, 0.8), 0.78);
      return { ...base, banner: deepen(p.accent, 2, 0.66), pillar: scale(mix(p.wall, p.accent, 0.3), 0.92),
        shell: { base: scale(p.accent, 0.36), wainscot, panel: scale(wainscot, 1.06), trim: scale(white, 0.95), wall } };
    }
    default: return base;
  }
}

// ------------------------------------------------------------------------------------------------- the part

const PNC = { position: 3, normal: 3, color: 3 };
/** The banners: width, rod height under the crown, tip height over the floor; how far off the wall. */
const BANNER = { width: 1.5, under: 1.4, tip: 0.5, off: 0.12 };
/** The light panels' daylight glow (linear emissive, × their colour; set for their draw only: the pooled material
 *  keeps black for any other user) — the panels' lit colour plus this crosses the bloom's threshold softly. */
const PANEL_GLOW = 0.5;

const HALL_KINDS: readonly HallKind[] = ['building', 'gym', 'leader', 'frontier'];

export const HALL_PART: ArenaPart = {
  name: 'hall',
  kinds: HALL_KINDS,
  catalogue(): readonly CatalogueEntry[] {
    return [
      { material: BUILDING_BODY, mesh: 'mesh', attrs: PNC, castShadow: true },
      { material: BUILDING_GLASS, mesh: 'mesh', attrs: PNC, castShadow: true },
      { material: PROP_GLOW, mesh: 'mesh', attrs: PNC, castShadow: false },
      { material: SOIL_MATERIAL, mesh: 'mesh', attrs: PNC, castShadow: false },
    ];
  },
  build(ctx) {
    const kind = ctx.kind as HallKind, spec = HALLS[kind];
    if (!spec) return null;
    const { stage, palette } = ctx;
    const colors = hallColors(kind, palette), layout = hallLayout(kind);
    const group = new THREE.Group();
    const parts: THREE.BufferGeometry[] = [roomShell(spec, stage, palette, colors.shell), ...wallPillars(spec, layout.pillars, stage, colors.pillar)];
    const extra = new Soup(), glass = new Soup(), glow = new Soup();
    const frames = { back: wallFrame('back', spec, stage), left: wallFrame('left', spec, stage), right: wallFrame('right', spec, stage) };
    const bannerH = spec.height - BANNER.under - BANNER.tip;
    for (const b of layout.banners) {
      const F = frames[b.wall], at = F.at(b.s, BANNER.tip, BANNER.off);
      const g = bannerGeometry(BANNER.width, bannerH, colors.banner, colors.stripe);
      g.rotateY(Math.atan2(F.w[0], F.w[2]));
      parts.push(g.translate(at[0], at[1], at[2]));
    }
    for (const w of layout.windows) addWindow(extra, glass, frames[w.wall], w.s, colors.shell.trim);
    layout.shelves.forEach((s, i) => addShelf(extra, frames[s.wall], s.s, colors.wood, i + 1));
    if (spec.seats) parts.push(seatTiers(stage, 5, colors.seat));
    for (const a of layout.lights) addLightPanel(glow, stage, a, colors.glow);
    if (!extra.empty) parts.push(extra.geometry());
    const g = mergeGeometries(parts)!;
    for (const x of parts) x.dispose();
    g.computeBoundingSphere();
    const room = new THREE.Mesh(g, kitMaterial(ctx.uniforms, BUILDING_BODY).material);
    room.name = 'hallRoom';
    room.castShadow = true;
    room.receiveShadow = true;
    group.add(room);
    if (!glass.empty) {
      const m = new THREE.Mesh(glass.geometry(), kitMaterial(ctx.uniforms, BUILDING_GLASS).material);
      m.name = 'hallWindows';
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
    if (!glow.empty) {
      // (daytime glow for their draw only)
      const e = lin(colors.glow), m = glowMesh(ctx.uniforms, glow.geometry(), [e[0] * PANEL_GLOW, e[1] * PANEL_GLOW, e[2] * PANEL_GLOW]);
      m.name = 'hallLights';
      group.add(m);
    }
    if (kind === 'gym' || kind === 'leader') {
      const m = new THREE.Mesh(courtLines(stage, colors.lines), kitMaterial(ctx.uniforms, SOIL_MATERIAL).material);
      m.name = 'courtLines';
      m.receiveShadow = true;
      group.add(m);
    }
    return group;
  },
};
