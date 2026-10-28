// Classifies overworld sprites for 3D presentation, using the game's own sprite templates
// and callbacks: upright cards (characters, objects), flat ground decals (shadows, ripples,
// footprints), grass overlays, and sprites the 3D view replaces (reflections, weather).

import type { Mem } from './mem';
import type { SpriteSnap } from './state';
import { SYM } from './symbols';

export const enum SpriteKind { Upright, Flat, Grass, Hidden }

// Indices into gFieldEffectObjectTemplatePointers (include/constants/field_effects.h).
const FLDEFFOBJ = {
  SHADOW_S: 0, SHADOW_M: 1, SHADOW_L: 2, SHADOW_XL: 3, TALL_GRASS: 4, RIPPLE: 5,
  JUMP_TALL_GRASS: 10, SAND_FOOTPRINTS: 11, LONG_GRASS: 15, JUMP_LONG_GRASS: 16,
  REFLECTION_DISTORTION: 21, DEEP_SAND_FOOTPRINTS: 23, BIKE_TIRE_TRACKS: 27, SHORT_GRASS: 30,
  HOT_SPRINGS_WATER: 31,
};

const WEATHER_TEMPLATES = new Set<number>([
  SYM.sCloudSpriteTemplate, SYM.sRainSpriteTemplate, SYM.sSnowflakeSpriteTemplate, SYM.sFogHorizontalSpriteTemplate,
  SYM.sAshSpriteTemplate, SYM.sFogDiagonalSpriteTemplate, SYM.sSandstormSpriteTemplate, SYM.sBubbleSpriteTemplate,
]);

/** A rotating gate of the Fortree Gym / Trick House 6 (rotating_gate.c): a CreateSprite sprite, not an object event,
 *  known by its callback SpriteCallback_RotatingGate (compared without the Thumb bit). Its OAM is affine: the hardware
 *  turns the unrotated image in OBJ VRAM by the sprite's matrix (SpriteSnap.rotation). */
export function isRotatingGate(s: Pick<SpriteSnap, 'callback'>): boolean {
  return (s.callback & ~1) === (SYM.SpriteCallback_RotatingGate & ~1);
}

export class SpriteClassifier {
  private flat = new Set<number>();
  private grass = new Set<number>();
  private hidden = new Set<number>();

  constructor(mem: Mem) {
    const table = SYM.gFieldEffectObjectTemplatePointers;
    const t = (i: number) => mem.u32(table + i * 4);
    for (const i of [FLDEFFOBJ.SHADOW_S, FLDEFFOBJ.SHADOW_M, FLDEFFOBJ.SHADOW_L, FLDEFFOBJ.SHADOW_XL,
      FLDEFFOBJ.RIPPLE, FLDEFFOBJ.SAND_FOOTPRINTS, FLDEFFOBJ.DEEP_SAND_FOOTPRINTS, FLDEFFOBJ.BIKE_TIRE_TRACKS,
      FLDEFFOBJ.HOT_SPRINGS_WATER]) this.flat.add(t(i));
    for (const i of [FLDEFFOBJ.TALL_GRASS, FLDEFFOBJ.JUMP_TALL_GRASS, FLDEFFOBJ.LONG_GRASS,
      FLDEFFOBJ.JUMP_LONG_GRASS, FLDEFFOBJ.SHORT_GRASS]) this.grass.add(t(i));
    this.hidden.add(t(FLDEFFOBJ.REFLECTION_DISTORTION));
  }

  kind(s: SpriteSnap): SpriteKind {
    if ((s.callback & ~1) === SYM.UpdateObjectReflectionSprite) return SpriteKind.Hidden;
    if (WEATHER_TEMPLATES.has(s.template) || this.hidden.has(s.template)) return SpriteKind.Hidden;
    if (this.flat.has(s.template)) return SpriteKind.Flat;
    if (this.grass.has(s.template)) return SpriteKind.Grass;
    return SpriteKind.Upright;
  }
}
