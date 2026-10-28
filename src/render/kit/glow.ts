// A glowing prop's mesh (moved from battle/parts/rooms.ts in Phase 4: the battle's Frontier light panels and Phoebe's
// candle flames use it, the interiors' lamps and screens too).

import * as THREE from 'three';
import { kitMaterial, type KitMaterialOptions, type KitUniforms } from './materials';
import { PROP_GLOW } from './props';
import type { RGB } from './palette';

/** A mesh of `geometry` in `options` (default PROP_GLOW; the interiors' low furniture passes its no-fade twin,
 *  FURNITURE_GLOW_LOW), glowing `emissive` (linear) for its own draw only (PROP_GLOW's own glow is × uNight: none
 *  indoors): the Frontier's light panels, Phoebe's candle flames (stadium.ts), the interiors' screens and lamps. Its
 *  material is made here for it alone — the glow is right only for a material's single user: three re-uploads a
 *  material's uniforms (emissive among them) only when the material changes between draws, and the kit pool's
 *  configure() never resets `emissive`; the reset after the draw keeps the pooled material black for its next user
 *  (PROP_GLOW shares its pool with BUILDING_GLASS: one program). Never hand its material to another mesh. */
export function glowMesh(uniforms: KitUniforms, geometry: THREE.BufferGeometry, emissive: RGB,
  options: KitMaterialOptions = PROP_GLOW): THREE.Mesh {
  const material = kitMaterial(uniforms, options).material;
  const m = new THREE.Mesh(geometry, material);
  m.onBeforeRender = () => { material.emissive.setRGB(emissive[0], emissive[1], emissive[2]); };
  m.onAfterRender = () => { material.emissive.setRGB(0, 0, 0); };
  return m;
}
