// Room floors (Phase 4, D3): boards, tiles, carpet, rugs, mats in their own program ('interiorFloor'), laid under
// everything the other interior families claimed (the family runs last), plus the window light shafts (shafts.ts). The
// pure parts (cells, texture bytes, quads, GLSL, the shafts' strips and material) are in geom/floorPatterns.ts.

import * as THREE from 'three';
import { CLAIM_SURFACE, type Claims } from '../../overworld/claims';
import { kitMaterial } from '../materials';
import type { Family, KitContext, SemanticContext } from '../semantics';
import { interiorIds } from '../tables/building';
import {
  floorCells, floorGeometry, floorTexture, interiorFloorMaterial, roomShaftMaterial, shaftGeometry, type FloorCell,
} from './geom/floorPatterns';
import type { InteriorCatalogueEntry } from './index';
import { roomLayout } from './room';
import { glazedWindows } from './geom/shellParts';

export { encodeFloor, floorCells, FloorMat, interiorFloorMaterial, type FloorCell } from './geom/floorPatterns';

/** The shafts' strength (their strips' peak alpha × the daylight they add). */
export const SHAFT_ALPHA = 0.3;

export const floorFamily: Family<FloorCell[]> = {
  name: 'floor',

  extract({ a, events }: SemanticContext, claims: Claims): FloorCell[] {
    const ids = interiorIds(a);
    const cells = floorCells(a, ids, roomLayout(a, ids, events.warps), claims);
    for (const c of cells) claims.claim(c.i, CLAIM_SURFACE);
    return cells;
  },

  build(cells: FloorCell[], { a, events }: SemanticContext, kit: KitContext): THREE.Object3D | null {
    const group = new THREE.Group();
    group.name = 'interiorFloor';
    if (cells.length) {
      const tex = floorTexture(a, cells);
      kit.disposables.push(tex);
      const km = kitMaterial(kit.uniforms, interiorFloorMaterial(tex, new THREE.Vector2(a.minX, a.minY), new THREE.Vector2(a.GW, a.GH)));
      const mesh = new THREE.Mesh(floorGeometry(a, cells), km.material);
      mesh.name = 'floor';
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      group.add(mesh);
    }
    const L = roomLayout(a, interiorIds(a), events.warps);
    const shafts = shaftGeometry(L, glazedWindows(a, L));
    if (shafts) {
      const mesh = new THREE.Mesh(shafts, kitMaterial(kit.uniforms, roomShaftMaterial(SHAFT_ALPHA)).material);
      mesh.name = 'shafts';
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      // after the other transparent draws (blob and contact shadows, cards), so none blends over the added light (the
      // glass is opaque: its fade is a dithered discard, it draws in the opaque pass)
      mesh.renderOrder = 1;
      // (every window is in the back wall, N: the shafts are cut away with it — no light from a hidden window)
      mesh.userData.wallDir = 'N';
      group.add(mesh);
    }
    return group.children.length ? group : null;
  },
};

/** A 1×1 cell texture for the catalogue's floor (its program only: never drawn). */
function placeholder(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  t.needsUpdate = true;
  return t;
}

/** The floor's material kinds: interiorFloorMaterial PN no cast; roomShaftMaterial PNC no cast. */
export const FLOOR_CATALOGUE: readonly InteriorCatalogueEntry[] = [
  { material: interiorFloorMaterial(placeholder(),new THREE.Vector2(), new THREE.Vector2(1, 1)), attrs: { position: 3, normal: 3 }, castShadow: false },
  { material: roomShaftMaterial(SHAFT_ALPHA), attrs: { position: 3, normal: 3, color: 3 }, castShadow: false },
];
