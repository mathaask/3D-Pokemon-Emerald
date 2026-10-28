// The interior furniture core (Phase 4 Task 6): real-world specs, fitting on the game's footprint, pieces, claims.
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createKitUniforms } from '../src/render/kit/materials';
import { lin } from '../src/render/kit/soup';
import {
  componentRects, fitFurniture, isLow, furnitureFamilyWith, FURNITURE_SPEC, WALL_BACK, WALKABLE_SEAT, FURNITURE_LOW, FURNITURE_TALL,
  FURNITURE_GLOW_LOW, type FurniturePiece, type FurnitureOut,
} from '../src/render/kit/interior/furniture';
import { RECESS, roomLayout } from '../src/render/kit/interior/room';
import { FURNITURE_KINDS } from '../src/render/kit/tables/building';
import { Claims, CLAIM_OBJECT } from '../src/render/overworld/claims';
import { NO_EVENTS } from '../src/render/kit/events';
import { fakeInterior } from './helpers/fakeInterior';

const stub = (p: FurniturePiece, o: FurnitureOut) => o.low.quad([p.foot.x0, 0, p.foot.z0], [p.foot.x1, 0, p.foot.z0],
  [p.foot.x1, 0, p.foot.z1], [p.foot.x0, 0, p.foot.z1], [0, 1, 0], [1, 1, 1]);
const extract = (rows: string[], gens: Parameters<typeof furnitureFamilyWith>[0], legend?: Parameters<typeof fakeInterior>[1]) => {
  const { a, ids } = fakeInterior(rows, legend);
  const claims = new Claims(a.N);
  const pieces = furnitureFamilyWith(gens).extract({ a, events: NO_EVENTS, quality: 'medium' }, claims);
  return { a, ids, claims, pieces };
};

describe('furniture fitting', () => {
  it('anchors a free table at the south edge of its cells', () => {
    expect(fitFurniture('table', 3, 4, 5, 6, 0, -Infinity)).toEqual({ x0: 3, x1: 5, z0: 7 - 1.6, z1: 7, y: 0, height: 0.75 });
  });
  it('keeps furniture in the wall band in front of the wall and its relief', () => {
    const f = fitFurniture('fridge', 6, 6, 1, 2, 0, 3 - RECESS + WALL_BACK);
    expect(f.z0).toBeCloseTo(2.59, 5); expect(f).toMatchObject({ z1: 3, height: 1.9 });
  });
  it('never fades low furniture, its screens included', () => {
    expect(FURNITURE_KINDS.filter(isLow)).toEqual(['bed', 'table', 'chair', 'tv', 'pc', 'sink', 'cabinet', 'crate', 'trashCan',
      'vase', 'counter', 'pcCounter', 'stairsDown',
      // Phase 4b (statue, pillar, fishTank, slotMachine and machine stay tall)
      'brazier', 'dais', 'displayCase', 'modelShip', 'plinth', 'rouletteTable', 'schoolDesk', 'flowerBin', 'bikeRack']);
    expect(FURNITURE_LOW.fade).toBeFalsy(); expect(FURNITURE_TALL.fade).toBe(true);
    expect(FURNITURE_GLOW_LOW.fade).toBeFalsy();
  });
  it('has a spec for every kind, real-world high, never deeper than 2', () => {
    for (const k of FURNITURE_KINDS) {
      // (a gym or League pillar reaches its room's ceiling art: 2.6, Phase 4b)
      expect(FURNITURE_SPEC[k].height, k).toBeLessThanOrEqual(k === 'pillar' ? 2.6 : 2.1);
      expect(FURNITURE_SPEC[k].depth, k).toBeLessThanOrEqual(2);
    }
  });
});

