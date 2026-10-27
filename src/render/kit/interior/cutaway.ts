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

/** A pocket side is at most this long: the back-wall band's depth (BAND_MAX: the stairs alcove, a back-wall step). */
export const POCKET_MAX = BAND_MAX;

/**
 * 'N' when the back wall's cutaway takes run `r` along, else null: `r` is a short side of a pocket in the back wall —
 * both its ends meet N runs and it is at most POCKET_MAX long: the side walls of the stairs alcove, of a back-wall step.
 * When the back wall is cut away (yaw near π) such a run stands alone between the camera and the room, so it goes with
 * it. Only the back wall takes runs along: a piece of back wall between two E (or W) runs — the one cell between a
 * corner and an alcove — stays governed by its own direction (taken along with a side wall it left a wall-high hole
 * beside the alcove from about 15° of orbit, the wall decals floating in it). A room's own side walls meet N at one end
 * and S at the other: never taken along. At yaw 0 nothing changes (N is shown).
 */
export function pocketDir(runs: readonly CutawayRun[], r: CutawayRun): WallDir | null {
  if (isNS(r.dir) || r.to - r.from > POCKET_MAX + 1e-6) return null;
  const at = (e: number) =>
    runs.find((o) => isNS(o.dir) && o.floorY === r.floorY && o.line === e && (o.from === r.line || o.to === r.line));
  const a = at(r.from), b = at(r.to);
  return a?.dir === 'N' && b?.dir === 'N' ? 'N' : null;
}

/** A run of direction `dir` that `pocket`'s cutaway takes along (pocketDir; null: none) stays visible when its own
 *  direction does and so does `pocket`. */
export function runVisible(dir: WallDir, pocket: WallDir | null, camBack: { x: number; y: number }): boolean {
  return wallVisible(dir, camBack) && (pocket === null || wallVisible(pocket, camBack));
}
