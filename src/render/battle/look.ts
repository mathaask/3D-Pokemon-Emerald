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
const LINEAR = new WeakMap<ArenaPalette, { wall: THREE.Color; ground: THREE.Color; rock: THREE.Color }>();
function linearOf(p: ArenaPalette): { wall: THREE.Color; ground: THREE.Color; rock: THREE.Color } {
  let l = LINEAR.get(p);
  if (!l) {
    LINEAR.set(p, (l = { wall: new THREE.Color(...toLinear(p.wall)), ground: new THREE.Color(...toLinear(p.ground)),
      rock: new THREE.Color(...toLinear(p.rock)) }));
  }
  return l;
}

/** The caves' light (Task 9; linear): the cave and the cave pond a warm, dim light over their tan rock, the fog their rock
 *  darkened (`fog`: × the palette's rock); Groudon's red-orange over volcanic rock in a red-brown haze; Kyogre's cool
 *  blue-grey over its dark water. (Before Task 9 every cave had sun (1.0, 0.85, 0.7) × 0.9 — Groudon's (1.0, 0.6, 0.35) —,
 *  sky (0.55, 0.5, 0.6) × 1.2 and fog the backdrop × 0.12 — Groudon's (0.18, 0.07, 0.04) —, 14..40: a murky olive cave,
 *  Kyogre's top band olive.) */
interface CaveLight { sun: THREE.Color; sunI: number; sky: THREE.Color; hemiI: number; fog: number | THREE.Color; near: number; far: number }
const WARM_CAVE: CaveLight = { sun: new THREE.Color(1.0, 0.93, 0.84), sunI: 1.8, sky: new THREE.Color(0.84, 0.81, 0.78), hemiI: 1.6,
  fog: 0.45, near: 18, far: 50 };
export const CAVE_LIGHT: Readonly<Partial<Record<ArenaKind, CaveLight>>> = {
  cave: WARM_CAVE,
  cavePond: WARM_CAVE,
  groudon: { sun: new THREE.Color(1.0, 0.78, 0.6), sunI: 1.7, sky: new THREE.Color(0.85, 0.66, 0.58), hemiI: 1.5,
    fog: new THREE.Color(0.16, 0.06, 0.035), near: 15, far: 46 },
  kyogre: { sun: new THREE.Color(0.85, 0.93, 1.0), sunI: 1.5, sky: new THREE.Color(0.6, 0.7, 0.82), hemiI: 1.5,
    fog: new THREE.Color(0.1, 0.16, 0.2), near: 20, far: 58 },
};

/** A new look (arenaLook's `out`). */
function blankLook(): ArenaLook {
  return { sunColor: new THREE.Color(), sunI: 0, sky: new THREE.Color(), hemiI: 0, hemiGround: new THREE.Color(), fog: new THREE.Color(),
    fogNear: 0, fogFar: 0, night: 0, clouds: 0, caustics: 0 };
}

/** outdoor and water settings: timeOfDay(hour), night = nightFactor(hour), fog 30..80, clouds 1; sky (rayquaza): the
 *  same with the fog lerped 0.5 towards the backdrop, fog 25..90; underwater: sun (0.7, 0.95, 1.0) × 1.7, sky (0.5, 0.82,
 *  0.95), hemi 1.7, fog (0.3, 0.64, 0.8) 10..42, caustics 1; cave (cave, cavePond, groudon, kyogre): CAVE_LIGHT;
 *  indoor: today's indoor battle light (sun 1.6, hemi 1.6) in warm white,
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
      // (tuned at Task 8's reviews from sun (0.55, 0.8, 1.0) × 1.2, sky (0.3, 0.6, 0.9), hemi 1.2, fog (0.05, 0.22, 0.42)
      // 10..38 — a deep blue floor, its kelp and light shafts lost in the haze —, then from a warm white light over warm
      // sand, the haze from 13 units — a murky grey-olive lake bed: a bright, clear sea in the GBA's pale blues, cyan light
      // over pale turquoise sand, a light turquoise haze from just behind the player's battler on: from 5.5 the battlers
      // stood in it, their outlines grey-teal; the camera stands 9.97 from the player's platform, 13.8 from the enemy's)
      o.sunColor.setRGB(0.7, 0.95, 1.0);
      o.sunI = 1.7;
      o.sky.setRGB(0.5, 0.82, 0.95);
      o.hemiI = 1.7;
      o.fog.setRGB(0.3, 0.64, 0.8);
      o.fogNear = 10;
      o.fogFar = 42;
      o.caustics = 1;
      break;
    case 'cave': {
      // (a cave kind without a light of its own: the warm cave's — never a throw in the per-frame look)
      const c = CAVE_LIGHT[kind] ?? WARM_CAVE;
      o.sunColor.copy(c.sun);
      o.sunI = c.sunI;
      o.sky.copy(c.sky);
      o.hemiI = c.hemiI;
      if (typeof c.fog === 'number') o.fog.copy(lin.rock).multiplyScalar(c.fog);
      else o.fog.copy(c.fog);
      o.fogNear = c.near;
      o.fogFar = c.far;
      break;
    }
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
