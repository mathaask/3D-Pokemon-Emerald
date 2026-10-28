// The puzzle state core (Phase 4b, D4/D5): the mechanic cells of a map, the state texture their shaders read (one RGBA8
// texel per analysis cell: r state, g variant, b kind index + 1, 0 none), the live cells that follow a runtime metatile
// change by writing a texel (World.patch, D3), and the look of every state (PUZZLE_LOOK, shared by the GLSL and the
// tests).
//
// The geometry the puzzle family builds is state-free: a state change never makes or moves a mesh, it writes a texel and
// flags the texture (one upload of GW × GH × 4 bytes, ≤ 21 KB on Petalburg, F43). The texture lives on the meshes
// (`userData.stateTexture`, attach): kit uniforms sit in the material pool's private slots, so that is where the world
// digest finds the state (F8).
//
// Mechanic cells are found by id (a mechanic id of the map's secondary: `puzzleId`) and by position (the table's
// `puzzleCells[mapKey]`, whatever id they show: Mauville's V beams switch off into the plain floor id, read as the pin's
// `offState`; F4). `accepts` ignores collision, elevation and the variant; `apply` writes the state and the variant the
// new id names (F4).

import * as THREE from 'three';
import { K, type MapAnalysis } from '../../../overworld/analyze';
import { SYM } from '../../../../game/symbols';
import {
  INTERIOR_TABLES, PUZZLE_KINDS, puzzleId,
  type PuzzleCellPin, type PuzzleId, type PuzzleKind,
} from '../../tables/building';
import type { LiveCells } from '../../semantics';
import type { RGB } from '../../palette';

/** A mechanic cell: its analysis index, map-local position, kind, variant and state at build time. A position-listed
 *  cell (F4) also carries its pin's `offId` (the plain id it shows when off), `offState` and `offVariant` (the pin's
 *  variant: what the texel reads when off, whatever variant the cell showed at build time). */
export interface PuzzleCell {
  i: number; x: number; y: number; kind: PuzzleKind; variant: number; state: number;
  offId?: number; offState?: number; offVariant?: number;
}

/** A seeded cell (the test seam): its PuzzleId, and with `offId` it is a position-listed cell (F4; `offVariant`: its
 *  pin's variant, default the seeded variant). */
export interface PuzzleSeedCell extends PuzzleId { offId?: number; offState?: number; offVariant?: number }

/** The seam's data per analysis: one entry per cell, and the metatile → meaning lookup `accepts` / `apply` use. */
interface Seed { ids: readonly (PuzzleSeedCell | null)[]; lookup: (m: number) => PuzzleId | null }
const seeds = new WeakMap<MapAnalysis, Seed>();

/** Test seam (as seedInteriorIds): makes puzzleCells read these ids (one per analysis cell, null = none; an entry with
 *  `offId` is position-listed), and the live cells read new metatiles through `lookup` (default: the seeded cells'
 *  own metatiles). Throws on a length mismatch. */
export function seedPuzzleIds(a: MapAnalysis, ids: readonly (PuzzleId | PuzzleSeedCell | null)[],
  lookup?: (m: number) => PuzzleId | null): void {
  if (ids.length !== a.N) throw new Error(`seedPuzzleIds: ${ids.length} ids for an analysis of ${a.N} cells (length mismatch)`);
  let look = lookup;
  if (!look) {
    const byMt = new Map<number, PuzzleId>();
    ids.forEach((p, i) => { if (p) byMt.set(a.mt[i], p); });
    look = (m) => byMt.get(m) ?? null;
  }
  seeds.set(a, { ids, lookup: look });
}

/** The meaning of metatile m on this analysis' map (seeded, or its secondary's table: ids ≥ 512, and below 512 only on
 *  another primary than Building when the table is of it, as interiorId reads them: Building's own ids are never
 *  mechanics). */
function lookupOf(a: MapAnalysis): (m: number) => PuzzleId | null {
  const seed = seeds.get(a);
  if (seed) return seed.lookup;
  const secondary = a.opts.secondaryTileset ?? 0, primary = a.opts.primaryTileset ?? SYM.gTileset_Building;
  const t = INTERIOR_TABLES.get(secondary);
  const own = t !== undefined && (t.primary ?? SYM.gTileset_Building) === primary;
  const low = own && primary !== SYM.gTileset_Building;
  return (m) => (m >= 512 || low ? puzzleId(m, secondary) : null);
}

/** Every analysis cell whose metatile is a mechanic id of the map's secondary (through puzzleId, or the seed), and
 *  every cell the table's `puzzleCells[mapKey]` lists by position, whatever id it shows (its `offId` read as
 *  `offState`; F4). In analysis order. */
