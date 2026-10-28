// The puzzle state core (Phase 4b Task 6): mechanic cells by id and by position, the state texture (on the meshes, F8),
// the live cells, the state looks, and every other family blind to a mechanic cell's state.
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  PUZZLE_LOOK, PUZZLE_STATE_GLSL, PuzzleStateTexture, arrowRotation, puzzleCells, puzzleKindIndex, puzzleLiveCells,
  puzzleLookGlsl, puzzleUniforms,
} from '../src/render/kit/interior/puzzle/state';
import {
  INTERIOR_TABLES, PUZZLE_KINDS, puzzleStateCount, type InteriorTable, type PuzzleId,
} from '../src/render/kit/tables/building';
import { extractAll, type Extracted, type Family } from '../src/render/kit/semantics';
import { NO_EVENTS } from '../src/render/kit/events';
import { CLAIM_OBJECT, CLAIM_SURFACE, CLAIM_TOP } from '../src/render/overworld/claims';
import { furnitureFamily } from '../src/render/kit/interior/index';
import { shellFamily } from '../src/render/kit/interior/shell';
import { floorFamily } from '../src/render/kit/interior/floors';
import type { RGB } from '../src/render/kit/palette';
import { INTERIOR_LEGEND, fakeInterior } from './helpers/fakeInterior';
import { fakePuzzle, rawOf } from './helpers/puzzle';

const luma = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** `f` after a stand-in puzzle family that claims the mechanic cells first (as Task 7's will). */
function withoutPuzzleCells<P>(f: Family<P>): Family<P> {
  return {
    name: f.name,
    extract(ctx, claims) {
      for (const c of puzzleCells(ctx.a)) claims.claim(c.i, CLAIM_SURFACE | CLAIM_OBJECT | CLAIM_TOP);
      return f.extract(ctx, claims);
    },
    build: (p, ctx, kit) => f.build(p, ctx, kit),
  };
}

/** The payloads as JSON (typed arrays as lists, maps and sets as entry lists), hashed. */
function digestPayloads(ex: Extracted): string {
  const json = JSON.stringify([...ex.payloads], (_k, v: unknown) => {
    if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>);
    if (v instanceof Map) return [...v];
    if (v instanceof Set) return [...v];
    return v;
  });
  return createHash('sha1').update(json).digest('hex');
}

const extractStates = (states: string[]) => states
  .map((k) => fakePuzzle(['        ', ' WWWWWW ', ` .T${k}T. `, ' ...... ', '        ']))
  .map(({ a }) => extractAll({ a, events: NO_EVENTS, quality: 'medium' },
    [furnitureFamily, shellFamily, floorFamily].map((f) => withoutPuzzleCells(f as Family<unknown>))));

