// Whether the renderer skips a frame's sync with the emulator: while the game is mid map load and the sync would rebuild
// the world from it. The previous frame's state is then drawn once more (the whole sync waits, sprites included: they
// would stand on the new map's coordinates over the old world), and the world is built once, from the finished map.

/** The longest run of emulated frames deferred in a row: the next frame syncs whatever the state (no stall). A
 *  crossing's load ends within the frame after the one it straddles. */
export const MAX_DEFERRED_SYNCS = 3;

export class SyncGate {
  /** Emulated frames deferred in the session. */
  deferred = 0;
  private run = 0;
  /** The emulated frame last decided, and the decision (renders of the same frame get it again). */
  private frame: number | undefined;
  private answer = false;

  constructor(readonly maxRun = MAX_DEFERRED_SYNCS) {}

  /** Whether to skip this render's sync: `midLoad` (the game is loading a map now) and, only then, `wouldRebuild` (a sync
   *  now would rebuild the world); never more than `maxRun` emulated frames in a row. `frame`: the emulated frame
   *  (gba.frameCount) — renders of a frame already decided (a display refreshing faster than the game) get the same
   *  answer without spending the cap. */
  defer(midLoad: () => boolean, wouldRebuild: () => boolean, frame?: number): boolean {
    if (frame !== undefined && frame === this.frame) return this.answer;
    this.frame = frame;
    if (this.run >= this.maxRun || !midLoad() || !wouldRebuild()) {
      this.run = 0;
      return (this.answer = false);
    }
    this.run++;
    this.deferred++;
    return (this.answer = true);
  }
}
