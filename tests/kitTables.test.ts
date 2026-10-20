import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { propFamily, blockRun, type PropPlacement } from '../src/render/kit/props';
import {
  GENERAL_BIG_ROCKS, GENERAL_FENCE_SHAPES, GENERAL_FLOWERS, GENERAL_PINE, GENERAL_PROPS, GENERAL_ROCK, GENERAL_SEA_ROCK, GENERAL_SHOAL_TOPS, installGeneralTables,
} from '../src/render/kit/tables/general';
import { cliffFamily, isRocky } from '../src/render/kit/cliffs';
import { treeFamily } from '../src/render/kit/trees';
import { createKitUniforms } from '../src/render/kit/materials';
import { disposeKit } from '../src/render/kit/semantics';
import type { GridEvents } from '../src/render/kit/events';
import { analyze, K, type MapAnalysis } from '../src/render/overworld/analyze';
import { Claims, CLAIM_OBJECT, CLAIM_TOP } from '../src/render/overworld/claims';
import { MB } from '../src/game/behaviors';
import { FAMILIES } from '../src/render/kit';
import { emitLegacy } from '../src/render/overworld/legacyQuads';
import type { TileInfo } from '../src/render/overworld/tileInfo';
import { SYM } from '../src/game/symbols';
import { SECONDARY_ROCK } from '../src/render/kit/tables/secondary';
import { fakeInfo } from './helpers/fakeMap';

function map(rows: string[], ids: Record<string, number>, generalPrimary: boolean) {
  const info = fakeInfo();
  const w = rows[0].length, h = rows.length;
  const cells = new Uint16Array(w * h);
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    cells[y * w + x] = ch === '.' ? 1 | 0x3000 : ids[ch] | 0x0400;
  }));
  return analyze({ width: w, height: h, cells, border: [1, 1, 1, 1], borderW: 2, borderH: 2, borderPhase: 0 },
    { info, generalPrimary, indoor: false, underground: false, underwater: false, margin: 1 });
}

describe('props', () => {
  const sign = [...GENERAL_PROPS.entries()].find(([, k]) => k === 'sign')![0];
  it('a sign event on a lone block becomes a sign', () => {
    const a = map(['.....', '..S..', '.....'], { S: 9 }, false);
    const claims = new Claims(a.N);
    const out = propFamily.extract({ a, events: { warps: [], signs: [{ x: 2, y: 1 }] }, quality: 'medium' }, claims);
    expect(out.map((p) => p.kind)).toEqual(['sign']);
    expect(claims.has(a.idx(2, 1), CLAIM_OBJECT)).toBe(true);
  });
  it('table ids are used only when the primary tileset is General', () => {
    const a1 = map(['.....', '..S..', '.....'], { S: sign }, true);
    const a2 = map(['.....', '..S..', '.....'], { S: sign }, false);
    const none = { warps: [], signs: [] };
    expect(propFamily.extract({ a: a1, events: none, quality: 'medium' }, new Claims(a1.N))).toHaveLength(1);
    expect(propFamily.extract({ a: a2, events: none, quality: 'medium' }, new Claims(a2.N))).toHaveLength(0);
  });
  it('blockRun finds the vertical run containing a cell', () => {
    const a = map(['..#..', '..#..', '..#..', '.....'], { '#': 9 }, false);
    // the margin row above the map is border (always blocked), so stay inside the map
    expect(blockRun(a, 2, 1, (i) => a.cellY(i) >= 0 && a.kind[i] === K.Block)).toEqual([0, 2]);
  });
});

// ---------------------------------------------------------------- synthetic General maps

/** BGR555 pixel of an sRGB colour given in 31sts. */
const px = (r: number, g: number, b: number) => r | (g << 5) | (b << 10);
const GRASS = 1;
const T = {
  wall: 0x210, roof: 0x211, door: 0x212, rock: 0x220, hedge: 0x221, statueTop: 0x230, statue: 0x231, moss: 0x232,
  woodSign: 0x233,
};