describe('furniture family', () => {
  it('gives a piece its cells, per-cell footprints and a chair its facing', () => {
    const { a } = fakeInterior(['        ', ' WWWWWW ', ' ...... ', ' .cTT.. ', ' ...... ', '        ']);
    const stub = (p: FurniturePiece, o: FurnitureOut) => o.low.quad([p.foot.x0, 0, p.foot.z0], [p.foot.x1, 0, p.foot.z0],
      [p.foot.x1, 0, p.foot.z1], [p.foot.x0, 0, p.foot.z1], [0, 1, 0], [1, 1, 1]);
    const pieces = furnitureFamilyWith({ table: stub, chair: stub }).extract({ a, events: NO_EVENTS, quality: 'medium' }, new Claims(a.N));
    const table = pieces.find((p) => p.kind === 'table')!, chair = pieces.find((p) => p.kind === 'chair')!;
    expect(table.xy).toEqual([[3, 3], [4, 3]]); expect(table.cellFeet).toHaveLength(2); expect(table.floorY).toBe(0);
    expect(chair.facing).toBe('E'); expect(table.facing).toBeNull();
  });
  it('cuts a component at an unknown cell and leaves kinds without a generator to legacy', () => {
    const { a } = fakeInterior(['        ', ' WWWWWW ', ' .TT?T. ', ' ...... ', '        ']);
    const gen = vi.fn((p: FurniturePiece, o: FurnitureOut) => o.low.quad([p.foot.x0, 0, p.foot.z0], [p.foot.x1, 0, p.foot.z0],
      [p.foot.x1, 0, p.foot.z1], [p.foot.x0, 0, p.foot.z1], [0, 1, 0], [1, 1, 1]));
    const fam = furnitureFamilyWith({ table: gen });
    const claims = new Claims(a.N), pieces = fam.extract({ a, events: NO_EVENTS, quality: 'medium' }, claims);
    expect(pieces.map((p) => p.cells.length)).toEqual([2, 1]);             // TT | T, the ? stays legacy
    expect(claims.has(a.idx(4, 2), CLAIM_OBJECT)).toBe(false);
    expect(furnitureFamilyWith({}).extract({ a, events: NO_EVENTS, quality: 'medium' }, new Claims(a.N))).toEqual([]);
  });
  it('fits stacked walkable chairs one per cell as low seats, and merges the table they face', () => {
    const { pieces } = extract(['         ', ' WWWWWWW ', ' ....... ', ' .hTTh.. ', ' .hTTh.. ', ' ....... ', '         '],
      { chair: stub, table: stub }, { h: { mt: 0x210, blocked: false, id: 'chair' } });
    const chairs = pieces.filter((p) => p.kind === 'chair');
    expect(chairs.map((p) => p.xy)).toEqual([[[2, 3]], [[5, 3]], [[2, 4]], [[5, 4]]]);
    expect(chairs.map((p) => p.facing)).toEqual(['E', 'W', 'E', 'W']);
    for (const c of chairs) {
      expect(c.foot.height).toBeLessThanOrEqual(WALKABLE_SEAT);
      expect(c.cellFeet[0].height).toBeLessThanOrEqual(WALKABLE_SEAT);
    }
    expect(WALKABLE_SEAT).toBeLessThanOrEqual(0.45);
    expect(pieces.filter((p) => p.kind === 'table').map((p) => p.cells.length)).toEqual([4]);
  });
  it('caps every walkable furniture cell low, whatever its kind: a bed head, plant leaves, a stairs cell', () => {
    const { pieces } = extract(['         ', ' WWWWWWW ', ' .e.l.S. ', ' .d.p... ', ' ....... ', '         '],
      { bed: stub, plant: stub, stairsUp: stub },
      { e: { mt: 0x213, blocked: false, id: 'bed' }, d: { mt: 0x214, blocked: true, id: 'bed' },
        l: { mt: 0x211, blocked: false, id: 'plant' }, p: { mt: 0x212, blocked: true, id: 'plant' } });
    const of = (k: string) => pieces.find((q) => q.kind === k)!;
    expect(of('bed').cellFeet.map((f) => f.height)).toEqual([WALKABLE_SEAT, FURNITURE_SPEC.bed.height]);   // head, foot end
    expect(of('bed').foot.height).toBe(FURNITURE_SPEC.bed.height);
    expect(of('plant').cellFeet.map((f) => f.height)).toEqual([WALKABLE_SEAT, FURNITURE_SPEC.plant.height]);
    // (the player climbs stairs: the piece keeps its height, its walkable cell's own footprint is low)
    expect(of('stairsUp').foot.height).toBe(FURNITURE_SPEC.stairsUp.height);
    expect(of('stairsUp').cellFeet[0].height).toBe(WALKABLE_SEAT);
  });
  it('keeps a blocked chair at its real height', () => {
    const { pieces } = extract(['        ', ' WWWWWW ', ' ...... ', ' .cTT.. ', ' ...... ', '        '], { chair: stub });
    expect(pieces[0].foot.height).toBe(FURNITURE_SPEC.chair.height);
  });
  // review C M1: a 2×2 bookcase and the small shelf beside it (or a cabinet and a drawer unit) are one
  // component of one kind, but two objects on the GBA
  it('splits an L of shelves into its rectangles, keeps a rectangle and an L of tables whole', () => {
    const L = (rows: string[]) => extract(rows, { bookshelf: stub, table: stub }).pieces.map((p) => p.xy.map(([x, y]) => `${x},${y}`).join(' '));
    expect(L(['        ', ' WBBWWW ', ' WBBBWW ', ' ...... ', ' ...... ', '        '])).toEqual(['2,1 3,1 2,2 3,2', '4,2']);
    expect(L(['        ', ' WBBBWW ', ' WBBBWW ', ' ...... ', ' ...... ', '        '])).toEqual(['2,1 3,1 4,1 2,2 3,2 4,2']);
    expect(L(['        ', ' WWWWWW ', ' ...... ', ' .TT... ', ' .TTT.. ', ' ...... ', '        '])).toHaveLength(1);
  });
  it('takes the largest rectangle first, then the southernmost, the westernmost', () => {
    expect(componentRects([[0, 0], [1, 0], [0, 1], [1, 1], [2, 1]])).toEqual([[0, 1, 2, 3], [4]]);
    expect(componentRects([[0, 0], [0, 1], [1, 1]])).toEqual([[1, 2], [0]]);     // two 2-cell rectangles: the south row
    expect(componentRects([[0, 0], [1, 0], [2, 0], [1, 1]])).toEqual([[0, 1, 2], [3]]);
    expect(componentRects([[5, 5]])).toEqual([[0]]);
  });
  it('splits plants one per column, the walkable leaves north of a pot joining it', () => {
    const { pieces } = extract(
      ['         ', ' WWWWWWW ', ' ll..l.. ', ' pp..p.. ', ' ....l.. ', ' ....p.. ', ' ....... ', '         '],
      { plant: stub },
      { l: { mt: 0x211, blocked: false, id: 'plant' }, p: { mt: 0x212, blocked: true, id: 'plant' } });
    expect(pieces.map((p) => p.xy)).toEqual([[[1, 2], [1, 3]], [[2, 2], [2, 3]], [[5, 2], [5, 3]], [[5, 4], [5, 5]]]);
    // the model stands on the pot: its depth never reaches the leaves' cell
    expect(pieces[0].foot).toMatchObject({ z1: 4, height: FURNITURE_SPEC.plant.height });
    expect(pieces[0].foot.z0).toBeCloseTo(4 - FURNITURE_SPEC.plant.depth, 6);
  });
  it('fits a piece in the wall band against the back wall, claiming the ground as the room floor', () => {
    const { a, ids, claims, pieces } = extract(['       ', ' WFWWW ', ' WFWWW ', ' ..... ', ' ..... ', '       '], { fridge: stub });
    expect(pieces).toHaveLength(1);
    const L = roomLayout(a, ids, NO_EVENTS.warps);
    expect(pieces[0].xy).toEqual([[2, 1], [2, 2]]);
    expect(pieces[0].foot.z0).toBeCloseTo(3 - RECESS + WALL_BACK, 6);
    expect(pieces[0].foot.z1).toBe(3);
    for (const i of pieces[0].cells) {
      expect(claims.has(i, CLAIM_OBJECT)).toBe(true);
      expect(claims.groundMt[i]).toBe(L.floorTile);
    }
  });
  it('turns stairs to the side they are entered from, a Sootopolis 0x3FF floor cell included', () => {
    const { pieces } = extract(['       ', ' WWWWW ', ' ...S. ', ' ..._. ', ' ..... ', '       '], { stairsUp: stub });
    expect(pieces.map((p) => [p.kind, p.facing])).toEqual([['stairsUp', 'S']]);
  });
  it('builds one mesh per non-empty soup', () => {
    const { a } = fakeInterior(['        ', ' WWWWWW ', ' .cTT.. ', ' ...... ', '        ']);
    const fam = furnitureFamilyWith({ table: stub });
    const ctx = { a, events: NO_EVENTS, quality: 'medium' as const };
    const pieces = fam.extract(ctx, new Claims(a.N));
    const kit = { uniforms: createKitUniforms(), quality: 'medium' as const, disposables: [] };
    // (the stub writes `low` only: one mesh, cast and received shadows)
    const built = fam.build(pieces, ctx, kit)!;
    expect(built.children.map((c) => c.name)).toEqual(['furnitureLow']);
    expect((built.children[0] as THREE.Mesh).castShadow).toBe(true);
    expect(fam.build([], ctx, kit)).toBeNull();
  });
});

