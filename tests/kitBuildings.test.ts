import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { addBox, buildingKind, buildingFamily, clearGround, type BuildingPlacement } from '../src/render/kit/buildings';
import { buildingLayout } from '../src/render/kit/footprints';
import { MeshBuilder } from '../src/render/kit/geom';
import { treeFamily } from '../src/render/kit/trees';
import { analyze, K, type MapAnalysis } from '../src/render/overworld/analyze';
import { Claims, CLAIM_OBJECT, CLAIM_SURFACE, CLAIM_TOP } from '../src/render/overworld/claims';
import { emitLegacy } from '../src/render/overworld/legacyQuads';
import { createKitUniforms } from '../src/render/kit/materials';
import { disposeKit } from '../src/render/kit/semantics';
import { pokeballTexture } from '../src/render/kit/text';
import type { GridEvents } from '../src/render/kit/events';
import { MB } from '../src/game/behaviors';
import { fakeInfo } from './helpers/fakeMap';

describe('buildingKind', () => {
  const cases: [string | null, number, string][] = [
    ['OldaleTown_PokemonCenter_1F', 5, 'pc'],
    ['OldaleTown_Mart', 4, 'mart'],
    ['PetalburgCity_Gym', 8, 'gym'],
    ['LavaridgeTown_Gym_1F', 8, 'gym'],
    ['LittlerootTown_ProfessorBirchsLab', 7, 'lab'],
    ['LittlerootTown_BrendansHouse_1F', 5, 'house'],
    ['OldaleTown_House1', 4, 'house'],
    ['LilycoveCity_LilycoveMuseum_1F', 9, 'special'],
    ['MAP_127_127', 5, 'special'],
    [null, 5, 'house'],
    [null, 8, 'special'],
  ];
  for (const [dest, w, want] of cases) it(`${dest} → ${want}`, () => expect(buildingKind(dest, w)).toBe(want));
});

describe('building extract', () => {
  it('finds the footprint, door and kind of a building', () => {
    const info = fakeInfo();
    info.attributes[4] = MB.ANIMATED_DOOR;
    const rows = ['.....', '.###.', '.###.', '.#D#.', '.....'];
    const w = 5, h = rows.length;
    const cells = new Uint16Array(w * h);
    rows.forEach((r, y) => [...r].forEach((ch, x) => {
      cells[y * w + x] = ch === '#' ? 2 | 0x0400 : ch === 'D' ? 4 | 0x0400 : 1 | 0x3000;
    }));
    const a = analyze({ width: w, height: h, cells, border: [1, 1, 1, 1], borderW: 2, borderH: 2, borderPhase: 0 },
      { info, generalPrimary: false, indoor: false, underground: false, underwater: false, margin: 1 });
    const claims = new Claims(a.N);
    const out = buildingFamily.extract(
      { a, events: { warps: [{ x: 2, y: 3, dest: 'OldaleTown_Mart' }], signs: [] }, quality: 'medium' }, claims);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'mart', x0: 1, x1: 3, top: 1, bottom: 3, doorX: 2, wallRows: 2 });
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) expect(claims.has(a.idx(x, y), CLAIM_OBJECT)).toBe(true);
  });
});

/** BGR555 pixel of an sRGB colour given in 31sts. */
const px = (r: number, g: number, b: number) => r | (g << 5) | (b << 10);
const ASH_LEAF = px(19, 23, 12);
const T = {
  ground: 1, wall: 2, roof: 3, door: 4, post: 5, steps: 6, fence: 7, other: 8, grass: 9, hedge: 10, blueWall: 11,
  walkDoor: 12, walkway: 13, teal: 14, bush: 15, corner: 16, sea: 17, blue: 18, lawn: 19,
  ashA: 0x220, ashB: 0x221, rock: 0x222,
};
const CREAM = px(28, 25, 20), LAWN_A = px(10, 22, 8), LAWN_B = px(12, 26, 10);
/** The lawn's colour at x within a tile: stripes, LAWN_A at even x, LAWN_B at odd x. */
const lawn = (x: number) => (x % 2 ? LAWN_B : LAWN_A);

/**
 * Synthetic outdoor map (secondary tiles only, margin 2). Cells: '.' ground, 'g' grass, 'W' house
 * wall, 'R' roof, 'D' door, 'p' a post (sign post / lamp post / fence), 's' the building's
 * walkable front steps, 'f' a fence, 'O' another building's wall, 'h' a hedge, 'w' a pale blue
 * wall, 'A' / 'a' ash-forest blocks, 'd' a walk-in door (walkable, NON_ANIMATED_DOOR), 'x' a
 * treehouse walkway (walkable, NO_RUNNING), 'L' a teal wall the analysis takes for leaves, 'b' a
 * bush, ',' a striped lawn, 'C' a wall's corner drawn over the lawn (its bottom left), '~'
 * the sea, 'B' a blue harbour wall (the analysis reads it as water beside the sea),
 * '#' rock. `border` defaults to rock (terrain: repeated all around the map). `general`: the
 * tiles are the General tileset's.
 */