export function puzzleCells(a: MapAnalysis, mapKey?: string | null): PuzzleCell[] {
  const out: PuzzleCell[] = [];
  const seed = seeds.get(a);
  if (seed) {
    for (let i = 0; i < a.N; i++) {
      const p = seed.ids[i];
      if (!p || a.kind[i] === K.Void) continue;
      const c: PuzzleCell = { i, x: a.cellX(i), y: a.cellY(i), kind: p.kind, variant: p.variant, state: p.state };
      if (p.offId !== undefined) { c.offId = p.offId; c.offState = p.offState ?? 0; c.offVariant = p.offVariant ?? p.variant; }
      out.push(c);
    }
    return out;
  }
  const look = lookupOf(a);
  const secondary = a.opts.secondaryTileset ?? 0;
  const pins = mapKey != null ? INTERIOR_TABLES.get(secondary)?.puzzleCells?.[mapKey] : undefined;
  const pinAt = new Map<number, PuzzleCellPin>();
  for (const p of pins ?? []) {
    if (!a.inside(p.x, p.y)) continue;
    const i = a.idx(p.x, p.y);
    if (a.kind[i] !== K.Void) pinAt.set(i, p);
  }
  for (let i = 0; i < a.N; i++) {
    if (a.kind[i] === K.Void) continue;
    const pin = pinAt.get(i), id = look(a.mt[i]);
    if (pin) {
      // the pin's kind whatever id it shows; a mechanic id of that kind gives the state and variant, else the off state
      const own = id && id.kind === pin.kind ? id : null;
      out.push({ i, x: a.cellX(i), y: a.cellY(i), kind: pin.kind, variant: own ? own.variant : pin.variant,
        state: own ? own.state : (pin.offState ?? 0), offId: pin.offId, offState: pin.offState ?? 0, offVariant: pin.variant });
    } else if (id) {
      out.push({ i, x: a.cellX(i), y: a.cellY(i), kind: id.kind, variant: id.variant, state: id.state });
    }
  }
  return out;
}

/** The index of a kind in PUZZLE_KINDS (the texel's b is this + 1; the GLSL's PUZZLE_<KIND> constants). */
export function puzzleKindIndex(kind: PuzzleKind): number {
  return PUZZLE_KINDS.indexOf(kind);
}

/** One RGBA8 texel per analysis cell (r state, g variant, b kind index + 1, 0 none; a 255 on a mechanic cell),
 *  NearestFilter, no mipmaps: GW×GH×4 bytes (Petalburg 20.7 KB, F43). Texel i is analysis cell i (row y − minY, column
 *  x − minX; flipY off). */
export class PuzzleStateTexture {
  readonly texture: THREE.DataTexture;
  private readonly data: Uint8Array;

  constructor(a: MapAnalysis, cells: readonly PuzzleCell[]) {
    const data = new Uint8Array(a.GW * a.GH * 4);
    for (const c of cells) {
      const o = c.i * 4;
      data[o] = c.state; data[o + 1] = c.variant; data[o + 2] = puzzleKindIndex(c.kind) + 1; data[o + 3] = 255;
    }
    const t = new THREE.DataTexture(data, a.GW, a.GH, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.flipY = false;
    t.needsUpdate = true;
    this.data = data;
    this.texture = t;
  }

  state(i: number): number {
    return this.data[i * 4];
  }

  variant(i: number): number {
    return this.data[i * 4 + 1];
  }

  /** Writes the texel (state, and the variant when given: Mauville's pole/beam cells, F4) and flags the texture once
   *  (needsUpdate: a version bump; the renderer uploads the whole texture once on its next use, however many cells
   *  changed); no allocation. An unchanged texel flags nothing. */
  set(i: number, state: number, variant?: number): void {
    const o = i * 4, d = this.data;
    const v = variant ?? d[o + 1];
    if (d[o] === state && d[o + 1] === v) return;
    d[o] = state; d[o + 1] = v;
    this.texture.needsUpdate = true;
  }

  /** Sets `userData.stateTexture = this.texture` on every mesh under `root` (the puzzle family's group: every mesh in it
   *  samples it; F8: kit uniforms sit in the pool's private slots, so this is where worldDigest finds the state). */
  attach(root: THREE.Object3D): void {
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.userData.stateTexture = this.texture;
    });
  }

  dispose(): void {
    this.texture.dispose();
  }
}

