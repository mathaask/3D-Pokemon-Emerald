import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import { flowerFamily, isFlowerTile, petalColors, setFlowerIds, type FlowerCell } from '../src/render/kit/flowers';
import { BLADES, bladeColor, clump, grassFamily, LONG_SCALE, type GrassCell } from '../src/render/kit/grass';
import { cellLook } from '../src/render/kit/terrain';
import { Claims, CLAIM_DECOR, CLAIM_OBJECT, CLAIM_TOP } from '../src/render/overworld/claims';
import { NO_EVENTS } from '../src/render/kit/events';
import { createKitUniforms } from '../src/render/kit/materials';
import { bgr555ToSrgb, luma } from '../src/render/kit/palette';
import { disposeKit } from '../src/render/kit/semantics';
import { analyze, K, type MapAnalysis } from '../src/render/overworld/analyze';
import { fakeInfo } from './helpers/fakeMap';
import { MB } from '../src/game/behaviors';
import { SYM } from '../src/game/symbols';

describe('flora', () => {
  it('grass density follows quality', () => {
    expect(BLADES).toEqual({ low: 8, medium: 24, high: 48 });
  });
  it('finds two petal colours among green', () => {
    const px = new Uint16Array(256).fill(14 | (25 << 5) | (20 << 10)); // grass green
    px.fill(31 | (4 << 5) | (4 << 10), 0, 30);                        // red petals
    px.fill(31 | (31 << 5) | (31 << 10), 30, 45);                     // white centres
    const c = petalColors(px, 0)!;
    expect(c[0][0]).toBeGreaterThan(0.9);
    expect(c[0][1]).toBeLessThan(0.3);
    expect(c[1]).toEqual([1, 1, 1]);
  });
  it('plain grass has no petals', () => {
    expect(petalColors(new Uint16Array(256).fill(14 | (25 << 5) | (20 << 10)), 0)).toBeNull();
  });
});

/** BGR555 pixel of an sRGB colour given in 31sts. */
const px = (r: number, g: number, b: number) => r | (g << 5) | (b << 10);
// Hoenn grass art: bare-ground mint, the blades' mid green, dark olive outlines, light tips; long
// grass green; ash; flower petals (peach), centres (red), leaves; outlines of signs and roofs (navy).
const MINT = px(14, 24, 20), BLADE = px(3, 20, 13), OLIVE = px(7, 10, 0), TIP = px(20, 26, 24);
const LONG = px(7, 17, 6), ASH = px(18, 17, 14), ASH_LIGHT = px(21, 21, 17);
const PEACH = px(31, 24, 18), RED = px(25, 8, 10), LEAF = px(7, 17, 6), NAVY = px(4, 6, 14), YELLOW = px(31, 30, 12);

const GRASS = 1, TALL = 13, LONG_MT = 21, LONG_EDGE = 22, ASH_MT = 23, FLOWER = 4, EAVE = 5, SPECKLE = 6, SIGN = 7, KNOWN = 8;
const FLOWER_GRASS = 9, BUSH = 10;
/** A town tileset's flower beds (secondary ids: Mauville's), drawn in the ground layer: a bed, the
 *  bed with a stone ledge in the top layer over its lower half (Ever Grande's), and a bed of shaded
 *  petals. */
const BED = 0x208, BED_STONE = 0x209, BED_SHADED = 0x20a;
const PINK = px(29, 16, 22), WHITE = px(31, 31, 31), ORANGE = px(31, 20, 4), LPINK = px(31, 21, 27), STONE = px(24, 24, 20), SAND = px(28, 25, 14);
// Ever Grande's petals are drawn in a dark shade and a light one
const DARK_Y = px(20, 18, 8), LIGHT_Y = px(31, 30, 10), VIOLET = px(12, 11, 21), BLUE_P = px(18, 18, 31);

/** Pixel painter for one metatile in a 256-px buffer pair (both layers alike). */
function painter(info: ReturnType<typeof fakeInfo>, m: number) {
  const set = (x: number, y: number, c: number) => { info.both[m * 256 + y * 16 + x] = c; info.bottom[m * 256 + y * 16 + x] = c; };
  return {
    fill: (c: number) => { for (let p = 0; p < 256; p++) set(p & 15, p >> 4, c); },
    rect: (x0: number, y0: number, w: number, h: number, c: number) => {
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, c);
    },
    set,
  };
}

