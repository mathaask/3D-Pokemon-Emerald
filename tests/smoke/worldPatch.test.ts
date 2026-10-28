// The incremental world update on real maps (Phase 4b Task 3, needs the ROM and, for the decomp's edit lists,
// vendor/pokeemerald-src): a runtime grid change patched in place (World.patch) draws exactly what a rebuild of the changed
// grid draws — the worlds' digests (helpers/worldDigest.ts) agree, in both styles — and every change the patch must not
// take is refused with its reason (the world then rebuilds). A live family's no-op `apply` makes the digests differ (F8).
//   npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/worldPatch.test.ts

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import { loadStaticMap, type StaticMap } from './helpers/staticMap';
import { worldDigest } from './helpers/worldDigest';
import { MetatileAtlas } from '../../src/render/overworld/metatileAtlas';
import { World, PATCH_MAX_CELLS, artAnalysis, type GridData, type WorldStyle, type PatchResult } from '../../src/render/overworld/world';
import { analyze, cellFeatures, queries } from '../../src/render/overworld/analyze';
import { createHdWorldMaterials, createWorldMaterials } from '../../src/render/overworld/materials';
import { createKitUniforms } from '../../src/render/kit/materials';
import { gridEvents } from '../../src/render/kit/events';
import { FAMILIES } from '../../src/render/kit/index';
import { INTERIOR_FAMILIES } from '../../src/render/kit/interior/index';
import { interiorId } from '../../src/render/kit/tables/building';
import { CLAIM_OBJECT, CLAIM_SURFACE, CLAIM_TOP } from '../../src/render/overworld/claims';
import { changedCells } from '../../src/render/overworld/gridDiff';
import type { Family } from '../../src/render/kit/semantics';
import { editRaw, metatileId, scriptEdits, type DecompEdit } from '../../tools/lib/decompEdits';

const hasDecomp = fs.existsSync(path.resolve(import.meta.dirname, '../../vendor/pokeemerald-src'));

const atlas = new MetatileAtlas({ vram: null, palette: null } as never, 1);
const u = createKitUniforms();
// (the view's: today's legacy materials, with their HD twins for the cells the interior kit leaves)
const mats = { ...createWorldMaterials(atlas.target.texture, u), hd: createHdWorldMaterials(atlas.target.texture, u) };
const world = new World(atlas, mats, u);
/** A new World on the same atlas, materials and uniforms (the rebuilt world a patched one is compared with). */
const fresh = (interiorFamilies: readonly Family<unknown>[] = INTERIOR_FAMILIES) => new World(atlas, mats, u, FAMILIES, interiorFamilies);
let warn: ReturnType<typeof vi.spyOn>;
beforeAll(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { warn.mockRestore(); world.dispose(); });

const maps = new Map<string, StaticMap>();
const map = (g: number, n: number) => {
  const k = `${g}.${n}`;
  let s = maps.get(k);
  if (!s) maps.set(k, (s = loadStaticMap(g, n)));
  return s;
};
const ctxOf = (g: number, n: number, style: WorldStyle) =>
  ({ style, events: gridEvents(map(g, n).map.events, 0), quality: 'medium' as const, mapKey: `${g}.${n}` });
/** A copy of the map's grid with the edits applied (the game's MapGridSetMetatileIdAt: elevation kept). */
const edited = (s: StaticMap, edits: readonly DecompEdit[]): GridData => {
  const cells = s.grid.cells.slice();
  for (const e of edits) cells[e.y * s.grid.width + e.x] = editRaw(cells[e.y * s.grid.width + e.x], e);
  return { ...s.grid, cells };
};
const at = (x: number, y: number, label: string, blocked = false): DecompEdit => ({ x, y, metatile: metatileId(label), blocked, label });

/** Builds map g.n, patches the edits in, and builds the edited grid afresh: the patch's result and whether both worlds
 *  digest alike (and the patched world's digest before the patch, `before`). */