function map(rows: string[], border = [T.rock, T.rock, T.rock, T.rock], underwater = false, general = false): MapAnalysis {
  const info = fakeInfo();
  const fill = (m: number, c: number, from = 0, to = 256) => {
    for (let p = from; p < to; p++) { info.both[m * 256 + p] = c; info.bottom[m * 256 + p] = c; }
  };
  fill(T.ground, px(26, 24, 18)); fill(T.grass, px(14, 24, 20)); fill(T.steps, px(22, 22, 22));
  // a cream wall with a blue window, drawn mostly in a navy outline shade
  fill(T.wall, px(8, 9, 13)); fill(T.wall, px(28, 25, 20), 100, 192); fill(T.wall, px(16, 24, 30), 192, 256);
  fill(T.blueWall, px(23, 25, 28)); // a Mart's pale blue wall
  fill(T.roof, px(8, 9, 13)); fill(T.roof, px(26, 9, 8), 160); // a red roof, mostly navy outlines
  fill(T.door, px(18, 11, 6)); fill(T.post, px(12, 12, 14));
  fill(T.fence, px(20, 14, 9)); fill(T.other, px(25, 25, 8)); fill(T.hedge, px(8, 22, 6)); info.green[T.hedge] = 0.9; info.attributes[T.hedge] = 1 << 12; // (covered: no tree)
  fill(T.ashA, ASH_LEAF); fill(T.ashA, px(21, 21, 17), 0, 100); info.green[T.ashA] = 0.4;
  fill(T.ashB, ASH_LEAF); fill(T.ashB, px(21, 21, 17), 0, 140); info.green[T.ashB] = 0.3;
  fill(T.rock, px(18, 16, 14));
  info.attributes[T.door] = MB.ANIMATED_DOOR;
  fill(T.walkDoor, px(4, 4, 6)); info.attributes[T.walkDoor] = MB.NON_ANIMATED_DOOR;
  fill(T.walkway, px(20, 16, 10)); info.attributes[T.walkway] = MB.NO_RUNNING;
  fill(T.teal, px(8, 22, 22)); info.green[T.teal] = 0.7; // (green enough for the analysis' trees)
  fill(T.bush, px(8, 22, 6)); info.green[T.bush] = 0.9;
  fill(T.sea, px(6, 12, 28)); info.attributes[T.sea] = MB.OCEAN_WATER; info.blue[T.sea] = 1;
  fill(T.blue, px(10, 14, 30)); info.blue[T.blue] = 0.8;
  for (let p = 0; p < 256; p++) { info.both[T.lawn * 256 + p] = lawn(p & 15); info.bottom[T.lawn * 256 + p] = lawn(p & 15); }
  // the wall's bottom-left corner cut off: the lawn shows there (bottom layer, top transparent);
  // a detail at the foot of the wall drawn in the bottom layer, in the lawn's other stripe colour
  for (let p = 0; p < 256; p++) {
    const ground = (p >> 4) - (p & 15) >= 8, detail = p === 15 * 16 + 12;
    info.both[T.corner * 256 + p] = ground ? lawn(p & 15) : detail ? LAWN_B : CREAM;
    info.bottom[T.corner * 256 + p] = ground ? lawn(p & 15) : detail ? LAWN_B : 0x8000;
  }
  const code: Record<string, number> = {
    '.': T.ground | 0x3000, g: T.grass | 0x3000, s: T.steps | 0x3000, W: T.wall | 0x0400, R: T.roof | 0x0400,
    D: T.door | 0x0400, p: T.post | 0x0400, f: T.fence | 0x0400, O: T.other | 0x0400,
    h: T.hedge | 0x0400, w: T.blueWall | 0x0400, A: T.ashA | 0x0400, a: T.ashB | 0x0400, '#': T.rock | 0x0400,
    d: T.walkDoor | 0x3000, x: T.walkway | 0x3000, L: T.teal | 0x0400, b: T.bush | 0x0400, C: T.corner | 0x0400,
    '~': T.sea | 0x0400, B: T.blue | 0x0400, ',': T.lawn | 0x3000,
  };
  const w = rows[0].length, h = rows.length;
  const cells = new Uint16Array(w * h);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { cells[y * w + x] = code[ch]; }));
  return analyze({ width: w, height: h, cells, border, borderW: 2, borderH: 2, borderPhase: 0 },
    { info, generalPrimary: general, indoor: false, underground: false, underwater, margin: 2 });
}

const run = (a: MapAnalysis, events: GridEvents, claims = new Claims(a.N)) =>
  ({ claims, out: buildingFamily.extract({ a, events, quality: 'medium' }, claims) });
const ev = (warps: [number, number, string][], signs: [number, number][] = []): GridEvents =>
  ({ warps: warps.map(([x, y, dest]) => ({ x, y, dest })), signs: signs.map(([x, y]) => ({ x, y })) });
const box = (p: BuildingPlacement) => [p.x0, p.x1, p.top, p.bottom];