/** `PUZZLE_<KIND>` int constants (the kind index), in PUZZLE_KINDS order. */
const KIND_CONSTS = PUZZLE_KINDS.map((k, n) => `const int PUZZLE_${k.toUpperCase()} = ${n};`).join('\n');

/** GLSL (vertex and fragment): uniforms uPuzzleState (sampler2D), uPuzzleGrid (vec4: minX, minY, GW, GH);
 *  `vec4 puzzleTexel(vec2 gridXY)`, `float puzzleStateAt(vec2 gridXY)` (texelFetch, no filtering), plus
 *  `float puzzleVariantAt`, `int puzzleKindAt` (−1: none) and the `PUZZLE_<KIND>` constants. `gridXY` is a map-local
 *  grid position (world x, and z − h un-projected); outside the analysis every texel reads 0 (no mechanic). */
export const PUZZLE_STATE_GLSL = /* glsl */ `uniform sampler2D uPuzzleState;
uniform vec4 uPuzzleGrid;
${KIND_CONSTS}
vec4 puzzleTexel(vec2 gridXY) {
  ivec2 c = ivec2(floor(gridXY - uPuzzleGrid.xy));
  if (c.x < 0 || c.y < 0 || c.x >= int(uPuzzleGrid.z) || c.y >= int(uPuzzleGrid.w)) return vec4(0.0);
  return texelFetch(uPuzzleState, c, 0);
}
float puzzleStateAt(vec2 gridXY) { return floor(puzzleTexel(gridXY).r * 255.0 + 0.5); }
float puzzleVariantAt(vec2 gridXY) { return floor(puzzleTexel(gridXY).g * 255.0 + 0.5); }
int puzzleKindAt(vec2 gridXY) { return int(puzzleTexel(gridXY).b * 255.0 + 0.5) - 1; }
`;

/** The two uniforms PUZZLE_STATE_GLSL reads, for a material's `uniforms`. */
export function puzzleUniforms(tex: PuzzleStateTexture, a: MapAnalysis): Record<string, { value: unknown }> {
  return {
    uPuzzleState: { value: tex.texture },
    uPuzzleGrid: { value: new THREE.Vector4(a.minX, a.minY, a.GW, a.GH) },
  };
}

/** accepts: raw's metatile is a mechanic id of the same **kind** as the cell's, any variant, or the cell's listed
 *  `offId` (collision and elevation any; F4). apply: tex.set(i, its state, its variant) (the off id: `offState`, the
 *  pin's variant `offVariant`, so a patch writes what a rebuild reads). A change it does not accept is ignored by apply (World.patch asks accepts first). */
export function puzzleLiveCells(name: string, a: MapAnalysis, cells: readonly PuzzleCell[], tex: PuzzleStateTexture): LiveCells {
  const look = lookupOf(a);
  const byCell = new Map<number, PuzzleCell>();
  for (const c of cells) byCell.set(c.i, c);
  const meaning = (c: PuzzleCell, raw: number): PuzzleId | 'off' | null => {
    const m = raw & 0x3ff, p = look(m);
    if (p && p.kind === c.kind) return p;
    return c.offId !== undefined && m === c.offId ? 'off' : null;
  };
  return {
    name,
    cells: new Set(byCell.keys()),
    accepts(i: number, raw: number): boolean {
      const c = byCell.get(i);
      return c !== undefined && meaning(c, raw) !== null;
    },
    apply(i: number, raw: number): void {
      const c = byCell.get(i);
      if (!c) return;
      const p = meaning(c, raw);
      if (p === 'off') tex.set(i, c.offState ?? 0, c.offVariant ?? c.variant);
      else if (p) tex.set(i, p.state, p.variant);
    },
  };
}

/** The look of one state, shared by the shaders (as GLSL constants via puzzleLookGlsl) and the tests: a tint (the kind's
 *  base tint by default, F33), glow (emissive 0..1), raise (a raised part's height share 0..1, or a switch's lift in
 *  units), steps (hidden stairs: 0 a smooth slope, 1 steps; both on the ramp between the tiers, D13/F9), crack (thin
 *  ice's fracture lines 0..1), open (a hole / a door's slide 0..1). */
export interface PuzzleStateLook { tint: RGB; glow: number; raise: number; steps: number; crack: number; open: number }

/** Each kind's base tint (every state's unless it sets its own; F33). Starting values, tuned in Tasks 8 / 9. */
const BASE_TINT: Readonly<Record<PuzzleKind, RGB>> = {
  thinIce: [0.80, 0.92, 1.0],
  floorSwitch: [0.92, 0.80, 0.45],
  barrier: [0.60, 0.85, 1.0],
  arrowTile: [1.0, 0.85, 0.45],
  warpPad: [0.60, 0.90, 1.0],
  gymDoor: [0.72, 0.62, 0.50],
  toggleWall: [1.0, 1.0, 1.0],          // the variant (red / blue) colours the glass in the builder
  hiddenStairs: [0.80, 0.92, 1.0],
  geyserHole: [0.95, 0.72, 0.45],
};

