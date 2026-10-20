import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { blobCrown, pairRoundTrees, treeFamily, type TreePlacement } from '../src/render/kit/trees';
import { Claims, CLAIM_OBJECT, CLAIM_TOP } from '../src/render/overworld/claims';
import { NO_EVENTS } from '../src/render/kit/events';
import { doorStructures } from '../src/render/kit/cliffs';
import { createKitUniforms } from '../src/render/kit/materials';
import { disposeKit } from '../src/render/kit/semantics';
import { analyze, K, type MapAnalysis } from '../src/render/overworld/analyze';
import { fakeInfo } from './helpers/fakeMap';
import { MB } from '../src/game/behaviors';

describe('pairRoundTrees', () => {
  it('pairs side-by-side round-tree columns into one big tree', () => {
    const out = pairRoundTrees([
      { x: 4, k: 10, base: 0 }, { x: 5, k: 10, base: 0 }, // one 2-wide tree
      { x: 8, k: 10, base: 0 },                          // lonely column
    ]);
    expect(out).toEqual([
      { x: 5, k: 10, base: 0, big: true },
      { x: 8.5, k: 10, base: 0, big: false },
    ]);
  });
  it('pairs greedily left to right in long rows', () => {
    const out = pairRoundTrees([0, 1, 2, 3].map((x) => ({ x, k: 3, base: 1 })));
    expect(out.map((t) => t.x)).toEqual([1, 3]);
  });
});

/** BGR555 pixel of an sRGB colour given in 31sts. */
const px = (r: number, g: number, b: number) => r | (g << 5) | (b << 10);
const LEAF = px(8, 20, 6), LEAF2 = px(14, 26, 8), ASH_LEAF = px(19, 23, 12), SAND = px(27, 25, 16), STONE = px(16, 16, 18);
const ROUND = 0x1d4, NARROW = 0x0c7; // General tree ids (analyze.ts ROUND_TREE / NARROW_TREE)
const SEC_TREE = 0x210, LEFT = 0x211, RIGHT = 0x212, LEAFY = 0x213, ASH_A = 0x220, ASH_B = 0x221, ROCK = 0x222, FACADE = 0x223;

/**
 * Synthetic outdoor map (General primary tileset). Cells: '.' grass (1), 'P' grass on a plateau
 * (another elevation), 'R' General round tree, 'N' General narrow tree, 'n' a narrow tree in other
 * leaf colours (0x0c6), 's' beach sand (SAND behaviour), 'p' a sand-coloured path (NORMAL), '~' sea,
 * 'o' grass with a leafy overhang, 'g' tall grass with a leafy tuft overhang, 'T' a secondary-tileset
 * tree, 'L' / 'J' the leafy left / right halves of a 2-wide tree's bottom row, 'B' a leafy block,
 * 'A' / 'a' ash-forest blocks, '#' rock, 'F' a green building facade (the analysis takes it for a
 * tree by its green; it draws no foliage).
 */