describe('building footprints', () => {
  it('builds nothing on a Dive map, and claims nothing there', () => {
    const rows = ['.....', '.RRR.', '.WDW.', '.....'];
    const { out, claims } = run(map(rows, undefined, true), ev([[2, 2, 'OldaleTown_House1']]));
    expect(out).toEqual([]);
    expect(claims.bits.every((b) => b === 0)).toBe(true);
    expect(run(map(rows), ev([[2, 2, 'OldaleTown_House1']])).out).toHaveLength(1);
  });

  it('leaves out what the door flood fill swallowed: terrain, a lamp post behind, a sign post beside', () => {
    // rock masses touching the house's sides (the fill takes them), a lamp post standing on the
    // roof's back edge, a sign post at the door row
    const a = map([
      '...p.....',
      '...p.....',
      '##.RRRR##',
      '##.WWWW##',
      '##.WDWWp.',
      '.........',
    ]);
    const { out, claims } = run(a, ev([[4, 4, 'OldaleTown_House1']], [[7, 4]]));
    expect(out).toHaveLength(1);
    expect(box(out[0])).toEqual([3, 6, 2, 4]);
    const layout = buildingLayout(a, ev([[4, 4, 'OldaleTown_House1']], [[7, 4]]));
    for (const [x, y] of [[0, 3], [8, 3], [3, 0], [3, 1], [7, 4]]) {
      expect(a.building[a.idx(x, y)]).toBeGreaterThanOrEqual(0); // the fill took them...
      expect(claims.has(a.idx(x, y), CLAIM_OBJECT)).toBe(false); // ...the model does not
    }
    expect(layout.stray[a.idx(0, 3)]).toBe(1);
    expect(layout.stray[a.idx(4, 3)]).toBe(0);
    // the lamp post's foot on the row above the roof is not the roof's edge
    expect(claims.has(a.idx(3, 1), CLAIM_OBJECT)).toBe(false);
  });

  it('keeps a sign on its own wall, the walkable front steps under its wall, and a fence before it', () => {
    const a = map([
      '..........',
      '.RRRRRR...',
      '.WWWWWW...',
      '.sWWDWs...',
      '..ff.f....',
      '..........',
    ]);
    const events = ev([[4, 3, 'PetalburgCity_Gym']], [[5, 3]]);
    const { out, claims } = run(a, events);
    expect(box(out[0])).toEqual([1, 6, 1, 3]);
    expect(out[0].recess).toEqual([1, 0, 0, 0, 0, 1]);
    // the steps stay walkable ground: not under the model (the walls stand behind them)
    for (const x of [1, 6]) expect(claims.has(a.idx(x, 3), CLAIM_OBJECT)).toBe(false);
    for (const x of [1, 6]) expect(claims.has(a.idx(x, 2), CLAIM_OBJECT)).toBe(true);
    const root = buildingFamily.build(out, { a, events, quality: 'medium' }, kitCtx())!;
    // walking north into the door row at chest height: the wall is the step cell's back edge
    // (z = 3) over the steps, the door row's front edge (z = 4) over the bay between them
    for (const [x, z] of [[1.5, 3], [6.5, 3], [2.5, 4], [4.5, 4], [5.5, 4]]) expect(Math.abs(firstWallZ(root, x, 0.8) - z)).toBeLessThan(0.15);
    // nothing of the model over a step cell below head height
    expect(hitsBelow(root, 1.5, 3.5, 1.6)).toBe(false);
    // plain ground at a corner is not a step: the building stops before it
    const b = map(['.......', '.RRRR..', '.WWWW..', '..WDW..', '.......']);
    expect(box(run(b, ev([[3, 3, 'OldaleTown_House1']])).out[0])).toEqual([2, 4, 1, 3]);
  });

  it('parts neighbours the flood fill joined, and trims a hedge row along the back', () => {
    const a = map([
      '.hhhh.....',
      '.RRRRRRRR.',
      '.WWWWOOOO.',
      '.WDWWODOO.',
      '..........',
    ]);
    const { out } = run(a, ev([[2, 3, 'MauvilleCity_House2'], [6, 3, 'MauvilleCity_Mart']]));
    expect(a.buildings).toHaveLength(1);
    expect(out.map((p) => [p.kind, ...box(p)])).toEqual([['house', 1, 4, 1, 3], ['mart', 5, 8, 1, 3]]);
  });

  it('leaves out a sign post walled in beside the house, and a fence running on past the door row', () => {
    // the cell above the sign post has no way in (as at the Glass Workshop): without the sign
    // event the post would pass for the building's art
    const a = map(['........', '##RRRf..', '#.WWWf..', '.pWDWf..', '.....f..', '........']);
    const out = run(a, ev([[3, 3, 'OldaleTown_House1']], [[1, 3]])).out;
    expect(box(out[0])).toEqual([2, 4, 1, 3]);
  });

  it('stops at the crater rock around a house carved into it (Sootopolis), and at a tall door', () => {
    const a = map(['#####', '#RRR#', '#WDW#', '#...#', '#...#']);
    expect(box(run(a, ev([[2, 2, 'SootopolisCity_House1']])).out[0])).toEqual([1, 3, 1, 2]);
    // a door two cells tall (a tent): one building, its door the lower cell
    const b = map(['.....', '.RRR.', '.WDW.', '.WDW.', '.....']);
    const out = run(b, ev([[2, 3, 'VerdanturfTown_BattleTentLobby']])).out;
    expect(out.map(box)).toEqual([[1, 3, 1, 3]]);
    // a double door with one warp (a Pokémon Center): one building
    const c = map(['......', '.RRRR.', '.WDDW.', '......']);
    expect(run(c, ev([[2, 2, 'OldaleTown_PokemonCenter_1F']])).out.map(box)).toEqual([[1, 4, 1, 2]]);
  });

  it('leaves out a column with a cell the player can walk into below its top row', () => {
    // (3, 2) is open to the ground on its right: the model must not stand on it
    const a = map(['......', '.RRRR.', '.WWW..', '.WDWW.', '......']);
    expect(box(run(a, ev([[2, 3, 'OldaleTown_House1']])).out[0])).toEqual([1, 3, 1, 3]);
  });

  it('builds nothing for a door with nothing of its building above it', () => {
    const a = map(['......', '......', '.WDW..', '......']);
    expect(a.buildings).toHaveLength(1);
    const { out, claims } = run(a, ev([[2, 2, 'OldaleTown_House1']]));
    expect(out).toEqual([]);
    expect(claims.bits.every((b) => b === 0)).toBe(true);
  });

  it('leaves out a hedge beside the house', () => {
    const a = map(['......', '.RRRh.', '.WWWh.', '.WDWh.', '......']);
    expect(box(run(a, ev([[2, 3, 'OldaleTown_House1']])).out[0])).toEqual([1, 3, 1, 3]);
  });

  it('takes the walls and overhang of its footprint; the legacy art draws the roof edge above', () => {
    const a = map(['......', '..R...', '.RRRR.', '.WWWW.', '.WDWW.', '......']);
    const events = ev([[2, 4, 'OldaleTown_House1']]);
    const { out, claims } = run(a, events);
    expect(box(out[0])).toEqual([1, 4, 2, 4]);
    // The roof's lone edge cell on the row above is the building's (no stray block other families
    // could take), but the model never reaches that row: unclaimed, the legacy art stands there
    // as a block, so the cell the game blocks never shows as open ground.
    const edge = a.idx(2, 1);
    expect(buildingLayout(a, events).owner[edge]).toBe(1);
    expect(buildingLayout(a, events).stray[edge]).toBe(0);
    expect(claims.has(edge, CLAIM_OBJECT)).toBe(false);
    const legacy = emitLegacy(a, claims).quads;
    expect(legacy.some((q) => q.metatile === T.roof && q.a[0] === 2 && q.normal[2] === 1 && q.a[2] === 2)).toBe(true);
    for (let y = 2; y <= 4; y++) for (let x = 1; x <= 4; x++) expect(claims.has(a.idx(x, y), CLAIM_OBJECT)).toBe(true);
    for (let y = 2; y <= 4; y++) for (let x = 1; x <= 4; x++) expect(claims.groundY[a.idx(x, y)]).toBe(0);
    expect(claims.has(a.idx(0, 2), CLAIM_TOP)).toBe(false);
    // a walled-in walkable cell inside is under the model, on the ground before the door
    const b = map(['......', '.RRRR.', '.W.WW.', '.WDWW.', '......']);
    const r = run(b, ev([[2, 3, 'OldaleTown_House1']]));
    expect(box(r.out[0])).toEqual([1, 4, 1, 3]);
    expect(r.claims.has(b.idx(2, 2), CLAIM_OBJECT)).toBe(true);
    expect(r.claims.groundMt[b.idx(2, 2)]).toBe(T.ground);
    expect(r.claims.groundMt[b.idx(1, 2)]).toBe(T.ground);
  });

  it('finds windows and colours from the tiles', () => {
    const a = map(['......', '.RRRR.', '.WWWW.', '.WDWW.', '......']);
    const p = run(a, ev([[2, 3, 'OldaleTown_House1']])).out[0];
    expect(p.windows).toEqual([1, 3, 4]); // every wall column but the door's shows the blue window
    expect(p.roof[0]).toBeGreaterThan(p.roof[1] + 0.3); // red roof
    expect(p.wall[0]).toBeGreaterThan(0.8); // cream wall, not its outlines nor the window's blue
    // pale blue walls (a Mart) are no windows
    const b = map(['......', '.RRRR.', '.wwww.', '.wDww.', '......']);
    expect(run(b, ev([[2, 3, 'OldaleTown_Mart']])).out[0].windows).toEqual([]);
  });
});

