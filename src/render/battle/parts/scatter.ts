// Scattering the arena's scenery: seeded dart throwing in an annulus around the stage (deterministic: the same seed and
// options give the same points), and the stage's keep-outs — the platforms, and the tall rule that keeps anything tall
// out of the battle camera's way. The camera (BattleView) stands ≈ 11 units in front of the stage (+z), 3.6 up, looking
// 16.55° down; it swings to ±0.9 yaw (plus its sway and focus nudge) and never frames the horizon (D1): it sees the ground
// band up to ≈ 42 units behind the stage and, at its top edge, what rises there.

import * as THREE from 'three';
import { rng } from '../../kit/geom';
import { BATTLE_CAMERA, PLATFORM_FOOTPRINT, PX, REF_PITCH, type Stage } from '../stage';

export interface Ellipse { x: number; z: number; rx: number; rz: number }
export interface ScatterOptions {
  centre: { x: number; z: number }; r0: number; r1: number; count: number; minGap: number;
  keepOut?: readonly Ellipse[]; accept?: (x: number, z: number) => boolean;
}

/** Dart throws per point before it is given up. */
const TRIES = 30;

/** Whether (x, z) lies inside ellipse `e` (its boundary is outside). */
export const insideEllipse = (e: Ellipse, x: number, z: number) => ((x - e.x) / e.rx) ** 2 + ((z - e.z) / e.rz) ** 2 < 1;

/** Seeded dart throwing (≤ 30 tries per point) in the annulus r0..r1 around `centre`, ≥ minGap apart, outside every
 *  keep-out; deterministic. Darts land uniformly by area; a point whose 30 tries all miss is skipped (so fewer than
 *  `count` come back where the annulus fills up). */
export function scatter(seed: number, o: ScatterOptions): { x: number; z: number }[] {
  const r = rng(seed);
  const out: { x: number; z: number }[] = [];
  // (a grid of minGap cells over the annulus' square: a dart checks the 5×5 cells around it)
  const cell = Math.max(o.minGap, 1e-3), n = Math.ceil((2 * o.r1) / cell) + 1;
  const grid = new Map<number, number[]>();
  const x0 = o.centre.x - o.r1, z0 = o.centre.z - o.r1;
  const gap2 = o.minGap * o.minGap;
  const free = (x: number, z: number): boolean => {
    const ci = Math.floor((x - x0) / cell), cj = Math.floor((z - z0) / cell);
    for (let j = cj - 2; j <= cj + 2; j++) {
      for (let i = ci - 2; i <= ci + 2; i++) {
        const list = grid.get(j * n + i);
        if (!list) continue;
        for (const k of list) if ((out[k].x - x) ** 2 + (out[k].z - z) ** 2 < gap2) return false;
      }
    }
    return true;
  };
  const a2 = o.r0 * o.r0, b2 = o.r1 * o.r1;
  for (let p = 0; p < o.count; p++) {
    for (let t = 0; t < TRIES; t++) {
      const rad = Math.min(o.r1, Math.max(o.r0, Math.sqrt(a2 + r() * (b2 - a2)))), ang = r() * Math.PI * 2;
      const x = o.centre.x + Math.cos(ang) * rad, z = o.centre.z + Math.sin(ang) * rad;
      if (o.keepOut && o.keepOut.some((e) => insideEllipse(e, x, z))) continue;
      if (o.accept && !o.accept(x, z)) continue;
      if (!free(x, z)) continue;
      const key = Math.floor((z - z0) / cell) * n + Math.floor((x - x0) / cell);
      const list = grid.get(key);
      if (list) list.push(out.length); else grid.set(key, [out.length]);
      out.push({ x, z });
      break;
    }
  }
  return out;
}

/** The seed every arena's scenery is placed with (one arena per kind: always the same). The flora, the dunes and the rocks
 *  must agree on it — the palms keep off the dunes, the rocks off the trees and onto the dunes. */
export const SCENERY_SEED = 1;

/** The yaw the battle camera reaches once its intro is done: the user's ±0.9, its sway (0.04) and its focus nudge (0.06).
 *  (The intro sweep starts 0.5 further, at yaw + 0.5, 1.5× as far and 0.06 steeper, and eases in over 2.2 s: with the
 *  user's yaw past +0.4 its first frames stand beyond this wedge, on the +x side, where a tall thing beside the stage may
 *  pass between it and the stage for a moment. The tall rule keeps to the settled camera.) */