describe('puzzle state core', () => {
  it('finds the mechanic cells and writes their states into the texture', () => {
    const { a } = fakePuzzle(['       ', ' WWWWW ', ' .013. ', ' ..5.. ', '       ']);
    const cells = puzzleCells(a), tex = new PuzzleStateTexture(a, cells);
    expect(cells.map((c) => [c.kind, c.state])).toEqual([['thinIce', 0], ['thinIce', 1], ['floorSwitch', 0], ['barrier', 0]]);
    expect(tex.texture.image.data!.length).toBe(a.GW * a.GH * 4);                // F43: one RGBA8 texel per analysis cell
    const c = cells[2], v0 = tex.texture.version;
    tex.set(c.i, 1);
    // (Texture.needsUpdate is a setter only in three: the flag shows as a version bump)
    expect(tex.state(c.i)).toBe(1); expect(tex.texture.version).toBe(v0 + 1);
    const root = new THREE.Group(); root.add(new THREE.Mesh()); tex.attach(root);
    expect((root.children[0] as THREE.Mesh).userData.stateTexture).toBe(tex.texture);   // F8
  });

  it('encodes state, variant and kind per texel, and flags the texture once per upload', () => {
    const { a } = fakePuzzle(['      ', ' WWWW ', ' 0.6. ', '      ']);
    const cells = puzzleCells(a), tex = new PuzzleStateTexture(a, cells), d = tex.texture.image.data as Uint8Array;
    const beam = cells.find((c) => c.kind === 'barrier')!;
    expect([...d.subarray(beam.i * 4, beam.i * 4 + 4)]).toEqual([1, 1, puzzleKindIndex('barrier') + 1, 255]);
    expect(d.reduce((n, b, k) => n + (k % 4 === 2 && b > 0 ? 1 : 0), 0)).toBe(2);   // no other texel has a kind
    expect(tex.texture.minFilter).toBe(THREE.NearestFilter); expect(tex.texture.generateMipmaps).toBe(false);
    const v0 = tex.texture.version, data = tex.texture.image.data;
    tex.set(beam.i, 0, 0);
    expect([tex.state(beam.i), tex.variant(beam.i)]).toEqual([0, 0]); expect(tex.texture.version).toBe(v0 + 1);
    tex.set(beam.i, 0);
    expect(tex.texture.version).toBe(v0 + 1);                                     // an unchanged texel flags nothing
    expect(tex.texture.image.data).toBe(data);                                    // written in place
  });

  it('accepts a change to another state of the same mechanic only', () => {
    const { a } = fakePuzzle(['     ', ' WWW ', ' 0.3 ', '     ']), cells = puzzleCells(a);
    const live = puzzleLiveCells('puzzle', a, cells, new PuzzleStateTexture(a, cells));
    const ice = cells[0];
    expect(live.accepts(ice.i, rawOf('thinIce', 2))).toBe(true);          // broken, collision any
    expect(live.accepts(ice.i, rawOf('thinIce', 2) | 0x0400 | 0x3000)).toBe(true);
    expect(live.accepts(ice.i, rawOf('floorSwitch', 1))).toBe(false);
    expect(live.accepts(ice.i, 0x201)).toBe(false);                       // not a mechanic id
    expect(live.accepts(a.idx(2, 1), rawOf('thinIce', 1))).toBe(false);   // not a mechanic cell
    expect([...live.cells].sort((p, q) => p - q)).toEqual(cells.map((c) => c.i));
  });

  it('follows a position-listed cell through a plain off id and a variant change (F4)', () => {
    // Mauville: a V-beam cell whose off state is the plain floor id; a pole cell that becomes a beam
    const { a } = fakePuzzle(['     ', ' WWW ', ' .V. ', '     '], { V: { mt: 0x2a0, blocked: true, id: 'barrier',
      puzzle: { kind: 'barrier', state: 1, variant: 2, blocked: true }, offId: INTERIOR_LEGEND['.'].mt, offState: 0 } });
    const cells = puzzleCells(a), tex = new PuzzleStateTexture(a, cells), live = puzzleLiveCells('puzzle', a, cells, tex);
    const v = cells[0];
    expect(cells).toHaveLength(1);
    expect(live.accepts(v.i, INTERIOR_LEGEND['.'].mt)).toBe(true);        // off = the plain floor id
    live.apply(v.i, INTERIOR_LEGEND['.'].mt); expect(tex.state(v.i)).toBe(0);
    live.apply(v.i, rawOf('barrier', 1, /* pole */ 0)); expect(tex.variant(v.i)).toBe(0);
    expect(tex.state(v.i)).toBe(1);
    expect(live.accepts(cells[0].i, INTERIOR_LEGEND.W.mt)).toBe(false);    // another plain id
  });

  it('switches a pinned cell off to its pin\'s variant, whatever it showed at build time (F4, a table pin)', () => {
    // a fake table on a fake secondary: a V-beam pin (variant 2) built showing a pole id (variant 0), then switched off
    const SECONDARY = 0x7fff0001, KEY = '99.0', FLOOR = INTERIOR_LEGEND['.'].mt;
    const table: InteriorTable = {
      name: 'FakePuzzleTable', ids: new Map(), target: 0, pins: [],
      puzzle: new Map<number, PuzzleId>([[0x2b0, { kind: 'barrier', state: 1, variant: 0, blocked: true }],
        [0x2b1, { kind: 'barrier', state: 1, variant: 2, blocked: true }]]),
      puzzleCells: { [KEY]: [{ x: 2, y: 2, kind: 'barrier', variant: 2, offId: FLOOR, offState: 0 }] },
    };
    const tables = INTERIOR_TABLES as Map<number, InteriorTable>;
    const onTable = (ch: string) => {
      const { a } = fakeInterior(['     ', ' WWW ', ` .${ch}. `, '     '], { p: { mt: 0x2b0, blocked: true, id: 'barrier' } });
      a.opts.secondaryTileset = SECONDARY;
      return a;
    };
    tables.set(SECONDARY, table);
    try {
      const built = onTable('p'), rebuiltA = onTable('.');
      const cells = puzzleCells(built, KEY), tex = new PuzzleStateTexture(built, cells);
      expect(cells.map((c) => [c.kind, c.state, c.variant])).toEqual([['barrier', 1, 0]]);
      const live = puzzleLiveCells('puzzle', built, cells, tex);
      expect(live.accepts(cells[0].i, FLOOR)).toBe(true);
      live.apply(cells[0].i, FLOOR);
      const rebuilt = new PuzzleStateTexture(rebuiltA, puzzleCells(rebuiltA, KEY));
      expect([tex.state(cells[0].i), tex.variant(cells[0].i)]).toEqual([0, 2]);
      expect([...(tex.texture.image.data as Uint8Array)]).toEqual([...(rebuilt.texture.image.data as Uint8Array)]);
    } finally {
      tables.delete(SECONDARY);
    }
  });

  it('makes a patched texture equal the rebuilt one, and a skipped patch differ (F8)', () => {
    const rows = (k: string) => ['      ', ' WWWW ', ` 0${k}3. `, '      '];
    const before = fakePuzzle(rows('0')), after = fakePuzzle(rows('1'));
    const bytes = (t: PuzzleStateTexture) => [...(t.texture.image.data as Uint8Array)];
    const rebuilt = new PuzzleStateTexture(after.a, puzzleCells(after.a));
    const cells = puzzleCells(before.a), patched = new PuzzleStateTexture(before.a, cells);
    const skipped = new PuzzleStateTexture(before.a, cells);
    const live = puzzleLiveCells('puzzle', before.a, cells, patched);
    const i = before.a.idx(2, 2);
    expect(live.accepts(i, rawOf('thinIce', 1))).toBe(true);
    live.apply(i, rawOf('thinIce', 1));
    expect(bytes(patched)).toEqual(bytes(rebuilt));
    expect(bytes(skipped)).not.toEqual(bytes(rebuilt));                    // a no-op apply must not pass the digest
  });

  it('makes every state of a mechanic readable at a glance', () => {
    for (const kind of PUZZLE_KINDS) {
      const looks = PUZZLE_LOOK[kind];
      expect(looks).toHaveLength(puzzleStateCount(kind));
      for (const l of looks) expect(l.tint).toHaveLength(3);
      if (kind === 'gymDoor') {                                           // F33: an animation; ends apart, monotonic
        expect(looks.at(-1)!.open - looks[0].open).toBeGreaterThanOrEqual(0.3);
        for (let s = 1; s < looks.length; s++) expect(looks[s].open).toBeGreaterThan(looks[s - 1].open);
        continue;
      }
      if (kind === 'arrowTile') {                                         // F33: four distinct directions in the GLSL
        expect(new Set([0, 1, 2, 3].map((s) => arrowRotation(s))).size).toBe(4);
        for (let s = 0; s < 4; s++) expect(puzzleLookGlsl()).toContain(`if (state == ${s}) return ${arrowRotation(s).toFixed(6)};`);
        continue;
      }
      for (let s = 1; s < looks.length; s++) for (let t = 0; t < s; t++) {
        const d = Math.max(Math.abs(luma(looks[s].tint) - luma(looks[t].tint)), Math.abs(looks[s].glow - looks[t].glow),
          Math.abs(looks[s].raise - looks[t].raise), Math.abs(looks[s].steps - looks[t].steps),
          Math.abs(looks[s].crack - looks[t].crack), Math.abs(looks[s].open - looks[t].open));
        expect(d, `${kind} ${t}/${s}`).toBeGreaterThanOrEqual(0.3);
      }
    }
  });

  it('gives the shaders the state texture, the grid and every look', () => {
    const { a } = fakePuzzle(['     ', ' WWW ', ' 0.3 ', '     ']);
    const tex = new PuzzleStateTexture(a, puzzleCells(a)), u = puzzleUniforms(tex, a);
    expect(Object.keys(u).sort()).toEqual(['uPuzzleGrid', 'uPuzzleState']);
    expect(u.uPuzzleState.value).toBe(tex.texture);
    expect((u.uPuzzleGrid.value as THREE.Vector4).toArray()).toEqual([a.minX, a.minY, a.GW, a.GH]);
    for (const s of ['uniform sampler2D uPuzzleState;', 'uniform vec4 uPuzzleGrid;', 'vec4 puzzleTexel(vec2 gridXY)',
      'float puzzleStateAt(vec2 gridXY)', 'texelFetch(uPuzzleState']) expect(PUZZLE_STATE_GLSL).toContain(s);
    PUZZLE_KINDS.forEach((k, n) => expect(PUZZLE_STATE_GLSL).toContain(`const int PUZZLE_${k.toUpperCase()} = ${n};`));
    const glsl = puzzleLookGlsl();
    expect(glsl).toContain('PuzzleStateLook puzzleLook(int kind, int state)');
    // one return per state of every kind, plus the fallback
    expect(glsl.match(/return PuzzleStateLook\(/g)).toHaveLength(PUZZLE_KINDS.reduce((n, k) => n + puzzleStateCount(k), 0) + 1);
    expect(glsl).not.toMatch(/[^.\d]\d+\.?\d*e-/);                          // no exponent literals
  });

  it('keeps every other family blind to a mechanic cell\'s state', () => {
    // the same map with each mechanic in each state: the room layout and the furniture/shell/floor extract agree (the
    // blocked states rest on Task 5's "mechanic cells are floor" rule in room.ts)
    for (const states of [['0', '1', '2'], ['6', '7'], ['8', '9']]) {      // ice; barrier on/off; toggle wall down/up
      const out = extractStates(states);
      for (const o of out) expect(o.report.every((r) => r.ok)).toBe(true);
      for (const o of out.slice(1)) expect(digestPayloads(o)).toBe(digestPayloads(out[0]));
    }
  });
});