describe("Route 113's Glass Workshop", () => {
  it('leaves the ash forest the flood fill swallowed to the tree family', () => {
    const a = map([
      'AaAaAaAaAaAaAaAaAa',
      'aAaAaAaAaAaARRRaAa',
      'AaAaAaAaAaAaWDWaAa',
      '..................',
      '..................',
    ], [T.ashA, T.ashB, T.ashB, T.ashA]);
    const events = ev([[13, 2, 'Route113_GlassWorkshop']]);
    const swallowed = [[9, 1], [10, 2], [16, 0], [17, 2]];
    for (const [x, y] of swallowed) expect(a.building[a.idx(x, y)]).toBeGreaterThanOrEqual(0);
    const claims = new Claims(a.N);
    const out = run(a, events, claims).out;
    expect(box(out[0])).toEqual([12, 14, 1, 2]);
    for (const [x, y] of swallowed) expect(claims.has(a.idx(x, y), CLAIM_OBJECT)).toBe(false);
    treeFamily.extract({ a, events, quality: 'medium' }, claims);
    for (const [x, y] of swallowed) expect(claims.has(a.idx(x, y), CLAIM_OBJECT)).toBe(true);
  });
});

describe('building build', () => {
  it('addBox writes six outward-facing faces', () => {
    const mb = new MeshBuilder();
    addBox(mb, 1, 2, 3, 2, 4, 6, [1, 0, 0]);
    const g = mb.build();
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    expect(p.count).toBe(36);
    const v = (i: number) => new THREE.Vector3().fromBufferAttribute(p, i);
    for (let t = 0; t < 12; t++) {
      const [a, b, c] = [v(3 * t), v(3 * t + 1), v(3 * t + 2)];
      const face = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      const normal = new THREE.Vector3().fromBufferAttribute(n, 3 * t);
      expect(face.dot(normal)).toBeGreaterThan(0); // counter-clockwise about its normal
      const out = a.clone().add(b).add(c).divideScalar(3).sub(new THREE.Vector3(1, 2, 3));
      expect(out.dot(normal)).toBeGreaterThan(0); // pointing away from the centre
    }
    g.computeBoundingBox();
    expect(g.boundingBox!.min.toArray()).toEqual([0, 0, 0]);
    expect(g.boundingBox!.max.toArray()).toEqual([2, 4, 6]);
  });

  it('builds body, roof and glass meshes that fade and cast shadows', () => {
    const a = map(['......', '.RRRR.', '.WWWW.', '.WDWW.', '......']);
    const ctx = { a, events: ev([[2, 3, 'OldaleTown_House1']]), quality: 'medium' as const };
    const out = buildingFamily.extract(ctx, new Claims(a.N));
    const kit = { uniforms: createKitUniforms(), quality: 'medium' as const, disposables: [] };
    const root = buildingFamily.build(out, ctx, kit)!;
    const meshes = root.children as THREE.Mesh[];
    expect(meshes).toHaveLength(3);
    for (const m of meshes) {
      expect(m.castShadow).toBe(true);
      expect((m.material as THREE.MeshStandardMaterial).defines!.KIT_FADE).toBeDefined();
    }
    expect((meshes[1].material as THREE.MeshStandardMaterial).defines!.KIT_PATTERN_ROOF).toBeDefined();
    expect((meshes[2].material as THREE.MeshStandardMaterial).defines!.KIT_GLOW).toBeDefined();
    // the model stands inside its footprint: from the back of the roof to the step before the door
    const bb = new THREE.Box3().setFromObject(root);
    expect(bb.min.x).toBeGreaterThanOrEqual(1 - 0.3);
    expect(bb.max.x).toBeLessThanOrEqual(5 + 0.3);
    expect(bb.min.z).toBeGreaterThan(1); // row 0 behind the house stays walkable
    expect(bb.max.z).toBeLessThan(4 + 0.5);
    expect(buildingFamily.build([], ctx, kit)).toBeNull();
  });

  it('never reaches behind its top row, however shallow or tall', () => {
    for (const [dest, rows] of [
      ['OldaleTown_House1', ['......', '.RRRR.', '.WDWW.', '......']], // two rows: the shallowest model (1.6 deep)
      ['OldaleTown_House1', ['......', '.RRRR.', '.RRRR.', '.RRRR.', '.WWWW.', '.WDWW.', '......']],
      ['LilycoveCity_ContestLobby', ['......', ...Array(6).fill('.RRRR.'), '.WWWW.', '.WDWW.', '......']], // 4 deep at most
    ] as [string, string[]][]) {
      const a = map(rows);
      const ctx = { a, events: ev([[2, rows.length - 2, dest]]), quality: 'medium' as const };
      const out = buildingFamily.extract(ctx, new Claims(a.N));
      expect(out[0].top).toBe(1);
      const bb = new THREE.Box3().setFromObject(buildingFamily.build(out, ctx, kitCtx())!);
      expect(bb.min.z).toBeGreaterThanOrEqual(out[0].top + out[0].base);
    }
  });
});