const patchVsBuild = (g: number, n: number, style: WorldStyle, edits: readonly DecompEdit[], w: World = world,
  families?: readonly Family<unknown>[]) => {
  const s = map(g, n), ctx = ctxOf(g, n, style);
  w.build(s.grid, s.opts, ctx);
  const before = worldDigest(w);
  const next = edited(s, edits);
  const r = w.patch(next, changedCells(s.grid.cells, next.cells), ctx);
  const other = fresh(families);
  other.build(next, s.opts, ctx);
  const same = worldDigest(w) === worldDigest(other);
  other.dispose();
  return { r, same, before, after: worldDigest(w) };
};

// Sootopolis Gym 1F's first ice field (the harness's i_pz_sootopolis cells; METATILE_SootopolisGym_Ice_*: field_tasks.c)
const ICE = [[7, 19], [8, 19], [8, 18], [9, 18]];
const crack = (g: number, n: number, k: number) => { expect(`${g}.${n}`).toBe('15.0'); return ICE.slice(0, k).map(([x, y]) => at(x, y, 'METATILE_SootopolisGym_Ice_Cracked')); };
const broken = (g: number, n: number, k: number) => { expect(`${g}.${n}`).toBe('15.0'); return ICE.slice(3, 3 + k).map(([x, y]) => at(x, y, 'METATILE_SootopolisGym_Ice_Broken')); };
// the harness's o_* edits: Fortree's bridge lowered (0.4), Route 113's ash cleared (0.28), Pacifidlog's logs sunk (0.15)
const fortreeBridge = (k: number) => [15, 16, 17, 18].slice(0, k).map((x) => at(x, 14, 'METATILE_Fortree_BridgeOverTrees_Lowered'));
const ash = (k: number) => [44, 45, 46, 47].slice(0, k).map((x) => at(x, 3, 'METATILE_Fallarbor_NormalGrass'));
const logSunk = () => [at(4, 17, 'METATILE_Pacifidlog_SubmergedLogs_HorizontalLeft'), at(5, 17, 'METATILE_Pacifidlog_SubmergedLogs_HorizontalRight')];
/** `k` cells of map g.n changed (their metatile id's low bit flipped). */
const manyEdits = (g: number, n: number, k: number): DecompEdit[] => {
  const s = map(g, n);
  return Array.from({ length: k }, (_, j) => {
    const raw = s.grid.cells[j];
    return { x: j % s.grid.width, y: (j / s.grid.width) | 0, metatile: (raw & 0x3ff) ^ 1, blocked: (raw & 0x0c00) !== 0, label: `#${j}` };
  });
};
const blockedAt = (g: number, n: number, e: DecompEdit) => (map(g, n).grid.cells[e.y * map(g, n).grid.width + e.x] & 0x0c00) !== 0;
/** The first cell of map g.n whose interior id is `id`. */
const cellOf = (g: number, n: number, id: string) => {
  const s = map(g, n);
  for (let y = 0; y < s.grid.height; y++) for (let x = 0; x < s.grid.width; x++) {
    const m = s.grid.cells[y * s.grid.width + x] & 0x3ff;
    if (interiorId(m, s.info.attributes[m] & 0xff, s.opts.secondaryTileset ?? 0) === id) return { x, y };
  }
  throw new Error(`no ${id} on ${g}.${n}`);
};
/** The gyms and Trick House rooms whose scripts set metatiles (their scripts.inc), out of scope until Task 7: legacy in
 *  both styles. */
const PUZZLE_MAPS: [number, number, string][] = [[8, 1, 'PetalburgCity_Gym'], [10, 0, 'MauvilleCity_Gym'], [14, 0, 'MossdeepCity_Gym'],
  [15, 0, 'SootopolisCity_Gym_1F'], [29, 3, 'Route110_TrickHousePuzzle1'], [29, 4, 'Route110_TrickHousePuzzle2'],
  [29, 5, 'Route110_TrickHousePuzzle3'], [29, 9, 'Route110_TrickHousePuzzle7']];