const look = (kind: PuzzleKind, o: Partial<PuzzleStateLook>): PuzzleStateLook =>
  ({ tint: BASE_TINT[kind], glow: 0, raise: 0, steps: 0, crack: 0, open: 0, ...o });

/** The look of every state of every kind (one entry per state: puzzleStateCount). Starting values (Tasks 8 / 9 tune
 *  them); every pair of states of a kind differs by ≥ 0.3 in some field (tested), except the arrows (a direction each:
 *  arrowRotation) and the door frames (an animation: monotonic `open`, its ends ≥ 0.3 apart). */
export const PUZZLE_LOOK: Readonly<Record<PuzzleKind, readonly PuzzleStateLook[]>> = {
  thinIce: [look('thinIce', {}), look('thinIce', { crack: 1 }), look('thinIce', { open: 1 })],   // intact, cracked, broken
  floorSwitch: [look('floorSwitch', { glow: 0, raise: 0.08 }), look('floorSwitch', { glow: 1, raise: 0 })],   // raised, pressed
  barrier: [look('barrier', { glow: 0 }), look('barrier', { glow: 1 })],                       // off, on
  arrowTile: [0, 1, 2, 3].map(() => look('arrowTile', { glow: 0.6 })),                          // N, E, S, W: arrowRotation
  warpPad: [look('warpPad', { glow: 0.8 })],
  gymDoor: [0, 0.2, 0.4, 0.6, 0.8, 1].map((open) => look('gymDoor', { open })),                // closed, Frame0–4 (F33)
  toggleWall: [look('toggleWall', { raise: 0 }), look('toggleWall', { raise: 1 })],            // down, up
  hiddenStairs: [look('hiddenStairs', { steps: 0 }), look('hiddenStairs', { steps: 1 })],      // hidden, stairs
  geyserHole: [look('geyserHole', { glow: 0.3 })],
};

/** An arrow tile's chevron rotation per state (= direction: 0 N, 1 E, 2 S, 3 W), radians clockwise seen from above,
 *  from a chevron pointing north (grid −y, world −z): direction (x, z) = (sin r, −cos r), state 1 → +x. three's
 *  `rotation.y` turns the other way (counter-clockwise seen from above): use −r there. */
const ARROW_ROTATION: readonly number[] = [0, Math.PI / 2, Math.PI, 1.5 * Math.PI];

/** The rotation puzzleLookGlsl's `puzzleArrowRotation(state)` gives state s (exported for the tests). */
export function arrowRotation(s: number): number {
  return ARROW_ROTATION[s];
}

const glslFloat = (x: number): string => x.toFixed(6);

/** GLSL: `struct PuzzleStateLook { vec3 tint; float glow, raise, steps, crack, open; }`,
 *  `PuzzleStateLook puzzleLook(int kind, int state)` from PUZZLE_LOOK (kind: the kind index, PUZZLE_<KIND>; an unknown
 *  kind or state reads the neutral look) and `float puzzleArrowRotation(int state)`. Needs nothing else. */
export function puzzleLookGlsl(): string {
  const lines: string[] = [
    'struct PuzzleStateLook { vec3 tint; float glow; float raise; float steps; float crack; float open; };',
    'PuzzleStateLook puzzleLook(int kind, int state) {',
  ];
  PUZZLE_KINDS.forEach((kind, n) => {
    const looks = PUZZLE_LOOK[kind];
    lines.push(`  if (kind == ${n}) {`);
    looks.forEach((l, s) => {
      const args = [`vec3(${l.tint.map(glslFloat).join(', ')})`, ...[l.glow, l.raise, l.steps, l.crack, l.open].map(glslFloat)];
      lines.push(`    if (state == ${s}) return PuzzleStateLook(${args.join(', ')});`);
    });
    lines.push('  }');
  });
  lines.push(`  return PuzzleStateLook(vec3(1.0), 0.0, 0.0, 0.0, 0.0, 0.0);`, '}');
  lines.push('float puzzleArrowRotation(int state) {');
  ARROW_ROTATION.forEach((r, s) => lines.push(`  if (state == ${s}) return ${glslFloat(r)};`));
  lines.push('  return 0.0;', '}');
  return lines.join('\n') + '\n';
}
