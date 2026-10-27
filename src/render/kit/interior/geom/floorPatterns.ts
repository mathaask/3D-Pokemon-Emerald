// Room floors and window light shafts (Phase 4 Task 8, D3/D8), the pure parts: which cells get floor and in what kind,
// tint and border edges (`floorCells`), the per-cell data texture (`encodeFloor`), the floor's flat quads, the floor
// program's GLSL and options (`interiorFloorMaterial`, hookKey 'interiorFloor'), and the shafts' strips and material
// (`shaftGeometry`, `roomShaftMaterial`, hookKey 'roomShaft'). The families (kit/interior/floors.ts, shafts.ts) wire
// them in.
//
// The floor program fetches its cell the way the outdoor terrain does (kit/terrain.ts TERRAIN_GRID_GLSL +
// TERRAIN_CELL_GLSL: un-projected grid point, clamped texel), without the border warp and without the bilinear tint
// blend (rooms are rectilinear). Boards and tiles are Phase 3's analytic patterns (kit/interior/floorGlsl.ts), inlined
// unchanged (in their parts, floorGlsl.ts) in blocks that declare the uniforms they read as locals. A fragment runs only
// its cell's pattern, chosen by the kind it fetches. The snippets' one derivative each (`fw`, fwidth) is undefined in
// control flow that differs between neighbouring fragments, and the kind changes from cell to cell: so both footprints
// are taken first, in uniform control flow, and handed to the patterns inside the branch (Phase 4 perf follow-up: until
// then every pattern ran on every fragment, ~0.75 ms GPU on the iGPU). Not a draw per pattern: under MSAA a border
// pixel's fragment is shaded at the pixel centre, which may lie in the neighbouring cell, and must shade it as that cell's
// kind (the per-fragment choice by the fetched kind does; a per-draw choice cannot).

import * as THREE from 'three';
import { K, type MapAnalysis } from '../../../overworld/analyze';
import { CLAIM_OBJECT, CLAIM_SURFACE, type Claims } from '../../../overworld/claims';
import type { KitMaterialOptions } from '../../materials';
import { mix, type RGB } from '../../palette';
import type { TileInfo } from '../../../overworld/tileInfo';
import { TERRAIN_CELL_GLSL, TERRAIN_GRID_GLSL } from '../../terrain';
import { FLOOR_KINDS, type FloorKind, type InteriorId } from '../../tables/building';
import { floorLook } from '../colors';
import {
  BOARDS_CELL_GLSL, BOARDS_FW_GLSL, BOARDS_SHADE_GLSL, FLOOR_SEAM_GLSL, TILES_CELL_GLSL, TILES_FW_GLSL, TILES_SHADE_GLSL,
} from '../floorGlsl';
import { windowRect, type RoomLayout } from '../room';

export const enum FloorMat { Boards = 0, Tiles = 1, Carpet = 2, Rug = 3, Mat = 4 }
/** edges: bit 0 N, 1 E, 2 S, 3 W — the neighbour on that side is another floor kind (rugs and mats draw their border). */
export interface FloorCell { i: number; h: number; mat: FloorMat; tint: RGB; edges: number }

export const FLOOR_MAT: Readonly<Record<FloorKind, FloorMat>> = {
  boards: FloorMat.Boards, tiles: FloorMat.Tiles, carpet: FloorMat.Carpet, rug: FloorMat.Rug, mat: FloorMat.Mat,
};
const FLOOR_SET = new Set<InteriorId>(FLOOR_KINDS);
/** A room without any floor metatile (no walkable cell at all): warm wood. */
const NO_FLOOR: RGB = [0.72, 0.56, 0.4];

/** Room material, as room.ts reads it: an in-map cell that is non-void or a metatile-0x3FF block (`real3ff`). */
function nonVoid(a: MapAnalysis, i: number): boolean {
  const m = a.opts.margin, x = a.cellX(i), y = a.cellY(i);
  if (x < a.minX + m || y < a.minY + m || x >= a.maxX - m || y >= a.maxY - m) return false;
  return a.kind[i] !== K.Void || a.real3ff[i] > 0;
}
/** Walkable, as room.ts reads it (a 0x3FF block: its own collision, `real3ff` 1). */
const walkable = (a: MapAnalysis, i: number) => (a.kind[i] !== K.Void ? a.col[i] === 0 : a.real3ff[i] === 1);