/**
 * Outdoor map, General primary (margin 1; the border ring is blocked grass). Cells: '.' grass;
 * any other character is the blocked tile `legend[ch]` (General ids for the table's props), walkable
 * if listed in `open`; 't' (unless in the legend) a walkable cell with a top-layer overhang (a
 * statue's head).
 */
function world(rows: string[], legend: Record<string, number>,
  opts: { general?: boolean; underwater?: boolean; open?: string; secondary?: number; paint?: (info: TileInfo) => void } = {}): MapAnalysis {
  const info = fakeInfo();
  const fill = (m: number, c: number) => { info.both.fill(c, m * 256, m * 256 + 256); info.bottom.fill(c, m * 256, m * 256 + 256); };
  fill(GRASS, px(14, 24, 20));
  fill(T.wall, px(28, 25, 20)); fill(T.roof, px(26, 9, 8)); fill(T.door, px(18, 11, 6));
  info.attributes[T.door] = MB.ANIMATED_DOOR;
  fill(T.rock, px(22, 14, 10)); fill(T.hedge, px(8, 22, 6)); info.green[T.hedge] = 0.9; info.attributes[T.hedge] = 1 << 12;
  fill(T.statueTop, px(14, 24, 20)); info.both.fill(px(28, 28, 28), T.statueTop * 256 + 128, T.statueTop * 256 + 256);
  info.topCover[T.statueTop] = 128;
  fill(T.statue, px(28, 28, 28)); fill(T.moss, px(8, 22, 6)); fill(T.woodSign, px(20, 14, 9));
  // the table's props: a grey fence on grass, a brown boulder on grass, the metal sign
  for (const m of [...GENERAL_FENCE_SHAPES.keys()]) { fill(m, px(14, 24, 20)); info.both.fill(px(16, 16, 18), m * 256 + 64, m * 256 + 200); }
  for (const m of [0x0e0, ...GENERAL_BIG_ROCKS.flat()]) { fill(m, px(14, 24, 20)); info.both.fill(px(20, 14, 10), m * 256 + 40, m * 256 + 240); }
  fill(0x003, px(18, 18, 20));
  opts.paint?.(info);
  const w = rows[0].length, h = rows.length;
  const cells = new Uint16Array(w * h);
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    cells[y * w + x] = ch === '.' ? GRASS | 0x3000 : opts.open?.includes(ch) ? legend[ch] | 0x3000
      : ch === 't' && !(ch in legend) ? T.statueTop | 0x3000 : legend[ch] | 0x0400;
  }));
  return analyze({ width: w, height: h, cells, border: [GRASS, GRASS, GRASS, GRASS], borderW: 2, borderH: 2, borderPhase: 0 },
    { info, generalPrimary: opts.general ?? true, indoor: false, underground: false, underwater: opts.underwater ?? false, margin: 1,
      secondaryTileset: opts.secondary });
}
const ev = (warps: [number, number, string][], signs: [number, number][] = []): GridEvents =>
  ({ warps: warps.map(([x, y, dest]) => ({ x, y, dest })), signs: signs.map(([x, y]) => ({ x, y })) });
const props = (a: MapAnalysis, events: GridEvents = ev([]), claims = new Claims(a.N)) =>
  ({ claims, out: propFamily.extract({ a, events, quality: 'medium' }, claims) });

