// The legacy emitter's claim guards, on a synthetic map (no ROM).
//
// fakeGrid(['....', '.##.', '....']) analyses (margin 1, blocked border ring) as:
//   row 0: floor at height 1 (the '#' row below reads as a 1-high cliff face)
//   row 1: stairs (0.5) | block | block | stairs (0.5)  (end cells are flanked by blocked cells)
//   row 2: floor at height 0
// so it has two blocked runs with south faces and four N/S connectors (columns 0 and 3).

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { emitLegacy, type Quad } from '../src/render/overworld/legacyQuads';
import { Claims, CLAIM_OBJECT, CLAIM_SURFACE, CLAIM_TOP, CLAIM_WATER_UNDER } from '../src/render/overworld/claims';
import { Variant } from '../src/render/overworld/metatileAtlas';
import { analyze, K } from '../src/render/overworld/analyze';
import { MB } from '../src/game/behaviors';
import { fakeAnalysis, fakeGrid, fakeInfo } from './helpers/fakeMap';
import { buildAll, extractAll, type Extracted, type Family, type KitContext } from '../src/render/kit/semantics';
import { terrainFamily, type TerrainPlacement } from '../src/render/kit/terrain';
import { createKitUniforms } from '../src/render/kit/materials';
import { NO_EVENTS } from '../src/render/kit/events';

const MAP = ['....', '.##.', '....'];

const isFloor = (q: Quad) => q.normal[0] === 0 && q.normal[1] === 1 && q.normal[2] === 0;
/** Connectors sample the bottom fifth of their metatile; nothing else does. */
const isConnector = (q: Quad) => q.tv0 === 0.8;
/** South-facing solid (non-cutout) faces: blocked-run fronts. */
const isFace = (q: Quad) => q.normal[2] === 1 && q.normal[1] === 0 && !q.cutout && !isConnector(q);

describe('Claims', () => {
  it('snapshot and restore cover every override, the walkable surface heights too', () => {
    const c = new Claims(4);
    c.claim(1, CLAIM_SURFACE); c.surfaceY[1] = 2; c.groundY[2] = 1; c.groundMt[2] = 7;
    const snap = c.snapshot();
    c.claim(3, CLAIM_OBJECT); c.surfaceY[1] = 5; c.surfaceY[3] = 4; c.groundY[2] = 3; c.groundMt[2] = 9;
    c.restore(snap);
    expect([...c.bits]).toEqual([0, CLAIM_SURFACE, 0, 0]);
    expect([...c.surfaceY]).toEqual([NaN, 2, NaN, NaN]);
    expect([c.groundY[2], c.groundMt[2]]).toEqual([1, 7]);
    expect([...new Claims(2).surfaceY]).toEqual([NaN, NaN]); // (none by default)
  });
});