function map(rows: string[], opts: { margin?: number; underwater?: boolean; indoor?: boolean; border?: number[] } = {}): MapAnalysis {
  const info = fakeInfo();
  const fill = (m: number, c: number, from = 0, to = 256) => {
    for (let p = from; p < to; p++) { info.both[m * 256 + p] = c; info.bottom[m * 256 + p] = c; }
  };
  fill(1, px(14, 24, 20)); // mint grass
  fill(ROUND, LEAF); info.green[ROUND] = 1;
  fill(NARROW, LEAF); info.green[NARROW] = 1;
  fill(0x0c6, LEAF2); info.green[0x0c6] = 1;
  fill(3, SAND); info.attributes[3] = MB.SAND;
  fill(4, SAND);
  fill(5, px(8, 12, 26)); info.attributes[5] = MB.OCEAN_WATER;
  fill(6, px(14, 24, 20)); info.both.fill(LEAF, 6 * 256, 6 * 256 + 128); info.topCover[6] = 128;
  fill(7, px(14, 24, 20)); info.both.fill(LEAF, 7 * 256, 7 * 256 + 128); info.topCover[7] = 128; info.attributes[7] = MB.TALL_GRASS;
  fill(SEC_TREE, LEAF); info.green[SEC_TREE] = 1;
  fill(LEFT, px(14, 24, 20)); for (let y = 0; y < 16; y++) fill(LEFT, LEAF, y * 16 + 8, y * 16 + 16);
  fill(RIGHT, px(14, 24, 20)); for (let y = 0; y < 16; y++) fill(RIGHT, LEAF, y * 16, y * 16 + 8);
  info.green[LEFT] = info.green[RIGHT] = 0.5;
  fill(LEAFY, LEAF); info.green[LEAFY] = 0.5; // below the analysis' tree threshold for secondary tiles
  fill(ASH_A, ASH_LEAF); fill(ASH_A, px(21, 21, 17), 0, 100); info.green[ASH_A] = 0.4;
  fill(ASH_B, ASH_LEAF); fill(ASH_B, px(21, 21, 17), 0, 140); info.green[ASH_B] = 0.3;
  fill(ROCK, STONE);
  fill(FACADE, px(14, 26, 22)); fill(FACADE, px(26, 30, 28), 0, 64); info.green[FACADE] = 0.75; // teal, no foliage
  const code: Record<string, number> = {
    '.': 1 | 0x3000, P: 1 | 0x5000, R: ROUND | 0x0400, N: NARROW | 0x0400, n: 0x0c6 | 0x0400, s: 3 | 0x3000, p: 4 | 0x3000, '~': 5 | 0x0400,
    o: 6 | 0x3000, g: 7 | 0x3000, T: SEC_TREE | 0x0400, L: LEFT | 0x0400, J: RIGHT | 0x0400, B: LEAFY | 0x0400,
    A: ASH_A | 0x0400, a: ASH_B | 0x0400, '#': ROCK | 0x0400, F: FACADE | 0x0400,
  };
  const w = rows[0].length, h = rows.length;
  const cells = new Uint16Array(w * h);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { cells[y * w + x] = code[ch]; }));
  return analyze({ width: w, height: h, cells, border: opts.border ?? [1, 1, 1, 1], borderW: 2, borderH: 2, borderPhase: 0 },
    { info, generalPrimary: true, indoor: opts.indoor ?? false, underground: false, underwater: opts.underwater ?? false, margin: opts.margin ?? 0 });
}

const extract = (a: MapAnalysis) => {
  const claims = new Claims(a.N);
  return { claims, trees: treeFamily.extract({ a, events: NO_EVENTS, quality: 'medium' }, claims) };
};
/** Grid row of a tree's trunk (z = row + 0.5 + base). */
const row = (t: TreePlacement) => t.z - 0.5 - t.y;

