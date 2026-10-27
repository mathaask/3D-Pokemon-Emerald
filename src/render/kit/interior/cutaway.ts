// The interior cutaway (Phase 4, D5), pure: walls are built in four meshes by direction (their inner face looking into
// the room: N = the back wall, looking south); per frame a direction is hidden when the camera's horizontal back
// direction (`uCamBack`: from the target towards the camera) points at its outer side. At the default yaw the south
// (front) walls vanish, as the GBA shows none; when the user orbits, the near walls vanish instead.

import type { WallDir } from './room';
import type { V2 } from './wallParts';

/** Each wall direction's inner normal (into the room), world x / z. */
export const INNER_NORMAL: Readonly<Record<WallDir, V2>> = { N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0] };

/** A wall is hidden when its inner normal · camBack falls below this (the camera on its outer side). */
export const CUTAWAY_DOT = -0.25;

/** Whether walls of direction `dir` stay visible with the camera's horizontal back direction `camBack` (x = world x,
 *  y = world z; kitUniforms.uCamBack). */
export function wallVisible(dir: WallDir, camBack: { x: number; y: number }): boolean {
  const n = INNER_NORMAL[dir];
  return n[0] * camBack.x + n[1] * camBack.y >= CUTAWAY_DOT;
}