describe('furniture test helpers', () => {
  it('measures, hashes and counts what a generator wrote', async () => {
    const h = await import('./helpers/furniture');
    // (generators write linear colours: countClusters compares lin() of the sRGB it is given)
    const two = (p: FurniturePiece, o: FurnitureOut) => {
      o.tall.box([p.foot.x0, 0, p.foot.z0], [1, 0, 0], [0, 0, 1], 0, 0.4, 0, 1, 0, 0.4, lin([0.85, 0.15, 0.15]));
      o.tall.box([p.foot.x0 + 1, 0, p.foot.z0], [1, 0, 0], [0, 0, 1], 0, 0.4, 0, 1, 0, 0.4, lin([0.85, 0.15, 0.15]));
      o.glowLow.quad([0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 1, 0], [1, 1, 1]);
    };
    const out = h.run({ vase: two }, 'vase');
    expect(h.countClusters(out.tall, [0.85, 0.15, 0.15])).toBe(2);
    expect(h.countClusters(out.tall, [0.1, 0.1, 0.1])).toBe(0);
    expect(h.tris(out)).toBe(2 * 10 + 2);
    expect(h.hashOut(out)).toBe(h.hashOut(h.run({ vase: two }, 'vase')));
    expect(h.boxOf(out).max.y).toBe(1);
    expect(h.piece('table').foot).toEqual(fitFurniture('table', 2, 3, 4, 5, 0, -Infinity));
    expect(h.piece('chair', { facing: 'E' }).facing).toBe('E');
  });
});
