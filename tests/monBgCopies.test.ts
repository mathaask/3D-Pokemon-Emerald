import { describe, it, expect } from 'vitest';
import { SYM } from '../src/game/symbols';
import { GameState } from '../src/game/state';
import { Bus } from '../src/gba/bus';

/** A GameState on a blank bus in a battle, a Task_UpdateMonBg in task slot 3 for sprite 4 (not yet listed in
 *  sMonAnimTaskIdArray), and the helpers that write RAM and set the emulated frame (gMain.vblankCounter1). */
function battle() {
  const bus = new Bus(new Uint8Array(0x1000));
  const w = (a: number, v: number, bytes: 1 | 2 | 4) => {
    const arr = (a >>> 24) === 2 ? bus.ewram : bus.iwram, o = (a >>> 24) === 2 ? a & 0x3ffff : a & 0x7fff;
    for (let i = 0; i < bytes; i++) arr[o + i] = (v >>> (8 * i)) & 0xff;
  };
  w(SYM.gMain + 4, SYM.BattleMainCB2 | 1, 4);                                    // in battle
  w(SYM.sMonAnimTaskIdArray, 0xff, 1); w(SYM.sMonAnimTaskIdArray + 1, 0xff, 1);
  const task = SYM.gTasks + 3 * 40;
  w(task, SYM.Task_UpdateMonBg | 1, 4); w(task + 4, 1, 1); w(task + 8, 4, 2);    // Task_UpdateMonBg, active, sprite 4
  const st = new GameState(bus);
  let frame = 0;
  return {
    st, w, task,
    /** monbg: the task lives (true) or clearmonbg's task destroyed it (false). */
    monBg: (on: boolean) => w(SYM.sMonAnimTaskIdArray, on ? 3 : 0xff, 1),
    /** `frames` emulated frames pass (gMain.vblankCounter1 counts them), then a sync. */
    sync: (frames: number) => { frame += frames; w(SYM.gMain + 0x20, frame, 4); st.update(); return st.battlerCopies; },
    /** The emulated frame jumps to `to` (a loaded save state), then a sync. */
    syncAt: (to: number) => { frame = to; w(SYM.gMain + 0x20, frame, 4); st.update(); return st.battlerCopies; },
  };
}

describe('battler copies on BG layers (a move\'s monbg): GameState.battlerCopies by emulated frames', () => {
  it('one emulated frame per sync: a battler whose task appeared at least a frame ago (as measured: the copy shows a frame after the task appears)', () => {
    const { st, w, task, monBg, sync } = battle();
    expect(sync(1)).toEqual([]);
    expect(st.scene).toBe('battle');
    monBg(true);                                                     // the task appears (the copy shows a frame later)
    expect(sync(1)).toEqual([]);
    expect(sync(1)).toEqual([4]);
    expect(sync(1)).toEqual([4]);
    monBg(false);                                                    // clearmonbg's task destroyed it
    expect(sync(1)).toEqual([]);
    monBg(true); w(task, 0x08000001, 4);                             // another task in that slot: no copy
    sync(1); expect(sync(1)).toEqual([]);
    w(task, SYM.Task_UpdateMonBg | 1, 4); w(task + 4, 0, 1);         // an inactive task: none
    sync(1); expect(sync(1)).toEqual([]);
  });

  it('two or more emulated frames per sync: a task first seen may have appeared on any frame since the last sync, so it counts at once', () => {
    for (const frames of [2, 3, 5]) {
      const { monBg, sync } = battle();
      expect(sync(1)).toEqual([]);
      monBg(true);
      // (it appeared at the earliest the frame after the last sync's: the overlay shows its copy from the next one)
      expect(sync(frames), `${frames} frames`).toEqual([4]);
      expect(sync(frames)).toEqual([4]);
      monBg(false);
      expect(sync(frames)).toEqual([]);
    }
  });

  it('a resync on the same emulated frame changes nothing: a task that appeared this frame is no copy yet, one already copied stays one', () => {
    const { monBg, sync } = battle();
    expect(sync(1)).toEqual([]);
    monBg(true);
    expect(sync(1)).toEqual([]);
    expect(sync(0)).toEqual([]);                                     // (the battler was hidden a frame early here)
    expect(sync(1)).toEqual([4]);
    expect(sync(0)).toEqual([4]);
    expect(sync(0)).toEqual([4]);
    monBg(false);
    expect(sync(1)).toEqual([]);
    expect(sync(0)).toEqual([]);
  });

  it('a task seen at the first battle sync, after leaving the battle or after the frame counter went back (a loaded state) counts from the next frame', () => {
    const { st, w, monBg, sync, syncAt } = battle();
    monBg(true);
    expect(sync(5)).toEqual([]);                                     // the first sync: no earlier one
    expect(sync(1)).toEqual([4]);
    expect(syncAt(2)).toEqual([]);                                   // the counter went back: the history restarts
    expect(sync(1)).toEqual([4]);
    w(SYM.gMain + 4, SYM.CB2_Overworld | 1, 4);                      // out of the battle: none, and the history goes
    expect(sync(1)).toEqual([]);
    expect(st.scene).toBe('overworld');
    w(SYM.gMain + 4, SYM.BattleMainCB2 | 1, 4);
    expect(sync(3)).toEqual([]);
    expect(sync(1)).toEqual([4]);
  });
});
