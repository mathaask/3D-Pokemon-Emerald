// The room shell's geometry (Phase 4 Task 7, pure): a room layout's walls, partitions, window and door fixtures, clocks,
// the wall-art decals' texture and quads, and the glass material's options. The shell family (shell.ts) wraps these in
// meshes and materials.
//
// - Outer walls. These are the layout's runs that are not partitions, plus *bridges*: wherever a partition cell borders
//   neither room nor partition (the void beside a dividing wall, the back wall's band over a strip), the outer wall goes
//   on past it, so the runs on either side merge into one wall. Each run is one `wallPath` segment with SHELL_PROFILE
//   and caps. Each end is mitred with the run of the other axis that meets it there (RUN_NORMAL = the cutaway's
//   INNER_NORMAL), or square where none does. Doorways and windows cut openings: the run is split there, with a lintel
//   (or a head over the window) and a sill below the window.
// - Partitions (`RoomLayout.partition`, the controller's ruling). A dividing wall or a strip of wall art in the room is
//   a half-height solid (PARTITION_H) with real thickness. Each connected piece's footprint is its cells, plus the
//   recess where it hangs from the back wall. Each footprint is one closed `wallPath` loop of PARTITION_PROFILE
//   (baseboard, wainscot, coping) under a flat lid. It is never hollow, so it is no wall the cutaway hides.
// - Window glass sits at `windowRect` (by feature reference: Task 5 M3), on the back wall's N run. Its casing and sill
//   come from `addWindow`. A clock is modelled. Decor, unknown band cells, and wall art on a partition are decals:
//   Scale4x of the cells' pixels in one texture, a quad DECAL_OFFSET in front of the wall's face. Clocks and decals
//   take their rows from `bandRect` (row 0 = the band's top).
//
// Coordinates: world X = grid x, Y = floorY + h, Z = grid line + floorY (the room is flat at floorY; un-projection).

import * as THREE from 'three';
import type { MapAnalysis } from '../../../overworld/analyze';
import type { KitMaterialOptions } from '../../materials';
import { bgr555ToSrgb, scale, soften, type RGB } from '../../palette';
import { lathe, lin, Soup } from '../../soup';
import type { V3 } from '../../geom';
import { scale4x } from '../../upscale';
import { INNER_NORMAL, pocketDir } from '../cutaway';
import {
  RECESS, WALL_H, WALL_SPAN, WALL_T, bandRect, mergeSpans, windowRect, type DoorGap, type RoomLayout, type WallDir, type WallFeature,
  type WallRun,
} from '../room';
import {
  SHELL, WINDOW, addWindow, maxProfileDepth, shellPalette, shellProfile, wallFrameAt, wallPath,
  type ShellColors, type ShellPalette, type ShellProfile, type V2, type WallFrame, type WindowSize,
} from '../wallParts';

// ------------------------------------------------------------------------------------------------- constants

/** The rooms' wall profile: WALL_H tall, its chair rail at SHELL.wainscot, WALL_T thick. */
export const SHELL_PROFILE: ShellProfile = shellProfile(WALL_H, SHELL.wainscot, WALL_T);
/** How far the wall profile stands into the room at most: its crown, 0.16 (preflight F9). */
export const SHELL_CROWN_DEPTH = maxProfileDepth(SHELL_PROFILE);
/** A doorway's height: the wall stands over it from here (the lintel). */
export const LINTEL_H = 2.1;
/** A partition's height (half the wall's: the GBA draws them one row of face under a one-row top). */
export const PARTITION_H = WALL_H / 2;
/** A decal stands this far in front of its wall's face (inner face 0): clear of the rail and baseboard (SHELL.relief). */
export const DECAL_OFFSET = SHELL.relief + 0.01;
/** The band's art rows are stretched over WALL_SPAN on a wall (room.ts: windows, clocks, decals) and over this span on
 *  a partition's face. */
export { WALL_SPAN, bandRect };
export const PARTITION_SPAN: readonly [number, number] = [0.12, PARTITION_H - 0.12];
/** Doorways: the casing `casing` wide standing `depth` off the wall; linings `lining` thick on the opening's jambs and
 *  head; the closed slab `slab` thick in the middle of the wall; a knob. */
export const DOOR = { casing: 0.1, depth: 0.09, lining: 0.03, slab: 0.05, knob: 0.05, knobH: 0.98 };
/** A wall clock's radius: at most this, else 0.45 of its feature's smaller side. */
export const CLOCK_R = 0.32;

/** Each wall direction's inner normal (into the room; world x, z): the cutaway's INNER_NORMAL. */
export const RUN_NORMAL: Readonly<Record<WallDir, V2>> = INNER_NORMAL;
const DIRS: readonly WallDir[] = ['N', 'E', 'S', 'W'];
const isNS = (d: WallDir) => d === 'N' || d === 'S';

/** A partition's cross-section (as shellProfile's: d into the room, h over the floor), up its face to its coping; the
 *  shell closes it with a flat lid at PARTITION_H (a closed loop needs no outer face). */