describe('building details', () => {
  /** Builds the map's buildings (door warps given) and returns the root, placements and kit. */
  const build = (rows: string[], warps: [number, number, string][]) => {
    const a = map(rows);
    const ctx = { a, events: ev(warps), quality: 'medium' as const };
    const out = buildingFamily.extract(ctx, new Claims(a.N));
    const kit = kitCtx();
    const root = buildingFamily.build(out, ctx, kit)!;
    root.updateMatrixWorld(true);
    return { a, out, kit, root };
  };
  const named = (root: THREE.Object3D, prefix: string) => {
    const found: THREE.Mesh[] = [];
    root.traverse((o) => { if (o.name.startsWith(prefix)) found.push(o as THREE.Mesh); });
    return found;
  };
  const bounds = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);
  const mapOf = (m: THREE.Mesh) => (m.material as THREE.MeshStandardMaterial).map;
  const SMALL = ['......', '.RRRR.', '.WWWW.', '.WDWW.', '......'];

  it('gives a Pokémon Center its sign above the door and a Poké Ball emblem on the roof', () => {
    // zf = 4, main body z 2..4 (zm = 3), eave 2.02
    const { root, kit } = build(SMALL, [[2, 3, 'OldaleTown_PokemonCenter_1F']]);
    const [sign] = named(root, 'sign:POKéMON CENTER');
    const s = bounds(sign);
    expect(s.min.z).toBeGreaterThan(4); // on the front wall, not buried in it...
    expect(s.max.z).toBeLessThan(4.1); // ...nor floating before it
    expect(s.min.x).toBeGreaterThanOrEqual(1);
    expect(s.max.x).toBeLessThanOrEqual(5);
    expect(s.min.y).toBeGreaterThan(1.4); // above the door
    expect(s.max.y).toBeLessThan(2.02); // below the eave
    const [emblem] = named(root, 'emblem');
    expect(mapOf(emblem)).toBe(pokeballTexture());
    const e = bounds(emblem);
    expect(e.min.y).toBeGreaterThan(2.02); // on the roof, on its front slope, at the middle
    expect(e.min.z).toBeGreaterThan(3);
    expect(e.max.z).toBeLessThan(4.25);
    expect((e.min.x + e.max.x) / 2).toBeCloseTo(3, 5);
    // the signage textures are cached for the session: shared by every build, never disposed with it
    const again = build(SMALL, [[2, 3, 'OldaleTown_PokemonCenter_1F']]);
    expect(mapOf(named(again.root, 'sign:')[0])).toBe(mapOf(sign));
    let disposed = false;
    mapOf(sign)!.addEventListener('dispose', () => { disposed = true; });
    expect(kit.disposables).not.toContain(mapOf(sign));
    disposeKit(root, kit);
    expect(disposed).toBe(false);
  });

  it("gives a Mart its sign and a striped awning over the front, above the shoppers' heads", () => {
    const { root } = build(SMALL, [[2, 3, 'OldaleTown_Mart']]);
    expect(named(root, 'sign:POKé MART')).toHaveLength(1);
    expect(named(root, 'emblem')).toHaveLength(0);
    // falling onto the cell before the wall, past the eave (z 4.25): the awning, high up
    const colors = new Set<string>();
    for (const x of [1.2, 1.45, 1.7, 1.95, 3.5, 4.5]) {
      root.updateMatrixWorld(true);
      const hit = new THREE.Raycaster(new THREE.Vector3(x, 5, 4.32), new THREE.Vector3(0, -1, 0)).intersectObject(root, true)[0];
      expect(hit.point.y).toBeGreaterThan(1.3);
      expect(hit.point.y).toBeLessThan(1.9);
      const c = (hit.object as THREE.Mesh).geometry.getAttribute('color');
      colors.add([c.getX(hit.face!.a), c.getY(hit.face!.a), c.getZ(hit.face!.a)].map((v) => v.toFixed(2)).join());
    }
    expect(colors.size).toBe(2); // two-colour stripes
    expect(hitsBelow(root, 1.5, 4.5, 1.3)).toBe(false); // nothing of it over the front cell below head height
  });

  it("gives a gym pillars by the door and its sign, on the door's bay between the walkable front steps", () => {
    const rows = ['..........', '.RRRRRR...', '.WWWWWW...', '.sWWDWs...', '..........'];
    const { root } = build(rows, [[4, 3, 'PetalburgCity_Gym']]);
    // the bay x 2..6 stands out to z = 4, the main body's front over the steps is z = 3
    const s = bounds(named(root, 'sign:POKéMON GYM')[0]);
    expect(s.min.x).toBeGreaterThanOrEqual(2);
    expect(s.max.x).toBeLessThanOrEqual(6);
    expect(s.min.z).toBeGreaterThan(4);
    expect(s.max.z).toBeLessThan(4.1);
    // a pillar on each side of the door, standing out of the bay's wall
    for (const x of [3.8, 5.2]) {
      const z = firstWallZ(root, x, 0.8);
      expect(z).toBeGreaterThan(4.1);
      expect(z).toBeLessThan(4.4);
    }
    expect(hitsBelow(root, 1.5, 3.5, 1.6)).toBe(false); // the steps stay clear
    // the bay's walls beside the door are bare (no windows behind the pillars); the wings keep theirs
    expect(firstWallZ(root, 2.5, 1.0)).toBeCloseTo(4, 3);
    expect(firstWallZ(root, 6.5, 1.0) - 3).toBeGreaterThan(0.05);
  });

  it("puts vents and a dish on a lab's roof", () => {
    const rows = ['.........', '.RRRRRRR.', '.RRRRRRR.', '.WWWWWWW.', '.WWWWDWW.', '.........'];
    const lab = bounds(build(rows, [[5, 4, 'LittlerootTown_ProfessorBirchsLab']]).root);
    const plain = bounds(build(rows, [[5, 4, 'LilycoveCity_ContestLobby']]).root); // the same massing
    expect(lab.max.y).toBeGreaterThan(plain.max.y + 0.3);
  });

  it("dresses a special building's front walls in its ROM facade, upscaled, on each front's own plane", () => {
    const rows = ['..........', '.RRRRRR...', '.WWWWWW...', '.sWWDWs...', '..........'];
    const { root, kit, out } = build(rows, [[4, 3, 'BattleFrontier_Lounge2']]);
    expect(out[0].kind).toBe('special');
    const [facade] = named(root, 'facade');
    const tex = mapOf(facade) as THREE.DataTexture;
    expect([tex.image.width, tex.image.height]).toEqual([6 * 16 * 4, 2 * 16 * 4]);
    expect(kit.disposables).toContain(tex);
    // the wall art's colours, and its transparent pixels filled with the wall colour (opaque)
    const px = new Uint8Array(tex.image.data!.buffer);
    for (let i = 3; i < px.length; i += 4) expect(px[i]).toBe(255);
    // the front over the steps stands one row back (z = 3), the bay's at the door row's edge (z = 4)
    for (const [x, z] of [[1.5, 3], [2.5, 4], [4.5, 4], [6.5, 3]]) {
      const hit = new THREE.Raycaster(new THREE.Vector3(x, 1, 50), new THREE.Vector3(0, 0, -1)).intersectObject(facade)[0];
      expect(hit.point.z - z).toBeGreaterThan(0);
      expect(hit.point.z - z).toBeLessThan(0.05);
      expect(hit.uv!.x).toBeCloseTo((x - 1) / 6, 5); // the column's own pixels
    }
    let disposed = false;
    tex.addEventListener('dispose', () => { disposed = true; });
    disposeKit(root, kit);
    expect(disposed).toBe(true);
  });
});

/** FNV-1a digest of a building model: every mesh's vertices, normals and colours (rounded), and
 *  each extra mesh's name and place. */
