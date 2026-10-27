// Window light shafts (Phase 4, D8: off at night through uOutdoorNight). Placeholders (Task 6); Task 8 fills them.

import type * as THREE from 'three';
import type { KitMaterialOptions } from '../materials';
import type { RoomLayout } from './room';

/** Placeholder (Task 8: transparent, depthWrite false, AdditiveBlending, daylight × (1 − uOutdoorNight), hookKey
 *  'roomShaft'). */
export function roomShaftMaterial(_alpha: number): KitMaterialOptions {
  throw new Error('roomShaftMaterial: Task 8');
}

/** Placeholder (Task 8: one soft strip per window feature, from its glass down into the room). Draws none yet. */
export function shaftGeometry(_L: RoomLayout): THREE.BufferGeometry | null {
  return null;
}