const CAMERA_YAW = 1.0;
/** The battle camera's vertical field of view (BATTLE_CAMERA: 24°) and its pitch once settled (REF_PITCH − 0.13). */
const CAMERA_FOV = THREE.MathUtils.degToRad(BATTLE_CAMERA.fov), CAMERA_PITCH = REF_PITCH - BATTLE_CAMERA.pitchDrop;

/** Where the battle camera stands at yaw `yaw` (BattleView.update's camera with no focus: the user's yaw plus its sway),
 *  at `ease` through its intro sweep (default 1: done — the lowest it stands; at 0, its first frame: yaw + 0.5, 1.5× as
 *  far, 0.06 steeper — the sight lines to the near platform run flatter there) and the user's `zoom` (default 1; 0.6–1.6:
 *  its distance × zoom), and the point it looks at. (tests/battleCamera.test.ts holds it to BattleView's.) */
export function battleCamera(stage: Stage, yaw: number, out = new THREE.Vector3(), look = new THREE.Vector3(), ease = 1,
  zoom = 1): THREE.Vector3 {
  const C = BATTLE_CAMERA;
  stage.at(120, 82, (stage.playerDepth + stage.enemyDepth) / 2, look);
  const y = yaw + (1 - ease) * C.intro.yaw;
  const dist = ((80 / PX) / Math.tan(CAMERA_FOV / 2)) * zoom * (1 + (1 - ease) * C.intro.dist), pitch = CAMERA_PITCH + (1 - ease) * C.intro.pitch;
  return out.set(Math.sin(y) * Math.cos(pitch), Math.sin(pitch), Math.cos(y) * Math.cos(pitch)).multiplyScalar(dist).add(look);
}
/** A tall thing stands at least this far from the stage centre, no further forward than `front`, and at least
 *  `clearance` from the camera's line of sight to the stage at any yaw (its crown's half width, with room). */
const TALL = { r: 10, front: 4, clearance: 3 };

/** Both platform footprints × 1.25 (ellipses) and the tall rule: a tall thing (> 1 unit) stands at r ≥ 10 from the
 *  centre and z ≤ centre.z + 4, never between the camera (any yaw in ±0.9) and the stage. */
export function stageKeepOut(stage: Stage): { ellipses: Ellipse[]; tallOk(x: number, z: number): boolean } {
  const fp = PLATFORM_FOOTPRINT;
  const ellipses: Ellipse[] = [
    { x: stage.player.x, z: stage.player.z, rx: fp.player.rx * 1.25, rz: fp.player.rz * 1.25 },
    { x: stage.enemy.x, z: stage.enemy.z, rx: fp.enemy.rx * 1.25, rz: fp.enemy.rz * 1.25 },
  ];
  const cx = stage.centre.x, cz = stage.centre.z;
  const look = new THREE.Vector3(), cam = battleCamera(stage, 0, new THREE.Vector3(), look);
  const reach = Math.hypot(cam.x - look.x, cam.z - look.z);
  const tallOk = (x: number, z: number): boolean => {
    if (Math.hypot(x - cx, z - cz) < TALL.r || z > cz + TALL.front) return false;
    // the camera's sight lines: from the point it looks at to where it stands at any yaw in ±CAMERA_YAW — a point within
    // the swept wedge, or `clearance` of its edges, short of the camera, is in its way
    const dx = x - look.x, dz = z - look.z, d = Math.hypot(dx, dz), a = Math.atan2(dx, dz);
    if (d > reach + TALL.clearance) return true;
    if (Math.abs(a) <= CAMERA_YAW) return false;
    const off = Math.abs(a) - CAMERA_YAW;
    return d * Math.sin(Math.min(off, Math.PI / 2)) >= TALL.clearance;
  };
  return { ellipses, tallOk };
}

/** Yaws the sight cap and the frame top check the camera at (the user's ±0.9, in steps), and the intro sweep's steps
 *  (ease 1: settled … 0: its first frame). */
const SIGHT_YAWS = Array.from({ length: 13 }, (_, i) => -0.9 + (1.8 * i) / 12);
const SIGHT_EASES = [1, 0.75, 0.5, 0.25, 0];
/** The sight cap stays this far under the sight line. */
const SIGHT_MARGIN = 0.04;