/** Per cell: its room's floor height (flat rooms: the mode of the room's walkable floor heights, as the walls' `floorY`;
 *  a room = a 4-connected component of room material, room.ts). Cells in no room: the map's mode. */
export function roomFloorHeights(a: MapAnalysis, L: RoomLayout): Float32Array {
  const N = a.N;
  const room = new Int32Array(N).fill(-1);
  let rooms = 0;
  const stack: number[] = [];
  for (let s = 0; s < N; s++) {
    if (room[s] >= 0 || !nonVoid(a, s)) continue;
    const id = rooms++;
    room[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      const x = a.cellX(i), y = a.cellY(i);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!a.inside(x + dx, y + dy)) continue;
        const j = a.idx(x + dx, y + dy);
        if (room[j] < 0 && nonVoid(a, j)) { room[j] = id; stack.push(j); }
      }
    }
  }
  const votes = Array.from({ length: rooms + 1 }, () => new Map<number, number>());   // [rooms] = the whole map
  for (let i = 0; i < N; i++) {
    if (!L.inside[i] || a.kind[i] !== K.Floor || Number.isNaN(a.height[i])) continue;
    for (const v of [votes[room[i]], votes[rooms]]) v.set(a.height[i], (v.get(a.height[i]) ?? 0) + 1);
  }
  const mode = votes.map((m) => {
    let best = 0, bestN = 0;
    for (const [h, n] of m) if (n > bestN || (n === bestN && h < best)) { best = h; bestN = n; }
    return best;
  });
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = mode[room[i] >= 0 ? room[i] : rooms];
  return out;
}

/** A floor's tint (sRGB) from its metatile: the bottom layer's main colour (`floorLook`) a third of the way towards the
 *  tile's mean (the GBA's floor reads as its colour and its drawn lines together: a board tile's yellow with its brown
 *  seams), its HSL saturation above FLOOR_SAT_KNEE compressed by FLOOR_SAT_SLOPE (the Modern post grade boosts saturation
 *  again, as `lush` knows; a soft knee, not a cap, so a vivid orange stays orange next to a tamed yellow board). */
export const FLOOR_MEAN_MIX = 0.35, FLOOR_SAT_KNEE = 0.35, FLOOR_SAT_SLOPE = 0.45;
const _hsl = { h: 0, s: 0, l: 0 }, _c = new THREE.Color();
export function floorTint(info: TileInfo, m: number): RGB {
  const main = floorLook(info, m).tint;
  let r = 0, g = 0, b = 0, n = 0;
  for (let p = m * 256, end = p + 256; p < end; p++) {
    const v = info.bottom[p];
    if (v & 0x8000) continue;
    r += (v & 31) / 31; g += ((v >> 5) & 31) / 31; b += ((v >> 10) & 31) / 31; n++;
  }
  const c = n ? mix(main, [r / n, g / n, b / n], FLOOR_MEAN_MIX) : main;
  _c.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace).getHSL(_hsl, THREE.SRGBColorSpace);
  if (_hsl.s <= FLOOR_SAT_KNEE) return c;
  _c.setHSL(_hsl.h, FLOOR_SAT_KNEE + (_hsl.s - FLOOR_SAT_KNEE) * FLOOR_SAT_SLOPE, _hsl.l, THREE.SRGBColorSpace);
  const out = { r: 0, g: 0, b: 0 };
  _c.getRGB(out, THREE.SRGBColorSpace);
  return [out.r, out.g, out.b];
}

/** The 8-neighbourhood, with its vote weights (the sides count twice: a chair on a rug's edge has as many board cells
 *  as rug cells around it, but the rug on two sides). */
const NEIGHBOURS8 = [[-1, -1, 1], [0, -1, 2], [1, -1, 1], [-1, 0, 2], [1, 0, 2], [-1, 1, 1], [0, 1, 2], [1, 1, 1]] as const;
const SIDES = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;   // N, E, S, W: edge bits 0..3
/** How far a cell under furniture looks along its row / column for the floor on both sides of it. */
const BETWEEN_MAX = 6;

