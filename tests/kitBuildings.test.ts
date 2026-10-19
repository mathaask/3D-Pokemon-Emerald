import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { addBox, buildingKind, buildingFamily, buildingLayout, type BuildingPlacement } from '../src/render/kit/buildings';
import { MeshBuilder } from '../src/render/kit/geom';
import { treeFamily } from '../src/render/kit/trees';
import { analyze, type MapAnalysis } from '../src/render/overworld/analyze';
import { Claims, CLAIM_OBJECT, CLAIM_TOP } from '../src/render/overworld/claims';
import { createKitUniforms } from '../src/render/kit/materials';
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
  ashA: 0x220, ashB: 0x221, rock: 0x222,
};

/**
 * Synthetic outdoor map (secondary tiles only, margin 2). Cells: '.' ground, 'g' grass, 'W' house
 * wall, 'R' roof, 'D' door, 'p' a post (sign post / lamp post / fence), 's' the building's
 * walkable front steps, 'f' a fence, 'O' another building's wall, 'h' a hedge, 'w' a pale blue
 * wall, 'A' / 'a' ash-forest blocks,
 * '#' rock. `border` defaults to rock (terrain: repeated all around the map).
 */
function map(rows: string[], border = [T.rock, T.rock, T.rock, T.rock], underwater = false): MapAnalysis {
  const info = fakeInfo();
  const fill = (m: number, c: number, from = 0, to = 256) => {
    for (let p = from; p < to; p++) { info.both[m * 256 + p] = c; info.bottom[m * 256 + p] = c; }
  };
  fill(T.ground, px(26, 24, 18)); fill(T.grass, px(14, 24, 20)); fill(T.steps, px(22, 22, 22));
  // a cream wall with a blue window, drawn mostly in a navy outline shade
  fill(T.wall, px(8, 9, 13)); fill(T.wall, px(28, 25, 20), 100, 192); fill(T.wall, px(16, 24, 30), 192, 256);
  fill(T.blueWall, px(23, 25, 28)); // a Mart's pale blue wall
  fill(T.roof, px(8, 9, 13)); fill(T.roof, px(26, 9, 8), 160); // a red roof, mostly navy outlines fill(T.door, px(18, 11, 6)); fill(T.post, px(12, 12, 14));
  fill(T.fence, px(20, 14, 9)); fill(T.other, px(25, 25, 8)); fill(T.hedge, px(8, 22, 6)); info.green[T.hedge] = 0.9; info.attributes[T.hedge] = 1 << 12; // (covered: no tree)
  fill(T.ashA, ASH_LEAF); fill(T.ashA, px(21, 21, 17), 0, 100); info.green[T.ashA] = 0.4;
  fill(T.ashB, ASH_LEAF); fill(T.ashB, px(21, 21, 17), 0, 140); info.green[T.ashB] = 0.3;
  fill(T.rock, px(18, 16, 14));
  info.attributes[T.door] = MB.ANIMATED_DOOR;
  const code: Record<string, number> = {
    '.': T.ground | 0x3000, g: T.grass | 0x3000, s: T.steps | 0x3000, W: T.wall | 0x0400, R: T.roof | 0x0400,
    D: T.door | 0x0400, p: T.post | 0x0400, f: T.fence | 0x0400, O: T.other | 0x0400,
    h: T.hedge | 0x0400, w: T.blueWall | 0x0400, A: T.ashA | 0x0400, a: T.ashB | 0x0400, '#': T.rock | 0x0400,
  };
  const w = rows[0].length, h = rows.length;
  const cells = new Uint16Array(w * h);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { cells[y * w + x] = code[ch]; }));
  return analyze({ width: w, height: h, cells, border, borderW: 2, borderH: 2, borderPhase: 0 },
    { info, generalPrimary: false, indoor: false, underground: false, underwater, margin: 2 });
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
    const { out } = run(a, events);
    expect(box(out[0])).toEqual([1, 6, 1, 3]);
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

  it('leaves out a hedge beside the house', () => {
    const a = map(['......', '.RRRh.', '.WWWh.', '.WDWh.', '......']);
    expect(box(run(a, ev([[2, 3, 'OldaleTown_House1']])).out[0])).toEqual([1, 3, 1, 3]);
  });

  it('takes the walls, roof edge and overhang of its footprint', () => {
    const a = map(['......', '..R...', '.RRRR.', '.WWWW.', '.WDWW.', '......']);
    const { out, claims } = run(a, ev([[2, 4, 'OldaleTown_House1']]));
    expect(box(out[0])).toEqual([1, 4, 2, 4]);
    expect(claims.has(a.idx(2, 1), CLAIM_OBJECT)).toBe(true); // the roof's lone edge cell above
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
});