export const PARTITION_PROFILE: ShellProfile = {
  pts: [[SHELL.relief, -0.04], [SHELL.relief, 0.29], [0.035, SHELL.base], [0.02, SHELL.base], [0.02, PARTITION_H - 0.13],
    [0.07, PARTITION_H - 0.09], [0.07, PARTITION_H]],
  col: ['base', 'base', 'base', 'wainscot', 'trim', 'trim'],
};
/** The partition's coping: how far its lid reaches past the footprint. */
const COPING = 0.07;

// ------------------------------------------------------------------------------------------------- profile crops

/** The inner polyline of a profile: its points up to the first one on the outer face (d = min d). */
function innerOf(p: ShellProfile): { pts: [number, number][]; outer: number } {
  const outer = Math.min(...p.pts.map(([d]) => d));
  const k = p.pts.findIndex(([d]) => d === outer);
  return { pts: p.pts.slice(0, k < 0 ? p.pts.length : k), outer };
}

/**
 * The profile `p` cut to the heights h0 … h1 (clamped to its own): a section of the wall over / under an opening. The
 * inner face between them keeps its steps and colours; a cut above the bottom starts with the section's underside (from
 * the outer face to the inner one, facing down: a lintel's soffit); a cut under the top ends with its top (back to the
 * outer face, facing up: a sill); the outer face closes it. Closing steps are coloured 'cap'.
 */
export function cropProfile(p: ShellProfile, h0: number, h1: number): ShellProfile {
  const { pts, outer } = innerOf(p);
  const lo = pts[0][1], hi = pts[pts.length - 1][1];
  const a = Math.max(h0, lo), b = Math.min(h1, hi);
  // d on the inner face at h, from above (the first rising step whose span starts at or below h) or below
  const dAt = (h: number, above: boolean): { d: number; k: number } => {
    for (let k = 0; k + 1 < pts.length; k++) {
      const [d0, y0] = pts[k], [d1, y1] = pts[k + 1];
      if (y1 <= y0) continue;
      if (above ? y0 <= h && h < y1 : y0 < h && h <= y1) return { d: d0 + ((h - y0) / (y1 - y0)) * (d1 - d0), k };
    }
    // at the very bottom / top
    return above ? { d: pts[0][0], k: 0 } : { d: pts[pts.length - 1][0], k: pts.length - 2 };
  };
  const out: [number, number][] = [], col: ShellProfile['col'] = [];
  if (a > lo) { out.push([outer, a]); col.push('cap'); }
  const s = a > lo ? dAt(a, true) : { d: pts[0][0], k: 0 };
  out.push([s.d, a]);
  // the original points strictly between a and b (a horizontal ledge at a or b is cut away with the cut)
  let k = s.k;
  for (let i = 0; i < pts.length; i++) {
    const h = pts[i][1];
    if (h <= a || h >= b) continue;
    col.push(p.col[k]);
    out.push([pts[i][0], h]);
    k = i;
  }
  const e = b < hi ? dAt(b, false) : { d: pts[pts.length - 1][0], k: pts.length - 2 };
  col.push(p.col[b < hi ? e.k : k]);
  out.push([e.d, b]);
  // over the top back to the outer face (the original top's colour where it is the top), down the outer face
  const topCol = b < hi ? 'cap' : p.col[pts.length - 1] ?? 'cap';
  out.push([outer, b]); col.push(topCol);
  out.push([outer, a]); col.push('cap');
  return { pts: out, col };
}

// ------------------------------------------------------------------------------------------------- outer runs

/** An outer wall run built by the shell (WallRun without the partition flag). */
export type ShellRun = Omit<WallRun, 'partition'>;

/** Whether cell (x, y)'s north neighbour is back-wall band (not a partition): a partition cell there reaches back into
 *  the recess to the back wall's face. */
function underBackBand(a: MapAnalysis, L: RoomLayout, x: number, y: number): boolean {
  if (!a.inside(x, y - 1)) return false;
  const n = a.idx(x, y - 1);
  return L.band[n] === 1 && L.partition[n] === 0;
}

/**
 * The outer walls: the layout's runs that are not partitions, plus a bridge along every edge of a partition cell that
 * borders neither room nor partition (N: on the back wall's line when band lies north, else the cell's edge; E/W from
 * the recess where the cell reaches into it), merged. A bridge takes the floorY of the run it continues (else the
 * layout's most common).
 */
export function shellRuns(a: MapAnalysis, L: RoomLayout): ShellRun[] {
  const outer: ShellRun[] = L.runs.filter((r) => !r.partition).map(({ dir, line, from, to, floorY }) => ({ dir, line, from, to, floorY }));
  const fyCount = new Map<number, number>();
  for (const r of L.runs) fyCount.set(r.floorY, (fyCount.get(r.floorY) ?? 0) + 1);
  let fyMode = 0, best = 0;
  for (const [fy, n] of fyCount) if (n > best) { fyMode = fy; best = n; }
  const room = (x: number, y: number) => a.inside(x, y) && (L.inside[a.idx(x, y)] === 1 || L.partition[a.idx(x, y)] === 1);
  const bridges: Omit<ShellRun, 'floorY'>[] = [];
  for (let i = 0; i < a.N; i++) {
    if (!L.partition[i]) continue;
    const x = a.cellX(i), y = a.cellY(i);
    const back = underBackBand(a, L, x, y), top = back ? y - RECESS : y;
    if (!room(x, y - 1)) bridges.push({ dir: 'N', line: top, from: x, to: x + 1 });
    if (!room(x, y + 1)) bridges.push({ dir: 'S', line: y + 1, from: x, to: x + 1 });
    if (!room(x + 1, y)) bridges.push({ dir: 'E', line: x + 1, from: top, to: y + 1 });
    if (!room(x - 1, y)) bridges.push({ dir: 'W', line: x, from: top, to: y + 1 });
  }
  for (const b of bridges) {
    const near = outer.find((r) => r.dir === b.dir && r.line === b.line && r.from <= b.to && b.from <= r.to);
    outer.push({ ...b, floorY: near ? near.floorY : fyMode });
  }
  return mergeSpans(outer);
}