describe('emitLegacy claim guards', () => {
  const a = fakeAnalysis(MAP);
  const at = (x: number, y: number) => a.idx(x, y);
  const claimsWith = (cells: number[], bit: number) => {
    const c = new Claims(a.N);
    for (const i of cells) c.claim(i, bit);
    return c;
  };
  const all = [...Array(a.N).keys()];

  it('the synthetic map has the shape these tests rely on', () => {
    expect([a.kind[at(1, 1)], a.kind[at(2, 1)]]).toEqual([K.Block, K.Block]);
    expect([a.kind[at(0, 1)], a.kind[at(3, 1)]]).toEqual([K.Stairs, K.Stairs]);
    expect([a.height[at(0, 0)], a.height[at(0, 1)], a.height[at(0, 2)]]).toEqual([1, 0.5, 0]);
    // No claims and a null Claims are the same thing.
    expect(emitLegacy(a, new Claims(a.N))).toEqual(emitLegacy(a, null));
  });

  it('ignores the walkable surface heights the kit publishes (they only place characters)', () => {
    const c = new Claims(a.N);
    c.surfaceY.fill(3);
    expect(emitLegacy(a, c)).toEqual(emitLegacy(a, null));
  });

  it('CLAIM_SURFACE on every cell drops the floor pass (one floor per cell)', () => {
    const before = emitLegacy(a).quads.filter(isFloor).length;
    const after = emitLegacy(a, claimsWith(all, CLAIM_SURFACE)).quads.filter(isFloor).length;
    expect(before - after).toBe(a.N);
    // The floors left are flat tops of blocked runs (object geometry); claiming the objects too
    // leaves no floor quads at all — and with every bit claimed, nothing at all.
    expect(emitLegacy(a, claimsWith(all, CLAIM_SURFACE | CLAIM_OBJECT)).quads.filter(isFloor)).toHaveLength(0);
    const everything = emitLegacy(a, claimsWith(all, CLAIM_SURFACE | CLAIM_OBJECT | CLAIM_TOP));
    expect(everything.quads).toHaveLength(0);
    expect(everything.trees).toHaveLength(0);
  });

  it('CLAIM_OBJECT on a blocked run removes its faces but keeps the ground under it', () => {
    const facesIn = (qs: Quad[], x: number) => qs.filter((q) => isFace(q) && q.a[0] === x).length;
    const before = emitLegacy(a).quads;
    const after = emitLegacy(a, claimsWith([at(1, 1), at(2, 1)], CLAIM_OBJECT)).quads;
    expect([facesIn(before, 1), facesIn(before, 2)]).toEqual([1, 1]);
    expect([facesIn(after, 1), facesIn(after, 2)]).toEqual([0, 0]);
    expect(before.length - after.length).toBe(2);
    expect(after.filter(isFloor)).toHaveLength(before.filter(isFloor).length);
  });

  it('connectors are skipped only when both cells are surface-claimed', () => {
    const col0 = (c: Claims | null) => emitLegacy(a, c).quads.filter((q) => isConnector(q) && q.a[0] === 0).length;
    const total = (c: Claims | null) => emitLegacy(a, c).quads.filter(isConnector).length;
    expect(total(null)).toBe(4);
    expect(col0(null)).toBe(2); // (0,0)-(0,1) and (0,1)-(0,2)
    expect(col0(claimsWith([at(0, 0)], CLAIM_SURFACE))).toBe(2);
    expect(col0(claimsWith([at(0, 1)], CLAIM_SURFACE))).toBe(2);
    expect(col0(claimsWith([at(0, 0), at(0, 1)], CLAIM_SURFACE))).toBe(1);
    expect(col0(claimsWith([at(0, 0), at(0, 1), at(0, 2)], CLAIM_SURFACE))).toBe(0);
    // Other claim bits never remove connectors.
    expect(total(claimsWith(all, CLAIM_OBJECT | CLAIM_TOP))).toBe(4);
  });
});

describe('emitLegacy and a building the kit modelled', () => {
  // A door (2, 2) whose flood fill takes the house (rows 1-2) and a post on its roof (2, 0).
  const info = fakeInfo();
  info.attributes[4] = MB.ANIMATED_DOOR;
  const grid = fakeGrid(['..#..', '.###.', '.###.', '.....']);
  grid.cells[2 * 5 + 2] = 4 | 0x0400;
  const a = analyze(grid, { info, generalPrimary: false, indoor: false, underground: false, underwater: false, margin: 1 });
  const at = (x: number, y: number) => a.idx(x, y);
  const xs = (qs: Quad[], x: number) => qs.filter((q) => Math.min(q.a[0], q.b[0], q.c[0], q.d[0]) === x && Math.max(q.a[0], q.b[0], q.c[0], q.d[0]) === x + 1);
  /** The kit's model: the house rows, standing on the ground (0). */
  const model = () => {
    const c = new Claims(a.N);
    for (let y = 1; y <= 2; y++) for (let x = 1; x <= 3; x++) { c.claim(at(x, y), CLAIM_OBJECT); c.groundY[at(x, y)] = 0; }
    return c;
  };

  it('the synthetic map has the shape these tests rely on', () => {
    expect(a.buildings).toHaveLength(1);
    expect(a.kind[at(2, 0)]).toBe(K.Building);
  });

  it('draws the cells of the fill outside the model as blocks standing on the modelled ground', () => {
    const solo = emitLegacy(a, model()).quads;
    // the post: a standing quad (not a flat tile painted on the ground behind the model)
    const post = xs(solo, 2).filter((q) => q.a[2] <= 1 + 1e-6 && q.normal[1] === 0);
    expect(post.length).toBeGreaterThan(0);
    // the legacy building shell (its walls glow at night) is gone; without claims it is drawn
    expect(solo.some((q) => q.glow)).toBe(false);
    expect(emitLegacy(a, null).quads.some((q) => q.glow)).toBe(true);
    expect(emitLegacy(a, null)).toEqual(emitLegacy(a, new Claims(a.N)));
  });
});