function digest(root: THREE.Object3D): string {
  root.updateMatrixWorld(true);
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    const s = String(Math.round(v * 1e4));
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    h ^= 44; h = Math.imul(h, 0x01000193) >>> 0;
  };
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const c of m.name) mix(c.charCodeAt(0));
    for (const e of m.matrixWorld.elements) mix(e);
    for (const k of ['position', 'normal', 'color']) {
      const at = m.geometry.getAttribute(k);
      if (at) for (let i = 0; i < at.array.length; i++) mix(at.array[i]);
    }
  });
  return h.toString(16).padStart(8, '0');
}

describe('blocked-door buildings (pinned before walk-in doors)', () => {
  // Recorded with Task 13's code (6e32091): the footprints, claims and models of the buildings whose
  // doors the player walks into from the cell before them must not change. (`steps`: Task 13's
  // columns standing back over the walkable front steps, now the columns with a recess.)
  const cases: [string, string[], [number, number, string][], object][] = [
    ['gym with front steps', ['..........', '.RRRRRR...', '.WWWWWW...', '.sWWDWs...', '..........'],
      [[4, 3, 'PetalburgCity_Gym']], {
        footprints: [
          { x0: 1, x1: 6, top: 1, bottom: 3, doorX: 4, dest: 'PetalburgCity_Gym', base: 0, steps: [1, 6] },
        ],
        owner: '1,1 2,1 3,1 4,1 5,1 6,1 1,2 2,2 3,2 4,2 5,2 6,2 2,3 3,3 4,3 5,3',
        stray: '',
        object: '1,1 2,1 3,1 4,1 5,1 6,1 1,2 2,2 3,2 4,2 5,2 6,2 2,3 3,3 4,3 5,3',
        top: '', surface: '', model: '75cdae97',
      }],
    ['house and Mart the fill joined, hedge row behind', ['.hhhh.....', '.RRRRRRRR.', '.WWWWOOOO.', '.WDWWODOO.', '..........'],
      [[2, 3, 'MauvilleCity_House2'], [6, 3, 'MauvilleCity_Mart']], {
        footprints: [
          { x0: 1, x1: 4, top: 1, bottom: 3, doorX: 2, dest: 'MauvilleCity_House2', base: 0, steps: [] },
          { x0: 5, x1: 8, top: 1, bottom: 3, doorX: 6, dest: 'MauvilleCity_Mart', base: 0, steps: [] },
        ],
        owner: '1,1 2,1 3,1 4,1 5,1 6,1 7,1 8,1 1,2 2,2 3,2 4,2 5,2 6,2 7,2 8,2 1,3 2,3 3,3 4,3 5,3 6,3 7,3 8,3',
        stray: '1,0 2,0 3,0 4,0',
        object: '1,1 2,1 3,1 4,1 5,1 6,1 7,1 8,1 1,2 2,2 3,2 4,2 5,2 6,2 7,2 8,2 1,3 2,3 3,3 4,3 5,3 6,3 7,3 8,3',
        top: '', surface: '', model: '35cfc2ed',
      }],
    ['Pokémon Center with a walled-in cell', ['......', '.RRRR.', '.W.WW.', '.WDWW.', '......'],
      [[2, 3, 'OldaleTown_PokemonCenter_1F']], {
        footprints: [
          { x0: 1, x1: 4, top: 1, bottom: 3, doorX: 2, dest: 'OldaleTown_PokemonCenter_1F', base: 0, steps: [] },
        ],
        owner: '1,1 2,1 3,1 4,1 1,2 2,2 3,2 4,2 1,3 2,3 3,3 4,3',
        stray: '',
        object: '1,1 2,1 3,1 4,1 1,2 2,2 3,2 4,2 1,3 2,3 3,3 4,3',
        top: '', surface: '', model: '5a6f7ea9',
      }],
  ];
  for (const [name, rows, warps, want] of cases) {
    it(`keeps the ${name}`, () => {
      const a = map(rows);
      const events = ev(warps);
      const { out, claims } = run(a, events);
      const layout = buildingLayout(a, events);
      const cells = (f: (i: number) => boolean) => {
        const s: string[] = [];
        for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[0].length; x++) if (f(a.idx(x, y))) s.push(`${x},${y}`);
        return s.join(' ');
      };
      const got = {
        footprints: layout.footprints.map(({ x0, x1, top, bottom, doorX, dest, base, recess }) =>
          ({ x0, x1, top, bottom, doorX, dest, base, steps: recess.flatMap((r, k) => (r ? [x0 + k] : [])) })),
        owner: cells((i) => layout.owner[i] > 0), stray: cells((i) => layout.stray[i] > 0),
        object: cells((i) => claims.has(i, CLAIM_OBJECT)), top: cells((i) => claims.has(i, CLAIM_TOP)),
        surface: cells((i) => claims.has(i, CLAIM_SURFACE)),
        model: digest(buildingFamily.build(out, { a, events, quality: 'medium' }, kitCtx())!),
      };
      expect(got).toEqual(want);
    });
  }
});

