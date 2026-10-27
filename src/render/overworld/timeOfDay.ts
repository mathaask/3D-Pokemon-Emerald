// The outdoor light over the day: the overworld's keyframes (sun colour and intensity, sky, hemisphere intensity, fog)
// and the night ramp of its window glow, moved here unchanged from OverworldView.updateLighting so the battle's arenas
// (battle/look.ts) light an outdoor battle exactly as the route it started on (D11). Colours are linear (THREE.Color's
// components as given).

import * as THREE from 'three';

export interface DayLight { sunColor: THREE.Color; sunI: number; sky: THREE.Color; hemiI: number; fog: THREE.Color }

/** hour, sunColor, sunI, sky, hemiI, fog (the keyframes, blended linearly between neighbours). */
type Key = [number, THREE.Color, number, THREE.Color, number, THREE.Color];
const KEYS: readonly Key[] = [
  [0, new THREE.Color(0.55, 0.65, 1.0), 0.55, new THREE.Color(0.25, 0.32, 0.6), 0.75, new THREE.Color(0.05, 0.07, 0.16)],
  [5, new THREE.Color(0.6, 0.65, 1.0), 0.6, new THREE.Color(0.3, 0.35, 0.62), 0.8, new THREE.Color(0.1, 0.12, 0.22)],
  [6.5, new THREE.Color(1.0, 0.7, 0.5), 1.6, new THREE.Color(0.85, 0.75, 0.8), 1.0, new THREE.Color(0.95, 0.75, 0.65)],
  [9, new THREE.Color(1.0, 0.95, 0.88), 2.4, new THREE.Color(0.75, 0.88, 1.0), 1.15, new THREE.Color(0.8, 0.9, 1.0)],
  [16, new THREE.Color(1.0, 0.95, 0.85), 2.3, new THREE.Color(0.75, 0.88, 1.0), 1.15, new THREE.Color(0.82, 0.9, 1.0)],
  [18, new THREE.Color(1.0, 0.52, 0.22), 2.0, new THREE.Color(1.0, 0.62, 0.45), 0.95, new THREE.Color(1.0, 0.55, 0.32)],
  [19.5, new THREE.Color(0.85, 0.45, 0.55), 0.9, new THREE.Color(0.55, 0.4, 0.65), 0.85, new THREE.Color(0.4, 0.25, 0.42)],
  [21, new THREE.Color(0.55, 0.65, 1.0), 0.55, new THREE.Color(0.25, 0.32, 0.6), 0.75, new THREE.Color(0.05, 0.07, 0.16)],
  [24, new THREE.Color(0.55, 0.65, 1.0), 0.55, new THREE.Color(0.25, 0.32, 0.6), 0.75, new THREE.Color(0.05, 0.07, 0.16)],
];

/** The outdoor keyframe blend (hour, sun colour, sun intensity, sky, hemisphere intensity, fog) at time of day `tod`
 *  (0..24), into `out` (default a new one; its colours are overwritten, never shared with the keyframes). */
export function timeOfDay(tod: number, out?: DayLight): DayLight {
  const d = out ?? { sunColor: new THREE.Color(), sunI: 0, sky: new THREE.Color(), hemiI: 0, fog: new THREE.Color() };
  let k = 0;
  while (k < KEYS.length - 2 && tod >= KEYS[k + 1][0]) k++;
  const [h0, sc0, si0, sk0, hi0, f0] = KEYS[k];
  const [h1, sc1, si1, sk1, hi1, f1] = KEYS[k + 1];
  const t = THREE.MathUtils.clamp((tod - h0) / (h1 - h0), 0, 1);
  d.sunColor.copy(sc0).lerp(sc1, t);
  d.sunI = si0 + (si1 - si0) * t;
  d.sky.copy(sk0).lerp(sk1, t);
  d.hemiI = hi0 + (hi1 - hi0) * t;
  d.fog.copy(f0).lerp(f1, t);
  return d;
}

/** Window glow / night factor: clamp(max((tod − 18.3) / 1.5, (6.2 − tod) / 1.2), 0, 1) — fades in after sunset, out after
 *  sunrise. */
export function nightFactor(tod: number): number {
  return THREE.MathUtils.clamp(Math.max((tod - 18.3) / 1.5, (6.2 - tod) / 1.2), 0, 1);
}

/** An in-scope room's light (D8): the sun's colour and intensity, the hemisphere's sky / ground colours and intensity
 *  (linear). The sun's direction stays as today (tod 12 indoors). */
export interface IndoorLight { sunColor: THREE.Color; sunI: number; sky: THREE.Color; ground: THREE.Color; hemiI: number }

/** Today's indoor values (updateLighting's indoor branch, moved here unchanged): sun (1, 0.95, 0.85) × 1.5, sky
 *  (1, 0.97, 0.92), ground (0.55, 0.5, 0.45), hemisphere × 1.7. Never mutate its colours (copy them). */
export const INDOOR_DAY: Readonly<IndoorLight> = Object.freeze({
  sunColor: new THREE.Color(1.0, 0.95, 0.85), sunI: 1.5,
  sky: new THREE.Color(1.0, 0.97, 0.92), ground: new THREE.Color(0.55, 0.5, 0.45), hemiI: 1.7,
});

/** The lamp-lit night of an in-scope room (D8, tuned against `nightLum` in Task 6 Step 6): a warm, dimmed sun and sky. */
export const INDOOR_NIGHT: Readonly<IndoorLight> = Object.freeze({
  sunColor: new THREE.Color(1.0, 0.72, 0.45), sunI: 0.6,
  sky: new THREE.Color(0.95, 0.78, 0.6), ground: new THREE.Color(0.4, 0.32, 0.26), hemiI: 1.0,
});

/** INDOOR_DAY blended towards INDOOR_NIGHT by nightK (0..1, clamped), into `out` (default a new one; its colours are
 *  overwritten, never shared with the constants); nightK = 0 returns INDOOR_DAY's values exactly. */
export function indoorLight(nightK: number, out?: IndoorLight): IndoorLight {
  const d = out ?? { sunColor: new THREE.Color(), sunI: 0, sky: new THREE.Color(), ground: new THREE.Color(), hemiI: 0 };
  const k = THREE.MathUtils.clamp(nightK, 0, 1);
  const D = INDOOR_DAY, N = INDOOR_NIGHT;
  d.sunColor.copy(D.sunColor).lerp(N.sunColor, k);
  d.sunI = D.sunI + (N.sunI - D.sunI) * k;
  d.sky.copy(D.sky).lerp(N.sky, k);
  d.ground.copy(D.ground).lerp(N.ground, k);
  d.hemiI = D.hemiI + (N.hemiI - D.hemiI) * k;
  return d;
}

/** The actors' light floor at night in an in-scope room, as a share of the day's charLight (D8): their charLight is per
 *  channel max(the blended light's, ACTOR_NIGHT_FLOOR × INDOOR_DAY's), so characters stay as readable as by day. */
export const ACTOR_NIGHT_FLOOR = 0.95;
