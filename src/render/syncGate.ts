// Whether the renderer skips a frame's sync with the emulator: while the game is mid map load and the sync would rebuild
// the world from it. The previous frame's state is then drawn once more (the whole sync waits, sprites included: they
// would stand on the new map's coordinates over the old world), and the world is built once, from the finished map.

/** The longest run of frames deferred in a row: the next frame syncs whatever the state (no stall). A crossing's load
 *  ends within the frame after the one it straddles. */
export const MAX_DEFERRED_SYNCS = 3;

export class SyncGate {
  /** Frames deferred in the session. */
  deferred = 0;
  private run = 0;

  constructor(readonly maxRun = MAX_DEFERRED_SYNCS) {}

  /** Whether to skip this frame's sync: `midLoad` (the game is loading a map now) and, only then, `wouldRebuild` (a sync
   *  now would rebuild the world); never more than `maxRun` frames in a row. */
  defer(midLoad: () => boolean, wouldRebuild: () => boolean): boolean {
    if (this.run >= this.maxRun || !midLoad() || !wouldRebuild()) {
      this.run = 0;
      return false;
    }
    this.run++;
    this.deferred++;
    return true;
  }
}