describe.skipIf(!hasDecomp)('World.patch: legacy cells (decomp edits)', () => {
  it('patches legacy cells in place and draws exactly what a rebuild draws', () => {
    // Sootopolis Gym 1F (out of scope until Task 7: legacy in both styles): three cracked, one broken ice cell
    const ice = [...crack(15, 0, 3), ...broken(15, 0, 1)];
    for (const style of ['modern', 'retro'] as const) {
      const { r, same, before, after } = patchVsBuild(15, 0, style, ice);
      expect(r, style).toMatchObject({ ok: true, live: 0, legacy: 4 });
      expect(same, style).toBe(true);
      expect(after, `${style}: the patch changed what the digest sees`).not.toBe(before);
      expect(world.patches).toBeGreaterThan(0);
    }
    // the harness's other visual-only edits: Petalburg's doors at slide frame 4, the Lilycove Museum's cool painting
    const doors = [1, 7].flatMap((x) => [at(x, 52, 'METATILE_PetalburgGym_SlidingDoor_Frame4', true), at(x, 53, 'METATILE_PetalburgGym_SlidingDoor_Frame4+8', true)]);
    const painting = scriptEdits('LilycoveCity_LilycoveMuseum_2F', 'LilycoveCity_LilycoveMuseum_2F_EventScript_SetCoolPainting');
    for (const style of ['modern', 'retro'] as const) {
      for (const [g, n, edits] of [[8, 1, doors], [13, 3, painting]] as const) {
        const { r, same } = patchVsBuild(g, n, style, edits);
        expect(r, `${g}.${n} ${style}`).toMatchObject({ ok: true, live: 0, legacy: edits.length });
        expect(same, `${g}.${n} ${style}`).toBe(true);
      }
    }
  });

  it('patches every script edit of the gyms and the Trick House that keeps its shape, and refuses the rest', () => {
    const lines: string[] = [];
    for (const [g, n, name] of PUZZLE_MAPS) {
      const tally = new Map<string, number>();
      for (const e of scriptEdits(name)) {
        const { r, same } = patchVsBuild(g, n, 'retro', [e]);
        if (r.ok) expect(same, `${name} ${e.label} ${e.x},${e.y}`).toBe(true);
        else expect(['structure', 'quads'], `${name} ${e.label} ${e.x},${e.y}`).toContain(r.reason);
        const k = r.ok ? 'patched' : r.reason;
        tally.set(k, (tally.get(k) ?? 0) + 1);
      }
      lines.push(`${g}.${n} ${name}: ${[...tally].map(([k, v]) => `${k} ${v}`).join(', ')}`);
    }
    console.log(`[worldPatch] script edits, Retro:\n  ${lines.join('\n  ')}`);
  });

  it('reads an art-only change as analyze does (cellFeatures equal: artAnalysis = a fresh analysis, every array)', () => {
    const KEYS = ['mt', 'col', 'elev', 'beh', 'layer', 'kind', 'roundTree', 'building', 'height', 'waterLevel', 'groundOf', 'groundSrc',
      'groundH', 'groundRefs', 'real3ff'] as const;
    let art = 0;
    const cases: [number, number, DecompEdit[]][] = [];
    for (const [g, n, name] of PUZZLE_MAPS) for (const e of scriptEdits(name)) cases.push([g, n, [e]]);
    cases.push([15, 0, [...crack(15, 0, 3), ...broken(15, 0, 1)]], [0, 4, fortreeBridge(4)], [0, 28, ash(4)], [0, 15, logSunk()],
      [13, 3, scriptEdits('LilycoveCity_LilycoveMuseum_2F', 'LilycoveCity_LilycoveMuseum_2F_EventScript_SetCoolPainting')],
      ...[1, 2, 3, 4].map((k): [number, number, DecompEdit[]] => [8, 1, [1, 7].flatMap((x) => [at(x, 52, `METATILE_PetalburgGym_SlidingDoor_Frame${k}`, true),
        at(x, 53, `METATILE_PetalburgGym_SlidingDoor_Frame${k}+8`, true)])]));
    for (const [g, n, edits] of cases) {
      const s = map(g, n), W = s.grid.width;
      const a = analyze(s.grid, { ...s.opts, margin: 14 });
      const next = edited(s, edits);
      const ch = changedCells(s.grid.cells, next.cells);
      if (!ch.length || !ch.every((k) => { const f = cellFeatures(s.grid.cells[k], s.opts); return f >= 0 && f === cellFeatures(next.cells[k], s.opts); })) continue;
      art++;
      const got = artAnalysis(a, ch.map((k) => ({ i: a.idx(k % W, (k / W) | 0), raw: next.cells[k] })));
      const want = analyze(next, { ...s.opts, margin: 14 });
      for (const key of KEYS) expect([...got[key]], `${g}.${n} ${edits[0].label} ${key}`).toEqual([...want[key]]);
      expect(got.buildings).toEqual(want.buildings);
      for (let i = 0; i < a.N; i++) if (got.hasTop(i) !== want.hasTop(i)) expect.fail(`${g}.${n} hasTop ${i}`);
      expect(queries(got).dominantFloor).toBe(queries(want).dominantFloor);
    }
    console.log(`[worldPatch] art-only cases checked against analyze: ${art} of ${cases.length}`);
    expect(art).toBeGreaterThanOrEqual(96);                                // (96 of 274 at Task 3)
  });

  it('refuses on an outdoor Modern map and over the cap', () => {
    expect(patchVsBuild(0, 4, 'modern', fortreeBridge(4)).r).toEqual({ ok: false, reason: 'outdoorKit' });
    const lines: string[] = [];
    for (const [g, n, edits] of [[0, 4, fortreeBridge(4)], [0, 28, ash(4)], [0, 15, logSunk()]] as const) {
      const { r, same } = patchVsBuild(g, n, 'retro', edits);                // Retro: legacy only (user answer 1)
      if (r.ok) expect(same, `${g}.${n}`).toBe(true);                        // F29: digests, not just ok
      else expect(['structure', 'quads']).toContain(r.reason);
      lines.push(`${g}.${n}: ${r.ok ? `patched in ${r.ms.toFixed(2)} ms` : r.reason}`);
    }
    console.log(`[worldPatch] outdoor edits, Retro: ${lines.join('; ')}`);
    expect(PATCH_MAX_CELLS).toBe(256);
    expect(patchVsBuild(29, 5, 'retro', manyEdits(29, 5, 300)).r).toEqual({ ok: false, reason: 'tooMany' });
  });

  it('refuses a collision change in Retro (F3)', () => {
    const e = scriptEdits('MauvilleCity_Gym').find((x) => x.blocked !== blockedAt(10, 0, x))!;
    expect(e).toBeDefined();
    expect(patchVsBuild(10, 0, 'retro', [e]).r).toEqual({ ok: false, reason: 'structure' });
  });

  it('refuses a claimed cell no family follows', () => {
    // an in-scope Phase 4 room: a furniture cell changed (no LiveCells there)
    expect(patchVsBuild(1, 0, 'modern', [{ ...cellOf(1, 0, 'table'), metatile: 0x201, blocked: true, label: 't' }]).r)
      .toEqual({ ok: false, reason: 'claimedNotLive' });
  });
});