/** Inside + claimed-object + band cells of the rooms. A walkable cell takes its own id's kind (unknown floor ids and
 *  `legacy` stay legacy); a cell under furniture, wall or stairsUp takes the kind and tint of the floor on both sides of
 *  it along its row or column (across other such cells, up to BETWEEN_MAX; a rug's kind before the room's), else the
 *  most common among the walkable floor cells of its 8-neighbourhood (sides weigh 2, corners 1), else the room's
 *  floorTile. A `stairsDown` cell gets
 *  no floor (the stairwell's hole: Task 10's generator draws it).
 *
 *  Also: a metatile-0x3FF block (`real3ff`, Sootopolis; its id null, its kind Void) is floor under the neighbourhood
 *  rule; a blocked cell with a floor id keeps its own kind; a blocked unknown cell (null / `legacy`) in the room that no
 *  family claimed stays legacy; a cell another family claimed CLAIM_SURFACE gets none. Tints: a 4-connected area of one
 *  kind takes its most common metatile tint (`floorTint`), so a rug's border metatiles and a floor's shadow variants do
 *  not read as patches. Heights: flat per room (`roomFloorHeights`). */
export function floorCells(a: MapAnalysis, ids: readonly (InteriorId | null)[], L: RoomLayout, claims: Claims): FloorCell[] {
  const N = a.N;
  const kind = new Int8Array(N).fill(-1);
  const tint: (RGB | null)[] = new Array<RGB | null>(N).fill(null);
  const own = new Uint8Array(N);            // a walkable cell with its own floor id (the neighbourhood rule's voters)
  const looks = new Map<number, RGB>();
  const lookOf = (m: number) => {
    let t = looks.get(m);
    if (!t) looks.set(m, t = floorTint(a.info, m));
    return t;
  };
  const candidate = (i: number) => (L.inside[i] === 1 || L.band[i] === 1 || claims.has(i, CLAIM_OBJECT))
    && !claims.has(i, CLAIM_SURFACE) && ids[i] !== 'stairsDown';

  // own kinds
  for (let i = 0; i < N; i++) {
    const id = ids[i];
    if (!candidate(i) || a.kind[i] === K.Void || id == null || !FLOOR_SET.has(id)) continue;
    kind[i] = FLOOR_MAT[id as FloorKind];
    tint[i] = lookOf(a.mt[i]);
    if (walkable(a, i)) own[i] = 1;
  }
  // one tint per 4-connected area of one kind: its most common
  const seen = new Uint8Array(N);
  const stack: number[] = [];
  for (let s = 0; s < N; s++) {
    if (kind[s] < 0 || seen[s]) continue;
    const area: number[] = [];
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      area.push(i);
      const x = a.cellX(i), y = a.cellY(i);
      for (const [dx, dy] of SIDES) {
        if (!a.inside(x + dx, y + dy)) continue;
        const j = a.idx(x + dx, y + dy);
        if (!seen[j] && kind[j] === kind[s]) { seen[j] = 1; stack.push(j); }
      }
    }
    area.sort((p, q) => p - q);
    const count = new Map<RGB, number>();
    for (const i of area) count.set(tint[i]!, (count.get(tint[i]!) ?? 0) + 1);
    let best = tint[area[0]]!, bestN = 0;
    for (const [t, n] of count) if (n > bestN) { best = t; bestN = n; }
    for (const i of area) tint[i] = best;
  }

  // the room's floor: floorTile's kind (its id on any cell) and look
  let roomKind = FloorMat.Boards;
  for (let i = 0; i < N; i++) {
    const id = ids[i];
    if (a.mt[i] === L.floorTile && a.kind[i] !== K.Void && id != null && FLOOR_SET.has(id)) { roomKind = FLOOR_MAT[id as FloorKind]; break; }
  }
  const roomTint = L.floorTile >= 0 ? lookOf(L.floorTile) : NO_FLOOR;

  // the rest: under furniture, wall, stairs, 0x3FF blocks
  const pend = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (kind[i] >= 0 || !candidate(i)) continue;
    const id = ids[i];
    const unknown = a.kind[i] !== K.Void && (id == null || id === 'legacy');
    if (!(unknown && (walkable(a, i) || (!claims.has(i, CLAIM_OBJECT) && !L.band[i])))) pend[i] = 1;   // else legacy
  }
  /** The own floor cell first met from (x, y) towards (dx, dy) across pending cells (at most BETWEEN_MAX), or −1. */
  const reach = (x: number, y: number, dx: number, dy: number) => {
    for (let k = 1; k <= BETWEEN_MAX; k++) {
      if (!a.inside(x + k * dx, y + k * dy)) return -1;
      const j = a.idx(x + k * dx, y + k * dy);
      if (own[j]) return j;
      if (!pend[j]) return -1;
    }
    return -1;
  };
  for (let i = 0; i < N; i++) {
    if (!pend[i]) continue;
    const x = a.cellX(i), y = a.cellY(i);
    // furniture standing on a rug's edge row (Brendan's table and chairs on the rug's top row): between two cells of one
    // kind, along a row or a column, it stands on that kind
    let between = -1;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const p = reach(x, y, dx, dy), q = reach(x, y, -dx, -dy);
      if (p >= 0 && q >= 0 && kind[p] === kind[q]) { between = kind[p] !== roomKind || between < 0 ? p : between; }
    }
    if (between >= 0) { kind[i] = kind[between]; tint[i] = tint[between]; continue; }
    const votes = new Map<string, { n: number; mat: FloorMat; tint: RGB }>();
    let best: { n: number; mat: FloorMat; tint: RGB } | null = null;
    for (const [dx, dy, wt] of NEIGHBOURS8) {
      if (!a.inside(x + dx, y + dy)) continue;
      const j = a.idx(x + dx, y + dy);
      if (!own[j]) continue;
      const key = `${kind[j]}:${tint[j]!.join(',')}`;
      let v = votes.get(key);
      if (!v) votes.set(key, v = { n: 0, mat: kind[j] as FloorMat, tint: tint[j]! });
      v.n += wt;
      if (!best || v.n > best.n) best = v;
    }
    kind[i] = best ? best.mat : roomKind;
    tint[i] = best ? best.tint : roomTint;
  }

  // border edges, heights
  const h = roomFloorHeights(a, L);
  const cells: FloorCell[] = [];
  for (let i = 0; i < N; i++) {
    if (kind[i] < 0) continue;
    const x = a.cellX(i), y = a.cellY(i);
    let edges = 0;
    SIDES.forEach(([dx, dy], b) => {
      const j = a.inside(x + dx, y + dy) ? a.idx(x + dx, y + dy) : -1;
      if (j < 0 || kind[j] !== kind[i]) edges |= 1 << b;
    });
    cells.push({ i, h: h[i], mat: kind[i] as FloorMat, tint: tint[i]!, edges });
  }
  return cells;
}

