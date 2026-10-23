import { describe, it, expect } from 'vitest';
import { MAX_DEFERRED_FRAMES, SyncGate } from '../src/render/syncGate';
import type { MapLoad } from '../src/game/mapLoad';

const crossing = (): MapLoad | null => 'crossing', warp = (): MapLoad | null => 'warp', none = (): MapLoad | null => null;
const yes = () => true, no = () => false;

describe('SyncGate (skip a frame\'s sync while the game is mid map load)', () => {
  it('syncs when the game is not loading a map, without asking whether the world would rebuild', () => {
    const g = new SyncGate();
    let asked = 0;
    expect(g.defer(none, () => { asked++; return true; }, 1)).toBe(false);
    expect(asked).toBe(0);
    expect(g.deferred).toBe(0);
  });

  it('syncs mid-load when the sync would not rebuild the world (sprites, palettes: as every frame)', () => {
    const g = new SyncGate();
    expect(g.defer(crossing, no, 1)).toBe(false);
    expect(g.deferred).toBe(0);
  });

  it('defers a sync that would rebuild the world from a map load in progress', () => {
    const g = new SyncGate();
    expect(g.defer(crossing, yes, 1)).toBe(true);
    expect(g.deferred).toBe(1);
    // the load finished: the next frame syncs (and builds once, on the finished map)
    expect(g.defer(none, yes, 2)).toBe(false);
  });

  it(`a crossing defers at most ${MAX_DEFERRED_FRAMES.crossing} emulated frames in a row: the next one syncs whatever the state`, () => {
    const g = new SyncGate();
    for (let f = 1; f <= MAX_DEFERRED_FRAMES.crossing; f++) expect(g.defer(crossing, yes, f)).toBe(true);
    expect(g.defer(crossing, yes, MAX_DEFERRED_FRAMES.crossing + 1)).toBe(false);
    expect(g.deferred).toBe(MAX_DEFERRED_FRAMES.crossing);
    // (a sync ends the run)
    expect(g.defer(crossing, yes, MAX_DEFERRED_FRAMES.crossing + 2)).toBe(true);
  });

  it(`a warp's black loading frames wait longer: up to ${MAX_DEFERRED_FRAMES.warp} emulated frames`, () => {
    const g = new SyncGate();
    expect(MAX_DEFERRED_FRAMES.warp).toBeGreaterThan(MAX_DEFERRED_FRAMES.crossing);
    for (let f = 1; f <= MAX_DEFERRED_FRAMES.warp; f++) expect(g.defer(warp, yes, f)).toBe(true);
    expect(g.defer(warp, yes, MAX_DEFERRED_FRAMES.warp + 1)).toBe(false);
  });

  it('counts emulated frames, not renders: fast-forward (4 frames a render) spends 4 of the cap per render', () => {
    const g = new SyncGate();
    expect(g.defer(warp, yes, 4)).toBe(true);
    expect(g.defer(warp, yes, 8)).toBe(true);
    // (frames 4..31 deferred: frame 32 lies 28 frames after the run's first)
    expect(g.defer(warp, yes, 32)).toBe(true);
    expect(g.defer(warp, yes, 36)).toBe(false);
    const c = new SyncGate();
    expect(c.defer(crossing, yes, 4)).toBe(true);
    expect(c.defer(crossing, yes, 8)).toBe(false);
  });

  it('a loaded state (the emulator back at an earlier frame) starts a new run, still capped', () => {
    const g = new SyncGate();
    expect(g.defer(crossing, yes, 100)).toBe(true);
    expect(g.defer(crossing, yes, 50)).toBe(true);
    expect(g.defer(crossing, yes, 51)).toBe(true);
    expect(g.defer(crossing, yes, 52)).toBe(true);
    expect(g.defer(crossing, yes, 53)).toBe(false);
  });

  it('a sync in between starts a new run', () => {
    const g = new SyncGate();
    expect(g.defer(crossing, yes, 1)).toBe(true);
    expect(g.defer(none, yes, 2)).toBe(false);
    for (let f = 3; f < 3 + MAX_DEFERRED_FRAMES.crossing; f++) expect(g.defer(crossing, yes, f)).toBe(true);
    expect(g.defer(crossing, yes, 3 + MAX_DEFERRED_FRAMES.crossing)).toBe(false);
  });

  it('asked again for the same emulated frame (a display faster than the game): the same answer, nothing read again', () => {
    const g = new SyncGate();
    let asked = 0;
    const load = (): MapLoad | null => { asked++; return 'crossing'; };
    expect(g.defer(load, yes, 10)).toBe(true);
    for (let i = 0; i < 3; i++) expect(g.defer(load, yes, 10)).toBe(true);
    expect(asked).toBe(1);
    expect(g.deferred).toBe(1);
    expect(g.defer(load, yes, 11)).toBe(true);
    expect(g.defer(load, yes, 12)).toBe(true);
    expect(g.defer(load, yes, 13)).toBe(false);
    // a frame that synced is not asked again either
    expect(g.defer(load, yes, 13)).toBe(false);
    expect(asked).toBe(4);
  });
});