describe('emitLegacy and the kit water under legacy art (CLAIM_WATER_UNDER)', () => {
  // A shore ('.', land) and the sea ('w'); a boat ('b': blocked, its art in the covered top layer
  // over water: the analysis lays it flat as water); a rock standing in the sea ('R': blocked, the
  // rock drawn over water, a block).
  const SEA = 8 | (12 << 5) | (26 << 10), HULL = 24 | (20 << 5) | (14 << 10), STONE = 18 | (12 << 5) | (8 << 10);
  const info = fakeInfo();
  const fill = (m: number, c: number, from = 0, to = 256) => { info.both.fill(c, m * 256 + from, m * 256 + to); info.bottom.fill(c, m * 256 + from, m * 256 + to); };
  fill(1, 14 | (24 << 5) | (20 << 10));
  fill(3, SEA); info.attributes[3] = MB.OCEAN_WATER;
  fill(5, SEA); info.both.fill(HULL, 5 * 256 + 64, 5 * 256 + 192); info.topCover[5] = 128; info.attributes[5] = 1 << 12; info.blue[5] = 0.7;
  fill(6, SEA); fill(6, STONE, 32, 224); info.blue[6] = 0.2; // (the rock, drawn in the ground layer)
  const rows = ['.www', '.wbw', '.wRw', '.www'];
  const code: Record<string, number> = { '.': 1 | 0x3000, w: 3 | 0x1000, b: 5 | 0x1400, R: 6 | 0x1400 };
  const w = rows[0].length, h = rows.length;
  const cells = new Uint16Array(w * h);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { cells[y * w + x] = code[ch]; }));
  const a = analyze({ width: w, height: h, cells, border: [3, 3, 3, 3], borderW: 2, borderH: 2, borderPhase: 0 },
    { info, generalPrimary: false, indoor: false, underground: false, underwater: false, margin: 0 });
  const at = (x: number, y: number) => a.idx(x, y);
  const cellQuads = (qs: Quad[], x: number, y: number) => qs.filter((q) => Math.min(q.a[0], q.b[0], q.c[0], q.d[0]) === x &&
    Math.max(q.a[0], q.b[0], q.c[0], q.d[0]) === x + 1 && q.metatile === a.mt[at(x, y)]);
  /** The kit's water: surface claimed on the plain sea, water under the boat and the rock. */
  const kit = () => {
    const c = new Claims(a.N);
    for (let i = 0; i < a.N; i++) if (a.kind[i] === K.Water && a.mt[i] === 3) c.claim(i, CLAIM_SURFACE);
    for (let i = 0; i < a.N; i++) if (a.kind[i] !== K.Floor && !c.has(i, CLAIM_SURFACE)) c.claim(i, CLAIM_WATER_UNDER);
    return c;
  };

  it('the synthetic map has the shape these tests rely on', () => {
    expect(a.kind[at(2, 1)]).toBe(K.Water);
    expect(a.kind[at(2, 2)]).toBe(K.Block);
    expect(a.groundOf[at(2, 2)]).toBe(3);
  });

  it("draws a boat's art over the kit water: its water cut out, just above the water's swell", () => {
    const before = cellQuads(emitLegacy(a, null).quads, 2, 1);
    expect(before.map((q) => [q.variant, q.water])).toEqual([[Variant.Both, true]]);
    const [boat, ...rest] = cellQuads(emitLegacy(a, kit()).quads, 2, 1);
    expect(rest).toEqual([]);
    expect(boat.variant).toBe(Variant.Dry);
    expect(boat.cutout).toBe(true);
    expect(boat.water).toBeFalsy();
    expect(boat.a[1]).toBeCloseTo(a.height[at(2, 1)] + 0.06);
    expect(boat.a[2]).toBeCloseTo(1 + a.height[at(2, 1)] + 0.06); // (un-projected at its height)
  });

  it('drops the pixel water under a rock standing in the sea, and cuts the water out of its art', () => {
    const under = (qs: Quad[]) => cellQuads(qs, 2, 2).length + qs.filter((q) => q.metatile === 3 && isFloor(q) &&
      q.a[0] === 2 && Math.abs(q.a[2] - q.a[1] - 2) < 1e-6).length;
    const legacy = emitLegacy(a, null).quads;
    expect(legacy.some((q) => q.metatile === 3 && isFloor(q) && q.a[0] === 2 && Math.abs(q.a[2] - q.a[1] - 2) < 1e-6)).toBe(true);
    const withKit = emitLegacy(a, kit()).quads;
    expect(withKit.some((q) => q.metatile === 3 && isFloor(q) && q.a[0] === 2 && Math.abs(q.a[2] - q.a[1] - 2) < 1e-6)).toBe(false);
    const rock = cellQuads(withKit, 2, 2);
    expect(rock.length).toBeGreaterThan(0);
    for (const q of rock) expect([q.variant, q.cutout]).toEqual([Variant.Dry, true]);
    expect(under(withKit)).toBe(rock.length);
  });

  it('leaves the shore between the kit water under legacy art and the terrain to the kit (no legacy connector)', () => {
    // (the terrain draws the bank: water cells count as its surfaces)
    const c = new Claims(a.N);
    for (let i = 0; i < a.N; i++) c.claim(i, a.kind[i] === K.Floor ? CLAIM_SURFACE : CLAIM_WATER_UNDER);
    expect(emitLegacy(a, c).quads.filter(isConnector)).toEqual([]);
    const land = new Claims(a.N);
    for (let i = 0; i < a.N; i++) if (a.kind[i] === K.Floor) land.claim(i, CLAIM_SURFACE);
    expect(emitLegacy(a, land).quads.filter(isConnector).length).toBeGreaterThan(0);
  });
});