/** RGBA8 per analysis cell: rgb = sRGB tint, a = mat << 4 | edges. A texel without a floor cell copies a 4-neighbour's
 *  (first in +x, −x, +y, −y), so a fragment on a cell's very border never fetches black. */
export function encodeFloor(a: MapAnalysis, cells: readonly FloorCell[]): Uint8Array {
  const data = new Uint8Array(a.N * 4);
  const has = new Uint8Array(a.N);
  for (const c of cells) {
    const o = c.i * 4;
    data[o] = Math.round(c.tint[0] * 255);
    data[o + 1] = Math.round(c.tint[1] * 255);
    data[o + 2] = Math.round(c.tint[2] * 255);
    data[o + 3] = (c.mat << 4) | (c.edges & 15);
    has[c.i] = 1;
  }
  const W = a.GW, H = a.GH;
  for (let i = 0; i < a.N; i++) {
    if (has[i]) continue;
    const col = i % W, row = (i - col) / W;
    const j = col + 1 < W && has[i + 1] ? i + 1 : col > 0 && has[i - 1] ? i - 1
      : row + 1 < H && has[i + W] ? i + W : row > 0 && has[i - W] ? i - W : -1;
    if (j >= 0) data.copyWithin(i * 4, j * 4, j * 4 + 4);
  }
  return data;
}