/** The run's two ends' neighbours: per end (from, to) the inner normal of the run of the other axis that has an end at
 *  that corner (same floorY), else null (a square end). */
export function runEnds(runs: readonly ShellRun[], r: ShellRun): [V2 | null, V2 | null] {
  const at = (e: number): V2 | null => {
    const q = runs.find((o) => isNS(o.dir) !== isNS(r.dir) && o.floorY === r.floorY && o.line === e && (o.from === r.line || o.to === r.line));
    return q ? RUN_NORMAL[q.dir] : null;
  };
  return [at(r.from), at(r.to)];
}

/** A run's frame: its inner face's origin on the floor, u to the right seen from the room, w = into the room. s along u
 *  is the grid coordinate along the run for N and E walls and its negative for S and W walls (`sOf`). */
export function runFrame(r: ShellRun): WallFrame {
  const n = RUN_NORMAL[r.dir], fy = r.floorY;
  const w: V3 = [n[0], 0, n[1]], u: V3 = [n[1], 0, -n[0]];
  const o: V3 = isNS(r.dir) ? [0, fy, r.line + fy] : [r.line, fy, fy];
  const s0 = sOf(r.dir, r.from), s1 = sOf(r.dir, r.to);
  return wallFrameAt(o, u, w, [Math.min(s0, s1), Math.max(s0, s1)]);
}
const sOf = (d: WallDir, t: number) => (d === 'N' || d === 'E' ? t : -t);

/** An opening in a run: along it [from, to) (grid), over the floor h0 … h1. */
interface Opening { from: number; to: number; h0: number; h1: number }

/** The run as wall pieces: full profile between the openings (square ends at an opening, the run's own `ends` at its
 *  ends; caps), and per opening the profile cut under and over it (no caps: they stand between the jambs). */
function addRun(s: Soup, r: ShellRun, ends: [V2 | null, V2 | null], openings: readonly Opening[], C: ShellPalette): void {
  const n = RUN_NORMAL[r.dir], fy = r.floorY;
  const pt = (t: number): V2 => (isNS(r.dir) ? [t, r.line + fy] : [r.line, t + fy]);
  const seg = (t0: number, t1: number, prof: ShellProfile, caps: boolean, e: [V2 | null, V2 | null]) => {
    if (t1 - t0 < 1e-6) return;
    wallPath(s, [pt(t0), pt(t1)], [n], fy, prof, C, caps, e);
  };
  let t = r.from, first = true;
  for (const o of openings) {
    seg(t, o.from, SHELL_PROFILE, true, [first ? ends[0] : null, null]);
    if (o.h0 > -0.04 + 1e-6) seg(o.from, o.to, cropProfile(SHELL_PROFILE, -Infinity, o.h0), false, [null, null]);
    if (o.h1 < WALL_H - 1e-6) seg(o.from, o.to, cropProfile(SHELL_PROFILE, o.h1, Infinity), false, [null, null]);
    t = o.to; first = false;
  }
  seg(t, r.to, SHELL_PROFILE, true, [first ? ends[0] : null, ends[1]]);
}

// ------------------------------------------------------------------------------------------------- features

/** Whether a feature hangs on a partition (its first row's middle cell, as roomLayout reads the wall it hangs on). */
export function onPartition(L: RoomLayout, f: WallFeature): boolean {
  const c = f.cells[Math.min(f.x1 - 1, Math.floor((f.x0 + f.x1) / 2)) - f.x0];
  return c !== undefined && L.partition[c] === 1;
}

/** A decal's quad: x0 … x1, y0 … y1 (world), at world z, facing +z; its texture rectangle [u0, v0, u1, v1]. */
export interface DecalQuad { x0: number; x1: number; y0: number; y1: number; z: number; uv: readonly [number, number, number, number] }

/** A decal's place (no uv yet): over its columns and stretched rows, DECAL_OFFSET in front of its wall (the back wall's
 *  N run or the partition's south face, `windowRect`'s z by reference), `floorY` the wall's. */
export function decalRect(L: RoomLayout, f: WallFeature, floorY: number): Omit<DecalQuad, 'uv'> {
  const part = onPartition(L, f);
  const [s0, s1] = part ? PARTITION_SPAN : WALL_SPAN;
  const r = bandRect(f, s0, s1), z = windowRect(L, f).z;
  return { x0: f.x0, x1: f.x1, y0: floorY + r.y0, y1: floorY + r.y1, z: z + floorY + DECAL_OFFSET };
}