describe('banks between the terrain and water the kit does not draw (Dive maps: no water family)', () => {
  // Land ('.', height 0) north of the sea ('w', the water level below it): four S banks, rows 1-2.
  const info = fakeInfo();
  info.both.fill(14 | (24 << 5) | (20 << 10), 256, 512);
  info.attributes[3] = MB.OCEAN_WATER;
  const rows = ['....', '....', 'wwww', 'wwww'];
  const code: Record<string, number> = { '.': 1 | 0x3000, w: 3 | 0x1000 };
  const cells = new Uint16Array(16);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { cells[y * 4 + x] = code[ch]; }));
  const a = analyze({ width: 4, height: 4, cells, border: [3, 3, 3, 3], borderW: 2, borderH: 2, borderPhase: 0 },
    { info, generalPrimary: false, indoor: false, underground: false, underwater: true, margin: 0 });
  const ctx = { a, events: NO_EVENTS, quality: 'medium' as const };
  const kit = (): KitContext => ({ uniforms: createKitUniforms(), quality: 'medium', disposables: [] });
  /** Bank quads the terrain mesh draws (its quads beyond one top per cell). */
  const terrainBanks = (group: THREE.Group, ex: Extracted) => {
    const mesh = group.getObjectByName('terrain') as THREE.Mesh | undefined;
    return mesh ? mesh.geometry.getAttribute('position').count / 6 - (ex.payloads.get('terrain') as TerrainPlacement).cells.length : 0;
  };

  it('the synthetic map has the shape these tests rely on', () => {
    expect(a.kind[a.idx(0, 1)]).toBe(K.Floor);
    expect(a.kind[a.idx(0, 2)]).toBe(K.Water);
    expect(a.height[a.idx(0, 2)]).toBeLessThan(a.height[a.idx(0, 1)]);
    expect(emitLegacy(a, null).quads.filter(isConnector)).toHaveLength(4);
  });

  it('draws each once: the terrain does (the shore slope is the land\'s), the legacy connectors do not', () => {
    const ex = extractAll(ctx, [terrainFamily]);
    const group = buildAll(ex, ctx, [terrainFamily], kit());
    expect(terrainBanks(group, ex)).toBe(4);
    expect(emitLegacy(a, ex.claims).quads.filter(isConnector)).toEqual([]);
  });

  it('the legacy connectors draw them when the terrain fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing: Family<unknown> = { ...terrainFamily, build() { throw new Error('boom'); } } as Family<unknown>;
    const ex = extractAll(ctx, [failing]);
    buildAll(ex, ctx, [failing], kit());
    expect(emitLegacy(a, ex.claims).quads.filter(isConnector)).toHaveLength(4);
    warn.mockRestore();
  });
});
