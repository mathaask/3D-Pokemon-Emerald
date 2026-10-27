// The interior cutaway (Phase 4 Task 6, D5): a wall whose outer side faces the camera vanishes.
import { describe, it, expect } from 'vitest';
import { wallVisible, INNER_NORMAL, CUTAWAY_DOT, pocketDir, runVisible } from '../src/render/kit/interior/cutaway';
import { roomLayout } from '../src/render/kit/interior/room';
import { shellRuns, buildShellSoups } from '../src/render/kit/interior/geom/shellParts';
import { fakeInterior } from './helpers/fakeInterior';

const back = (yaw: number) => ({ x: Math.sin(yaw), y: Math.cos(yaw) });
const shown = (yaw: number) => (['N', 'E', 'S', 'W'] as const).filter((d) => wallVisible(d, back(yaw)));

describe('interior cutaway', () => {
  it('hides the walls the camera sees from outside', () => {
    expect(shown(0)).toEqual(['N', 'E', 'W']);
    expect(shown(Math.PI / 2)).toEqual(['N', 'S', 'W']);
    expect(shown((3 * Math.PI) / 4)).toEqual(['S', 'W']);
    expect(shown(Math.PI)).toEqual(['E', 'S', 'W']);
  });
  it('points every inner normal into the room, with the threshold as given', () => {
    expect(INNER_NORMAL).toEqual({ N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0] });
    expect(CUTAWAY_DOT).toBe(-0.25);
    // (exactly at the threshold the wall stays)
    expect(wallVisible('N', { x: Math.sqrt(1 - 0.25 ** 2), y: -0.25 })).toBe(true);
  });
});

describe('interior cutaway: pocket sides', () => {
  // the stairs alcove in the back wall (Task 5's fixture): its W / E side walls stand in the foreground at yaw π
  const alcove = () => {
    const { a, ids } = fakeInterior(['          ', ' WWWWWSWW ', ' WWWWWSWW ', ' ........ ', ' ........ ', '          ']);
    const L = roomLayout(a, ids, []);
    return { a, L, runs: shellRuns(a, L) };
  };
  it('takes the stairs alcove side walls along with the back wall at yaw π, and keeps them at the default yaw', () => {
    const { runs } = alcove();
    const side = (dir: 'E' | 'W', line: number) => runs.find((r) => r.dir === dir && r.line === line)!;
    expect(pocketDir(runs, side('W', 6))).toBe('N');
    expect(pocketDir(runs, side('E', 7))).toBe('N');
    expect(pocketDir(runs, side('W', 1))).toBeNull();                  // the room's own side walls: N at one end, S at the other
    expect(pocketDir(runs, side('E', 9))).toBeNull();
    for (const r of runs.filter((q) => q.dir === 'N' || q.dir === 'S')) expect(pocketDir(runs, r)).toBeNull();
    const visible = (r: (typeof runs)[number], yaw: number) => runVisible(r.dir, pocketDir(runs, r), back(yaw));
    expect(visible(side('W', 6), Math.PI)).toBe(false);
    expect(visible(side('E', 7), Math.PI)).toBe(false);
    expect(visible(side('W', 1), Math.PI)).toBe(true);
    expect(visible(side('E', 9), Math.PI)).toBe(true);
    expect([side('W', 6), side('E', 7), side('W', 1), side('E', 9)].map((r) => visible(r, 0))).toEqual([true, true, true, true]);
  });
  it('builds the pocket sides into their own soups, tagged with the direction that takes them along', () => {
    const { a, L } = alcove();
    const S = buildShellSoups({ a, L, colors: { base: [0.5, 0.4, 0.3], wainscot: [0.8, 0.7, 0.6], panel: [0.8, 0.7, 0.6], trim: [0.9, 0.9, 0.9], wall: [0.9, 0.85, 0.8] } });
    expect(S.pockets.map((q) => [q.dir, q.pocket, q.walls.empty])).toEqual([['E', 'N', false], ['W', 'N', false]]);
  });
  it('keeps the one-cell back-wall piece beside an alcove at 15° of orbit (only the back wall takes runs along)', () => {
    // the stairs alcove one cell from the east corner: N 8–9 between the alcove's E side and the room's E wall
    const { a, ids } = fakeInterior(['          ', ' WWWWWWSW ', ' WWWWWWSW ', ' ........ ', ' ........ ', '          ']);
    const runs = shellRuns(a, roomLayout(a, ids, []));
    const piece = runs.find((r) => r.dir === 'N' && r.from === 8 && r.to === 9)!;
    const side = runs.find((r) => r.dir === 'E' && r.line === 8)!;
    expect(piece).toBeDefined();
    expect(pocketDir(runs, piece)).toBeNull();
    const yaw15 = (15 * Math.PI) / 180;
    expect(wallVisible('E', back(yaw15))).toBe(false);                 // (the side walls turn away from 15°)
    expect(runVisible(piece.dir, pocketDir(runs, piece), back(yaw15))).toBe(true);
    expect(runVisible(piece.dir, pocketDir(runs, piece), back(0))).toBe(true);
    // the alcove's sides: shown at yaw 0, gone with the back wall at yaw π
    expect(pocketDir(runs, side)).toBe('N');
    expect(runVisible(side.dir, 'N', back(0))).toBe(true);
    expect(runVisible(side.dir, 'N', back(Math.PI))).toBe(false);
  });
  it('never takes a long wall along (a back-wall segment beside an alcove stays at yaw ±π/2)', () => {
    const r = (dir: 'N' | 'E' | 'S' | 'W', line: number, from: number, to: number) => ({ dir, line, from, to, floorY: 0 });
    const runs = [r('N', 1.5, 0, 7), r('N', 0.5, 7, 8), r('N', 1.5, 8, 11), r('W', 7, 0.5, 1.5), r('E', 8, 0.5, 1.5),
      r('E', 11, 1.5, 9), r('W', 0, 1.5, 9), r('S', 9, 0, 11)];
    expect(pocketDir(runs, runs[2])).toBeNull();                       // N 8–11: E at both ends, but 3 long
    expect(pocketDir(runs, runs[4])).toBe('N');
  });
});

