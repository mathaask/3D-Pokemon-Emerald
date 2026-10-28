// The warp fixture (Phase 4b, D12): puts the player on any cell of any map by redirecting a door warp. A TEST TOOL ONLY
// (tools/puzzle-states.ts makes save states with it; the app never writes game memory, and this file is not in src/).
//
// From out/s22.state (Littleroot, the player free at 12,9) the player walks two cells east and up into May's house door
// (14,8; tools/regress-live.ts door_enter: the door reached at frame 92 of the state, the fade-out from 129). When the
// game has set the warp it is about to make (sWarpDestination = May's house 1F, 1.2), the destination is overwritten
// with the target map and cell and warpId 0xFF (WARP_ID_NONE: SetPlayerCoordsFromWarp then places the player on x, y):
// the game loads the target map as it would have loaded the house, its map scripts run (on load / on transition: a gym
// sets its puzzle state from the save's flags and vars), and the screen fades in on the target cell.

import type { Gba } from '../../src/gba/gba';
import type { GameState } from '../../src/game/state';
import { SYM } from '../../src/game/symbols';
import { keyMask } from '../../src/input/keyNames';

export interface WarpTarget { group: number; num: number; x: number; y: number }

/** sWarpDestination (WarpData): s8 mapGroup @0, s8 mapNum @1, s8 warpId @2, s16 x @4, s16 y @6; EWRAM. */
const WARP = SYM.sWarpDestination & 0x3ffff;
const MAYS_HOUSE_1F = { group: 1, num: 2 };
/** Frames the whole walk may take before it is given up (the door warp lands at ~150, the fade-in ends at ~185). */
const MAX_FRAMES = 900;

/** Runs one frame holding `keys` and refreshes `state`. */
function frame(gba: Gba, state: GameState, keys: string): void {
  gba.keys = keyMask(keys);
  gba.runFrame();
  state.update();
}

/**
 * From out/s22.state (loaded into `gba` by the caller; `state` reads `gba`'s bus): RIGHT 32 frames, then UP held; every
 * frame reads sWarpDestination and, once it names May's house 1F (1.2), writes `to` there with warpId 0xFF (once). Runs
 * until the player's map (state.mapGroup / mapNum) is the target and the fade-in has ended, then `settle` more idle
 * frames (default 60; 0: stop right at the fade-in's end, before an on-frame map script has run a frame). Returns the
 * frames run. Throws when the warp destination never names the house or the target never loads within MAX_FRAMES.
 */
export function warpInto(gba: Gba, state: GameState, to: WarpTarget, settle = 60): { frames: number } {
  const ew = gba.bus.ewram;
  let frames = 0, written = false, arrived = false;
  const step = (keys: string) => {
    if (++frames > MAX_FRAMES) {
      throw new Error(`warpInto ${to.group}.${to.num} (${to.x},${to.y}): ${written ? 'the target never loaded' : 'no warp to May\'s house'} in ${MAX_FRAMES} frames`);
    }
    frame(gba, state, keys);
    if (!written && ew[WARP] === MAYS_HOUSE_1F.group && ew[WARP + 1] === MAYS_HOUSE_1F.num) {
      ew[WARP] = to.group & 0xff;
      ew[WARP + 1] = to.num & 0xff;
      ew[WARP + 2] = 0xff;
      ew[WARP + 4] = to.x & 0xff; ew[WARP + 5] = (to.x >> 8) & 0xff;
      ew[WARP + 6] = to.y & 0xff; ew[WARP + 7] = (to.y >> 8) & 0xff;
      written = true;
    }
  };
  for (let i = 0; i < 32; i++) step('RIGHT');
  // UP held until the warp is set (released then: a held key would walk the player on after the fade-in), then idle
  // until the target map loaded
  while (!(written && state.mapGroup === to.group && state.mapNum === to.num)) step(written ? '' : 'UP');
  // the fade-in: past the load's screens (the map loads under the transition and 2D screens), then 4 overworld frames in a
  // row with no palette fade running (most maps fade in from black, 20-odd frames; Lavaridge Gym 1F shows no palette fade)
  let loading = state.scene !== 'overworld', idle = 0;
  while (!arrived) {
    step('');
    if (state.scene !== 'overworld') loading = true;
    idle = state.scene === 'overworld' && !state.fadeActive && state.fadeY === 0 ? idle + 1 : 0;
    if (loading && idle >= 4) arrived = true;
  }
  for (let i = 0; i < settle; i++) step('');
  return { frames };
}