/** Three 4x4 flowers (peach ring, red centre) on leaves. */
function paintFlowers(info: ReturnType<typeof fakeInfo>, m: number) {
  const p = painter(info, m);
  p.fill(LEAF);
  for (const [x, y] of [[1, 1], [9, 2], [5, 9]]) {
    p.rect(x, y, 4, 4, PEACH);
    p.rect(x + 1, y + 1, 2, 2, RED);
  }
}

/** The tiles above, as a synthetic analysis-ready TileInfo. */
function tiles() {
  const info = fakeInfo();
  painter(info, GRASS).fill(MINT);
  const tall = painter(info, TALL);
  tall.fill(MINT);
  tall.rect(0, 0, 16, 5, BLADE); tall.rect(0, 5, 16, 5, OLIVE); tall.rect(0, 10, 8, 1, TIP); // 80 blade, 80 olive, 8 tip px
  info.attributes[TALL] = MB.TALL_GRASS;
  painter(info, LONG_MT).fill(LONG);
  info.attributes[LONG_MT] = MB.LONG_GRASS;
  const edge = painter(info, LONG_EDGE);
  edge.fill(MINT); edge.rect(0, 0, 16, 6, OLIVE); edge.rect(0, 6, 16, 5, LONG);
  info.attributes[LONG_EDGE] = MB.LONG_GRASS_SOUTH_EDGE;
  const ash = painter(info, ASH_MT);
  ash.fill(ASH_LIGHT); ash.rect(0, 0, 16, 9, ASH);
  info.attributes[ASH_MT] = MB.ASHGRASS;
  paintFlowers(info, FLOWER);
  info.green[FLOWER] = 0.8;
  const eave = painter(info, EAVE); // a roof edge overhanging grass: one long band
  eave.fill(MINT); eave.rect(0, 0, 16, 5, PEACH); eave.rect(0, 5, 16, 1, NAVY);
  info.green[EAVE] = 0.6;
  const speckle = painter(info, SPECKLE); // speckled grass: single light pixels
  speckle.fill(MINT);
  for (let k = 0; k < 20; k++) speckle.set((k * 5) % 16, (k * 3) % 16 | 0, YELLOW);
  info.green[SPECKLE] = 0.8;
  const sign = painter(info, SIGN); // two framed yellow panels
  sign.fill(MINT);
  for (const x of [1, 9]) { sign.rect(x, 3, 6, 6, NAVY); sign.rect(x + 1, 4, 4, 4, YELLOW); }
  info.green[SIGN] = 0.6;
  paintFlowers(info, KNOWN);
  info.green[KNOWN] = 0.1; // too little green for the heuristic: only the curated id list takes it
  paintFlowers(info, FLOWER_GRASS); // flower art on a tall-grass cell
  info.green[FLOWER_GRASS] = 0.8;
  info.attributes[FLOWER_GRASS] = MB.TALL_GRASS;
  // a bush over sand (Dewford's tileset): leaves in the top layer, the sand showing through two gaps
  const bush = painter(info, BUSH);
  bush.fill(SAND);
  info.both.fill(LEAF, BUSH * 256, BUSH * 256 + 256);
  for (const [x, y] of [[2, 3], [9, 8]]) for (let r = y; r < y + 4; r++) info.both.fill(SAND, BUSH * 256 + r * 16 + x, BUSH * 256 + r * 16 + x + 4);
  info.green[BUSH] = 0.8; info.topCover[BUSH] = 224;
  for (const m of [BED, BED_STONE]) {
    // two big flowers side by side (they touch: one petal blob, too big for the blob test) over leaves
    const p = painter(info, m);
    p.fill(MINT); p.rect(2, 7, 12, 8, LEAF);
    p.rect(1, 1, 6, 5, PINK); p.rect(3, 2, 2, 2, ORANGE); // a pink flower, its orange centre
    p.rect(7, 1, 6, 5, WHITE); p.rect(9, 2, 2, 2, LPINK); // a white one, its pink centre
    info.green[m] = 0.6;
  }
  info.both.fill(STONE, BED_STONE * 256 + 9 * 16, BED_STONE * 256 + 256); info.topCover[BED_STONE] = 112;
  const shaded = painter(info, BED_SHADED); // a yellow flower and a blue one, each in two shades
  shaded.fill(MINT); shaded.rect(2, 7, 12, 8, LEAF);
  shaded.rect(1, 1, 5, 4, DARK_Y); shaded.rect(2, 1, 3, 2, LIGHT_Y);
  shaded.rect(8, 6, 5, 4, VIOLET); shaded.rect(9, 6, 3, 2, BLUE_P);
  return info;
}