/** The floor's cell texture (`encodeFloor`, GW × GH; texelFetch only, so nearest). */
export function floorTexture(a: MapAnalysis, cells: readonly FloorCell[]): THREE.DataTexture {
  const tex = new THREE.DataTexture(encodeFloor(a, cells), a.GW, a.GH, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/** The floor's flat quads, one per cell at its height (un-projected: world (x, h, y + h)), facing up: non-indexed
 *  position + normal (the material reads no colours or UVs). */
export function floorGeometry(a: MapAnalysis, cells: readonly FloorCell[]): THREE.BufferGeometry {
  const pos = new Float32Array(cells.length * 18);
  const nor = new Float32Array(cells.length * 18);
  let o = 0;
  for (const c of cells) {
    const x = a.cellX(c.i), y = a.cellY(c.i), h = c.h;
    // TL, BR, TR, TL, BL, BR: wound to face +y
    const v = [x, y, x + 1, y + 1, x + 1, y, x, y, x, y + 1, x + 1, y + 1];
    for (let k = 0; k < 12; k += 2) {
      pos[o] = v[k]; pos[o + 1] = h; pos[o + 2] = v[k + 1] + h;
      nor[o + 1] = 1;
      o += 3;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.computeBoundingSphere();
  return geo;
}

/** The patterns' parameters: boards 0.55 wide along z, tiles 1.0 cell (seams on the grid); seam darkness, tone spread
 *  (±) and the tiles' alternate factor as Phase 3's hall floors (battle/parts/floor.ts FLOOR_PATTERN). */
export const FLOOR_BOARDS = { size: 0.55, seam: 0.38, tone: 0.07 } as const;
export const FLOOR_TILES = { size: 1.0, seam: 0.22, tone: 0.025, alt: 0.95 } as const;
/** Rug border band width (cells), its colour factor (× tint), the thin inner line's offset inside it and half width;
 *  a mat's border band. */
export const RUG_BORDER = { width: 0.12, shade: 0.7, lineGap: 0.05, lineHalf: 0.012 } as const;
export const MAT_BORDER = { width: 0.1, shade: 0.7 } as const;

/** A GLSL float literal (6 decimals at most). */
const f = (v: number) => {
  const s = String(Number(v.toFixed(6)));
  return s.includes('.') ? s : s + '.0';
};

const FLOOR_HEAD = /* glsl */ `
uniform sampler2D tCells;
uniform vec2 uGridMin;
uniform vec2 uGridSize;
${FLOOR_SEAM_GLSL}
// distance (cells) from f (the cell's fract, y south) to the nearest side whose edge bit is set (1 N, 2 E, 4 S, 8 W)
float floorEdgeDist(vec2 f, int edges) {
  float d = 1e3;
  if ((edges & 1) != 0) d = min(d, f.y);
  if ((edges & 2) != 0) d = min(d, 1.0 - f.x);
  if ((edges & 4) != 0) d = min(d, 1.0 - f.y);
  if ((edges & 8) != 0) d = min(d, f.x);
  return d;
}
`;

/** The terrain's cell fetch (TERRAIN_CELL_GLSL: `g`, `ic`, `mat`) with its texel kept as `vec4 cd`: one fetch for the
 *  kind, the tint and the edges. */
const FETCH_MAT = 'int mat = int(texelFetch(tCells, ic, 0).a * 255.0 + 0.5) >> 4;';
if (!TERRAIN_CELL_GLSL.includes(FETCH_MAT)) throw new Error('floorPatterns: TERRAIN_CELL_GLSL no longer fetches `mat` as expected');
const FLOOR_CELL_GLSL = TERRAIN_CELL_GLSL.replace(FETCH_MAT, 'vec4 cd = texelFetch(tCells, ic, 0);\n  int mat = int(cd.a * 255.0 + 0.5) >> 4;');

const FLOOR_COLOR = /* glsl */ `
{
${TERRAIN_GRID_GLSL}  vec2 warp = vec2(0.0);
${FLOOR_CELL_GLSL}  int edges = int(cd.a * 255.0 + 0.5) & 15;
  vec3 tint = kitSrgbToLinear(cd.rgb);
  vec2 fp = cell;                                  // grid space: boards along z, tile seams on the grid
  vec2 pw = fwidth(fp);
  float pf = max(max(pw.x, pw.y), 1e-4);           // a pixel's footprint (cells; > 0: the smoothsteps need edge0 < edge1)
  // the patterns' footprints (their only derivatives), taken here where control flow is uniform: below, a fragment runs
  // only its cell's pattern, and the kind changes from cell to cell
  vec2 fwBoards, fwTiles;
  {
    vec4 uFloor = vec4(0.0, ${f(FLOOR_BOARDS.size)}, ${f(FLOOR_BOARDS.seam)}, ${f(FLOOR_BOARDS.tone)});
${BOARDS_CELL_GLSL}${BOARDS_FW_GLSL}    fwBoards = fw;
  }
  {
    vec4 uFloor = vec4(1.0, ${f(FLOOR_TILES.size)}, ${f(FLOOR_TILES.seam)}, ${f(FLOOR_TILES.tone)});
${TILES_CELL_GLSL}${TILES_FW_GLSL}    fwTiles = fw;
  }
  vec3 kf;
  if (mat == 0) {
    vec3 k = vec3(1.0);
    float seam = 0.0;
    vec4 uFloor = vec4(0.0, ${f(FLOOR_BOARDS.size)}, ${f(FLOOR_BOARDS.seam)}, ${f(FLOOR_BOARDS.tone)});
    vec3 uFloorAlt = vec3(1.0);
${BOARDS_CELL_GLSL}    vec2 fw = fwBoards;
${BOARDS_SHADE_GLSL}    kf = k * (1.0 - uFloor.z * seam);
  } else if (mat == 1) {
    vec3 k = vec3(1.0);
    float seam = 0.0;
    vec4 uFloor = vec4(1.0, ${f(FLOOR_TILES.size)}, ${f(FLOOR_TILES.seam)}, ${f(FLOOR_TILES.tone)});
    vec3 uFloorAlt = vec3(${f(FLOOR_TILES.alt)});
${TILES_CELL_GLSL}    vec2 fw = fwTiles;
${TILES_SHADE_GLSL}    kf = k * (1.0 - uFloor.z * seam);
  } else {
    // fabric: a soft pile, its fine grain fading out where a pixel spans it
    float fine = 1.0 - smoothstep(0.03, 0.08, pf);
    float pile = 1.0 + 0.1 * (kitNoise2(fp * 3.1) - 0.5) + 0.08 * fine * (kitNoise2(fp * 17.0 + 7.3) - 0.5);
    // rugs and mats: a border band on their edge sides (a rug's with a thin inner line)
    float d = floorEdgeDist(fract(g), edges);
    float rugBand = 1.0 - smoothstep(${f(RUG_BORDER.width)} - pf, ${f(RUG_BORDER.width)} + pf, d);
    float rugLine = 1.0 - smoothstep(${f(RUG_BORDER.lineHalf)} - pf, ${f(RUG_BORDER.lineHalf)} + pf, abs(d - ${f(RUG_BORDER.width + RUG_BORDER.lineGap)}));
    rugLine = mix(rugLine, ${f(2 * RUG_BORDER.lineHalf)}, smoothstep(0.02, 0.08, pf));
    float kRug = mix(1.0, ${f(RUG_BORDER.shade)}, max(rugBand, rugLine));
    float matBand = 1.0 - smoothstep(${f(MAT_BORDER.width)} - pf, ${f(MAT_BORDER.width)} + pf, d);
    // a mat's weave: three bands across it, a fine basket weave, both fading out with distance
    float weaveNear = 1.0 - smoothstep(0.03, 0.1, pf);
    float bandsNear = 1.0 - smoothstep(0.1, 0.3, pf);
    float bands = 0.5 + 0.5 * sin(fp.y * 18.849556);
    float weave = sin(fp.x * 75.398224) * sin(fp.y * 75.398224);
    float kMat = (1.0 + bandsNear * 0.12 * (bands - 0.5) + weaveNear * 0.05 * weave) * mix(1.0, ${f(MAT_BORDER.shade)}, matBand);
    kf = vec3(pile * (mat == 3 ? kRug : mat == 4 ? kMat : 1.0));
  }
  diffuseColor.rgb *= tint * kf;
}
`;

/** The room floor's material (`tex`: `floorTexture`, over the grid from `gridMin`, `gridSize` cells). hookKey
 *  'interiorFloor': one program for every kind. */
export function interiorFloorMaterial(tex: THREE.Texture, gridMin: THREE.Vector2, gridSize: THREE.Vector2): KitMaterialOptions {
  return {
    roughness: 0.7,
    uniforms: { tCells: { value: tex }, uGridMin: { value: gridMin }, uGridSize: { value: gridSize } },
    fragHead: FLOOR_HEAD,
    fragColor: FLOOR_COLOR,
    hookKey: 'interiorFloor',
  };
}

/** The shafts' slant: this far south per unit of fall. */
export const SHAFT_SLANT = 0.6;
/** The shafts' daylight (linear, emissive: the additive blend adds it × the strip's alpha). */
export const SHAFT_LIGHT: RGB = [1.0, 0.94, 0.8];

/** One soft strip per window feature: from its glass (`windowRect(L, f)`, the rectangle the shell glazes) down and into
 *  the room (slant 0.6 south per unit fall) to the floor, vertex colours r = across (0..1), g = along (0 window … 1 floor).
 *  The strip is the beam's middle sheet: from the glass's mid height at its own width, straight down the slant to the
 *  floor of the window's wall (its N run's floorY). Indexed position + normal + colour; null without windows. */
export function shaftGeometry(L: RoomLayout): THREE.BufferGeometry | null {
  const wins = L.features.filter((w) => w.kind === 'window');
  if (!wins.length) return null;
  const pos: number[] = [], nor: number[] = [], col: number[] = [], index: number[] = [];
  const nl = Math.hypot(SHAFT_SLANT, 1);
  for (const feature of wins) {
    const w = windowRect(L, feature);   // the feature itself: its z is kept by reference
    const cx = (w.x0 + w.x1) / 2;
    const run = L.runs.find((r) => r.dir === 'N' && r.line === w.z && r.from <= cx && cx < r.to);
    const fy = run ? run.floorY : 0;
    const top = (w.y0 + w.y1) / 2;
    const z0 = w.z + fy, z1 = z0 + SHAFT_SLANT * top;
    const b = pos.length / 3;
    // A (x0, top, glass), B (x1, top, glass), C (x1, floor), D (x0, floor)
    pos.push(w.x0, fy + top, z0, w.x1, fy + top, z0, w.x1, fy, z1, w.x0, fy, z1);
    for (let k = 0; k < 4; k++) nor.push(0, SHAFT_SLANT / nl, 1 / nl);
    col.push(0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0);
    index.push(b, b + 3, b + 2, b, b + 2, b + 1);   // facing up and south (the camera's side)
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}

const SHAFT_HEAD = /* glsl */ `
uniform float uOutdoorNight;
uniform float uShaftAlpha;
`;

/** The strip's coverage from its vertex colours (r across, g along): soft sides, a short fade in at the glass, a long
 *  fade out towards the floor, a faint steady haze; no lit colour of its own (only the emissive daylight adds). */
const SHAFT_COLOR = /* glsl */ `
{
  float across = vColor.r, along = vColor.g;
  float m = smoothstep(0.0, 0.3, across) * (1.0 - smoothstep(0.7, 1.0, across))
          * smoothstep(0.0, 0.15, along) * (1.0 - smoothstep(0.45, 1.0, along));
  m *= 0.85 + 0.15 * kitNoise2(vec2(vKitWorld.x * 2.0, (vKitWorld.y + vKitWorld.z) * 0.7));
  diffuseColor = vec4(0.0, 0.0, 0.0, m * uShaftAlpha);
}
`;

/** Daylight by day, none at night (D8). */
const SHAFT_EMISSIVE = /* glsl */ `
  totalEmissiveRadiance += vec3(${SHAFT_LIGHT.map(f).join(', ')}) * (1.0 - uOutdoorNight);
`;

/** transparent, depthWrite false, blending AdditiveBlending (an additive volume, spec §8), emissive daylight ×
 *  (1 − uOutdoorNight) (D8: none at night); alpha through a uniform; hookKey 'roomShaft'. Black and metallic, so
 *  the lights add nothing to it (no diffuse, no specular): only the emissive daylight × the alpha adds. */
export function roomShaftMaterial(alpha: number): KitMaterialOptions & { blending: THREE.Blending } {
  return {
    color: 0x000000,
    vertexColors: true,
    roughness: 1,
    metalness: 1,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uShaftAlpha: { value: alpha } },
    fragHead: SHAFT_HEAD,
    fragColor: SHAFT_COLOR,
    fragEmissive: SHAFT_EMISSIVE,
    hookKey: 'roomShaft',
  };
}