describe('props: signs and mailboxes', () => {
  it("a house's sign beside its door is its mailbox, a fence beside it a fence (cells the door flood fill swallowed)", () => {
    const rows = [
      '..........',
      '..RRRR....',
      '..WWWW....',
      '..WDWWSf..',
      '..........',
    ];
    const a = world(rows, { R: T.roof, W: T.wall, D: T.door, S: 0x003, f: 0x149 });
    // the building's flood fill took the sign and the fence (both on the door row)
    expect(a.kind[a.idx(6, 3)]).toBe(K.Building);
    expect(a.kind[a.idx(7, 3)]).toBe(K.Building);
    const { out, claims } = props(a, ev([[3, 3, 'LittlerootTown_BrendansHouse_1F']], [[6, 3]]));
    expect(out.find((p) => p.x0 === 6)?.kind).toBe('mailbox');
    expect(out.find((p) => p.x0 === 7)?.kind).toBe('fenceMetal');
    expect(claims.has(a.idx(6, 3), CLAIM_OBJECT)).toBe(true);
    expect(claims.has(a.idx(7, 3), CLAIM_OBJECT)).toBe(true);
    expect(claims.groundMt[a.idx(6, 3)]).toBe(GRASS); // (the ground in front)
    // not the house's own cells (the building family's)
    expect(claims.has(a.idx(5, 3), CLAIM_OBJECT)).toBe(false);
    // beside a lab it is a sign
    expect(props(a, ev([[3, 3, 'LittlerootTown_ProfessorBirchsLab']], [[6, 3]])).out.find((p) => p.x0 === 6)?.kind).toBe('sign');
  });

  it("is no sign on a statue (its top an overhang on the cell above) or a mossy stone, and a wooden one stands on one post", () => {
    // (two cells apart: a walkable cell between two blocks would be stairs for the analysis)
    const a = world(['.........', '.t.......', '.s..s..m.', '.........'], { s: T.woodSign, m: T.moss }, { general: false });
    for (let p = 0; p < 64; p++) a.info.both[T.woodSign * 256 + p] = px(14, 24, 20); // (the post: one narrow band)
    for (let p = 176; p < 256; p++) if ((p & 15) < 6 || (p & 15) > 9) a.info.both[T.woodSign * 256 + p] = px(14, 24, 20);
    const { out } = props(a, ev([], [[1, 2], [4, 2], [7, 2]]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'sign', x0: 4, posts: 1 });
  });

  it('a sign standing before a wall, a boulder at the foot of a rock: the wall\'s and the rock\'s cells', () => {
    const a = world(['.......', '.##.##.', '.##.##.', '.Ss.E#.', '.......'], { '#': T.rock, S: 0x003, s: 0x003, E: 0x0e0 });
    const { out, claims } = props(a, ev([], [[1, 3]]));
    expect(out).toEqual([]);
    expect(claims.bits.every((b) => b === 0)).toBe(true);
    // the same boulder on its own is a rock
    const b = world(['.....', '..E..', '.....'], { E: 0x0e0 });
    expect(props(b).out.map((p) => p.kind)).toEqual(['rock']);
  });
});