/** The decals' quads as one geometry (position, normal +z, uv; indexed). */
export function decalGeometry(quads: readonly DecalQuad[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], index: number[] = [];
  for (const q of quads) {
    const k = pos.length / 3, [u0, v0, u1, v1] = q.uv;
    pos.push(q.x0, q.y1, q.z, q.x1, q.y1, q.z, q.x1, q.y0, q.z, q.x0, q.y0, q.z);
    uv.push(u0, v1, u1, v1, u1, v0, u0, v0);
    nor.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
    index.push(k, k + 3, k + 1, k + 1, k + 3, k + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

/** The decals' texture: per feature its cells' pixels (16 × 16 per cell, `both` layers; transparent pixels in `fill`,
 *  sRGB, the others soften()ed), each with a one-pixel gutter of its own edge pixels (no bleeding between features under
 *  the upscaler and the linear filter), shelf-packed into one image, Scale4x-upscaled, rows flipped (a DataTexture's
 *  bottom row first). RGBA bytes; `uv[k]` = feature k's rectangle [u0, v0, u1, v1] without its gutter. */
export function packDecals(both: Uint16Array, mt: ArrayLike<number>, features: readonly WallFeature[], fill: RGB):
  { width: number; height: number; data: Uint8Array; uv: [number, number, number, number][] } {
  const pack = (c: RGB) => ((255 << 24) | (Math.round(c[2] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[0] * 255)) >>> 0;
  const fillPx = pack(fill), colours = new Map<number, number>();
  const pixel = (v: number) => {
    if (v & 0x8000) return fillPx;
    let c = colours.get(v);
    if (c === undefined) colours.set(v, (c = pack(soften(bgr555ToSrgb(v)))));
    return c;
  };
  // each feature's image with its gutter
  const imgs = features.map((f) => {
    const cw = f.x1 - f.x0, ch = f.row1 - f.row0 + 1, w = cw * 16, h = ch * 16;
    const img = new Uint32Array((w + 2) * (h + 2));
    for (let y = -1; y <= h; y++) {
      for (let x = -1; x <= w; x++) {
        const px = Math.min(w - 1, Math.max(0, x)), py = Math.min(h - 1, Math.max(0, y));
        const cell = f.cells[Math.floor(py / 16) * cw + Math.floor(px / 16)];
        const v = cell === undefined ? 0x8000 : both[mt[cell] * 256 + (py % 16) * 16 + (px % 16)];
        img[(y + 1) * (w + 2) + x + 1] = pixel(v);
      }
    }
    return { img, w: w + 2, h: h + 2 };
  });
  // shelf packing, widest first being unnecessary: rows of images in order, at most W wide
  const area = imgs.reduce((s, i) => s + i.w * i.h, 0);
  const W = Math.max(...imgs.map((i) => i.w), Math.ceil(Math.sqrt(area) / 2) * 2, 2);
  const at: { x: number; y: number }[] = [];
  let x = 0, y = 0, rowH = 0;
  for (const i of imgs) {
    if (x + i.w > W) { x = 0; y += rowH; rowH = 0; }
    at.push({ x, y });
    x += i.w; rowH = Math.max(rowH, i.h);
  }
  const H = Math.max(2, y + rowH);
  const src = new Uint32Array(W * H).fill(fillPx);
  imgs.forEach((i, k) => {
    for (let r = 0; r < i.h; r++) src.set(i.img.subarray(r * i.w, (r + 1) * i.w), (at[k].y + r) * W + at[k].x);
  });
  const big = scale4x(src, W, H), W4 = W * 4, H4 = H * 4;
  const flipped = new Uint32Array(W4 * H4);
  for (let r = 0; r < H4; r++) flipped.set(big.subarray(r * W4, (r + 1) * W4), (H4 - 1 - r) * W4);
  const uv = imgs.map((i, k): [number, number, number, number] => {
    const x0 = at[k].x + 1, y0 = at[k].y + 1, x1 = x0 + i.w - 2, y1 = y0 + i.h - 2;
    return [x0 / W, 1 - y1 / H, x1 / W, 1 - y0 / H];
  });
  return { width: W4, height: H4, data: new Uint8Array(flipped.buffer), uv };
}

// ------------------------------------------------------------------------------------------------- clock

/** Clock templates at the origin facing +z (position, normal, colour per vertex), by radius and colours. */
const clockTemplates = new Map<string, { p: Float32Array; n: Float32Array; c: Float32Array }>();

/** A round wall clock into `s`, its back on the wall at `c` facing +z: a rim (`rim`), a face (`face`), twelve hour marks,
 *  two hands at ten past ten and a pin (dark). Colours sRGB. */
export function addClock(s: Soup, c: V3, radius: number, face: RGB, rim: RGB): void {
  const key = `${radius}|${face.join()}|${rim.join()}`;
  let t = clockTemplates.get(key);
  if (!t) {
    const g = clockTemplate(radius, face, rim);
    t = { p: g.getAttribute('position').array as Float32Array, n: g.getAttribute('normal').array as Float32Array,
      c: g.getAttribute('color').array as Float32Array };
    if (clockTemplates.size > 64) clockTemplates.clear();
    clockTemplates.set(key, t);
  }
  const { p, n, c: col } = t;
  for (let i = 0; i < p.length; i += 9) {
    const v = (k: number): V3 => [p[i + k * 3] + c[0], p[i + k * 3 + 1] + c[1], p[i + k * 3 + 2] + c[2]];
    const nn = (k: number): V3 => [n[i + k * 3], n[i + k * 3 + 1], n[i + k * 3 + 2]];
    const cc = (k: number): RGB => [col[i + k * 3], col[i + k * 3 + 1], col[i + k * 3 + 2]];
    const a = v(0), b = v(1), d = v(2);
    // already wound: keep the order (face along its own winding's normal)
    s.triN(a, b, d, triFace(a, b, d), [nn(0), nn(1), nn(2)], [cc(0), cc(1), cc(2)]);
  }
}

/** The clock at the origin (see addClock). */
function clockTemplate(radius: number, face: RGB, rim: RGB): THREE.BufferGeometry {
  const r = radius, local = new Soup();
  const R = lin(rim), F = lin(face), D = lin(scale(rim, 0.3));
  // built round the vertical axis (y = out of the wall), turned to face +z below
  lathe(local, [0, 0, 0], [[r * 0.94, 0], [r, 0.02], [r, 0.06], [r * 0.95, 0.075], [r * 0.86, 0.075], [r * 0.84, 0.05]], [R, R, R, R, R], 24);
  lathe(local, [0, 0, 0], [[r * 0.84, 0.05], [0, 0.05]], [F], 24);
  const box = (ang: number, a0: number, a1: number, wd: number, y0: number, y1: number, col: RGB) => {
    // ang: clockwise from 12 o'clock seen from the room (+y out): 12 o'clock = −z here (turned to +y)
    const u: V3 = [Math.sin(ang), 0, -Math.cos(ang)], w: V3 = [Math.cos(ang), 0, Math.sin(ang)];
    local.box([0, 0, 0], u, w, a0, a1, y0, y1, -wd / 2, wd / 2, col);
  };
  for (let h = 0; h < 12; h++) box((h / 12) * Math.PI * 2, r * 0.66, r * 0.78, h % 3 ? r * 0.04 : r * 0.07, 0.05, 0.056, D);
  box(((10 + 10 / 60) / 12) * Math.PI * 2, -r * 0.08, r * 0.45, r * 0.07, 0.054, 0.061, D);
  box((10 / 60) * Math.PI * 2, -r * 0.1, r * 0.68, r * 0.045, 0.061, 0.067, D);
  lathe(local, [0, 0, 0], [[r * 0.06, 0.05], [r * 0.06, 0.072], [0, 0.072]], [D, D], 8);
  const g = local.geometry();
  g.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  return g;
}
/** A triangle's own face direction (its winding's normal): triN keeps the order. */
const triFace = (a: V3, b: V3, c: V3): V3 => {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
};

/** A round wall clock (PNC), its back on z = 0 at the origin, facing +z, `radius` round. */
export function clockGeometry(radius: number, face: RGB, rim: RGB): THREE.BufferGeometry {
  const s = new Soup();
  addClock(s, [0, 0, 0], radius, face, rim);
  return s.geometry();
}

// ------------------------------------------------------------------------------------------------- doorways

/** A doorway in `r` over [from, to): a casing round it on the inner face, linings on its jambs and head, a closed slab
 *  (two leaves when it is wide) in the middle of the wall with knobs; trim colours (sRGB). */
function addDoor(s: Soup, r: ShellRun, from: number, to: number, trim: RGB): void {
  const F = runFrame(r), D = DOOR, T = lin(trim), slab = lin(scale(trim, 0.86)), knob = lin([0.78, 0.66, 0.38]);
  const a = Math.min(sOf(r.dir, from), sOf(r.dir, to)), b = Math.max(sOf(r.dir, from), sOf(r.dir, to));
  const box = (s0: number, s1: number, h0: number, h1: number, d0: number, d1: number, c: RGB) => s.box(F.o, F.u, F.w, s0, s1, h0, h1, d0, d1, c);
  const c = D.casing, top = LINTEL_H;
  box(a - c, a, 0, top + c, 0, D.depth, T);
  box(b, b + c, 0, top + c, 0, D.depth, T);
  box(a - c, b + c, top, top + c, 0, D.depth, T);
  box(a, a + D.lining, 0, top, -WALL_T, 0, T);
  box(b - D.lining, b, 0, top, -WALL_T, 0, T);
  box(a, b, top - D.lining, top, -WALL_T, 0, T);
  const d0 = -WALL_T / 2 - D.slab / 2, d1 = -WALL_T / 2 + D.slab / 2, l = D.lining;
  const leaves: [number, number][] = b - a > 1.6 ? [[a + l, (a + b) / 2 - 0.01], [(a + b) / 2 + 0.01, b - l]] : [[a + l, b - l]];
  leaves.forEach(([s0, s1], k) => {
    box(s0, s1, 0, top - l, d0, d1, slab);
    // the knob on the leaf's free edge (the right of one leaf, the middle of a pair)
    const ks = leaves.length === 2 ? (k === 0 ? s1 - 0.12 : s0 + 0.12) : s1 - 0.15;
    box(ks - D.knob / 2, ks + D.knob / 2, D.knobH, D.knobH + D.knob, d1, d1 + 0.05, knob);
  });
}

// ------------------------------------------------------------------------------------------------- partitions

/** A partition piece's footprint outline: a closed loop of floor points (world x, grid z at floor 0; last = first) with
 *  the solid on its left, each segment's inner normal (pointing away from the solid, into the room), its floorY. */
export interface PartitionLoop { path: V2[]; inward: V2[]; floorY: number }

/** The partitions' footprint on a half-cell grid (W × H half cells from a.minX, a.minY): their cells, and the recess
 *  where a cell hangs from the back wall's band. null: no partition. */
export function partitionSolid(a: MapAnalysis, L: RoomLayout): { solid: Uint8Array; W: number; H: number } | null {
  const W = (a.maxX - a.minX) * 2, H = (a.maxY - a.minY) * 2;
  const solid = new Uint8Array(W * H);
  let any = false;
  for (let i = 0; i < a.N; i++) {
    if (!L.partition[i]) continue;
    any = true;
    const x = a.cellX(i), y = a.cellY(i), hx = (x - a.minX) * 2, hy = (y - a.minY) * 2;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) solid[(hy + dy) * W + hx + dx] = 1;
    if (underBackBand(a, L, x, y) && hy > 0) { solid[(hy - 1) * W + hx] = 1; solid[(hy - 1) * W + hx + 1] = 1; }
  }
  return any ? { solid, W, H } : null;
}

/** The partitions' footprints (`partitionSolid`) traced into closed loops (collinear edges merged). */
export function partitionLoops(a: MapAnalysis, L: RoomLayout): PartitionLoop[] {
  const P = partitionSolid(a, L);
  if (!P) return [];
  const { solid, W, H } = P;
  const fy = (() => {
    const p = L.runs.find((r) => r.partition);
    return p ? p.floorY : 0;
  })();
  const at = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < H && solid[j * W + i] === 1;
  // directed boundary edges (half-cell units), the solid on the left of travel: left of t = (−t.z, t.x)
  const key = (i: number, j: number) => j * (W + 1) + i;
  const out = new Map<number, { i: number; j: number; ti: number; tj: number }[]>();
  const add = (i: number, j: number, ti: number, tj: number) => {
    const k = key(i, j);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push({ i, j, ti, tj });
  };
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (!at(i, j)) continue;
      if (!at(i, j - 1)) add(i, j, 1, 0);           // north edge, west → east
      if (!at(i + 1, j)) add(i + 1, j, 0, 1);       // east edge, north → south
      if (!at(i, j + 1)) add(i + 1, j + 1, -1, 0);  // south edge, east → west
      if (!at(i - 1, j)) add(i, j + 1, 0, -1);      // west edge, south → north
    }
  }
  const loops: PartitionLoop[] = [];
  for (;;) {
    let start: { i: number; j: number; ti: number; tj: number } | undefined;
    for (const l of out.values()) if (l.length) { start = l[0]; break; }
    if (!start) break;
    const corners: [number, number][] = [], dirs: [number, number][] = [];
    let e = start;
    for (;;) {
      const list = out.get(key(e.i, e.j))!;
      list.splice(list.indexOf(e), 1);
      const ni = e.i + e.ti, nj = e.j + e.tj;
      if (!dirs.length || dirs[dirs.length - 1][0] !== e.ti || dirs[dirs.length - 1][1] !== e.tj) { corners.push([e.i, e.j]); dirs.push([e.ti, e.tj]); }
      const next = out.get(key(ni, nj)) ?? [];
      if (!next.length) break;
      // at a pinch (two pieces touching at a corner) turn towards the solid first: left, straight, right
      const left: [number, number] = [-e.tj, e.ti], right: [number, number] = [e.tj, -e.ti];
      e = next.find((n) => n.ti === left[0] && n.tj === left[1]) ?? next.find((n) => n.ti === e.ti && n.tj === e.tj)
        ?? next.find((n) => n.ti === right[0] && n.tj === right[1]) ?? next[0];
    }
    // the start's direction may continue the last one: merge the wrap-around
    if (dirs.length > 1 && dirs[0][0] === dirs[dirs.length - 1][0] && dirs[0][1] === dirs[dirs.length - 1][1]) { corners.shift(); dirs.shift(); }
    const path: V2[] = corners.map(([i, j]) => [a.minX + i / 2, a.minY + j / 2]);
    path.push([path[0][0], path[0][1]]);
    // the inner normal: right of travel (away from the solid)
    loops.push({ path, inward: dirs.map(([ti, tj]): V2 => [tj === 0 ? 0 : tj, ti === 0 ? 0 : -ti]), floorY: fy });
  }
  return loops;
}

/** One partition piece: its loop of PARTITION_PROFILE (mitred all round) and its lid's rim at PARTITION_H over the
 *  coping (a strip per side between the face and its mitred offset COPING out; addPartitionLids covers the footprint). */
function addPartition(s: Soup, loop: PartitionLoop, C: ShellPalette): void {
  const { path, inward, floorY: fy } = loop;
  const P: V2[] = path.map(([x, z]) => [x, z + fy]);
  wallPath(s, P, inward, fy, PARTITION_PROFILE, C, false);
  const n = inward.length, y = fy + PARTITION_H;
  // each corner's mitre (closed loop): k's corner joins segment k − 1 and k
  const mitre = (k: number): V2 => {
    const a = inward[(k - 1 + n) % n], b = inward[k % n];
    return [a[0] + b[0], a[1] + b[1]];
  };
  for (let k = 0; k < n; k++) {
    const p0 = P[k], p1 = P[k + 1], m0 = mitre(k), m1 = mitre(k + 1);
    s.quad([p0[0], y, p0[1]], [p1[0], y, p1[1]], [p1[0] + COPING * m1[0], y, p1[1] + COPING * m1[1]],
      [p0[0] + COPING * m0[0], y, p0[1] + COPING * m0[1]], [0, 1, 0], C.trim);
  }
}

// ------------------------------------------------------------------------------------------------- the build

/** What a feature becomes: a clock is modelled; a window on a back wall's N run (spanning it) is glazed; the rest — decor,
 *  unknown band cells, a window on a partition or on no run — is a decal. */
export function featureRole(L: RoomLayout, runs: readonly ShellRun[], f: WallFeature): 'window' | 'clock' | 'decal' {
  if (f.kind === 'clock') return 'clock';
  if (f.kind === 'window' && !onPartition(L, f)) {
    const z = windowRect(L, f).z;
    if (runs.some((q) => q.dir === 'N' && q.line === z && q.from <= f.x0 && f.x1 <= q.to)) return 'window';
  }
  return 'decal';
}

/** The features the shell draws as decals (featureRole; a window whose opening would overlap another one also becomes
 *  one at build, never seen on the 137 in-scope maps). */
export function shellDecals(a: MapAnalysis, L: RoomLayout): WallFeature[] {
  const runs = shellRuns(a, L);
  return L.features.filter((f) => featureRole(L, runs, f) === 'decal');
}

export interface ShellInput {
  a: MapAnalysis;
  L: RoomLayout;
  /** The back wall's colours (wallColors). */
  colors: ShellColors;
  /** A clock's face and rim (sRGB; default: off-white on the trim darkened). */
  clockColors?: (f: WallFeature) => { face: RGB; rim: RGB };
}

/** A shell's geometry, before meshes: per direction its walls (profile only) and fixtures (window casings and sills,
 *  clocks, door frames and slabs); the glass; the partitions (one solid, never cut away); the decal features with their
 *  places (uv filled by the caller from packDecals over `decals`); notes on what it could not place. */
export interface ShellSoups {
  walls: Record<WallDir, Soup>;
  /** The pocket sides (cutaway.ts pocketDir: the stairs alcove's side walls, back-wall steps), apart from `walls`: per
   *  (direction, the direction whose cutaway takes them along) one soup, so the cutaway can hide them with it. */
  pockets: { dir: WallDir; pocket: WallDir; walls: Soup }[];
  fixtures: Record<WallDir, Soup>;
  glass: Soup;
  partitions: Soup;
  decals: WallFeature[];
  decalRects: Omit<DecalQuad, 'uv'>[];
  runs: ShellRun[];
  skipped: string[];
}

const recordOf = <T>(f: () => T): Record<WallDir, T> => ({ N: f(), E: f(), S: f(), W: f() });

/** Builds the shell's geometry from the layout (see the header). */
export function buildShellSoups(inp: ShellInput): ShellSoups {
  const { a, L, colors } = inp;
  const C = shellPalette(colors);
  const runs = shellRuns(a, L);
  const walls = recordOf(() => new Soup()), fixtures = recordOf(() => new Soup());
  const glass = new Soup(), partitions = new Soup();
  const skipped: string[] = [];
  const openings = new Map<ShellRun, (Opening & { door: boolean })[]>();
  const runAt = (dir: WallDir, line: number, from: number, to: number) =>
    runs.find((r) => r.dir === dir && r.line === line && r.from <= from && to <= r.to);
  const open = (r: ShellRun, o: Opening & { door: boolean }) => {
    const list = openings.get(r) ?? [];
    if (list.some((p) => p.from < o.to && o.from < p.to)) return false;
    list.push(o);
    openings.set(r, list);
    return true;
  };

  // doorways
  for (const d of L.doors as readonly DoorGap[]) {
    const r = runAt(d.dir, d.line, d.from, d.to);
    if (!r || !open(r, { from: d.from, to: d.to, h0: -1, h1: LINTEL_H, door: true })) { skipped.push(`door ${d.dir} ${d.line} [${d.from}, ${d.to})`); continue; }
    addDoor(fixtures[d.dir], r, d.from, d.to, colors.trim);
  }

  // wall art: windows on a back wall's run, clocks, the rest (and anything on a partition but clocks) decals
  const decals: WallFeature[] = [], decalRects: Omit<DecalQuad, 'uv'>[] = [];
  for (const f of L.features) {
    const part = onPartition(L, f), role = featureRole(L, runs, f);
    const z = windowRect(L, f).z;
    const r = part ? undefined : runs.find((q) => q.dir === 'N' && q.line === z && q.from < f.x1 && f.x0 < q.to);
    const fy = r ? r.floorY : (L.runs.find((q) => q.partition) ?? L.runs[0])?.floorY ?? 0;
    if (role === 'window' && r) {
      const w = windowRect(L, f);
      if (open(r, { from: w.x0, to: w.x1, h0: w.y0, h1: w.y1, door: false })) {
        const size: WindowSize = { ...WINDOW, width: w.x1 - w.x0, height: w.y1 - w.y0, sill: w.y0 };
        addWindow(fixtures.N, glass, wallFrameAt([0, fy, z + fy], [1, 0, 0], [0, 0, 1], [r.from, r.to]), (w.x0 + w.x1) / 2, colors.trim, size);
        continue;
      }
      skipped.push(`window ${f.x0}…${f.x1} overlaps another opening: a decal`);
    }
    if (f.kind === 'clock') {
      const [s0, s1] = part ? PARTITION_SPAN : WALL_SPAN;
      const b = bandRect(f, s0, s1);
      const radius = Math.min(CLOCK_R, 0.45 * Math.min(f.x1 - f.x0, b.y1 - b.y0));
      const cy = (b.y0 + b.y1) / 2;
      // off the wall's face, or in front of its relief where the clock crosses the rail or the baseboard
      const rail = SHELL.wainscot;
      const clear = part || (cy - radius > rail + 0.07) || (cy + radius < rail - 0.1 && cy - radius > SHELL.base);
      const d = part ? COPING + 0.005 : clear ? 0.005 : SHELL.relief + 0.005;
      const cc = inp.clockColors?.(f) ?? { face: [0.96, 0.95, 0.9] as RGB, rim: scale(colors.trim, 0.55) };
      addClock(fixtures.N, [(f.x0 + f.x1) / 2, fy + cy, z + fy + d], radius, cc.face, cc.rim);
      continue;
    }
    decals.push(f);
    decalRects.push(decalRect(L, f, fy));
  }

  // the outer walls (a pocket side into its own soup)
  const pockets: ShellSoups['pockets'] = [];
  const pocketSoup = (dir: WallDir, pocket: WallDir) => {
    let e = pockets.find((q) => q.dir === dir && q.pocket === pocket);
    if (!e) pockets.push(e = { dir, pocket, walls: new Soup() });
    return e.walls;
  };
  for (const r of runs) {
    const list = (openings.get(r) ?? []).sort((p, q) => p.from - q.from);
    const pocket = pocketDir(runs, r);
    addRun(pocket ? pocketSoup(r.dir, pocket) : walls[r.dir], r, runEnds(runs, r), list, C);
  }

  // partitions: loops and their lids (the footprint's half-cell rows at PARTITION_H)
  const loops = partitionLoops(a, L);
  if (loops.length) {
    for (const loop of loops) addPartition(partitions, loop, C);
    addPartitionLids(partitions, a, L, loops[0].floorY, C);
  }
  return { walls, pockets, fixtures, glass, partitions, decals, decalRects, runs, skipped };
}

/** The partitions' lids over their footprints: per half-cell row, its runs of solid half-cells as one quad each. */
function addPartitionLids(s: Soup, a: MapAnalysis, L: RoomLayout, fy: number, C: ShellPalette): void {
  const P = partitionSolid(a, L);
  if (!P) return;
  const { solid, W, H } = P;
  const y = fy + PARTITION_H;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (!solid[j * W + i]) continue;
      let e = i;
      while (e + 1 < W && solid[j * W + e + 1]) e++;
      const x0 = a.minX + i / 2, x1 = a.minX + (e + 1) / 2, z0 = a.minY + j / 2 + fy, z1 = a.minY + (j + 1) / 2 + fy;
      s.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, 1, 0], C.trim);
      i = e;
    }
  }
}