describe('tree extract', () => {
  it('turns a 2x2 round tree into one big round tree and claims its cells', () => {
    const a = map(['....', '.RR.', '.RR.', '....']);
    const { claims, trees } = extract(a);
    expect(trees).toHaveLength(1);
    expect(trees[0]).toMatchObject({ x: 2, y: 0, z: 2.5, style: 'round' });
    for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]]) {
      const i = a.idx(x, y);
      expect(claims.has(i, CLAIM_OBJECT)).toBe(true);
      expect(claims.groundY[i]).toBe(0);
      expect(claims.groundMt[i]).toBe(1); // the grass beside it
    }
  });

  it('makes a lone round-tree column a small bushy tree', () => {
    const { trees } = extract(map(['...', '.R.', '.R.', '...']));
    expect(trees).toEqual([expect.objectContaining({ x: 1.5, z: 2.5, style: 'bushy' })]);
  });

  it('gives a narrow run of L rows L - 1 crowns (a narrow tree is crown over trunk)', () => {
    const count = (rows: string[]) => extract(map(rows)).trees.length;
    expect(count(['...', '.N.', '...'])).toBe(1);
    expect(count(['...', '.N.', '.N.', '...'])).toBe(1);
    expect(count(['...', '.N.', '.N.', '.N.', '.N.', '...'])).toBe(3);
    // the crown stands on the run's bottom row
    expect(row(extract(map(['...', '.N.', '.N.', '...'])).trees[0])).toBe(2);
  });

  it('thins a forest interior to every other tree, larger, and keeps every edge tree', () => {
    const rows = ['.......', ...Array.from({ length: 5 }, () => '.NNNNN.'), '.......'];
    const { trees } = extract(map(rows));
    const inner = trees.filter((t) => t.scale !== undefined);
    expect(inner.length).toBeGreaterThan(0);
    expect(inner.every((t) => t.scale! > 1)).toBe(true);
    // 5 columns x 4 crowns = 20 candidates: the 11 on the edge all stay, the 9 inside keep a checkerboard half
    expect(inner.length).toBeGreaterThanOrEqual(4);
    expect(inner.length).toBeLessThanOrEqual(5);
    expect(trees.length).toBe(11 + inner.length);
    const at = new Set(inner.map((t) => `${t.x - 0.5},${row(t)}`));
    for (const t of inner) {
      const x = t.x - 0.5, k = row(t);
      for (const [dx, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) expect(at.has(`${x + dx},${k + dk}`)).toBe(false);
    }
  });

  it('plants palms on beach sand only (not beside the sea, not by a sand-coloured path)', () => {
    const style = (below: string) => extract(map(['...', '.N.', `.${below}.`, '...'])).trees[0].style;
    expect(style('s')).toBe('palm');
    expect(style('p')).toBe('bushy');
    expect(style('~')).toBe('bushy');
  });

  it('takes the ground under trees from the nearest land, not the water beside them', () => {
    const a = map(['~~~~', '~NN.', '~NN.', '~~~~']);
    const { claims } = extract(a);
    for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]]) expect(claims.groundMt[a.idx(x, y)]).toBe(1);
  });

  it('stands the first rows of a forest running down from higher ground on that ground', () => {
    // a plateau (2 high: two rock rows down to the lowland in columns 0-1) behind a 4-row forest
    const a = map(['PPPPP', '##NNN', '##NNN', '..NNN', '..NNN', '.....']);
    expect(a.height[a.idx(0, 0)]).toBe(2);
    expect(a.height[a.idx(0, 5)]).toBe(0);
    const { claims, trees } = extract(a);
    expect(claims.groundY[a.idx(3, 1)]).toBe(2);
    expect(claims.groundY[a.idx(3, 4)]).toBe(0);
    expect(trees.find((t) => t.x === 4.5 && row(t) === 2)?.y).toBe(2);
    expect(trees.filter((t) => row(t) === 4).map((t) => t.y)).toEqual([0, 0, 0]);
  });

  it('lets a level reach only 2 cells into a forest (deeper in, the level in front of the column holds)', () => {
    // plateau (2) north of a 9-row forest; the lowland (0) only south of it
    const a = map(['PPPPPPP', '###NNNN', '###NNNN', '.##NNNN', ...Array.from({ length: 6 }, () => '.##NNNN'), '.......']);
    expect(a.height[a.idx(0, 0)]).toBe(2);
    const { claims, trees } = extract(a);
    expect(claims.groundY[a.idx(4, 2)]).toBe(2); // two cells from the plateau
    expect(claims.groundY[a.idx(4, 4)]).toBe(0); // deeper: the lowland in front of the forest
    expect(trees.filter((t) => row(t) >= 4).every((t) => t.y === 0)).toBe(true);
  });

  it('keeps a tree at the water side on the water side level, not on the plateau behind it', () => {
    const a = map(['PPPPP', '##NNN', '##NNN', '..~~~']);
    expect(a.height[a.idx(0, 0)]).toBe(2);
    const { trees } = extract(a);
    expect(trees.map((t) => t.y)).toEqual([0, 0, 0]);
  });

  it('colours each tree from its own tiles: the mean of its foliage pixels', () => {
    const { trees } = extract(map(['.....', '.N.n.', '.N.n.', '.....']));
    const [a, b] = trees.sort((p, q) => p.x - q.x);
    for (const t of [a, b]) {
      expect(t.leaf[1]).toBeGreaterThan(t.leaf[0]);
      expect(t.leaf[1]).toBeGreaterThan(t.leaf[2]);
    }
    expect(b.leaf[0]).toBeGreaterThan(a.leaf[0]); // the lighter tile gives the lighter tree
  });

  it('claims the crown art overhanging a tree, but not grass tufts', () => {
    const a = map(['.o..', '.N..', '.N..', '....']);
    expect(extract(a).claims.has(a.idx(1, 0), CLAIM_TOP)).toBe(true); // the overhang above a run is its crown
    const b = map(['..o.', '.N..', '.N.g', '..N.', '..N.', '....']);
    const r = extract(b);
    expect(r.claims.has(b.idx(2, 0), CLAIM_TOP)).toBe(true); // leafy overhang beside a tree
    expect(r.claims.has(b.idx(3, 2), CLAIM_TOP)).toBe(false); // tall-grass tuft beside a tree
  });

  it('takes a 2-wide tree whose bottom row is leafy blocking art (left and right halves)', () => {
    const a = map(['....', '.TT.', '.LJ.', '....']);
    const { claims, trees } = extract(a);
    expect(a.kind[a.idx(1, 2)]).toBe(K.Block);
    expect(claims.has(a.idx(1, 2), CLAIM_OBJECT)).toBe(true);
    expect(claims.has(a.idx(2, 2), CLAIM_OBJECT)).toBe(true);
    expect(trees).toEqual([expect.objectContaining({ x: 2, z: 2.5, style: 'round' })]);
  });

  it('leaves a stack of leafy blocks (the side of a structure) and plain leafy blocks to the legacy art', () => {
    // a stacked pair; plain leafy blocks under a tree; a left half with no right half beside it
    const a = map(['.....', '.TT..', '.LJ#.', '.LJ#.', '.....', '.T.T.', '.BBL.', '.....']);
    const { claims } = extract(a);
    for (const [x, y] of [[1, 2], [2, 2], [1, 6], [2, 6], [3, 6]]) expect(claims.has(a.idx(x, y), CLAIM_OBJECT)).toBe(false);
  });

  it("leaves a treehouse's corner post beside a tree to the legacy art (Fortree)", () => {
    // a hut on a door structure (walkable door, warp at (2, 2)); its left post runs one row past
    // the door row onto the deck: a leafy right-half tile beside a tree
    const a = map(['.....', 'TJ##.', 'TJ.#.', 'TJ...', '.....']);
    const events = { warps: [{ x: 2, y: 2, dest: 'FortreeCity_House5' }], signs: [] };
    const structure = doorStructures(a, events);
    for (const y of [1, 2, 3]) expect(structure[a.idx(1, y)]).toBe(1);
    const claims = new Claims(a.N);
    treeFamily.extract({ a, events, quality: 'medium' }, claims);
    expect(claims.has(a.idx(1, 3), CLAIM_OBJECT)).toBe(false);
    // without the door, the post's foot reads as the right half of a 2-wide tree
    expect(extract(a).claims.has(a.idx(1, 3), CLAIM_OBJECT)).toBe(true);
    // a cliff beside a door, running on far past the door row, stays out of the structure
    const b = map(['.....', 'TJ##.', 'TJ.#.', 'TJ...', 'TJ...', 'TJ...', '.....']);
    expect(doorStructures(b, events)[b.idx(1, 1)]).toBe(0);
    // a column open at the door row is no post (its walkable cell is no structure)
    const c = map(['.....', 'TJ##.', 'T..#.', 'TJ...', '.....']);
    const sc = doorStructures(c, events);
    for (const y of [1, 2, 3]) expect(sc[c.idx(1, y)]).toBe(0);
  });

  it("leaves a secondary tile the analysis took for a tree by its green but that draws no foliage to the legacy art (Trainer Hill's facade)", () => {
    const a = map(['.....', '.FFT.', '.....']);
    expect([1, 2, 3].map((x) => a.kind[a.idx(x, 1)])).toEqual([K.Tree, K.Tree, K.Tree]);
    const { claims, trees } = extract(a);
    expect(claims.has(a.idx(1, 1), CLAIM_OBJECT)).toBe(false);
    expect(claims.has(a.idx(2, 1), CLAIM_OBJECT)).toBe(false);
    expect(claims.has(a.idx(3, 1), CLAIM_OBJECT)).toBe(true);
    expect(trees).toHaveLength(1);
    // nor is a leafy half block beside it the other half of a tree
    const b = map(['.....', '.LF..', '.....']);
    expect(extract(b).claims.has(b.idx(1, 1), CLAIM_OBJECT)).toBe(false);
    expect(extract(map(['.....', '.LT..', '.....'])).claims.has(b.idx(1, 1), CLAIM_OBJECT)).toBe(true);
  });

  it("leaves the path beyond a warp to the legacy art: the analysis' colour-guessed trees north of it", () => {
    // a warp at (1, 4) under a column of secondary-tileset "tree" cells (Petalburg Woods' north exit,
    // Mt Pyre's summit path: green blocking art) topped by a General round tree (a real tree)
    const a = map(['.R.', '.T.', '.T.', '.T.', '...', '...']);
    const events = { warps: [{ x: 1, y: 4, dest: 'Route104' }], signs: [] };
    const claims = new Claims(a.N);
    treeFamily.extract({ a, events, quality: 'medium' }, claims);
    for (const y of [1, 2, 3]) expect(claims.has(a.idx(1, y), CLAIM_OBJECT), `1,${y}`).toBe(false);
    expect(claims.has(a.idx(1, 0), CLAIM_OBJECT)).toBe(true);
    // without the warp they are trees
    for (const y of [1, 2, 3]) expect(extract(a).claims.has(a.idx(1, y), CLAIM_OBJECT)).toBe(true);
    // General tree ids are trees, warp or not
    const b = map(['...', '.N.', '.N.', '...']);
    const nb = new Claims(b.N);
    treeFamily.extract({ a: b, events: { warps: [{ x: 1, y: 3, dest: 'X' }], signs: [] }, quality: 'medium' }, nb);
    expect(nb.has(b.idx(1, 2), CLAIM_OBJECT)).toBe(true);
    // a passage whose first cell draws no foliage (no tree itself, Mt Pyre's) runs on past it
    const c = map(['.R.', '.T.', '.T.', '.F.', '...', '...']);
    const nc = new Claims(c.N);
    treeFamily.extract({ a: c, events, quality: 'medium' }, nc);
    for (const y of [1, 2, 3]) expect(nc.has(c.idx(1, y), CLAIM_OBJECT), `1,${y}`).toBe(false);
    expect(nc.has(c.idx(1, 0), CLAIM_OBJECT)).toBe(true);
  });

  it('turns a border forest the analysis left as blocks (ash trees) into round trees', () => {
    const a = map(['......', '.AaAa.', '.aAaA.', '......', '.#Aa..', '......'], { margin: 2, border: [ASH_A, ASH_B, ASH_B, ASH_A] });
    expect(a.kind[a.idx(1, 1)]).toBe(K.Block);
    const { claims, trees } = extract(a);
    const inside = trees.filter((t) => t.x > 0 && t.x < 6 && row(t) >= 0 && row(t) < 6);
    expect(inside.length).toBeGreaterThanOrEqual(2);
    expect(inside.every((t) => t.style === 'round' || t.style === 'bushy')).toBe(true);
    expect(claims.has(a.idx(2, 4), CLAIM_OBJECT)).toBe(true);
    expect(claims.has(a.idx(1, 4), CLAIM_OBJECT)).toBe(false); // rock stays rock
    // ash-tinted: lighter and yellower than the General trees' green
    const general = extract(map(['....', '.RR.', '.RR.', '....'])).trees[0].leaf;
    expect(inside[0].leaf[0]).toBeGreaterThan(general[0]);
  });

  it('plants nothing indoors or on a Dive map, and claims nothing there', () => {
    for (const opts of [{ indoor: true }, { underwater: true }]) {
      const a = map(['....', '.RR.', '.RR.', '.NN.'], opts);
      const { claims, trees } = extract(a);
      expect(trees).toEqual([]);
      expect(claims.bits.every((b) => b === 0)).toBe(true);
      expect(treeFamily.build(trees, { a, events: NO_EVENTS, quality: 'medium' }, kit())).toBeNull();
    }
  });
});