// ---- live cells: a fake family on Brendan's house 1F (1.0, in scope) whose one cell follows changes in place. Its cell
// (5,3) is a `boards` floor cell (0x201) with floor on all four sides; 0x205 is another `boards` id, and no blocked cell
// takes (5,3) as its ground (analyze's groundOf), so swapping them changes nothing but the cell's own art.
const L = { x: 5, y: 3, from: 0x201, to: 0x205 };
const OTHER = { x: 6, y: 3, to: 0x205 };   // another such cell (for the stale-analysis case)

interface FakeOpts { noop?: boolean; failBuild?: boolean }
/** The fake live family: claims L whole, draws a quad over it and keeps the cell's state (metatile, collision,
 *  elevation) in a DataTexture on the mesh's userData.stateTexture (F8), as the puzzle family will; its LiveCells
 *  accepts any change of L and writes it there (or, `noop`, does nothing). `failBuild`: its build throws. */
function fakeLive(o: FakeOpts, applies: { n: number }): Family<number> {
  const texel = (raw: number) => [raw & 0xff, (raw >> 8) & 3, (raw >> 10) & 3 ? 1 : 0, raw >> 12];
  return {
    name: 'fakeLive',
    extract(ctx, claims) {
      const i = ctx.a.idx(L.x, L.y);
      claims.claim(i, CLAIM_SURFACE | CLAIM_OBJECT | CLAIM_TOP);
      return i;
    },
    build(i, ctx) {
      if (o.failBuild) throw new Error('fakeLive made to fail');
      const a = ctx.a;
      const tex = new THREE.DataTexture(new Uint8Array(texel(a.mt[i] | (a.col[i] ? 0x0c00 : 0) | (a.elev[i] << 12))), 1, 1);
      tex.needsUpdate = true;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(L.x + 0.5, 0.01, L.y + 0.5),
        new THREE.MeshBasicMaterial({ color: 0x808080 }));
      mesh.userData.stateTexture = tex;
      return mesh;
    },
    live(i, built) {
      const tex = (built as THREE.Mesh).userData.stateTexture as THREE.DataTexture;
      return {
        name: 'fakeLive', cells: new Set([i]),
        accepts: () => true,
        apply(_, raw) {
          applies.n++;
          if (o.noop) return;
          (tex.image.data as Uint8Array).set(texel(raw));
          tex.needsUpdate = true;
        },
      };
    },
  };
}

