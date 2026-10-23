// Whether the renderer skips a frame's sync with the emulator: while the game is mid map load and the sync would rebuild
// the world from it. The previous frame's state is then drawn once more (the whole sync waits, sprites included: they
// would stand on the new map's coordinates over the old world), and the world is built once, from the finished map.

import type { MapLoad } from '../game/mapLoad';

/** The longest run of emulated frames deferred in a row, per load; the next frame syncs whatever the state (no stall).
 *  A crossing's load ends within the frame after the one it straddles; a warp loads over several frames, the screen
 *  faded to black (a door: 3). */
export const MAX_DEFERRED_FRAMES: Readonly<Record<MapLoad, number>> = { crossing: 3, warp: 30 };

export class SyncGate {
  /** Syncs deferred in the session (render decisions; under fast-forward one covers several emulated frames). */
  deferred = 0;
  /** The emulated frame the current run of deferrals started at (null: none). */
  private runStart: number | null = null;
  /** The emulated frame last decided, and the decision (renders of the same frame get it again). */
  private frame = -1;
  private answer = false;

  /**
   * Whether to skip this render's sync: `load` (which map load the game is in now, if any) and, only then, `wouldRebuild`
   * (a sync now would rebuild the world); a run lasts at most MAX_DEFERRED_FRAMES[load] emulated frames from its first.
   * `frame`: the emulated frame (gba.frameCount) — renders of a frame already decided (a display refreshing faster than
   * the game) get the same answer, nothing read again.
   */
  defer(load: () => MapLoad | null, wouldRebuild: () => boolean, frame: number): boolean {
    if (frame === this.frame) return this.answer;
    this.frame = frame;
    // (the emulator went back, a state loaded: a new run)
    if (this.runStart !== null && frame < this.runStart) this.runStart = null;
    const kind = load();
    const ran = this.runStart === null ? 0 : frame - this.runStart;
    if (kind === null || ran >= MAX_DEFERRED_FRAMES[kind] || !wouldRebuild()) {
      this.runStart = null;
      return (this.answer = false);
    }
    this.runStart ??= frame;
    this.deferred++;
    return (this.answer = true);
  }
}
