// The cells a runtime grid change touched (Phase 4b, D3): the incremental world update (World.patch) gets their grid
// indices from the last grid the world took and the new one.

/** Grid indices whose u16 differs between `prev` and `next`, ascending; the grids must have one length, else it throws. */
export function changedCells(prev: Uint16Array, next: Uint16Array): number[] {
  if (prev.length !== next.length) throw new Error(`changedCells: grids of ${prev.length} and ${next.length} cells`);
  const out: number[] = [];
  for (let i = 0; i < prev.length; i++) if (prev[i] !== next[i]) out.push(i);
  return out;
}
