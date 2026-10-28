// fakePuzzle: a fakeInterior with mechanic cells (Phase 4b, F14). The mechanics are digits, so no letter of
// fakeInterior's legend (Task 5 owns those) is shadowed; each digit's id is its kind, seeded both as the interior id
// (seedInteriorIds, through fakeInterior) and as the puzzle id (seedPuzzleIds). Further mechanics (gymDoor,
// hiddenStairs, a position-listed cell with `offId`) come through `legend`.
//
// Every (kind, state, variant) a mechanic can have has a metatile here (0x300 …), so `rawOf` gives the grid value of
// any state, whether or not the map shows it.
import type { MapAnalysis } from '../../src/render/overworld/analyze';
import {
  PUZZLE_KINDS, puzzleStateCount, type InteriorId, type PuzzleId, type PuzzleKind,
} from '../../src/render/kit/tables/building';
import { seedPuzzleIds, type PuzzleSeedCell } from '../../src/render/kit/interior/puzzle/state';
import { fakeInterior, type FakeCell } from './fakeInterior';

/** A legend cell that may be a mechanic: its meaning (`puzzle`), and with `offId` a position-listed cell (F4) whose off
 *  state shows that plain id (read as `offState`). */
export interface PuzzleFakeCell extends FakeCell { puzzle?: PuzzleId; offId?: number; offState?: number }

const KINDS = new Set<InteriorId | null>(PUZZLE_KINDS);

/** The variants each kind has (barrier: pole, beam H, beam V; toggleWall: red, blue). */
const VARIANTS: Partial<Record<PuzzleKind, number>> = { barrier: 3, toggleWall: 2 };

/** The collision the game sets with a state (the decomp's TRUE / FALSE): poles always, beams and walls when on / up, a
 *  closed door. Broken thin ice is walkable (field_tasks.c). */
function blockedOf(kind: PuzzleKind, state: number, variant: number): boolean {
  switch (kind) {
    case 'barrier': return variant === 0 || state === 1;
    case 'toggleWall': return state === 1;
    case 'gymDoor': return state === 0;
    default: return false;
  }
}

/** Every mechanic state's fake metatile, in PUZZLE_KINDS × variant × state order from 0x300. */
const FAKE_IDS = new Map<number, PuzzleId>();
const MT_OF = new Map<string, number>();
{
  let mt = 0x300;
  for (const kind of PUZZLE_KINDS) {
    for (let variant = 0; variant < (VARIANTS[kind] ?? 1); variant++) {
      for (let state = 0; state < puzzleStateCount(kind); state++) {
        FAKE_IDS.set(mt, { kind, state, variant, blocked: blockedOf(kind, state, variant) });
        MT_OF.set(`${kind}/${state}/${variant}`, mt++);
      }
    }
  }
}

/** The fake metatile of a mechanic state (no collision, no elevation bits: a grid value for `accepts` / `apply`). */
export function rawOf(kind: PuzzleKind, state: number, variant = 0): number {
  const mt = MT_OF.get(`${kind}/${state}/${variant}`);
  if (mt === undefined) throw new Error(`rawOf: no fake id for ${kind} state ${state} variant ${variant}`);
  return mt;
}

const mech = (kind: PuzzleKind, state: number, variant = 0): PuzzleFakeCell => {
  const mt = rawOf(kind, state, variant), puzzle = FAKE_IDS.get(mt)!;
  return { mt, blocked: puzzle.blocked, id: kind, puzzle };
};

/** The digits: thin ice intact / cracked / broken (walkable), floor switch raised / pressed, a barrier pole (blocked),
 *  a horizontal beam on (blocked) / off (walkable), a red toggle wall down (walkable) / up (blocked). */
export const PUZZLE_LEGEND: Readonly<Record<string, PuzzleFakeCell>> = {
  0: mech('thinIce', 0), 1: mech('thinIce', 1), 2: mech('thinIce', 2),
  3: mech('floorSwitch', 0), 4: mech('floorSwitch', 1),
  5: mech('barrier', 0, 0), 6: mech('barrier', 1, 1), 7: mech('barrier', 0, 1),
  8: mech('toggleWall', 0, 0), 9: mech('toggleWall', 1, 0),
};

/**
 * fakeInterior(rows) with the mechanic digits (and `legend`'s cells, which may add or override any), every mechanic
 * cell's puzzle id seeded (seedPuzzleIds; new metatiles read through the fake ids and the legend's), and `heights` (per
 * legend character: the cells' `a.height` and `groundH`, e.g. a raised cell for F19).
 */
export function fakePuzzle(rows: string[], legend?: Record<string, PuzzleFakeCell>, heights?: Record<string, number>):
  { a: MapAnalysis; ids: (InteriorId | null)[]; puzzle: (PuzzleSeedCell | null)[] } {
  const L: Record<string, PuzzleFakeCell> = { ...PUZZLE_LEGEND, ...legend };
  const { a, ids } = fakeInterior(rows, L);
  const byMt = new Map<number, PuzzleSeedCell>(), known = new Map<number, PuzzleId>(FAKE_IDS);
  for (const c of Object.values(L)) {
    // a mechanic letter without a meaning (fakeInterior's `i`, `b`, `G`, `H`) reads as its kind's state 0
    const p = c.puzzle ?? (KINDS.has(c.id) ? { kind: c.id as PuzzleKind, state: 0, variant: 0, blocked: c.blocked } : null);
    if (!p) continue;
    known.set(c.mt, p);
    byMt.set(c.mt, c.offId !== undefined ? { ...p, offId: c.offId, offState: c.offState ?? 0 } : p);
  }
  const puzzle = new Array<PuzzleSeedCell | null>(a.N);
  for (let i = 0; i < a.N; i++) puzzle[i] = byMt.get(a.mt[i]) ?? null;
  seedPuzzleIds(a, puzzle, (m) => known.get(m) ?? null);
  // (as fakeInterior's `heights`: by position, the cells' height and groundH)
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    const h = heights?.[ch];
    if (h === undefined || !a.inside(x, y)) return;
    const i = a.idx(x, y);
    a.height[i] = h; a.groundH[i] = h;
  }));
  return { a, ids, puzzle };
}