/** The highest a thing standing at (x, z) may reach (world y) without hiding a platform's top from the battle camera at
 *  any yaw in ±0.9, settled or anywhere in its intro sweep (battleCamera: the sweep stands 1.5× as far, and its sight
 *  lines to the player's near edge run flatter): below the sight line from the camera to the nearer edge of each
 *  platform top (y = 0) it stands in front of. Infinity where it stands in front of none. (The battlers stand on the tops,
 *  higher and further: under that line they stay whole too.) */
export function sightCap(stage: Stage): (x: number, z: number) => number {
  const fp = PLATFORM_FOOTPRINT;
  const tops = [{ p: stage.player, rx: fp.player.rx, rz: fp.player.rz }, { p: stage.enemy, rx: fp.enemy.rx, rz: fp.enemy.rz }];
  const cams = SIGHT_EASES.flatMap((e) => SIGHT_YAWS.map((y) => battleCamera(stage, y, new THREE.Vector3(), new THREE.Vector3(), e)));
  return (x, z) => {
    let cap = Infinity;
    for (const c of cams) {
      const ux = x - c.x, uz = z - c.z, dq = Math.hypot(ux, uz);
      if (dq < 1e-6) continue;
      for (const t of tops) {
        // the horizontal ray camera → (x, z) against the top's ellipse: its near hit beyond (x, z)
        const dx = (c.x - t.p.x) / t.rx, dz = (c.z - t.p.z) / t.rz, vx = ux / dq / t.rx, vz = uz / dq / t.rz;
        const A = vx * vx + vz * vz, B = 2 * (dx * vx + dz * vz), C = dx * dx + dz * dz - 1;
        const disc = B * B - 4 * A * C;
        if (disc < 0) continue;
        const near = (-B - Math.sqrt(disc)) / (2 * A);
        if (near <= dq) continue;
        cap = Math.min(cap, c.y * (1 - dq / near) - SIGHT_MARGIN);
      }
    }
    return cap;
  };
}

/** The frame's top edge dips this far below the horizontal (the settled camera's pitch less half its field of view), and
 *  the frame reaches this far to either side of the view (half the horizontal field of view of a 16:9 window, and a
 *  crown's width more). */
const FRAME_DIP = CAMERA_PITCH - CAMERA_FOV / 2;
const FRAME_SIDE = Math.atan(Math.tan(CAMERA_FOV / 2) * (16 / 9)) + 0.1;

/** The height (world y) of the frame's top edge over (x, z): the lowest over the settled cameras at `yaws` (default the
 *  user's ±0.9) that frame the point across (its horizontal angle off the view within FRAME_SIDE) — what stands above it
 *  there never shows, at any of them. Infinity where none frames it. (The intro sweep stands higher: it frames more.) */
export function frameTop(stage: Stage, yaws: readonly number[] = SIGHT_YAWS): (x: number, z: number) => number {
  const views = yaws.map((y) => {
    const look = new THREE.Vector3(), cam = battleCamera(stage, y, new THREE.Vector3(), look);
    return { cam, dir: Math.atan2(look.x - cam.x, look.z - cam.z) };
  });
  const dip = Math.tan(FRAME_DIP);
  return (x, z) => {
    let top = Infinity;
    for (const { cam, dir } of views) {
      const dx = x - cam.x, dz = z - cam.z;
      let off = Math.atan2(dx, dz) - dir;
      off = Math.atan2(Math.sin(off), Math.cos(off));
      if (Math.abs(off) > FRAME_SIDE) continue;
      // (the depth along the view: the frame's top edge dips by it)
      top = Math.min(top, cam.y - Math.hypot(dx, dz) * Math.cos(off) * dip);
    }
    return top;
  };
}

/** The settled battle camera at user yaw `yaw` (battleCamera, its 24° field of view; `aspect` the window's, default the
 *  harness's 1280 × 800) as a projection: world (x, y, z) → normalised device coordinates into `out` (x, y in −1..1
 *  inside the frame, z < 1 in front of the camera). */
export function frameProjector(stage: Stage, yaw: number, aspect = 1.6): (x: number, y: number, z: number, out: THREE.Vector3) => THREE.Vector3 {
  const look = new THREE.Vector3(), cam = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(CAMERA_FOV), aspect, 0.1, 400);
  cam.position.copy(battleCamera(stage, yaw, new THREE.Vector3(), look));
  cam.lookAt(look);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return (x, y, z, out) => out.set(x, y, z).project(cam);
}
