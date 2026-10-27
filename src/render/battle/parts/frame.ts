// The battle's frame: the battle camera (scatter.ts battleCamera) as the camera a frame is seen with, and the battlers in
// it — what the arena places against the frame keeps off them: the lava pools (rock.ts), the stadiums' props and spikes
// (stadium.ts), the halls' furniture and the Sky Pillar's stumps (their tests); the cloud sea is kept to the frames it
// shows in (skyPillar.ts cloudShown). One construction for all of them: a copy of the camera or of the box drifts.
// (This module reads scatter.ts only inside its functions: scatter.ts may import it back.)

import * as THREE from 'three';
import { BATTLE_CAMERA, type Stage } from '../stage';
import { FRAME_ASPECT, battleCamera, type CameraView } from './scatter';

/** The battle camera at `view` (battleCamera; a bare number is a yaw, settled at zoom 1) in a window of aspect `aspect`
 *  (default FRAME_ASPECT.shown, the harness's 1280 × 800: the frame what must show is placed in): a PerspectiveCamera at
 *  the battle's vertical field of view (BATTLE_CAMERA.fov, 24°), near 0.1, far 400, looking at the point battleCamera
 *  aims at, its matrices updated (ready to project). */
export function battleFrameCamera(stage: Stage, view: number | CameraView, aspect: number = FRAME_ASPECT.shown): THREE.PerspectiveCamera {
  const { yaw, ease, zoom } = typeof view === 'number' ? { yaw: view, ease: 1, zoom: 1 } : view;
  const look = new THREE.Vector3(), cam = new THREE.PerspectiveCamera(BATTLE_CAMERA.fov, aspect, 0.1, 400);
  cam.position.copy(battleCamera(stage, yaw, new THREE.Vector3(), look, ease, zoom));
  cam.lookAt(look);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

/** A rectangle in the frame, in normalised device coordinates: x0, y0, x1, y1 (−1..1 inside the frame). */
export type FrameRect = [number, number, number, number];

const _v = new THREE.Vector3();
/** The rectangle round `points` (world) as `cam` projects them. (A point behind the camera projects mirrored: keep them in
 *  front of it.) */
export function frameRect(cam: THREE.Camera, points: readonly (readonly [number, number, number])[]): FrameRect {
  const r: FrameRect = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y, z] of points) {
    _v.set(x, y, z).project(cam);
    r[0] = Math.min(r[0], _v.x); r[1] = Math.min(r[1], _v.y); r[2] = Math.max(r[2], _v.x); r[3] = Math.max(r[3], _v.y);
  }
  return r;
}

/** Whether two frame rectangles share area (rectangles that only touch do not). */
export function rectsOverlap(a: FrameRect, b: FrameRect): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

/** A battler as what is placed against the frame keeps off it: a box `half` either side, `depth` before and behind its
 *  platform's centre and `height` tall over its top (world units: a 64-px sprite is 2 wide). */
export const BATTLER_BOX = { half: 1.0, depth: 0.3, height: 2.0 } as const;

/** The battlers' boxes — BATTLER_BOX on the player's platform, then on the enemy's — as the settled battle camera at user
 *  yaw `yaw` (zoom 1) projects them in a window of aspect `aspect` (default FRAME_ASPECT.shown). */
export function battlerBoxes(stage: Stage, yaw: number, aspect: number = FRAME_ASPECT.shown): FrameRect[] {
  const cam = battleFrameCamera(stage, yaw, aspect), B = BATTLER_BOX;
  return [stage.player, stage.enemy].map((p) => frameRect(cam, [-B.half, B.half].flatMap((dx) => [-B.depth, B.depth].flatMap((dz) =>
    [0, B.height].map((y) => [p.x + dx, y, p.z + dz] as const)))));
}
