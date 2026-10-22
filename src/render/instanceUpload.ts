// Change-detected uploads of per-frame instance attributes (sprite cards, inflated actors). On ANGLE
// (D3D11, Intel) every draw that reads an instance buffer re-uploaded in the same frame costs
// ~0.3-0.5 ms of GPU time (measured, Task 5), so the per-frame setters write through `put` and mark
// only the attributes whose values changed: a still scene uploads nothing.

import type * as THREE from 'three';

/** Writes `v` (as float32) at `a[k]`; 1 if that changed the stored value, else 0. */
export function put(a: Float32Array, k: number, v: number): number {
  const f = Math.fround(v);
  if (a[k] === f) return 0;
  a[k] = f;
  return 1;
}

/** Marks the first `n` instances (whole items) of `a` for upload. Callers pass the most instances they
 *  have ever set, so the GPU copy mirrors the array there whatever the instance count did in between. */
export function markRange(a: THREE.BufferAttribute, n: number): void {
  a.clearUpdateRanges();
  a.addUpdateRange(0, n * a.itemSize);
  a.needsUpdate = true;
}