describe('props: fences and rocks', () => {
  it('builds fence runs that turn corners, and the analysis\' fence-post "trees" are fence', () => {
    const a = world([
      '.......',
      '.Aeee..',
      '.v.....',
      '.v.....',
      '.c.....',
      '.......',
    ], { A: 0x138, e: 0x149, v: 0x140, c: 0x132 });
    const { out, claims } = props(a);
    const lines = out.map((p) => p.line!.map((v) => Math.round(v * 100) / 100));
    // E-W from the corner's post line to the far edge; N-S from the corner down the left side
    expect(lines).toContainEqual([1.25, 1.85, 5, 1.85]);
    expect(lines).toContainEqual([1.25, 1.85, 1.25, 4.85]);
    expect(lines).toContainEqual([1, 4.85, 1.25, 4.85]); // (the foot piece: an E-W run ends at it)
    expect(out.every((p) => p.kind === 'fenceMetal')).toBe(true);
    for (const [x, y] of [[1, 1], [2, 1], [4, 1], [1, 2], [1, 4]]) expect(claims.has(a.idx(x, y), CLAIM_OBJECT)).toBe(true);
    // 0x132 is a narrow tree for the analysis: the tree family no longer sees it
    expect(a.kind[a.idx(1, 4)]).toBe(K.Tree);
    expect(treeFamily.extract({ a, events: ev([]), quality: 'medium' }, claims)).toEqual([]);
  });

  it("joins a piece to its neighbour's rail even where its own art draws no arm that way", () => {
    // 0x141 is the top of a N-S run on the right of its cell; a straight run leaves it to the east
    const a = world(['......', '.Te...', '.v....', '......'], { T: 0x141, e: 0x149, v: 0x142 });
    const lines = props(a).out.map((p) => p.line!.map((v) => Math.round(v * 100) / 100));
    expect(lines).toContainEqual([1.75, 1.85, 3, 1.85]);
  });

  it("takes a fence coming down to a wall, not one standing on rock (a cliff's railing)", () => {
    const wall = world(['.....', '..v..', '..v..', '..W..', '.....'], { v: 0x140, W: T.wall });
    const { out, claims } = props(wall);
    expect(out.map((p) => p.kind)).toEqual(['fenceMetal']);
    expect(claims.has(wall.idx(2, 2), CLAIM_OBJECT)).toBe(true);
    expect(claims.has(wall.idx(2, 3), CLAIM_OBJECT)).toBe(false);
    const rock = world(['.....', '..v..', '..#..', '..#..', '.....'], { v: 0x140, '#': T.rock });
    expect(props(rock).out).toEqual([]);
    // (a fence over three other cells: a building's side, a hedge... theirs)
    expect(props(world(['.....', '..v..', '..W..', '..W..', '..W..', '.....'], { v: 0x140, W: T.wall })).out).toEqual([]);
  });

  it('leaves a fence row in front of a hedge (a block that is no prop) to the hedge', () => {
    const a = world(['......', '.hhhh.', '.eeee.', '......'], { h: T.hedge, e: 0x149 });
    expect(props(a).out).toEqual([]);
  });

  it('makes one boulder of a 2x2 cone rock (its top tiles are tree ids for the analysis), nothing of a lone corner', () => {
    const [tl, tr, bl, br] = GENERAL_BIG_ROCKS[0];
    const a = world(['.......', '.AB....', '.CD....', '.......', '....D..', '.......'], { A: tl, B: tr, C: bl, D: br });
    expect(a.kind[a.idx(1, 1)]).toBe(K.Tree);
    const { out, claims } = props(a);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'rock', x0: 1, x1: 2, y: 2, rows: 1 });
    for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]]) expect(claims.has(a.idx(x, y), CLAIM_OBJECT)).toBe(true);
    expect(claims.has(a.idx(4, 4), CLAIM_OBJECT)).toBe(false);
    // not four tiles where they belong (a boulder for a corner), or something on top of it: no 2x2 rock
    const b = world(['.......', '.AB....', '.CE....', '.......'], { A: tl, B: tr, C: bl, E: 0x0e0 });
    expect(props(b).out.filter((p) => p.x1 > p.x0)).toEqual([]);
    const c = world(['.......', '.E.....', '.AB....', '.CD....', '.......'], { A: tl, B: tr, C: bl, D: br, E: 0x0e0 });
    expect(props(c).out.filter((p) => p.x1 > p.x0)).toEqual([]);
  });

  it('leaves a prop row the analysis made a step between two levels to the legacy face', () => {
    // a fence across the whole map: the height solver lifts the ground behind it by a level
    const a = world(['.....', '.....', 'eeeee', '.....', '.....'], { e: 0x149 });
    expect(a.height[a.idx(2, 1)]).not.toBe(a.height[a.idx(2, 3)]);
    const { out, claims } = props(a);
    expect(out).toEqual([]);
    expect(claims.bits.every((b) => b === 0)).toBe(true);
    // a boulder in such a row
    expect(props(world(['.....', '.....', 'hhEhh', '.....', '.....'], { h: T.hedge, E: 0x0e0 })).out).toEqual([]);
  });

  it('slopes a fence run beside a ramp', () => {
    // a walkway between two fences down from the upper level (rows 0-1) to the lower one (rows
    // 5-6): the analysis makes it stairs (walkable, a block either side)
    const a = world(['.......', '.......', '#v,v###', '#v,v###', '#v,v###', '.......', '.......'],
      { '#': T.rock, v: 0x140, ',': 0x240 }, { open: ',' });
    expect(a.kind[a.idx(2, 3)]).toBe(K.Stairs);
    const { out } = props(a);
    const left = out.find((p) => p.x0 === 1)!;
    expect(left.h).toBeCloseTo(a.height[a.idx(2, 2)]);
    expect(left.h1).toBeCloseTo(a.height[a.idx(2, 4)]);
    expect(left.h).toBeGreaterThan(left.h1!);
    expect(left.line).toEqual([1.25, 2, 1.25, 5]);
  });

  it("lights Rustboro's lamps (its own tileset's ids): the post, and the lantern over the paving above it", () => {
    const rows = ['.....', '..L..', '..P..', '.....'];
    const legend = { L: 0x212, P: 0x21a };
    const a = world(rows, legend, { open: 'L', secondary: SYM.gTileset_Rustboro });
    a.info.topCover[0x212] = 90;
    const { out, claims } = props(a);
    expect(out).toMatchObject([{ kind: 'lamp', x0: 2, y: 2 }]);
    expect(claims.has(a.idx(2, 2), CLAIM_OBJECT)).toBe(true);
    expect(claims.has(a.idx(2, 1), CLAIM_TOP)).toBe(true); // (the legacy lantern card goes)
    // the same ids in another tileset are something else
    expect(props(world(rows, legend, { open: 'L', secondary: SYM.gTileset_Petalburg })).out).toEqual([]);
    expect(props(world(rows, legend, { open: 'L' })).out).toEqual([]);
  });

  it('places nothing on a Dive map', () => {
    const a = world(['.....', '..S..', '.....'], { S: 0x003 }, { underwater: true });
    const { out, claims } = props(a, ev([], [[2, 1]]));
    expect(out).toEqual([]);
    expect(claims.bits.every((b) => b === 0)).toBe(true);
  });
});

