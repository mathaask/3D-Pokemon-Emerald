// The arena's look: the light, fog and sky values a Modern arena of a kind is drawn with — outdoor and water arenas on the
// overworld's time of day (overworld/timeOfDay.ts: a battle at dusk is lit like the route it started on, D11), caves,
// the sea floor and rooms by their own. The battle's light set never changes (sun with shadow, hemisphere light,
// THREE.Fog): only these values do. Colours are linear.

import * as THREE from 'three';
import { toLinear } from '../kit/palette';
import { timeOfDay, nightFactor, type DayLight } from '../overworld/timeOfDay';
import { ARENA_SETTING, type ArenaKind } from './arenaKind';
import type { ArenaPalette } from './palette';

export interface ArenaLook {
  sunColor: THREE.Color; sunI: number; sky: THREE.Color; hemiI: number; hemiGround: THREE.Color;
  fog: THREE.Color; fogNear: number; fogFar: number;
  night: number;      // kit uNight
  clouds: number;     // cloud-shadow / reflection strength (0..1)
  caustics: number;   // seabed caustics (0..1)
}

/** Today's indoor battle light (BattleView: sun 1.6, hemisphere 1.6), in the overworld's warm indoor whites. */
const INDOOR = { sun: new THREE.Color(1.0, 0.95, 0.85), sunI: 1.6, sky: new THREE.Color(1.0, 0.97, 0.92), hemiI: 1.6 };

const _day: DayLight = { sunColor: new THREE.Color(), sunI: 0, sky: new THREE.Color(), hemiI: 0, fog: new THREE.Color() };
/** 1 / the daytime sky colour of the overworld's keyframes (9:00–16:00: (0.75, 0.88, 1.0)). */
const DAY_SKY_INV = new THREE.Color(1 / 0.75, 1 / 0.88, 1);
const _c = new THREE.Color();
/** A palette's colours the look reads, linear (computed once per palette: no allocation per frame). */
const LINEAR = new WeakMap<ArenaPalette, { wall: THREE.Color; ground: THREE.Color }>();
function linearOf(p: ArenaPalette): { wall: THREE.Color; ground: THREE.Color } {
  let l = LINEAR.get(p);
  if (!l) LINEAR.set(p, (l = { wall: new THREE.Color(...toLinear(p.wall)), ground: new THREE.Color(...toLinear(p.ground)) }));
  return l;
}

/** A new look (arenaLook's `out`). */
function blankLook(): ArenaLook {
  return { sunColor: new THREE.Color(), sunI: 0, sky: new THREE.Color(), hemiI: 0, hemiGround: new THREE.Color(), fog: new THREE.Color(),
    fogNear: 0, fogFar: 0, night: 0, clouds: 0, caustics: 0 };
}

/** outdoor and water settings: timeOfDay(hour), night = nightFactor(hour), fog 30..80, clouds 1; sky (rayquaza): the
 *  same with the fog lerped 0.5 towards the backdrop, fog 25..90; underwater: sun (0.55, 0.8, 1.0) × 1.2, sky (0.3, 0.6,
 *  0.9), hemi 1.2, fog (0.05, 0.22, 0.42) 10..38, caustics 1; cave: sun (1.0, 0.85, 0.7) × 0.9, sky (0.55, 0.5, 0.6),
 *  hemi 1.2, fog = new THREE.Color(...toLinear(palette.wall)) × 0.12, 14..40 (groudon: fog (0.18, 0.07, 0.04),
 *  sun (1.0, 0.6, 0.35)); indoor: today's indoor battle light (sun 1.6, hemi 1.6) in warm white,
 *  fog = new THREE.Color(...toLinear(palette.wall)) × 0.6, 22..60, night 0.
 *  hemiGround = new THREE.Color(...toLinear(palette.ground)) × 0.6 (outdoors × the hour's sky / the day's sky: the
 *  ground bounces the light it gets). (toLinear: kit/palette.ts, sRGB RGB → linear RGB.)
 *  Into `out` (default a new one): no allocation per frame. */
export function arenaLook(kind: ArenaKind, palette: ArenaPalette, hour: number, out: ArenaLook = blankLook()): ArenaLook {
  const o = out, lin = linearOf(palette);
  o.night = 0;
  o.clouds = 0;
  o.caustics = 0;
  switch (ARENA_SETTING[kind]) {
    case 'outdoor': case 'water': case 'sky': {
      const d = timeOfDay(hour, _day);
      o.sunColor.copy(d.sunColor);
      o.sunI = d.sunI;
      o.sky.copy(d.sky);
      o.hemiI = d.hemiI;
      o.fog.copy(d.fog);
      o.night = nightFactor(hour);
      o.clouds = 1;
      o.fogNear = 30;
      o.fogFar = 80;
      if (ARENA_SETTING[kind] === 'sky') {
        o.fog.lerp(lin.wall, 0.5);
        o.fogNear = 25;
        o.fogFar = 90;
      }
      break;
    }
    case 'underwater':
      o.sunColor.setRGB(0.55, 0.8, 1.0);
      o.sunI = 1.2;
      o.sky.setRGB(0.3, 0.6, 0.9);
      o.hemiI = 1.2;
      o.fog.setRGB(0.05, 0.22, 0.42);
      o.fogNear = 10;
      o.fogFar = 38;
      o.caustics = 1;
      break;
    case 'cave':
      if (kind === 'groudon') {
        o.sunColor.setRGB(1.0, 0.6, 0.35);
        o.fog.setRGB(0.18, 0.07, 0.04);
      } else {
        o.sunColor.setRGB(1.0, 0.85, 0.7);
        o.fog.copy(lin.wall).multiplyScalar(0.12);
      }
      o.sunI = 0.9;
      o.sky.setRGB(0.55, 0.5, 0.6);
      o.hemiI = 1.2;
      o.fogNear = 14;
      o.fogFar = 40;
      break;
    case 'indoor':
      o.sunColor.copy(INDOOR.sun);
      o.sunI = INDOOR.sunI;
      o.sky.copy(INDOOR.sky);
      o.hemiI = INDOOR.hemiI;
      o.fog.copy(lin.wall).multiplyScalar(0.6);
      o.fogNear = 22;
      o.fogFar = 60;
      break;
  }
  o.hemiGround.copy(lin.ground).multiplyScalar(0.6);
  // (outdoors the ground bounces the hour's sky: as given by day — the day sky is DAY_SKY —, dim and blue at night, warm
  // at sunset; a constant green bounce tinted the battlers' undersides green under the moon)
  if (o.clouds > 0) o.hemiGround.multiply(_c.copy(o.sky).multiply(DAY_SKY_INV));
  return o;
}