/** Outdoor map over General ids: '.' grass, 'g' tall grass, 'L' long grass, 'E' long grass south
 *  edge, 'A' ash grass, 'f' flowers, 'e' an eave, 's' speckled grass, 'n' a sign, 'k' a curated
 *  flower tile, 'F' flowers on a tall-grass cell, 'b' a bush over sand, '#' a block; 'B' a town's flower
 *  bed, 'S' one under a stone ledge, 'Y' one of shaded yellow and blue flowers (secondary ids: Mauville's
 *  tileset unless `secondary` says). */
function map(rows: string[], opts: { indoor?: boolean; underground?: boolean; underwater?: boolean; secondary?: number } = {}): MapAnalysis {
  const code: Record<string, number> = {
    '.': GRASS | 0x3000, g: TALL | 0x3000, L: LONG_MT | 0x3000, E: LONG_EDGE | 0x3000, A: ASH_MT | 0x3000,
    f: FLOWER | 0x3000, e: EAVE | 0x3000, s: SPECKLE | 0x3000, n: SIGN | 0x3000, k: KNOWN | 0x3000, F: FLOWER_GRASS | 0x3000,
    b: BUSH | 0x3000, B: BED | 0x3000, S: BED_STONE | 0x3000, Y: BED_SHADED | 0x3000, '#': 2 | 0x0400,
  };
  const w = rows[0].length, h = rows.length;
  const cells = new Uint16Array(w * h);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { cells[y * w + x] = code[ch]; }));
  return analyze({ width: w, height: h, cells, border: [GRASS, GRASS, GRASS, GRASS], borderW: 2, borderH: 2, borderPhase: 0 }, {
    info: tiles(), generalPrimary: true, indoor: opts.indoor ?? false, underground: opts.underground ?? false,
    underwater: opts.underwater ?? false, margin: 0, secondaryTileset: opts.secondary ?? SYM.gTileset_Mauville,
  });
}

const ctxOf = (a: MapAnalysis) => ({ a, events: NO_EVENTS, quality: 'medium' as const });
const kit = (quality: 'low' | 'medium' | 'high' = 'medium') => ({ uniforms: createKitUniforms(), quality, disposables: [] as { dispose(): void }[] });
const meshes = (o: THREE.Object3D | null) => {
  const out: THREE.InstancedMesh[] = [];
  o?.traverse((m) => { if ((m as THREE.InstancedMesh).isInstancedMesh) out.push(m as THREE.InstancedMesh); });
  return out;
};

describe('grass colour', () => {
  it('takes the blades\' mid green, not the bare ground, the outlines or the tips', () => {
    const info = tiles();
    const c = bladeColor(info.both, TALL);
    expect(c[1]).toBeGreaterThan(c[0]);
    expect(c[1]).toBeGreaterThan(c[2]);
    expect(luma(c)).toBeLessThan(luma(bgr555ToSrgb(MINT)) - 0.05); // darker than the ground around the patch
    expect(luma(c)).toBeGreaterThan(luma(bgr555ToSrgb(OLIVE)) + 0.1);
    // the long grass's south edge (mostly dark outline) takes the long grass's green, as its body does
    expect(bladeColor(info.both, LONG_EDGE)).toEqual(bladeColor(info.both, LONG_MT));
  });

  it('keeps ash grass grey-beige', () => {
    const c = bladeColor(tiles().both, ASH_MT);
    expect(c[0]).toBeGreaterThanOrEqual(c[1]);
    expect(c[1]).toBeGreaterThan(c[2]);
  });

  it('gives the ground under tall grass the blades\' colour (one dense mass, no bare gaps)', () => {
    const a = map(['.g']);
    const cache = new Map();
    expect(cellLook(a, TALL, cache).tint).toEqual(bladeColor(a.info.both, TALL));
    expect(cellLook(a, GRASS, cache).tint).toEqual(bgr555ToSrgb(MINT));
  });
});