describe('props build', () => {
  const kit = () => ({ uniforms: createKitUniforms(), quality: 'medium' as const, disposables: [] as { dispose(): void }[] });
  const ctx = { a: map(['...'], {}, false), events: ev([]), quality: 'medium' as const };
  it('draws every kind standing on its ground; lamps glow in a mesh of their own', () => {
    const kinds = ['sign', 'mailbox', 'fenceWhite', 'fenceWood', 'fenceMetal', 'lamp', 'rock', 'bush', 'bollard'] as const;
    const list: PropPlacement[] = kinds.map((kind, k) => ({ kind, x0: k * 2, x1: k * 2, y: 3, h: 1, color: [0.5, 0.5, 0.5] }));
    list.push({ kind: 'rock', x0: 30, x1: 31, y: 3, h: 1, color: [0.5, 0.4, 0.3], rows: 1 });
    list.push({ kind: 'fenceMetal', x0: 40, x1: 40, y: 3, h: 1, color: [0.5, 0.5, 0.5], line: [40.25, 1.85, 40.25, 3.85] });
    const k = kit();
    const root = propFamily.build(list, ctx, k)!;
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes).toHaveLength(2);
    const box = new THREE.Box3().setFromObject(root);
    expect(box.min.y).toBeGreaterThan(0.75); // (rocks sink a little into the ground)
    expect(box.max.y).toBeLessThan(1 + 2.1);
    disposeKit(root, k);
    expect(propFamily.build([], ctx, kit())).toBeNull();
    // without lamps: one mesh
    const plain = propFamily.build(list.filter((p) => p.kind !== 'lamp'), ctx, kit())!;
    expect(plain.children).toHaveLength(1);
  });

  it('winds every face of every kind as its normal says, and rocks outward (front faces only are drawn)', () => {
    const grey: [number, number, number] = [0.5, 0.5, 0.5];
    const cases: PropPlacement[] = [
      { kind: 'sign', x0: 0, x1: 0, y: 3, h: 0, color: grey, posts: 2 },
      { kind: 'sign', x0: 0, x1: 0, y: 3, h: 0, color: [0.3, 0.2, 0.2], posts: 1 },
      { kind: 'mailbox', x0: 0, x1: 0, y: 3, h: 0, color: grey },
      { kind: 'lamp', x0: 0, x1: 0, y: 3, h: 0, color: grey },
      { kind: 'rock', x0: 0, x1: 0, y: 3, h: 0, color: [0.5, 0.4, 0.3] },
      { kind: 'rock', x0: 0, x1: 1, y: 3, h: 0, color: [0.5, 0.4, 0.3], rows: 1 },
      { kind: 'bush', x0: 0, x1: 0, y: 3, h: 0, color: [0.3, 0.6, 0.3] },
      { kind: 'bollard', x0: 0, x1: 0, y: 3, h: 0, color: grey },
      { kind: 'fenceMetal', x0: 0, x1: 3, y: 3, h: 0, color: grey, h1: 1 },
      { kind: 'fenceWhite', x0: 0, x1: 0, y: 5, h: 0, color: [1, 1, 1], rows: 3, h1: 2, line: [0.2, 2.45, 0.2, 6] },
      { kind: 'fenceWood', x0: 0, x1: 2, y: 3, h: 0, color: [0.5, 0.35, 0.2] },
    ];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), g = new THREE.Vector3(), n = new THREE.Vector3();
    for (const p of cases) {
      const meshes = propFamily.build([p], ctx, kit())!.children as THREE.Mesh[];
      for (const mesh of meshes) {
        const pos = mesh.geometry.getAttribute('position'), nor = mesh.geometry.getAttribute('normal');
        const centre = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute).getCenter(new THREE.Vector3());
        let faces = 0, against = 0, inward = 0;
        for (let i = 0; i < pos.count; i += 3) {
          a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
          g.subVectors(b, a).cross(c.clone().sub(a));
          if (g.lengthSq() < 1e-12) continue; // (the degenerate half of a triangle written as a quad)
          faces++;
          // the stored (shading) normal of every corner agrees with the winding
          for (const k of [i, i + 1, i + 2]) if (n.fromBufferAttribute(nor, k).dot(g) <= 0) against++;
          if (p.kind === 'rock' && g.dot(a.clone().add(b).add(c).divideScalar(3).sub(centre)) < 0) inward++;
        }
        expect([p.kind, faces > 4]).toEqual([p.kind, true]);
        expect([p.kind, against]).toEqual([p.kind, 0]);
        expect([p.kind, inward]).toEqual([p.kind, 0]);
      }
    }
  });
});