describe('walk-in doors', () => {
  // the door cell 'd' is walkable: the player steps onto it (a NON_ANIMATED_DOOR warp)
  const MUSEUM = ['..........', '.RRRRRR...', '.WWWWWW...', '.WWdWWW...', '..........'];

  it("models a walk-in door's building: its door cell stays the player's, in a recess before the wall", () => {
    const a = map(MUSEUM);
    const events = ev([[3, 3, 'SlateportCity_OceanicMuseum_1F']]);
    const { out, claims } = run(a, events);
    expect(out.map(box)).toEqual([[1, 6, 1, 3]]);
    expect(out[0]).toMatchObject({ kind: 'special', doorX: 3, recess: [0, 0, 1, 0, 0, 0], walkIn: [3] });
    const door = a.idx(3, 3);
    expect(claims.has(door, CLAIM_OBJECT)).toBe(false); // walkable: nothing of the model on it
    expect(claims.has(door, CLAIM_SURFACE)).toBe(true); // (its floor is the building's threshold...)
    expect(claims.surfaceY[door]).toBe(out[0].base); // (...the player stands on, at the building's level)
    for (let i = 0; i < a.N; i++) if (i !== door) expect(claims.surfaceY[i]).toBeNaN();
    for (const [x, y] of [[1, 3], [2, 3], [4, 3], [6, 3], [3, 2], [3, 1]]) expect(claims.has(a.idx(x, y), CLAIM_OBJECT)).toBe(true);
    const root = buildingFamily.build(out, { a, events, quality: 'medium' }, kitCtx())!;
    // walking north at chest height: the wall over the door is the door cell's back edge (z = 3),
    // the rest of the front the door row's front edge (z = 4)
    for (const [x, z] of [[3.5, 3], [1.5, 4], [2.5, 4], [5.5, 4]]) expect(Math.abs(firstWallZ(root, x, 0.8) - z)).toBeLessThan(0.1);
    expect(hitsBelow(root, 3.5, 3.5, 1.6)).toBe(false); // (its threshold lies flush with the ground)
    // a walk-in house: its wooden door on the recessed wall
    const b = map(MUSEUM);
    const house = run(b, ev([[3, 3, 'Route104_MrBrineysHouse']])).out;
    expect(house[0].kind).toBe('house');
    const z = firstWallZ(buildingFamily.build(house, { a: b, events, quality: 'medium' }, kitCtx())!, 3.5, 0.8);
    expect(z).toBeGreaterThan(3);
    expect(z).toBeLessThan(3.15);
  });

  it('takes the walled-in cell behind a walk-in door (Stern\'s Shipyard)', () => {
    const a = map(['.........', '.RRRRRRR.', '.WWW.WWW.', '.WWWdWWW.', '.........']);
    const { out, claims } = run(a, ev([[4, 3, 'SlateportCity_SternsShipyard_1F']]));
    expect(out.map(box)).toEqual([[1, 7, 1, 3]]);
    expect(out[0].recess).toEqual([0, 0, 0, 1, 0, 0, 0]);
    // beyond the door there is no way in: the cell behind it is under the model
    expect(claims.has(a.idx(4, 2), CLAIM_OBJECT)).toBe(true);
    expect(claims.groundMt[a.idx(4, 2)]).toBe(T.ground);
  });

  it("stands one row further forward on both sides of a walk-in door's landing (the Lilycove Museum)", () => {
    // the door (4..5, 2) behind a landing (4..5, 3) between balustrades running down the stairs
    const rows = ['..........', '.RRRRRRRR.', '.WWWddWWW.', '.WWp..pWW.', '...p..p...', '...p..p...', '..........'];
    const a = map(rows);
    const events = ev([[4, 2, 'LilycoveCity_LilycoveMuseum_1F'], [5, 2, 'LilycoveCity_LilycoveMuseum_1F']]);
    const { out, claims } = run(a, events);
    expect(out.map(box)).toEqual([[1, 8, 1, 3]]);
    expect(out[0]).toMatchObject({ recess: [0, 0, 0, 2, 2, 0, 0, 0], walkIn: [4, 5] });
    for (const x of [4, 5]) {
      expect(claims.has(a.idx(x, 2), CLAIM_SURFACE)).toBe(true); // the door: the threshold
      expect(claims.surfaceY[a.idx(x, 2)]).toBe(out[0].base);
      expect(claims.surfaceY[a.idx(x, 3)]).toBeNaN(); // the landing: the analysis' ground
      expect(claims.has(a.idx(x, 3), CLAIM_OBJECT) || claims.has(a.idx(x, 3), CLAIM_SURFACE)).toBe(false); // the landing: ground
    }
    for (const y of [4, 5]) expect(claims.has(a.idx(3, y), CLAIM_OBJECT)).toBe(false); // the balustrade below stays legacy art
    const root = buildingFamily.build(out, { a, events, quality: 'medium' }, kitCtx())!;
    for (const [x, z] of [[4.5, 2], [5.5, 2], [2.5, 4], [6.5, 4]]) expect(Math.abs(firstWallZ(root, x, 0.8) - z)).toBeLessThan(0.1);
    for (const z of [2.5, 3.5]) expect(hitsBelow(root, 4.5, z, 1.6)).toBe(false);
    // the recessed front shows the art above its landing: the door under the roof row
    const { w, h, px: f } = out[0].facade!;
    expect(f[(h - 1) * w + 3 * 16 + 8]).toBe(px(4, 4, 6)); // door, at the recess' foot
    expect(f[(h - 1) * w + 8]).toBe(px(16, 24, 30)); // the wall's own bottom row beside it
    expect(f[3 * 16 + 8]).toBe(px(8, 9, 13)); // the roof row on top of the recess
  });

  it("takes its tiles the analysis read as leaves (the Oceanic Museum's teal towers), not a bush beside it", () => {
    const rows = ['..........', '.RLLLLR...', '.WLWWLW.b.', '.WWdWWWbb.', '..........'];
    const a = map(rows);
    const events = ev([[3, 3, 'SlateportCity_OceanicMuseum_1F']]);
    expect(a.kind[a.idx(2, 1)]).toBe(K.Tree);
    const claims = new Claims(a.N);
    expect(run(a, events, claims).out.map(box)).toEqual([[1, 6, 1, 3]]);
    for (const [x, y] of [[2, 1], [5, 1], [2, 2], [5, 2]]) expect(claims.has(a.idx(x, y), CLAIM_OBJECT)).toBe(true);
    for (const [x, y] of [[8, 2], [7, 3], [8, 3]]) expect(claims.has(a.idx(x, y), CLAIM_OBJECT)).toBe(false);
    const trees = treeFamily.extract({ a, events, quality: 'medium' }, claims);
    expect(trees.some((t) => Math.floor(t.x) <= 6)).toBe(false); // no tree on the museum
    expect(claims.has(a.idx(8, 3), CLAIM_OBJECT)).toBe(true); // the bush is the trees'
  });

  it('takes its blue harbour wall the analysis read as water beside the sea', () => {
    const a = map(['..........', '.RRRRR~~..', '.WWWWB~~..', '.WWdWW....', '..........']);
    expect(a.kind[a.idx(5, 2)]).toBe(K.Water);
    const { out, claims } = run(a, ev([[3, 3, 'LilycoveCity_Harbor']]));
    expect(out.map(box)).toEqual([[1, 5, 1, 3]]);
    expect(claims.has(a.idx(5, 2), CLAIM_OBJECT)).toBe(true);
  });

  it('leaves a bush before its wall to the trees: the front stands back behind it', () => {
    const a = map(['.........', '.RRRRRR..', '.WWWWWW..', '.bWdWWW..', '.........']);
    const events = ev([[3, 3, 'Route119_WeatherInstitute_1F']]);
    const { out, claims } = run(a, events);
    expect(out.map(box)).toEqual([[1, 6, 1, 3]]);
    expect(out[0].recess).toEqual([1, 0, 1, 0, 0, 0]);
    expect(claims.has(a.idx(1, 3), CLAIM_OBJECT)).toBe(false);
    expect(Math.abs(firstWallZ(buildingFamily.build(out, { a, events, quality: 'medium' }, kitCtx())!, 1.5, 0.8) - 3)).toBeLessThan(0.1);
  });

  it('models no cave mouth, no door without a wall beside it, no treehouse', () => {
    const events = ev([[3, 3, 'SlateportCity_OceanicMuseum_1F']]);
    // a mouth drawn by the General tileset (its rock)
    expect(run(map(MUSEUM, undefined, false, true), events).out).toEqual([]);
    // a doorway with the building's art above but none beside it
    expect(run(map(['.......', '...R...', '...R...', '...d...', '.......']), events).out).toEqual([]);
    // a treehouse's door, on its walkway (NO_RUNNING) up in the trees: the legacy art draws it
    const tree = map(['..........', '.RRRRRR...', '.WWWWWW...', '.WWdWWW...', '.xxxxxx...']);
    expect(run(tree, events).out).toEqual([]);
    expect(buildingLayout(tree, events).owner.every((o) => o === 0)).toBe(true);
  });

  it('models no part of a bigger structure, nor a wall strip without its roof', () => {
    // Devon Corp: wings standing back from the door's bay, its art running on past the bay's sides
    const rows = ['.........', '.RRRRRRR.', '.WWWWWWW.', '..WWdWW..', '.........'];
    expect(run(map(rows), ev([[4, 3, 'RustboroCity_DevonCorp_1F']])).out).toEqual([]);
    // (a blocked door there: the bay, as before)
    expect(run(map(rows.map((r) => r.replace('d', 'D'))), ev([[4, 3, 'RustboroCity_DevonCorp_1F']])).out.map(box)).toEqual([[2, 6, 1, 3]]);
    // one row of art above the door: a wall strip whose roof was not taken (a green roof read as foliage)
    expect(run(map(['.........', '.bbbbbb..', '.WWWWWW..', '.WWdWWW..', '.........']), ev([[3, 3, 'SlateportCity_PokemonFanClub']])).out).toEqual([]);
    // terrain inside: a doorway cut into the cliff (rock), as below the Trainer Hill
    expect(run(map(['.........', '.RRRRRR..', '.W#WWWW..', '.WWdWWW..', '.........']), ev([[3, 3, 'TrainerHill_Entrance']])).out).toEqual([]);
    // a walk-in door a blocked-door building already took (as its front steps): no second model
    const both = run(map(['..........', '.RRRRRRRR.', '.WWWWWWWW.', '.WDWWWdWW.', '..........']),
      ev([[2, 3, 'OldaleTown_House1'], [6, 3, 'SlateportCity_OceanicMuseum_1F']])).out;
    expect(both.map((p) => p.kind)).toEqual(['house']);
  });
});