// ------------------------------------------------------------------------------------------------- glass

/** The glass's night: its sky gradient turned to deep blue by uOutdoorNight (D8), keeping a little of its gradient. */
const ROOM_GLASS_HEAD = /* glsl */ `
uniform float uOutdoorNight;
`;
const ROOM_GLASS_COLOR = /* glsl */ `
{
  float roomGlassK = dot(diffuseColor.rgb, vec3(0.3333));
  vec3 roomGlassNight = vec3(0.012, 0.022, 0.075) + vec3(0.01, 0.018, 0.05) * roomGlassK;
  diffuseColor.rgb = mix(diffuseColor.rgb, roomGlassNight, uOutdoorNight);
}
`;
/** Daylight through the glass by day (it reads as bright sky in a lamp-lit room); the night blue glows faintly. */
const ROOM_GLASS_EMISSIVE = /* glsl */ `
totalEmissiveRadiance += diffuseColor.rgb * mix(0.45, 0.8, uOutdoorNight);
`;

/** Window glass seen from inside: its vertex colours (a sky gradient) turned towards night blue by uOutdoorNight (D8). */
export const ROOM_GLASS: KitMaterialOptions = {
  vertexColors: true, roughness: 0.15, fade: true, fragHead: ROOM_GLASS_HEAD, fragColor: ROOM_GLASS_COLOR,
  fragEmissive: ROOM_GLASS_EMISSIVE, hookKey: 'roomGlass',
};

/** Every wall direction (for callers iterating the meshes in order). */
export const SHELL_DIRS = DIRS;