describe('grass extract', () => {
  it('plants tall, long and ash grass, flags long grass and claims the drawn tips', () => {
    const a = map(['.g.', 'LEA', '#..']);
    const claims = new Claims(a.N);
    const cells = grassFamily.extract(ctxOf(a), claims);
    const at = (x: number, y: number) => cells.find((c) => c.x === x && c.y === y);
    expect(cells).toHaveLength(4);
    expect(at(1, 0)?.long).toBe(false);
    expect(at(0, 1)?.long).toBe(true);
    expect(at(1, 1)?.long).toBe(true);
    expect(at(2, 1)?.long).toBe(false);
    expect(at(2, 1)!.tint[0]).toBeGreaterThanOrEqual(at(2, 1)!.tint[1]); // ash
    for (const c of cells) expect(claims.has(a.idx(c.x, c.y), CLAIM_TOP)).toBe(true);
    expect(claims.has(a.idx(0, 0), CLAIM_TOP)).toBe(false);
  });

  it('leaves cells an earlier family took as an object', () => {
    const a = map(['gg']);
    const claims = new Claims(a.N);
    claims.claim(a.idx(0, 0), CLAIM_OBJECT);
    expect(grassFamily.extract(ctxOf(a), claims).map((c) => c.x)).toEqual([1]);
  });

  it('plants nothing indoors, underground or on a Dive map, and claims nothing there', () => {
    for (const opts of [{ indoor: true }, { underground: true }, { underwater: true }]) {
      const a = map(['gL', 'fA'], opts);
      const claims = new Claims(a.N);
      expect(grassFamily.extract(ctxOf(a), claims)).toEqual([]);
      expect(flowerFamily.extract(ctxOf(a), claims)).toEqual([]);
      expect(claims.bits.every((b) => b === 0)).toBe(true);
    }
  });
});

const grass = (x: number, y: number, long = false): GrassCell => ({ x, y, h: 0, long, tint: [0.3, 0.6, 0.4] });
const buildGrass = (cells: GrassCell[], k = kit()) => grassFamily.build(cells, ctxOf(map(['..'])), k);

describe('grass build', () => {
  it('draws one instanced mesh per 16-cell map chunk', () => {
    const ms = meshes(buildGrass([grass(1, 1), grass(2, 3), grass(15, 15), grass(20, 2), grass(-3, 2)]));
    expect(ms.map((m) => m.count).sort()).toEqual([1, 1, 3]);
  });

  it('sways and bends, lit on both faces; receives shadows but casts none', () => {
    const [m] = meshes(buildGrass([grass(1, 1)]));
    const mat = m.material as THREE.MeshStandardMaterial;
    expect(mat.defines).toHaveProperty('KIT_WIND');
    expect(mat.defines).toHaveProperty('KIT_BEND');
    expect(mat.side).toBe(THREE.DoubleSide);
    expect(m.receiveShadow).toBe(true);
    expect(m.castShadow).toBe(false);
    expect(m.instanceColor).not.toBeNull();
  });

  it('stands long grass taller', () => {
    const [m] = meshes(buildGrass([grass(1, 1), grass(2, 1, true)]));
    const s = new THREE.Vector3(), mat = new THREE.Matrix4();
    const heights = [0, 1].map((i) => { m.getMatrixAt(i, mat); mat.decompose(new THREE.Vector3(), new THREE.Quaternion(), s); return s.y; });
    expect(heights[0]).toBeGreaterThan(0.9);
    expect(heights[0]).toBeLessThan(1.1);
    expect(heights[1]).toBeGreaterThan(heights[0] * 1.2);
    expect(heights[1]).toBeLessThan(LONG_SCALE * 1.1);
  });

  it('shares cached clumps across builds; disposing the world keeps them', () => {
    const k = kit();
    const root = buildGrass([grass(1, 1)], k)!;
    const g = meshes(root)[0].geometry;
    expect(g.userData.shared).toBe(true);
    expect(meshes(buildGrass([grass(1, 1)]))[0].geometry).toBe(g);
    let disposed = false;
    g.addEventListener('dispose', () => { disposed = true; });
    disposeKit(root, k);
    expect(disposed).toBe(false);
  });

  it('returns null for no grass', () => {
    expect(buildGrass([])).toBeNull();
  });
});

