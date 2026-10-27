// GTAO's depth/normal prepass (PostFX at High) draws the scene with one override material, MeshNormalMaterial, which
// places vertices by the geometry's own positions. A mesh whose shader places them itself (the inflated actors: a
// grid per instance, raised by the inflation field) would draw bare grids at the origin there, so such meshes drew
// nothing in the prepass — and the AO of the arena or ground behind them was composited over them (Task 12: the grass
// printed through the battlers at High). A mesh registered here draws a prepass material of its own instead: its
// vertex path, its depth and its normal packed as MeshNormalMaterial packs it. PostFX swaps it in for the prepass only;
// at Medium and Low (no GTAO) it is never drawn, so it never compiles.

import type * as THREE from 'three';

const prepass = new WeakMap<THREE.Object3D, THREE.Material>();

/** Gives `mesh` its own material in GTAO's depth/normal prepass, in place of the scene's override material (which then
 *  never applies to it: allowOverride off). */
export function setAoPrepassMaterial(mesh: THREE.Mesh, material: THREE.Material): void {
  material.allowOverride = false;
  prepass.set(mesh, material);
}

/** The prepass material of `mesh` (setAoPrepassMaterial), if any. */
export function aoPrepassMaterial(mesh: THREE.Object3D): THREE.Material | undefined {
  return prepass.get(mesh);
}

// The meshes swapped and their own materials (reused: no allocation per frame).
const swapped: THREE.Mesh[] = [];
const own: (THREE.Material | THREE.Material[])[] = [];
const swapIn = (o: THREE.Object3D) => {
  const m = prepass.get(o);
  if (!m) return;
  const mesh = o as THREE.Mesh;
  swapped.push(mesh);
  own.push(mesh.material);
  mesh.material = m;
};

/** Runs `draw` (the prepass) with every visible mesh under `root` that has a prepass material on it — three's render
 *  list takes each mesh's material as a render starts — and puts their own materials back after. */
export function withAoPrepassMaterials(root: THREE.Object3D, draw: () => void): void {
  const from = swapped.length;
  root.traverseVisible(swapIn);
  try {
    draw();
  } finally {
    for (let i = swapped.length - 1; i >= from; i--) swapped[i].material = own[i];
    swapped.length = own.length = from;
  }
}
