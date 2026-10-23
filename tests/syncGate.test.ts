import { describe, it, expect } from 'vitest';
import { MAX_DEFERRED_SYNCS, SyncGate } from '../src/render/syncGate';

const yes = () => true, no = () => false;

describe('SyncGate (skip a frame\'s sync while the game is mid map load)', () => {
  it('syncs when the game is not loading a map, without asking whether the world would rebuild', () => {
    const g = new SyncGate();
    let asked = 0;
    expect(g.defer(no, () => { asked++; return true; })).toBe(false);
    expect(asked).toBe(0);
    expect(g.deferred).toBe(0);
  });

  it('syncs mid-load when the sync would not rebuild the world (sprites, palettes: as every frame)', () => {
    const g = new SyncGate();
    expect(g.defer(yes, no)).toBe(false);
    expect(g.deferred).toBe(0);
  });

  it('defers a sync that would rebuild the world from a map load in progress', () => {
    const g = new SyncGate();
    expect(g.defer(yes, yes)).toBe(true);
    expect(g.deferred).toBe(1);
    // the load finished: the next frame syncs (and builds once, on the finished map)
    expect(g.defer(no, yes)).toBe(false);
  });

  it(`never defers more than ${MAX_DEFERRED_SYNCS} frames in a row: the next one syncs whatever the state`, () => {
    const g = new SyncGate();
    for (let i = 0; i < MAX_DEFERRED_SYNCS; i++) expect(g.defer(yes, yes)).toBe(true);
    expect(g.defer(yes, yes)).toBe(false);
    expect(g.deferred).toBe(MAX_DEFERRED_SYNCS);
    // (a sync ends the run)
    expect(g.defer(yes, yes)).toBe(true);
  });

  it('a sync in between starts a new run', () => {
    const g = new SyncGate(2);
    expect(g.defer(yes, yes)).toBe(true);
    expect(g.defer(no, yes)).toBe(false);
    expect(g.defer(yes, yes)).toBe(true);
    expect(g.defer(yes, yes)).toBe(true);
    expect(g.defer(yes, yes)).toBe(false);
    expect(g.deferred).toBe(3);
  });
});