describe('grass clump', () => {
  it('holds BLADES blades of 5 triangles, rooted evenly over the cell', () => {
    for (const q of ['low', 'medium', 'high'] as const) {
      const g = clump(BLADES[q], 1);
      expect(g.index!.count / 3).toBe(BLADES[q] * 5);
      expect(g.getAttribute('position').count).toBe(BLADES[q] * 7);
    }
    const g = clump(BLADES.medium, 2);
    const p = g.getAttribute('position');
    const quadrants = [0, 0, 0, 0];
    for (let b = 0; b < BLADES.medium; b++) {
      const x = (p.getX(b * 7) + p.getX(b * 7 + 1)) / 2, z = (p.getZ(b * 7) + p.getZ(b * 7 + 1)) / 2;
      expect(Math.abs(x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(z)).toBeLessThanOrEqual(0.5);
      quadrants[(x < 0 ? 0 : 1) + (z < 0 ? 0 : 2)]++;
    }
    for (const n of quadrants) expect(n).toBeGreaterThanOrEqual(4);
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y).toBeLessThanOrEqual(0.7);
    expect(g.boundingBox!.min.y).toBe(0);
  });
});

describe('flower tiles', () => {
  const info = tiles();
  it('knows flowers: several small petal blobs set in foliage', () => {
    expect(isFlowerTile(info.both, FLOWER)).toBe(true);
    expect(petalColors(info.both, FLOWER)).toEqual([bgr555ToSrgb(PEACH), bgr555ToSrgb(RED)]);
  });
  it('is not fooled by roof eaves, framed signs or speckled grass', () => {
    for (const m of [EAVE, SIGN, SPECKLE, GRASS]) expect(isFlowerTile(info.both, m)).toBe(false);
    expect(petalColors(info.both, EAVE)).not.toBeNull(); // the petal count alone would take the eave
  });
});

describe('flower extract', () => {
  afterEach(() => setFlowerIds(() => false));

  it('plants flowers in the tile\'s petal and centre colours, with its leaf green, and claims the art', () => {
    const a = map(['.f.', 'enk', 's.g']);
    const claims = new Claims(a.N);
    const cells = flowerFamily.extract(ctxOf(a), claims);
    expect(cells.map((c) => [c.x, c.y])).toEqual([[1, 0]]);
    const [c] = cells;
    expect(c.petals[0][0]).toBeGreaterThan(c.petals[0][2]); // peach
    expect(c.petals[1][0]).toBeGreaterThan(c.petals[1][1] + 0.3); // red
    expect(c.leaf![1]).toBeGreaterThan(c.leaf![0]);
    expect(c.second).toBeUndefined(); // (one kind of flower: no bed)
    expect(claims.has(a.idx(1, 0), CLAIM_TOP)).toBe(true);
    expect(claims.has(a.idx(1, 0), CLAIM_DECOR)).toBe(true);
    expect(claims.has(a.idx(0, 1), CLAIM_TOP)).toBe(false);
  });

  it('takes a curated General flower id whatever its green share', () => {
    setFlowerIds((m) => m === KNOWN);
    const a = map(['.k']);
    expect(flowerFamily.extract(ctxOf(a), new Claims(a.N)).map((c) => c.x)).toEqual([1]);
  });

  it("plants a town tileset's curated flower beds (too big for the blob test), on stairs too", () => {
    expect(isFlowerTile(tiles().both, BED)).toBe(false);
    const a = map(['.....', '#B#B.', '.....']);
    expect(a.kind[a.idx(1, 1)]).toBe(K.Stairs);
    const claims = new Claims(a.N);
    const cells = flowerFamily.extract(ctxOf(a), claims);
    expect(cells.map((c) => [c.x, c.y])).toEqual([[1, 1], [3, 1]]);
    for (const c of cells) expect(claims.has(a.idx(c.x, c.y), CLAIM_DECOR)).toBe(true);
    // the same ids in another tileset are something else
    expect(flowerFamily.extract(ctxOf(map(['.....', '#B#B.', '.....'], { secondary: SYM.gTileset_Rustboro })), new Claims(a.N))).toEqual([]);
  });

  it("reads a bed's two flowers: each kind's petals, and a third colour their centre", () => {
    const [c] = flowerFamily.extract(ctxOf(map(['B'])), new Claims(1));
    expect(c.petals[0][0]).toBeGreaterThan(c.petals[0][1] + 0.25); // pink
    expect(Math.min(...c.second!)).toBeGreaterThan(0.85); // white
    expect(c.petals[1][0]).toBeGreaterThan(c.petals[1][1] + 0.25); // its orange centre (not the default yellow)
    expect(c.petals[1][2]).toBeLessThan(0.25);
  });

  it("groups a petal's shades: a bed of yellow and blue flowers (mean colours), with no centre of its own", () => {
    const [c] = flowerFamily.extract(ctxOf(map(['Y'])), new Claims(1));
    const y = bgr555ToSrgb(DARK_Y);
    expect(c.petals[0][0]).toBeGreaterThan(y[0] + 0.05); // lighter than the dark shade alone
    expect(c.petals[0][2]).toBeLessThan(c.petals[0][1] - 0.3); // yellow
    expect(c.second![2]).toBeGreaterThan(c.second![0] + 0.25); // blue
    expect(c.petals[1]).toEqual([0.98, 0.85, 0.3]); // (the default centre: yellow)
  });

  it('reads a bed under a stone ledge from the ground layer, and leaves the ledge (top layer) to the legacy art', () => {
    const a = map(['BS']);
    const claims = new Claims(a.N);
    const [bed, under] = flowerFamily.extract(ctxOf(a), claims);
    expect(under.x).toBe(1);
    expect(under.petals).toEqual(bed.petals);
    expect(under.second).toEqual(bed.second);
    expect(claims.has(a.idx(1, 0), CLAIM_TOP)).toBe(false);
    expect(claims.has(a.idx(1, 0), CLAIM_DECOR)).toBe(true);
  });

  it('plants nothing on a bush over sand: its "petals" are the ground showing between its leaves', () => {
    expect(isFlowerTile(tiles().both, BUSH)).toBe(true); // (the blob test alone takes it)
    const a = map(['.b.']);
    expect(flowerFamily.extract(ctxOf(a), new Claims(a.N))).toEqual([]);
  });

  it('leaves grass cells to the grass and object cells to their family', () => {
    const a = map(['ffF']);
    const claims = new Claims(a.N);
    claims.claim(a.idx(0, 0), CLAIM_OBJECT);
    expect(flowerFamily.extract(ctxOf(a), claims).map((c) => c.x)).toEqual([1]);
    expect(grassFamily.extract(ctxOf(a), claims).map((c) => c.x)).toEqual([2]);
  });
});