describe('facade ground', () => {
  const W = 0x1111, G0 = 0x2222, G1 = 0x3333;
  // ground tiles alternate G0, G1 along x: G0 at even x, G1 at odd x
  const ground = (x: number, _y: number, v: number) => v === (x % 2 ? G1 : G0);

  it('clears the ground its art shows at its sides and bottom, by position, under the top layer only', () => {
    const px = Uint16Array.from([
      W, G1, W, W,
      G0, W, G1, G1,
      G0, G1, G0, G1,
    ]);
    const under = Uint8Array.from([
      1, 1, 1, 1,
      1, 1, 1, 1,
      1, 1, 0, 1,
    ]);
    clearGround(px, under, 4, 3, ground);
    const T_ = 0x8000;
    expect([...px]).toEqual([
      W, G1, W, W, // (1, 0) is the ground's colour where it lies, but walled off from the edges: kept
      T_, W, G1, T_, // (2, 1): G1 where the ground is G0, a wall colour that happens to match: kept
      T_, T_, G0, T_, // (2, 2): drawn in the top layer: kept
    ]);
  });

  it("fills a special building's corner drawn over the ground with its wall colour (the Contest Hall)", () => {
    // 'C': the bottom-left corner of the wall cut off, the lawn showing there
    const rows = [',,,,,,,,,,,,', ',,,,,,,,,,,,', ',,RRRRRR,,,,', ',,WWWWWW,,,,', ',,CWWDWW,,,,', ',,,,,,,,,,,,'];
    const a = map(rows);
    const out = run(a, ev([[5, 4, 'LilycoveCity_ContestLobby']])).out;
    expect(out[0].kind).toBe('special');
    const { w, h, px: f } = out[0].facade!;
    expect(f[(h - 1) * w]).toBe(0x8000); // the lawn in the corner: cleared
    expect(f[(h - 16) * w + 15]).toBe(CREAM); // the corner tile's wall: kept
    expect(f[(h - 1) * w + 15]).toBe(CREAM);
    expect(f[(h - 1) * w + 12]).toBe(LAWN_B); // a lawn colour, but not the lawn's there: kept
    // in the texture, the corner shows the wall colour (the texture's rows run bottom-up)
    const root = buildingFamily.build(out, { a, events: ev([[5, 4, 'LilycoveCity_ContestLobby']]), quality: 'medium' }, kitCtx())!;
    let tex: THREE.DataTexture | null = null;
    root.traverse((o) => { if (o.name === 'facade') tex = (o as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material.map as THREE.DataTexture; });
    const data = tex!.image.data as Uint8Array;
    expect([data[0], data[1], data[2]]).toEqual(out[0].wall.map((c) => Math.round(c * 255)));
  });
});

const kitCtx = () => ({ uniforms: createKitUniforms(), quality: 'medium' as const, disposables: [] as { dispose(): void }[] });

/** Z of the first surface of the model a ray walking north (-z) at height y meets at column x. */
function firstWallZ(root: THREE.Object3D, x: number, y: number): number {
  root.updateMatrixWorld(true);
  const hits = new THREE.Raycaster(new THREE.Vector3(x, y, 50), new THREE.Vector3(0, 0, -1)).intersectObject(root, true);
  return hits.length ? hits[0].point.z : NaN;
}

/** Whether a ray falling at (x, z) meets the model below height h (above the ground). */
function hitsBelow(root: THREE.Object3D, x: number, z: number, h: number): boolean {
  root.updateMatrixWorld(true);
  const hits = new THREE.Raycaster(new THREE.Vector3(x, h, z), new THREE.Vector3(0, -1, 0), 0, h - 0.01).intersectObject(root, true);
  return hits.length > 0;
}
