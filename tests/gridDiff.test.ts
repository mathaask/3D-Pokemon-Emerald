// changedCells: the grid cells a runtime change touched (Phase 4b Task 3, the incremental world update's input).

import { describe, it, expect } from 'vitest';
import { changedCells } from '../src/render/overworld/gridDiff';

describe('changedCells', () => {
  it('lists the changed grid cells in order', () => {
    expect(changedCells(Uint16Array.of(1, 2, 3, 4), Uint16Array.of(1, 9, 3, 0x0c04))).toEqual([1, 3]);
    expect(changedCells(Uint16Array.of(5), Uint16Array.of(5))).toEqual([]);
    expect(() => changedCells(Uint16Array.of(1), Uint16Array.of(1, 2))).toThrow();
  });

  it('sees a change in every u16 of a grid, odd lengths and offset views included', () => {
    const prev = new Uint16Array(9).map((_, i) => i * 7);
    for (let k = 0; k < prev.length; k++) {
      const next = prev.slice();
      next[k] ^= 0x8000;
      expect(changedCells(prev, next)).toEqual([k]);
    }
    // (a view that does not start at its buffer's first byte)
    const buf = new Uint16Array(11);
    const view = buf.subarray(1, 10);
    view.set(prev);
    view[8] = 1;
    expect(changedCells(prev, view)).toEqual([8]);
  });
});