const flower = (x: number, y: number, centre: [number, number, number] = [0.8, 0.25, 0.3]): FlowerCell =>
  ({ x, y, h: 0, petals: [[1, 0.77, 0.58], centre], leaf: [0.25, 0.55, 0.22] });
const buildFlowers = (cells: FlowerCell[], k = kit()) => flowerFamily.build(cells, ctxOf(map(['..'])), k);

describe('flower build', () => {
  it('draws three flowers per cell, one mesh per chunk and colour pair', () => {
    const ms = meshes(buildFlowers([flower(1, 1), flower(2, 1), flower(30, 1), flower(3, 3, [1, 1, 1])]));
    expect(ms.map((m) => m.count).sort()).toEqual([3, 3, 6]);
    expect(new Set(ms.map((m) => m.material)).size).toBe(2);
  });

  it('flags petals, centre and leaves in the vertex alpha of one shared geometry', () => {
    const k = kit();
    const root = buildFlowers([flower(1, 1)], k)!;
    const [m] = meshes(root);
    const col = m.geometry.getAttribute('color');
    expect(col.itemSize).toBe(4);
    const alphas = new Set<number>();
    for (let i = 0; i < col.count; i++) alphas.add(col.getW(i) >= 0.99 ? 1 : col.getW(i) > 0.5 ? 0.6 : 0);
    expect([...alphas].sort()).toEqual([0, 0.6, 1]);
    expect(m.geometry.userData.shared).toBe(true);
    const mat = m.material as THREE.MeshStandardMaterial;
    expect(mat.defines).toHaveProperty('KIT_BEND');
    expect(m.receiveShadow).toBe(true);
    expect(m.castShadow).toBe(false);
    let disposed = false;
    m.geometry.addEventListener('dispose', () => { disposed = true; });
    disposeKit(root, k);
    expect(disposed).toBe(false);
  });

  it("draws a bed's two kinds of flowers in turn, four per cell", () => {
    const [m] = meshes(buildFlowers([{ ...flower(1, 1), second: [1, 1, 1] }]));
    expect(m.count).toBe(4);
    const c = new THREE.Color();
    for (let k = 0; k < 4; k++) {
      m.getColorAt(k, c);
      if (k % 2) expect(c.g / c.r).toBeCloseTo(1, 2); // white
      else expect(c.g / c.r).toBeLessThan(0.7); // the petal colour (peach)
    }
  });

  it('returns null for no flowers', () => {
    expect(buildFlowers([])).toBeNull();
  });
});