describe('World.patch: live cells (a fake family)', () => {
  const swap = (x: number, y: number, to: number): DecompEdit => {
    const raw = map(1, 0).grid.cells[y * map(1, 0).grid.width + x];
    return { x, y, metatile: to, blocked: (raw & 0x0c00) !== 0, label: `${x},${y}` };
  };
  const run = (o: FakeOpts, edits: DecompEdit[]) => {
    const applies = { n: 0 };
    const w = fresh([fakeLive(o, applies)]);
    const builds = () => w.builds;
    const res = patchVsBuild(1, 0, 'modern', edits, w, [fakeLive(o, { n: 0 })]);
    const out = { ...res, applies: applies.n, builds: builds(), kitReport: w.kitReport.map((r) => `${r.name}:${r.ok}`) };
    w.dispose();
    return out;
  };

  it('the fixture: L and OTHER are boards floor cells with the ids the comment names', () => {
    const s = map(1, 0), sec = s.opts.secondaryTileset ?? 0;
    for (const [x, y, m] of [[L.x, L.y, L.from], [L.x, L.y, L.to], [OTHER.x, OTHER.y, OTHER.to]]) {
      expect(interiorId(m, s.info.attributes[m] & 0xff, sec), `${x},${y} 0x${m.toString(16)}`).toBe('boards');
    }
    expect(s.grid.cells[L.y * s.grid.width + L.x] & 0x3ff).toBe(L.from);
    expect(s.grid.cells[L.y * s.grid.width + L.x] & 0x0c00).toBe(0);
  });

  it('applies a live cell through its family: one apply, no build, the digest a rebuild\'s', () => {
    const r = run({}, [swap(L.x, L.y, L.to)]);
    expect(r.kitReport).toEqual(['fakeLive:true']);
    expect(r.r).toMatchObject({ ok: true, live: 1, legacy: 0 });
    expect(r.applies).toBe(1);
    expect(r.builds).toBe(1);                                  // (the one build before the patch)
    expect(r.after).not.toBe(r.before);
    expect(r.same).toBe(true);
  });

  it('a no-op apply patches "ok" but the digests differ (F8: the digest sees the live path)', () => {
    const r = run({ noop: true }, [swap(L.x, L.y, L.to)]);
    expect(r.r).toMatchObject({ ok: true, live: 1, legacy: 0 });
    expect(r.applies).toBe(1);
    expect(r.same).toBe(false);
  });

  it('a family whose build fails drops its claims and live cells: its cell patches as legacy (inert, F13)', () => {
    const r = run({ failBuild: true }, [swap(L.x, L.y, L.to)]);
    expect(r.kitReport).toEqual(['fakeLive:false']);
    expect(r.r).toMatchObject({ ok: true, live: 0, legacy: 1 });
    expect(r.applies).toBe(0);
    expect(r.same).toBe(true);
  });

  it('keeps the analysis of the build grid: a live collision change, then a legacy change elsewhere, both patch (F31)', () => {
    const applies = { n: 0 };
    const w = fresh([fakeLive({}, applies)]);
    const s = map(1, 0), ctx = ctxOf(1, 0, 'modern');
    w.build(s.grid, s.opts, ctx);
    // L blocked (its collision: Floor → Block in a fresh analysis), then OTHER's art swapped
    const g1 = edited(s, [{ ...swap(L.x, L.y, L.from), blocked: true }]);
    const r1: PatchResult = w.patch(g1, changedCells(s.grid.cells, g1.cells), ctx);
    expect(r1).toMatchObject({ ok: true, live: 1, legacy: 0 });
    const g2: GridData = { ...g1, cells: g1.cells.slice() };
    const o = OTHER.y * s.grid.width + OTHER.x;
    g2.cells[o] = (g2.cells[o] & 0xfc00) | OTHER.to;
    const r2 = w.patch(g2, changedCells(g1.cells, g2.cells), ctx);
    expect(r2).toMatchObject({ ok: true, live: 0, legacy: 1 });
    expect(applies.n).toBe(1);
    expect(w.patches).toBe(2);
    w.dispose();
  });

  it('refuses a claimed cell its family declines, and an unclaimed cell whose interior id changes (F13)', () => {
    const decline: Family<number> = { ...fakeLive({}, { n: 0 }) };
    decline.live = (i) => ({ name: 'fakeLive', cells: new Set([i]), accepts: () => false, apply: () => { throw new Error('not accepted'); } });
    const w = fresh([decline]);
    expect(patchVsBuild(1, 0, 'modern', [swap(L.x, L.y, L.to)], w, [decline]).r).toEqual({ ok: false, reason: 'claimedNotLive' });
    // OTHER (boards) → a table id: the families could see it (interior ids are their input)
    const t = cellOf(1, 0, 'table'), s = map(1, 0);
    const tableId = s.grid.cells[t.y * s.grid.width + t.x] & 0x3ff;
    expect(patchVsBuild(1, 0, 'modern', [{ ...swap(OTHER.x, OTHER.y, tableId) }], w, [decline]).r).toEqual({ ok: false, reason: 'notInert' });
    w.dispose();
  });

  it('never throws: a family whose apply throws is the refusal \'error\', warned once per map', () => {
    const boom: Family<number> = { ...fakeLive({}, { n: 0 }) };
    boom.live = (i) => ({ name: 'fakeLive', cells: new Set([i]), accepts: () => true, apply: () => { throw new Error('boom'); } });
    const w = fresh([boom]);
    const n0 = warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes('patch failed on map 1.0')).length;
    for (let k = 0; k < 2; k++) {
      expect(patchVsBuild(1, 0, 'modern', [swap(L.x, L.y, L.to)], w, [boom]).r).toEqual({ ok: false, reason: 'error' });
    }
    expect(warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes('patch failed on map 1.0')).length - n0).toBe(1);
    w.dispose();
  });
});