describe('General tables', () => {
  it('are General ids, and every fence piece has a shape', () => {
    for (const s of [GENERAL_ROCK, GENERAL_SEA_ROCK, GENERAL_PINE, GENERAL_FLOWERS, new Set(GENERAL_PROPS.keys())]) for (const m of s) expect(m).toBeLessThan(512);
    for (const [m, k] of GENERAL_PROPS) if (k.startsWith('fence')) expect(GENERAL_FENCE_SHAPES.has(m)).toBe(true);
    for (const m of GENERAL_FENCE_SHAPES.keys()) expect(GENERAL_PROPS.get(m)?.startsWith('fence')).toBe(true);
    expect(GENERAL_FLOWERS.has(0x004)).toBe(true);
  });

  it('installs the rock ids into the cliffs (only for the General tileset)', () => {
    installGeneralTables();
    const grassy = (general: boolean) => world(['...'], {}, { general });
    const a = grassy(true);
    a.info.both.fill(px(14, 24, 20), 0x079 * 256, 0x07a * 256); // a rock face in grass colours
    expect(isRocky(a, 0x079)).toBe(true);
    const b = grassy(false);
    b.info.both.fill(px(14, 24, 20), 0x079 * 256, 0x07a * 256);
    expect(isRocky(b, 0x079)).toBe(false);
  });

  it('installs the sea rocks into the cliffs: brown rock standing in the sea is never rock', () => {
    for (const m of GENERAL_SEA_ROCK) expect(GENERAL_ROCK.has(m)).toBe(false);
    expect([0x172, 0x17a, 0x17f, 0x182, 0x184, 0x157, 0x15e, 0x15f].every((m) => GENERAL_SEA_ROCK.has(m))).toBe(true);
    for (const m of GENERAL_SHOAL_TOPS) expect(GENERAL_SEA_ROCK.has(m)).toBe(true);
    // (the shoal rocks' edges and lower corners are also the corners of coastal cliffs: land rock, but
    // never under a shoal top: the cliffs leave the rows under one to the legacy art)
    expect([0x166, 0x167, 0x16e, 0x16f].some((m) => GENERAL_SEA_ROCK.has(m))).toBe(false);
    installGeneralTables();
    const a = world(['...'], {}, { general: true });
    a.info.both.fill(px(22, 14, 10), 0x17a * 256, 0x17b * 256); // brown rock pixels
    expect(isRocky(a, 0x17a)).toBe(false);
    const b = world(['...'], {}, { general: false });
    b.info.both.fill(px(22, 14, 10), 0x17a * 256, 0x17b * 256);
    expect(isRocky(b, 0x17a)).toBe(true); // (a secondary tileset's 0x17a is not the sea rock)
  });

  it('installs the shoal tops: a shoal rock\'s lower rows are never a cliff, whatever their size', () => {
    installGeneralTables();
    // a 2x3 shoal boulder: its top (0x15e/0x15f) over two rows of rock (0x16e/0x16f)
    const ids = { t: 0x15e, u: 0x15f, l: 0x16e, r: 0x16f };
    const paint = (info: TileInfo) => { for (const m of [0x16e, 0x16f]) info.both.fill(px(22, 14, 10), m * 256, (m + 1) * 256); };
    const a = world(['....', '.tu.', '.lr.', '.lr.', '....'], ids, { general: true, paint });
    const claims = new Claims(a.N);
    expect(cliffFamily.extract({ a, events: ev([]), quality: 'medium' }, claims).runs).toEqual([]);
    for (let y = 1; y <= 3; y++) for (const x of [1, 2]) expect(claims.bits[a.idx(x, y)], `${x},${y}`).toBe(0);
  });

});

