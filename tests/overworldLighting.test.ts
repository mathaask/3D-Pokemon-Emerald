// OverworldView.updateLighting's D8 wiring (Phase 4 final review I2): an in-scope Modern room whose interior kit ran
// follows the clock, everything else keeps today's fixed indoor light — tested on the method itself, over a stub view
// holding only the fields it reads (no GL, no emulator).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { OverworldView } from '../src/render/overworld/overworldView';
import { createKitUniforms } from '../src/render/kit/materials';
import {
  ACTOR_NIGHT_FLOOR, INDOOR_DAY, INDOOR_NIGHT, actorFloorShare, cardLight, indoorCardLight, indoorLight, nightFactor,
} from '../src/render/overworld/timeOfDay';
import { LIGHT_FLOOR } from '../src/render/actors/inflatedActors';

interface Lit {
  hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight; kitUniforms: ReturnType<typeof createKitUniforms>;
  charLight: THREE.Color; actorFloor: THREE.Color;
}

/** updateLighting on a stub view: `kitRan` the world's interiorKitRan, `mapType` 8 indoors (1 a town). */
function light(hour: number, { style = 'modern', kitRan = true, mapType = 8 }: { style?: string; kitRan?: boolean; mapType?: number } = {}): Lit {
  const view = Object.assign(Object.create(OverworldView.prototype), {
    mapType, style, world: { interiorKitRan: kitRan }, target: new THREE.Vector3(), zoom: 1, time: 0,
    sun: new THREE.DirectionalLight(), hemi: new THREE.HemisphereLight(), lantern: new THREE.PointLight(),
    kitUniforms: createKitUniforms(), indoorScratch: indoorLight(0), scene: { fog: new THREE.Fog(0, 1, 2) },
    sky: { setColors: () => {} }, weather: { flash: 0 },
    charLight: new THREE.Color(), actorFloor: new THREE.Color(), dayCard: new THREE.Color(),
  });
  const state = { hours: Math.floor(hour), minutes: Math.round((hour % 1) * 60), weather: 0, flashLevel: 0 };
  (view as { updateLighting(s: unknown): void }).updateLighting(state);
  return view as Lit;
}

const dayCard = indoorCardLight(INDOOR_DAY);
const rgb = (c: THREE.Color) => [c.r, c.g, c.b];

describe('updateLighting (D8 wiring)', () => {
  it('lights an in-scope room exactly as today by day (nightFactor 0)', () => {
    const lit = light(11), off = light(11, { kitRan: false });
    for (const v of [lit, off]) {
      expect(v.hemi.intensity).toBe(INDOOR_DAY.hemiI);
      expect(v.sun.intensity).toBe(INDOOR_DAY.sunI);
      expect(v.sun.color.equals(INDOOR_DAY.sunColor)).toBe(true);
      expect(v.hemi.color.equals(INDOOR_DAY.sky)).toBe(true);
      expect(v.hemi.groundColor.equals(INDOOR_DAY.ground)).toBe(true);
      expect(v.kitUniforms.uOutdoorNight.value).toBe(0);
      expect(rgb(v.charLight)).toEqual(rgb(dayCard));                 // bit for bit (the shared card-light helper)
      expect(rgb(v.actorFloor)).toEqual(rgb(dayCard));
    }
  });
  it('blends an in-scope room to the lamp-lit night at hour 21', () => {
    const v = light(21);
    expect(v.kitUniforms.uOutdoorNight.value).toBe(1);
    expect(v.hemi.intensity).toBe(INDOOR_NIGHT.hemiI);
    expect(v.sun.intensity).toBe(INDOOR_NIGHT.sunI);
    expect(v.sun.color.equals(INDOOR_NIGHT.sunColor)).toBe(true);
    expect(v.hemi.color.equals(INDOOR_NIGHT.sky)).toBe(true);
    // the cards floored at ACTOR_NIGHT_FLOOR of the day's light, the inflated actors' floor light at its share / LIGHT_FLOOR
    const room = cardLight(INDOOR_NIGHT.sky, INDOOR_NIGHT.hemiI, INDOOR_NIGHT.sunColor, INDOOR_NIGHT.sunI);
    const floor = actorFloorShare(1) / LIGHT_FLOOR;
    for (const c of ['r', 'g', 'b'] as const) {
      expect(v.charLight[c]).toBe(Math.max(room[c], dayCard[c] * ACTOR_NIGHT_FLOOR));
      expect(v.actorFloor[c]).toBe(Math.max(v.charLight[c], dayCard[c] * floor));
    }
    expect(v.charLight.r).toBeLessThan(dayCard.r);
  });
  it('applies the dusk blend at hour 19', () => {
    const v = light(19), k = nightFactor(19), L = indoorLight(k);
    expect(k).toBeGreaterThan(0.4); expect(k).toBeLessThan(0.5);
    expect(v.kitUniforms.uOutdoorNight.value).toBe(k);
    expect(v.hemi.intensity).toBe(L.hemiI);
    expect(v.sun.intensity).toBe(L.sunI);
    expect(v.hemi.intensity).toBeLessThan(INDOOR_DAY.hemiI); expect(v.hemi.intensity).toBeGreaterThan(INDOOR_NIGHT.hemiI);
  });
  it('keeps today\'s fixed light at night when the room is not lit: kit not run, Retro', () => {
    for (const v of [light(21, { kitRan: false }), light(21, { style: 'retro' })]) {
      expect(v.kitUniforms.uOutdoorNight.value).toBe(0);
      expect(v.hemi.intensity).toBe(INDOOR_DAY.hemiI);
      expect(v.sun.intensity).toBe(INDOOR_DAY.sunI);
      expect(rgb(v.charLight)).toEqual(rgb(dayCard));
      expect(rgb(v.actorFloor)).toEqual(rgb(dayCard));
    }
  });
  it('leaves outdoors alone (World runs no interior kit there): no room night, the actors\' floor their charLight', () => {
    const v = light(21, { mapType: 1, kitRan: false });
    expect(v.kitUniforms.uOutdoorNight.value).toBe(0);
    expect(v.kitUniforms.uNight.value).toBe(1);                 // the outdoor window glow
    expect(rgb(v.actorFloor)).toEqual(rgb(v.charLight));
  });
});
