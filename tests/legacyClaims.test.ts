// The legacy emitter's claim guards, on a synthetic map (no ROM).
//
// fakeGrid(['....', '.##.', '....']) analyses (margin 1, blocked border ring) as:
//   row 0: floor at height 1 (the '#' row below reads as a 1-high cliff face)
//   row 1: stairs (0.5) | block | block | stairs (0.5)  (end cells are flanked by blocked cells)
//   row 2: floor at height 0
// so it has two blocked runs with south faces and four N/S connectors (columns 0 and 3).

import { describe, it, expect } from 'vitest';
import { emitLegacy, type Quad } from '../src/render/overworld/legacyQuads';
import { Claims, CLAIM_OBJECT, CLAIM_SURFACE, CLAIM_TOP } from '../src/render/overworld/claims';
import { K } from '../src/render/overworld/analyze';
import { fakeAnalysis } from './helpers/fakeMap';

const MAP = ['....', '.##.', '....'];

const isFloor = (q: Quad) => q.normal[0] === 0 && q.normal[1] === 1 && q.normal[2] === 0;
/** Connectors sample the bottom fifth of their metatile; nothing else does. */
const isConnector = (q: Quad) => q.tv0 === 0.8;
/** South-facing solid (non-cutout) faces: blocked-run fronts. */
const isFace = (q: Quad) => q.normal[2] === 1 && q.normal[1] === 0 && !q.cutout && !isConnector(q);

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