const kit = () => ({ uniforms: createKitUniforms(), quality: 'medium' as const, disposables: [] as { dispose(): void }[] });
const tree = (x: number, z: number, style: TreePlacement['style'] = 'round', seed = 7): TreePlacement =>
  ({ x, y: 0, z, style, leaf: [0.4, 0.65, 0.3], trunk: [0.45, 0.32, 0.22], seed });
const meshes = (o: THREE.Object3D | null) => {
  const out: THREE.InstancedMesh[] = [];
  o?.traverse((m) => { if ((m as THREE.InstancedMesh).isInstancedMesh) out.push(m as THREE.InstancedMesh); });
  return out;
};
const build = (trees: TreePlacement[]) => treeFamily.build(trees, { a: map(['..']), events: NO_EVENTS, quality: 'medium' }, kit());

describe('tree build', () => {
  it('draws one instanced mesh per style and map chunk', () => {
    const ms = meshes(build([tree(1, 1), tree(3, 2), tree(20, 2), tree(4, 4, 'palm')]));
    expect(ms.map((m) => m.count).sort()).toEqual([1, 1, 2]);
  });

  it('draws a small tree among round ones with the round geometry (one draw)', () => {
    const ms = meshes(build([tree(1, 1), tree(3.5, 2, 'bushy')]));
    expect(ms).toHaveLength(1);
    expect(ms[0].count).toBe(2);
  });

  it('shares cached crown + trunk geometry across builds; disposing the world keeps it', () => {
    const k = kit();
    const root = treeFamily.build([tree(1, 1)], { a: map(['..']), events: NO_EVENTS, quality: 'medium' }, k)!;
    const g = meshes(root)[0].geometry;
    expect(g.userData.shared).toBe(true);
    expect(meshes(build([tree(1, 1)]))[0].geometry).toBe(g);
    let disposed = false;
    g.addEventListener('dispose', () => { disposed = true; });
    disposeKit(root, k);
    expect(disposed).toBe(false);
  });

  it('flags trunk vertices in the vertex alpha (bark colour) and crowns opaque', () => {
    const g = meshes(build([tree(1, 1)]))[0].geometry;
    const col = g.getAttribute('color'), pos = g.getAttribute('position');
    expect(col.itemSize).toBe(4);
    let trunk = 0, crown = 0;
    for (let i = 0; i < col.count; i++) {
      if (col.getW(i) < 0.5) { trunk++; expect(pos.getY(i)).toBeLessThanOrEqual(1.01); } else { crown++; expect(col.getW(i)).toBe(1); }
    }
    expect(trunk).toBeGreaterThan(0);
    expect(crown).toBeGreaterThan(trunk);
  });

  it('sways, fades, casts and receives shadows, and colours each instance', () => {
    const [m] = meshes(build([tree(1, 1), tree(2, 3)]));
    const mat = m.material as THREE.MeshStandardMaterial;
    expect(mat.defines).toHaveProperty('KIT_WIND');
    expect(mat.defines).toHaveProperty('KIT_FADE');
    expect(m.customDepthMaterial).toBeDefined();
    expect(m.castShadow && m.receiveShadow).toBe(true);
    expect(m.instanceColor).not.toBeNull();
  });

  it('skips the shadow pass for chunks whose shadows fall outside the view', () => {
    const [m] = meshes(build([tree(1, 1), tree(2, 3)]));
    const shadowCam = new THREE.OrthographicCamera();
    shadowCam.position.set(10, 40, 30);
    shadowCam.lookAt(0, 0, 0);
    shadowCam.updateMatrixWorld();
    const cam = new THREE.PerspectiveCamera(32, 1.6, 0.1, 500);
    const shadow = (lookAt: THREE.Vector3) => {
      cam.position.copy(lookAt).add(new THREE.Vector3(0, 11, 10));
      cam.lookAt(lookAt);
      cam.updateMatrixWorld();
      const r = null as unknown as THREE.WebGLRenderer, s = new THREE.Scene(), g = m.geometry;
      m.onBeforeShadow(r, s, cam, shadowCam, g, m.customDepthMaterial!, null as unknown as THREE.Group);
      const during = m.count;
      m.onAfterShadow(r, s, cam, shadowCam, g, m.customDepthMaterial!, null as unknown as THREE.Group);
      return [during, m.count];
    };
    expect(shadow(new THREE.Vector3(2, 0, 2))).toEqual([2, 2]);
    expect(shadow(new THREE.Vector3(200, 0, 200))).toEqual([0, 2]);
  });

  it('returns null for no trees', () => {
    expect(build([])).toBeNull();
  });
});

describe('blobCrown', () => {
  it('builds a new, normalled, vertex-coloured crown on each call', () => {
    const a = blobCrown(5, 4, 0.2, 0.22, 0.3, 0.3, 0.1, 1);
    const b = blobCrown(5, 4, 0.2, 0.22, 0.3, 0.3, 0.1, 1);
    expect(a).not.toBe(b);
    for (const name of ['position', 'normal', 'color']) expect(a.getAttribute(name)).toBeDefined();
    expect(Array.from(a.getAttribute('position').array)).toEqual(Array.from(b.getAttribute('position').array));
    a.computeBoundingBox();
    expect(a.boundingBox!.max.y).toBeLessThan(1);
  });
});
