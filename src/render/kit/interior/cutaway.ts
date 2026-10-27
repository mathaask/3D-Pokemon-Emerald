// The interior cutaway (Phase 4, D5), pure: walls are built in four meshes by direction (their inner face looking into
// the room: N = the back wall, looking south); per frame a direction is hidden when the camera's horizontal back
// direction (`uCamBack`: from the target towards the camera) points at its outer side. At the default yaw the south
// (front) walls vanish, as the GBA shows none; when the user orbits, the near walls vanish instead.

import { BAND_MAX, type WallDir } from './room';
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

/** A wall run as the cutaway judges it (a RoomLayout / shell run: its inner face on `line`, from `from` to `to`). */
export interface CutawayRun { dir: WallDir; line: number; from: number; to: number; floorY: number }

const isNS = (d: WallDir) => d === 'N' || d === 'S';

/** A pocket side is at most this long: in the back wall (N) the band's depth (BAND_MAX: the stairs alcove, a back-wall
 *  step), in a side or front wall one cell (a jog). */
export const POCKET_MAX: Readonly<Record<WallDir, number>> = { N: BAND_MAX, E: 1, S: 1, W: 1 };

/**
 * The wall direction whose cutaway takes run `r` along, else null: `r` is the short side of a pocket in a wall of that
 * direction — both its ends meet runs of one (perpendicular) direction p and it is at most POCKET_MAX[p] long: the side
 * walls of the stairs alcove in the back wall, of a back-wall step, a one-cell piece of back wall between a corner and an
 * alcove. When p is cut away such a run stands alone between the camera and the room (at yaw π the stairs alcove's E / W
 * walls in the foreground), so it goes with p. A room's own side walls meet two directions (N at the back, S at the
 * front) and a long wall stays: the default view (yaw 0, S cut away) keeps every wall it showed — no in-scope room has
 * a short S pocket (survey: the S pockets are 7–12 long, on 23.0 and 29.2).
 */
export function pocketDir(runs: readonly CutawayRun[], r: CutawayRun): WallDir | null {
  const at = (e: number) =>
    runs.find((o) => isNS(o.dir) !== isNS(r.dir) && o.floorY === r.floorY && o.line === e && (o.from === r.line || o.to === r.line));
  const a = at(r.from), b = at(r.to);
  return a && b && a.dir === b.dir && r.to - r.from <= POCKET_MAX[a.dir] + 1e-6 ? a.dir : null;
}

/** A run of direction `dir` that `pocket`'s cutaway takes along (pocketDir; null: none) stays visible when its own
 *  direction does and so does `pocket`. */
export function runVisible(dir: WallDir, pocket: WallDir | null, camBack: { x: number; y: number }): boolean {
  return wallVisible(dir, camBack) && (pocket === null || wallVisible(pocket, camBack));
}