describe('secondary tables', () => {
  it('Sootopolis\' crater rock is keyed by its tileset, in secondary ids', () => {
    const soot = SECONDARY_ROCK.get(SYM.gTileset_Sootopolis)!;
    expect([0x2d9, 0x2e1].every((m) => soot.has(m))).toBe(true); // the white top, a grey-cream face
    for (const ids of SECONDARY_ROCK.values()) for (const m of ids) expect(m).toBeGreaterThanOrEqual(512);
  });
});

describe('secret-base spots', () => {
  it('no family models or claims one: a cave hole in a rock mass, a secret-base tree, a shrub, an opened hole', () => {
    // A rock mass with a cave hole in it (H), the secret-base tree (bottom L Q, crown overhang p q)
    // beside a real tree (N), a shrub spot (s: the analysis takes it for a tree), an opened hole (o,
    // walkable); and spots on tiles other families would take: a boulder of the props table (b), a
    // wall cell of a house (Z).
    const HOLE = 0x1a0, OPEN = 0x1a1, SHRUB = 0x271, WALLSPOT = 0x272, LEAF = px(8, 22, 6);
    const rows = [
      '............',
      '.#####.pq...',
      '.##H##.LQN..',
      '.#####......',
      '............',
      '..s....o..b.',
      '............',
      '.RRR........',
      '.WDZ........',
      '............',
    ];
    const legend = { '#': T.rock, H: HOLE, L: 0x026, Q: 0x027, p: 0x01e, q: 0x01f, N: 0x0c7, s: SHRUB, o: OPEN, b: 0x0e2,
      R: T.roof, W: T.wall, D: T.door, Z: WALLSPOT };
    const a = world(rows, legend, {
      open: 'pqo',
      paint: (info) => {
        const fill = (m: number, c: number) => { info.both.fill(c, m * 256, m * 256 + 256); info.bottom.fill(c, m * 256, m * 256 + 256); };
        fill(HOLE, px(4, 3, 3)); fill(OPEN, px(4, 3, 3));
        for (const m of [0x026, 0x027, 0x01e, 0x01f, 0x0c7, SHRUB]) fill(m, LEAF);
        info.green[0x0c7] = 1; info.green[SHRUB] = 0.9;
        info.topCover[0x01e] = 128; info.topCover[0x01f] = 128;
        info.attributes[HOLE] = MB.SECRET_BASE_SPOT_RED_CAVE; info.attributes[OPEN] = MB.SECRET_BASE_SPOT_RED_CAVE_OPEN;
        info.attributes[0x026] = MB.SECRET_BASE_SPOT_TREE_LEFT; info.attributes[0x027] = MB.SECRET_BASE_SPOT_TREE_RIGHT;
        info.attributes[SHRUB] = MB.SECRET_BASE_SPOT_SHRUB;
        info.attributes[0x0e2] = MB.SECRET_BASE_SPOT_BROWN_CAVE;
        fill(WALLSPOT, px(28, 25, 20)); info.attributes[WALLSPOT] = MB.SECRET_BASE_SPOT_SHRUB_OPEN;
      },
    });
    expect(a.kind[a.idx(2, 5)]).toBe(K.Tree); // (the shrub, for the analysis)
    const spots = [[3, 2], [7, 2], [8, 2], [2, 5], [7, 5], [10, 5], [3, 8]];
    // the secret-base tree's crown, drawn over the walkable cells above it (their ground is the
    // terrain's, as under any overhang; the crown card stays)
    const covered = [[7, 1], [8, 1]];
    const claims = new Claims(a.N);
    const ctx = { a, events: ev([[2, 8, 'LittlerootTown_BrendansHouse_1F']]), quality: 'medium' as const };
    const payload = new Map<string, unknown>();
    for (const f of FAMILIES) payload.set(f.name, f.extract(ctx, claims));
    for (const [x, y] of spots) expect([x, y, claims.bits[a.idx(x, y)]]).toEqual([x, y, 0]);
    for (const [x, y] of covered) expect([x, y, claims.bits[a.idx(x, y)] & (CLAIM_OBJECT | CLAIM_TOP)]).toEqual([x, y, 0]);
    // the rock around the hole is still 3D (two columns either side); the hole's column is not
    const runs = (payload.get('cliffs') as { runs: { x: number }[] }).runs.map((r) => r.x);
    expect(runs).toEqual(expect.arrayContaining([1, 2, 4, 5]));
    expect(runs).not.toContain(3);
    expect((payload.get('trees') as { x: number; z: number }[]).every((t) => t.x > 8.5)).toBe(true); // (only the real tree)
    expect((payload.get('buildings') as { x0: number; x1: number }[])).toMatchObject([{ x0: 1, x1: 2 }]); // (the house, less its spot)
    // and the legacy art draws them (the shrub as a tree card)
    const legacy = emitLegacy(a, claims);
    const drawn = new Set([...legacy.quads, ...legacy.trees].map((q) => q.metatile));
    for (const m of [HOLE, OPEN, 0x026, 0x027, SHRUB]) expect(drawn.has(m)).toBe(true);
  });
  it("nor an opened spot with overhang art on the row behind a house's roof", () => {
    const OPENED = 0x1a2;
    const rows = [
      '......',
      '.v....',
      '.RRR..',
      '.WDW..',
      '......',
    ];
    const a = world(rows, { R: T.roof, W: T.wall, D: T.door, v: OPENED }, {
      open: 'v',
      paint: (info) => {
        info.both.fill(px(14, 24, 20), OPENED * 256, OPENED * 256 + 256); info.bottom.fill(px(14, 24, 20), OPENED * 256, OPENED * 256 + 256);
        info.both.fill(px(26, 9, 8), OPENED * 256, OPENED * 256 + 64); info.topCover[OPENED] = 64; // (roof-coloured overhang)
        info.attributes[OPENED] = MB.SECRET_BASE_SPOT_TREE_RIGHT_OPEN;
      },
    });
    expect(a.hasTop(a.idx(1, 1))).toBe(true);
    const claims = new Claims(a.N);
    const ctx = { a, events: ev([[2, 3, 'LittlerootTown_BrendansHouse_1F']]), quality: 'medium' as const };
    const payload = new Map<string, unknown>();
    for (const f of FAMILIES) payload.set(f.name, f.extract(ctx, claims));
    expect((payload.get('buildings') as unknown[]).length).toBe(1);
    expect(claims.bits[a.idx(1, 1)]).toBe(0);
  });
});
