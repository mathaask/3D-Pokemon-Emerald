import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { cliffFamily, isRocky, setRockIds, setSeaRockIds, setShoalTopIds, type CliffPlacement, type CliffRun } from '../src/render/kit/cliffs';
import { luma } from '../src/render/kit/palette';
import { SYM } from '../src/game/symbols';
import { Claims, CLAIM_OBJECT, CLAIM_SURFACE } from '../src/render/overworld/claims';
import { NO_EVENTS, type GridEvents } from '../src/render/kit/events';
import { createKitUniforms } from '../src/render/kit/materials';
import { analyze, K, type MapAnalysis } from '../src/render/overworld/analyze';
import { fakeInfo } from './helpers/fakeMap';
import { MB } from '../src/game/behaviors';
import { emitLegacy } from '../src/render/overworld/legacyQuads';
import { LayerType } from '../src/game/rom/tileset';

// A plateau (rows 0-1) above a two-row rock face (rows 2-3) above lowland (rows 4-5).
function plateau() {
  const info = fakeInfo();
  // metatile 2 (face) = brown rock pixels
  info.both.fill((10 << 10) | (14 << 5) | 22, 2 * 256, 3 * 256);
  const rows = ['....', '....', '####', '####', '....', '....'];
  const w = 4, h = rows.length;
  const cells = new Uint16Array(w * h);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { cells[y * w + x] = ch === '#' ? 2 | 0x0400 : 1 | 0x3000; }));
  return analyze({ width: w, height: h, cells, border: [1, 1, 1, 1], borderW: 2, borderH: 2, borderPhase: 0 },
    { info, generalPrimary: false, indoor: false, underground: false, underwater: false, margin: 0 });
}

describe('cliff extract', () => {
  it('turns a rock face between two levels into cliff runs', () => {
    const a = plateau();
    const claims = new Claims(a.N);
    const p = cliffFamily.extract({ a, events: NO_EVENTS, quality: 'medium' }, claims);
    expect(p.runs).toHaveLength(4);
    expect(p.runs[0].topH).toBeGreaterThan(p.runs[0].hB);
    for (let x = 0; x < 4; x++) {
      expect(claims.has(a.idx(x, 2), CLAIM_OBJECT)).toBe(true);
      expect(claims.has(a.idx(x, 3), CLAIM_SURFACE)).toBe(true);
    }
  });
});

/** BGR555 pixel of an sRGB colour given in 31sts. */
const px = (r: number, g: number, b: number) => r | (g << 5) | (b << 10);
const ROCK = px(22, 14, 10), ROCK2 = px(16, 10, 8), ASH = px(21, 21, 17), LEAF = px(10, 22, 8), NAVY = px(8, 9, 13), WATER = px(10, 13, 26);

/**
 * Synthetic outdoor map. Cells: '.' lowland (metatile 1, elevation 1), 'P' plateau (metatile 1,
 * elevation 3), '#' rock (metatile 2), 'r' darker rock (metatile 3), 'C' tree crown (4), 'k'
 * trunk on ash (5), 's' sign post (6), 'v' ledge jumping south (7), 'T' a tree (8), 'm' the
 * lowland's own tile blocked (metatile 1: a mountain's top in the colour of its ground), 'w'
 * water. `paint` colours the tiles.
 */
function map(rows: string[], paint: (info: ReturnType<typeof fakeInfo>) => void = () => {},
  opts: { indoor?: boolean; underwater?: boolean; general?: boolean; secondary?: number; ids?: Record<string, number> } = {}): MapAnalysis {
  const info = fakeInfo();
  const fill = (m: number, c: number, n = 256) => { info.both.fill(c, m * 256, m * 256 + n); info.bottom.fill(c, m * 256, m * 256 + n); };
  fill(2, ROCK);
  fill(3, ROCK2);
  fill(4, LEAF); info.green[4] = 0.4; // foliage, but below the analysis' tree threshold (Route 113's ash trees)
  fill(5, ASH); fill(5, ROCK, 40); // a trunk: mostly the ash ground around it
  fill(6, ROCK);
  info.attributes[7] = MB.JUMP_SOUTH;
  fill(8, LEAF); info.green[8] = 0.7;
  fill(10, WATER); info.attributes[10] = MB.DEEP_WATER; info.blue[10] = 1;
  paint(info);
  const code: Record<string, number> = {
    '.': 1 | 0x1000, P: 1 | 0x3000, '#': 2 | 0x0400, r: 3 | 0x0400, C: 4 | 0x0400, k: 5 | 0x0400, s: 6 | 0x0400, v: 7 | 0x1000, T: 8 | 0x0400,
    m: 1 | 0x0400, w: 10 | 0x1000, f: 12 | 0x1000,
  };
  for (const [ch, m] of Object.entries(opts.ids ?? {})) code[ch] = m | 0x0400;
  const w = rows[0].length, h = rows.length;
  const cells = new Uint16Array(w * h);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { cells[y * w + x] = code[ch]; }));
  return analyze({ width: w, height: h, cells, border: [1, 1, 1, 1], borderW: 2, borderH: 2, borderPhase: 0 },
    { info, generalPrimary: opts.general ?? false, indoor: opts.indoor ?? false, underground: false, underwater: opts.underwater ?? false, margin: 0,
      secondaryTileset: opts.secondary });
}

/** A mountain map's colours (Mt Chimney): its ground and the tops of its rock masses are one pink
 *  tile (metatile 1), the faces dark red rock (metatiles 2, 3). */
const PINK = px(26, 19, 17), FACE = px(16, 6, 4);
const mountain = (info: ReturnType<typeof fakeInfo>) => {
  for (const [m, c] of [[1, PINK], [2, FACE], [3, FACE]]) { info.both.fill(c, m * 256, (m + 1) * 256); info.bottom.fill(c, m * 256, (m + 1) * 256); }
};

const extract = (a: MapAnalysis, events: GridEvents = NO_EVENTS) => {
  const claims = new Claims(a.N);
  return { claims, p: cliffFamily.extract({ a, events, quality: 'medium' }, claims) };
};

describe('isRocky', () => {
  const tile = (c: number, green = 0) => {
    const a = map(['..']);
    a.info.both.fill(c, 9 * 256, 10 * 256);
    a.info.green[9] = green;
    return isRocky(a, 9);
  };
  it('takes brown rock and the dark muted shadow side of a rock', () => {
    expect(tile(ROCK)).toBe(true);
    expect(tile(px(12, 8, 10))).toBe(true); // Route 113's mauve rock shade
  });
  it('rejects lava: far more saturated than any rock (Mt Chimney\'s crater)', () => {
    expect(tile(px(25, 6, 0))).toBe(false); // (0.81, 0.19, 0): Mt Chimney's lava
    expect(tile(px(16, 6, 4))).toBe(true); // (0.52, 0.19, 0.13): the dark red rock beside it
    expect(tile(px(18, 10, 3))).toBe(true); // (0.58, 0.32, 0.1): Fallarbor's brown rock
  });
  it('rejects a navy window, foliage and grass', () => {
    expect(tile(NAVY)).toBe(false);
    expect(tile(ROCK, 0.25)).toBe(false); // an ash-covered tree crown
    expect(tile(px(14, 24, 20))).toBe(false);
  });
});

describe('cliff rules', () => {
  it('breaks a face at a secret-base hole: the hole and the rock above it keep their legacy art', () => {
    // a two-row face between the plateau and the lowland, with a cave hole ('r') in its foot row
    const rows = ['PPPPP', 'PPPPP', '#####', '##r##', '.....', '.....'];
    const hole = (info: ReturnType<typeof fakeInfo>) => { info.attributes[3] = MB.SECRET_BASE_SPOT_RED_CAVE; };
    const a = map(rows, hole);
    const { p, claims } = extract(a);
    expect(claims.bits[a.idx(2, 3)]).toBe(0);
    expect(claims.bits[a.idx(2, 2)]).toBe(0); // (no foot: its column is the legacy art's)
    expect(p.runs.map((r) => r.x + 0)).toEqual([0, 1, 3, 4]);
    const drawn = emitLegacy(a, claims).quads.filter((q) => q.metatile === 3);
    expect(drawn.length).toBeGreaterThan(0);
    // the same tile without the spot's behaviour is rock like the rest
    expect(extract(map(rows)).p.runs.map((r) => r.x + 0)).toEqual([0, 1, 2, 3, 4]);
  });

  it('leaves a block mass standing on a door to the legacy art (an undetected building)', () => {
    const rows = ['......', '.####.', '.####.', '.####.', '......', '......'];
    expect(extract(map(rows)).p.runs.length).toBe(4); // as a rock mass without the door
    const door: GridEvents = { warps: [{ x: 2, y: 4, dest: 'Somewhere' }], signs: [] };
    const { p, claims } = extract(map(rows), door);
    expect(p.runs).toEqual([]);
    expect(claims.bits.every((b) => b === 0)).toBe(true);
  });

  it('does not take a tree line whose trunk row is the colour of the ground', () => {
    const ash = (info: ReturnType<typeof fakeInfo>) => { info.both.fill(ASH, 256, 512); info.bottom.fill(ASH, 256, 512); };
    const { p } = extract(map(['PPPP', 'PPPP', 'CCCC', 'kkkk', '....', '....'], ash));
    expect(p.runs).toEqual([]);
    // the same rows in rock are a cliff
    expect(extract(map(['PPPP', 'PPPP', '####', '####', '....', '....'], ash)).p.runs.length).toBe(4);
  });

  it('makes a rock mass two columns wide a block with a rock top, but not a 1-wide strip', () => {
    const a = map(['.......', '.##..#.', '.##..#.', '.##..#.', '.......']);
    const { p, claims } = extract(a);
    expect(p.runs.map((r) => r.x + 0)).toEqual([1, 2]); // (+ 0: the analysis' minX is -0)
    expect(claims.has(a.idx(1, 1), CLAIM_SURFACE)).toBe(false); // top row: ground at the top
    expect(claims.groundY[a.idx(1, 1)]).toBe(p.runs[0].topH);
    expect(claims.groundMt[a.idx(1, 1)]).toBe(2); // rock on top
    expect(claims.has(a.idx(1, 3), CLAIM_SURFACE)).toBe(true);
    for (let y = 1; y <= 3; y++) expect(claims.bits[a.idx(5, y)]).toBe(0);
  });

  it('leaves a long 1-wide strip (a wall edge) to the legacy art, and the short mass at its foot with it', () => {
    // column 1 is rock for six rows with rock beside it for only two: not a mass
    const { p, claims } = extract(map(['.......', '.#.....', '.#.....', '.#.....', '.#.....', '.##....', '.##....', '.......']));
    expect(p.runs).toEqual([]);
    expect(claims.bits.every((b) => b === 0)).toBe(true);
  });

  it('keeps only walls standing on a line: a lone face column stays legacy', () => {
    expect(extract(map(['PPPP', 'PPPP', 'P#PP', 'P#PP', '....', '....'])).p.runs).toEqual([]);
    expect(extract(map(['PPPP', 'PPPP', 'P##P', 'P##P', '....', '....'])).p.runs.length).toBe(2);
  });

  it('takes the level beside a face column whose top meets a tree (a terrace corner)', () => {
    const { p } = extract(map(['PPPP', 'PTPP', 'P##P', 'P##P', '....', '....']));
    expect(p.runs.map((r) => [r.x, r.topH])).toEqual([[1, 2], [2, 2]]);
  });

  it('gives one connected cliff one rock colour', () => {
    const { p } = extract(map(['PPPP', 'PPPP', '##rr', '##rr', '....', '....']));
    expect(p.runs).toHaveLength(4);
    for (const r of p.runs) expect(r.tint).toEqual(p.runs[0].tint);
  });

  it('closes higher ground beside a lower face with a rock side panel', () => {
    const { p } = extract(map(['PPPPPP', 'PPPPPP', '##PPPP', '##PPPP', '......', '......']));
    expect(p.runs.map((r) => [r.x + 0, r.hB, r.topH])).toEqual([[0, 0, 2], [1, 0, 2]]);
    const sides = p.sides.filter((s) => s.px === 2);
    expect(sides.map((s) => [s.dir, s.zt, s.zb, s.y0, s.y1])).toEqual([[-1, 4, 5, 0, 2], [-1, 5, 6, 0, 2]]);
  });

  it('treats a sign post at the foot of a face as the ground in front of it', () => {
    const a = map(['PPPP', 'PPPP', '####', '####', '.s..', '....']);
    const { claims } = extract(a, { warps: [], signs: [{ x: 1, y: 4 }] });
    expect(claims.bits[a.idx(1, 4)]).toBe(0);
    expect(claims.has(a.idx(1, 2), CLAIM_SURFACE)).toBe(true);
    expect(claims.has(a.idx(1, 3), CLAIM_SURFACE)).toBe(true);
  });

  it('puts a ledge lip on each jump cell, facing its jump', () => {
    const { p } = extract(map(['....', 'vvvv', '....']));
    expect(p.ledges.map((l) => [l.x, l.y, l.dir])).toEqual([[0, 1, 'S'], [1, 1, 'S'], [2, 1, 'S'], [3, 1, 'S']]);
  });

  it('does nothing indoors', () => {
    const { p, claims } = extract(map(['PPPP', 'PPPP', '####', '####', '....'], () => {}, { indoor: true }));
    expect(p).toEqual({ runs: [], sides: [], ledges: [] });
    expect(claims.bits.every((b) => b === 0)).toBe(true);
  });

  it('does nothing on a Dive map (its rock is the seabed)', () => {
    const rows = ['PPPP', 'PPPP', '####', '####', '....', '....'];
    expect(extract(map(rows)).p.runs.length).toBe(4);
    const { p, claims } = extract(map(rows, () => {}, { underwater: true }));
    expect(p).toEqual({ runs: [], sides: [], ledges: [] });
    expect(claims.bits.every((b) => b === 0)).toBe(true);
  });

  it('takes curated rock ids even in the colour of the ground', () => {
    // the face tiles share the ash ground's colour: not rock by colour, rock by the General table
    const ash = (info: ReturnType<typeof fakeInfo>) => {
      for (const m of [1, 2]) { info.both.fill(ASH, m * 256, (m + 1) * 256); info.bottom.fill(ASH, m * 256, (m + 1) * 256); }
    };
    const rows = ['PPPP', 'PPPP', '####', '####', '....', '....'];
    expect(extract(map(rows, ash, { general: true })).p.runs).toEqual([]);
    setRockIds((m) => m === 2);
    try {
      expect(extract(map(rows, ash, { general: true })).p.runs.length).toBe(4);
    } finally {
      setRockIds(() => false);
    }
  });
});

describe('mountains: rock masses topped in the colour of their ground', () => {
  const runs = (p: CliffPlacement) => p.runs.map((r) => [r.x + 0, r.hB, r.topH, r.zf]);

  it('makes a mass whose top is the ground\'s own tile a cliff, its top in the ground\'s look', () => {
    // Mt Chimney: the pink rock top (metatile 1, blocked) is also the walkable ground around it
    const a = map(['......', '.mmmm.', '.mmmm.', '.####.', '......'], mountain);
    const { p, claims } = extract(a);
    expect(runs(p)).toEqual([1, 2, 3, 4].map((x) => [x, 0, 1, 4]));
    for (let x = 1; x <= 4; x++) {
      for (const y of [1, 2]) {
        expect(claims.bits[a.idx(x, y)]).toBe(CLAIM_OBJECT); // top rows: the terrain draws their ground
        expect(claims.groundY[a.idx(x, y)]).toBe(1);
        expect(claims.groundMt[a.idx(x, y)]).toBe(1); // the ground's tile, not the dark face
      }
      expect(claims.bits[a.idx(x, 3)]).toBe(CLAIM_OBJECT | CLAIM_SURFACE);
    }
  });

  it('stacks a terraced mass: each band of face rows raises the tops above it', () => {
    // (the upper face in another shade of the rock: one terraced mountain, one rock colour)
    const shade = (info: ReturnType<typeof fakeInfo>) => { mountain(info); info.both.fill(px(20, 9, 6), 3 * 256, 4 * 256); };
    const a = map(['......', '.mmmm.', '.rrrr.', '.mmmm.', '.####.', '......'], shade);
    const { p, claims } = extract(a);
    expect(runs(p)).toEqual([1, 2, 3, 4].flatMap((x) => [[x, 0, 1, 5], [x, 1, 2, 4]]));
    for (const r of p.runs) expect(r.tint).toEqual(p.runs[0].tint);
    for (let x = 1; x <= 4; x++) {
      expect(claims.groundY[a.idx(x, 1)]).toBe(2);
      expect(claims.groundY[a.idx(x, 3)]).toBe(1);
      for (const y of [2, 4]) expect(claims.has(a.idx(x, y), CLAIM_SURFACE)).toBe(true);
    }
  });

  it('makes a vertical strip of rock (a terrace\'s east edge) part of its top, not a step', () => {
    // column 4's 'r' rows have no face beside them: a strip, as the edges of Route 112's terraces
    const a = map(['......', '.mmmr.', '.mmmr.', '.####.', '......'], mountain);
    const { p, claims } = extract(a);
    expect(runs(p)).toEqual([1, 2, 3, 4].map((x) => [x, 0, 1, 4]));
    for (const y of [1, 2]) expect(claims.groundY[a.idx(4, y)]).toBe(1);
  });

  it('counts a top in the ground\'s colour as rock in a face between two levels when it stands on rock', () => {
    // a three-row face down from the plateau, its upper rows the pink top
    const a = map(['PPPPPP', 'PmmmmP', 'PmmmmP', 'P####P', '......'], mountain);
    expect(extract(a).p.runs.map((r) => [r.x + 0, r.hB, r.topH])).toEqual([1, 2, 3, 4].map((x) => [x, 0, 3]));
  });

  it('drops a terrace column whose lower band stands apart, and every band above it', () => {
    // column 3's lowest face ends a row higher than its neighbours' (no wall to share); its upper
    // band would match theirs, but must not float over the legacy art below it
    const a = map(['.......', '.mmmmm.', '.#####.', '.mmmmm.', '.mm#mm.', '.##.##.', '.......'], mountain);
    const { p, claims } = extract(a);
    expect([...new Set(p.runs.map((r) => r.x + 0))]).toEqual([1, 2, 4, 5]);
    for (let y = 1; y <= 4; y++) expect(claims.bits[a.idx(3, y)], `3,${y}`).toBe(0);
  });

  it('takes no 1-wide strip for a terrace, nor the short mass at its foot', () => {
    // column 1 is a tall strip with mass beside it only at its foot (column 2's short terrace)
    const { p, claims } = extract(map(['....', '.m..', '.m..', '.m..', '.mm.', '.##.', '....'], mountain));
    expect(p.runs).toEqual([]);
    expect(claims.bits.every((b) => b === 0)).toBe(true);
  });

  it('flattens a terrace band with no wall to share onto the band below it', () => {
    // column 3's lower face is two rows tall: its upper band starts a level higher than its
    // neighbours' and stands alone; its rows become the top of its lower band
    const a = map(['.......', '.mmmmm.', '.#####.', '.mmmmm.', '.mm#mm.', '.#####.', '.......'], mountain);
    const { p, claims } = extract(a);
    expect(runs(p).filter((r) => r[0] === 3)).toEqual([[3, 0, 2, 6]]);
    for (const x of [1, 2, 4, 5]) expect(runs(p).filter((r) => r[0] === x)).toEqual([[x, 0, 1, 6], [x, 1, 2, 4]]);
    for (const y of [1, 2, 3]) {
      expect(claims.bits[a.idx(3, y)]).toBe(CLAIM_OBJECT);
      expect(claims.groundY[a.idx(3, y)]).toBe(2);
    }
  });

  it('builds no tower: a face of more than three rows is no terrace step, but the flat top of the one below', () => {
    // column 1-2's upper face is five rows tall (Route 112's zigzag of ridge edges in one column)
    const a = map(['....', '.mm.', '.##.', '.##.', '.##.', '.##.', '.##.', '.mm.', '.##.', '....'], mountain);
    const { p, claims } = extract(a);
    expect(runs(p)).toEqual([[1, 0, 1, 9], [2, 0, 1, 9]]);
    for (let y = 1; y <= 7; y++) {
      expect(claims.bits[a.idx(1, y)], `1,${y}`).toBe(CLAIM_OBJECT);
      expect(claims.groundY[a.idx(1, y)]).toBe(1);
      expect(claims.groundMt[a.idx(1, y)]).toBe(1); // (the terrace's ground look)
    }
    // the same at the foot: no terrace at all (the old flat mass rule decides)
    const b = map(['....', '.mm.', '.##.', '.##.', '.##.', '.##.', '....'], mountain);
    expect(Math.max(...extract(b).p.runs.map((r) => r.topH - r.hB))).toBeLessThanOrEqual(3);
  });

  it('makes a face the run ends on (no top of its own) part of the top of the band below', () => {
    const a = map(['......', '.####.', '.mmmm.', '.####.', '......'], mountain);
    const { p, claims } = extract(a);
    expect(runs(p)).toEqual([1, 2, 3, 4].map((x) => [x, 0, 1, 4]));
    for (const y of [1, 2]) expect(claims.bits[a.idx(2, y)]).toBe(CLAIM_OBJECT);
    expect(claims.groundY[a.idx(2, 1)]).toBe(1);
  });

  it('makes a mass top running off the map (nothing in front of it) ground, where legacy lays it flat', () => {
    // rows 1-2 run to the map's edge: no foot, no face; legacy draws them flat at the level behind
    // (n: a rim in the ground's colour, not itself a floor tile: it takes the floor's look)
    const rim = (info: ReturnType<typeof fakeInfo>) => { mountain(info); info.both.fill(PINK, 11 * 256, 12 * 256); info.bottom.fill(PINK, 11 * 256, 12 * 256); };
    const a = map(['......', 'PPPPPP', '.mmmm.', '.m##m.', '.nmmn.'], rim, { ids: { n: 11 } });
    const { p, claims } = extract(a);
    expect(p.runs).toEqual([]);
    for (const x of [1, 4]) {
      for (const y of [2, 3, 4]) {
        expect(claims.bits[a.idx(x, y)], `${x},${y}`).toBe(CLAIM_OBJECT);
        expect(claims.groundY[a.idx(x, y)]).toBe(a.height[a.idx(x, 1)]); // the level behind
        expect(claims.groundMt[a.idx(x, y)]).toBe(1); // the ground's look
      }
    }
    // a run holding a rock face is not ground (columns 2 and 3 keep their art)
    for (const y of [2, 3, 4]) for (const x of [2, 3]) expect(claims.bits[a.idx(x, y)]).toBe(0);
    // nor is a run standing on anything: here it ends above water, so it is a mass on the water,
    // and (no face at its foot) not a cliff either
    // (the level behind, not the nearest ground: here the sea beside it)
    const c = map(['......', 'PPPPPP', 'wmmmmw', 'wmmmmw'], mountain);
    expect(extract(c).claims.groundY[c.idx(2, 3)]).toBe(Math.max(0, c.height[c.idx(2, 1)]));
    expect(c.groundH[c.idx(2, 3)]).toBeLessThan(0);
    const b = map(['......', '.mmmm.', '.mmmm.', 'wwwwww'], mountain);
    expect(extract(b).claims.bits.every((v) => v === 0)).toBe(true);
    // a backdrop in water colours is no mountain top, even where it is also walked on (Sky Pillar's clouds)
    const sky = (info: ReturnType<typeof fakeInfo>) => { mountain(info); info.both.fill(px(14, 23, 30), 256, 512); info.bottom.fill(px(14, 23, 30), 256, 512); };
    expect(extract(map(['......', 'PPPPPP', '.mmmm.', '.mmmm.'], sky)).claims.bits.every((v) => v === 0)).toBe(true);
  });

  it('takes no rock art standing over other ground for a top (its ground layer shows another colour)', () => {
    // 'm' looks like the pink top all over, but its ground layer is another colour (Route 134's rock
    // ridges on a shoal: the rock is art over the shoal, and the terrain would draw shoal on top)
    // (its rock in the top layer, drawn over sprites: art standing up)
    const shoal = (info: ReturnType<typeof fakeInfo>) => { mountain(info); info.bottom.fill(px(19, 20, 23), 256, 512); info.topCover[1] = 200; };
    const a = map(['......', '.mmmm.', '.####.', '......'], shoal);
    expect(extract(a).p.runs).toEqual([]);
  });

  it('knows a tileset\'s listed rock tops even where the ground is another colour (Lavaridge Town)', () => {
    // the town's ground is grass; its border is Lavaridge's pink rock top, running off the map
    const grassy = (info: ReturnType<typeof fakeInfo>) => {
      mountain(info);
      info.both.fill(px(14, 24, 20), 256, 512); info.bottom.fill(px(14, 24, 20), 256, 512);
      info.both.fill(PINK, 0x271 * 256, 0x272 * 256); info.bottom.fill(PINK, 0x271 * 256, 0x272 * 256);
    };
    const rows = ['......', 'TTTTTT', 'RRRRRR', 'RRRRRR'];
    const at = (secondary: number) => map(rows, grassy, { secondary, ids: { R: 0x271 } });
    const a = at(SYM.gTileset_Lavaridge);
    const { claims } = extract(a);
    for (let x = 0; x < 6; x++) for (const y of [2, 3]) {
      expect(claims.bits[a.idx(x, y)], `${x},${y}`).toBe(CLAIM_OBJECT);
      expect(claims.groundMt[a.idx(x, y)]).toBe(0x271);
    }
    expect(extract(at(SYM.gTileset_Rustboro)).claims.bits.every((v) => v === 0)).toBe(true);
  });

  it('still takes no ground-coloured rows over something that is not a rock face (a trunk, a boulder)', () => {
    // the foot row is in the ground's colour too: trunks of a tree line, boulders on the ground
    const trunk = (info: ReturnType<typeof fakeInfo>) => { mountain(info); info.both.fill(PINK, 5 * 256, 6 * 256); info.both.fill(ROCK, 5 * 256, 5 * 256 + 40); };
    expect(extract(map(['......', '.mmmm.', '.mmmm.', '.kkkk.', '......'], trunk)).p.runs).toEqual([]);
    // a face in the middle of the run is not its foot: the rows below it are not a mass standing there
    expect(extract(map(['......', '.mmmm.', '.####.', '.mmmm.', '......'], mountain)).p.runs).toEqual([]);
  });
});

describe('sea rocks', () => {
  const SEA = 0x17a;
  const paint = (info: ReturnType<typeof fakeInfo>) => { mountain(info); info.both.fill(ROCK, SEA * 256, (SEA + 1) * 256); info.bottom.fill(ROCK, SEA * 256, (SEA + 1) * 256); };
  const sea = (rows: string[], general = true) => map(rows, paint, { general, ids: { S: SEA } });
  const withSeaRocks = (f: () => void) => {
    setSeaRockIds((m) => m === SEA);
    try { f(); } finally { setSeaRockIds(() => false); }
  };

  it('never makes a cliff of a General sea rock: it keeps its legacy art', () => {
    const rows = ['wwww', 'wSSw', 'wSSw', 'wwww'];
    expect(extract(sea(rows)).p.runs.length).toBe(2); // (as land rock: a 2-wide box standing in the sea)
    withSeaRocks(() => {
      const a = sea(rows);
      const { p, claims } = extract(a);
      expect(p.runs).toEqual([]);
      expect(claims.bits.every((b) => b === 0)).toBe(true);
      expect(isRocky(a, SEA)).toBe(false);
      // (General ids only: the same id in a secondary tileset is something else)
      expect(extract(sea(rows, false)).p.runs.length).toBe(2);
    });
  });

  it('stands a land rock face on a sea rock at the waterline on the water behind it (a coastline)', () => {
    withSeaRocks(() => {
      const a = sea(['wwww', 'w##w', 'w##w', 'wSSw', 'wwww']);
      const { p, claims } = extract(a);
      expect(p.runs.map((r) => [r.x + 0, r.zf, r.hB, r.topH])).toEqual([[1, 3, -0.3, 1], [2, 3, -0.3, 1]].map(([x, zf, hB, t]) => [x, zf, Math.fround(hB), t]));
      for (const x of [1, 2]) {
        expect(claims.bits[a.idx(x, 3)]).toBe(0); // (the sea rock: its legacy card, in front of the face)
        expect(claims.has(a.idx(x, 2), CLAIM_SURFACE)).toBe(true);
      }
    });
  });

  it('lines a coast standing on sea rocks up with its neighbours at the waterline', () => {
    // column 1's land face reaches the water itself; columns 2-3 stand on a sea rock at the waterline
    withSeaRocks(() => {
      const a = sea(['wwwww', 'w###w', 'w###w', 'w#SSw', 'wwwww']);
      expect(extract(a).p.runs.map((r) => r.x + 0)).toEqual([1, 2, 3]);
    });
  });

  // Shoal rocks: T a shoal rock's top (a sea rock), B its lower rows (rock that is also a coastal
  // cliff's corner, Mossdeep's: not a sea rock itself)
  const TOP = 0x15e, LOW = 0x16e;
  const shoal = (rows: string[]) => map(rows, (info) => {
    paint(info);
    for (const m of [TOP, LOW]) { info.both.fill(ROCK, m * 256, (m + 1) * 256); info.bottom.fill(ROCK, m * 256, (m + 1) * 256); }
  }, { general: true, ids: { S: SEA, T: TOP, B: LOW } });
  const withShoals = (f: () => void) => {
    setSeaRockIds((m) => m === SEA || m === TOP);
    setShoalTopIds((m) => m === TOP);
    try { f(); } finally { setSeaRockIds(() => false); setShoalTopIds(() => false); }
  };

  it('never boxes a shoal rock: the rows under its top are its own (a 2x3 boulder in the sea)', () => {
    const rows = ['wwww', 'wTTw', 'wBBw', 'wBBw', 'wwww'];
    withShoals(() => {
      expect(extract(shoal(rows)).claims.bits.every((b) => b === 0)).toBe(true);
      // a shoal formation stacked on another boulder: no box, and no coast on the lower top
      expect(extract(shoal(['wwww', 'wTTw', 'wBBw', 'wBBw', 'wTTw', 'wBBw', 'wwww'])).claims.bits.every((b) => b === 0)).toBe(true);
    });
  });

  it('takes no shoal top for a waterline: rock standing on one stays legacy', () => {
    withShoals(() => expect(extract(shoal(['....', '.##.', '.##.', '.TT.', 'wwww'])).claims.bits.every((b) => b === 0)).toBe(true));
  });

  it('keeps a coastal cliff whose corners are shoal-rock pieces under land rock (Mossdeep)', () => {
    withShoals(() => {
      const a = shoal(['....', '.##.', '.BB.', '.BB.', 'wwww']);
      const { p, claims } = extract(a);
      expect(p.runs.map((r) => r.x + 0)).toEqual([1, 2]);
      expect(claims.has(a.idx(1, 3), CLAIM_SURFACE)).toBe(true);
    });
  });

  it('takes no land top standing on a sea rock for a cliff (an islet: legacy with its sea rock)', () => {
    withSeaRocks(() => {
      const { claims } = extract(sea(['......', '.mmmm.', '.SSSS.', 'wwwwww']));
      expect(claims.bits.every((b) => b === 0)).toBe(true);
    });
  });
});

describe('Sootopolis', () => {
  // the crater's white rock top (also the walkways) and its grey-cream faces: paving colours, rock
  // only by the Sootopolis table
  const WHITE = px(30, 30, 29), CREAM = px(21, 21, 19);
  const paint = (info: ReturnType<typeof fakeInfo>) => {
    for (const [m, c] of [[1, WHITE], [0x2d9, WHITE], [0x2e1, CREAM]]) { info.both.fill(c, m * 256, (m + 1) * 256); info.bottom.fill(c, m * 256, (m + 1) * 256); }
  };
  const crater = (secondary: number) => map(['......', '.WWWW.', '.WWWW.', '.GGGG.', '......'], paint, { secondary, ids: { W: 0x2d9, G: 0x2e1 } });

  it('makes the white crater rock 3D rock walls in its own white-cream colour', () => {
    const a = crater(SYM.gTileset_Sootopolis);
    const { p, claims } = extract(a);
    expect(p.runs.map((r) => r.x + 0)).toEqual([1, 2, 3, 4]);
    for (const r of p.runs) {
      expect(luma(r.tint)).toBeGreaterThan(0.6); // not brown
      expect(Math.abs(r.tint[0] - r.tint[2])).toBeLessThan(0.12);
    }
    expect(claims.groundMt[a.idx(1, 1)]).toBe(1); // the white walkway's look on top
    // keyed by tileset: the same ids in another secondary tileset are paving, not rock
    expect(extract(crater(SYM.gTileset_Rustboro)).p.runs).toEqual([]);
  });

  it('tops a terrace cell by cell: the white top and the pink slope down to the lake each their ground', () => {
    // f: a pink walkway (the lake's rim); E: the crater's white-to-pink slope, in the rim's pink
    const both = (info: ReturnType<typeof fakeInfo>) => {
      paint(info);
      for (const [m, c] of [[12, PINK], [0x2eb, PINK]]) { info.both.fill(c, m * 256, (m + 1) * 256); info.bottom.fill(c, m * 256, (m + 1) * 256); }
    };
    const a = map(['ffffff', '.WWEE.', '.WWEE.', '.GGGG.', '......'], both, { secondary: SYM.gTileset_Sootopolis, ids: { W: 0x2d9, E: 0x2eb, G: 0x2e1 } });
    const { p, claims } = extract(a);
    expect(p.runs.map((r) => r.x + 0)).toEqual([1, 2, 3, 4]);
    for (const y of [1, 2]) {
      expect(claims.groundMt[a.idx(2, y)]).toBe(1); // white
      expect(claims.groundMt[a.idx(3, y)]).toBe(12); // pink
    }
  });

  it('makes a one-row crater wall between two walkways at one level a free-standing wall', () => {
    const wall = (secondary: number) => map(['......', '.GGGG.', '......'], paint, { secondary, ids: { G: 0x2e1 } });
    const a = wall(SYM.gTileset_Sootopolis);
    const { p, claims } = extract(a);
    expect(p.runs.map((r) => [r.x + 0, r.hB, r.topH, r.zf, !!r.wall])).toEqual([1, 2, 3, 4].map((x) => [x, 0, 1, 2, true]));
    for (let x = 1; x <= 4; x++) expect(claims.bits[a.idx(x, 1)]).toBe(CLAIM_OBJECT | CLAIM_SURFACE);
    // (only what a rock table lists: other one-row rock ridges stay legacy, as Mossdeep's)
    expect(extract(map(['......', '.####.', '......'])).p.runs).toEqual([]);
  });

  it('takes listed crater rock that a door\'s flood fill swallowed, outside the building', () => {
    // a house (D: its door, Z: its wall) whose door flood fill runs on into the crater wall beside it
    const paintDoor = (info: ReturnType<typeof fakeInfo>) => {
      paint(info);
      for (const m of [0x20c, 0x209]) { info.both.fill(px(28, 25, 20), m * 256, (m + 1) * 256); info.bottom.fill(px(28, 25, 20), m * 256, (m + 1) * 256); }
      info.attributes[0x20c] = MB.ANIMATED_DOOR;
    };
    // (more crater rock below: common tiles are terrain to the footprints, not the house's art)
    const rows = ['..........', '.ZZZWWWWW.', '.ZDZGGGGG.', '..........', 'WWWWWWWWWW', 'WWWWWWWWWW', 'WWWWWWWWWW', 'GGGGGGGGGG', 'GGGGGGGGGG', 'GGGGGGGGGG', '..........'];
    const a = map(rows, paintDoor, { secondary: SYM.gTileset_Sootopolis, ids: { W: 0x2d9, G: 0x2e1, Z: 0x209, D: 0x20c } });
    expect(a.kind[a.idx(5, 2)]).toBe(K.Building); // (the flood fill took the crater rock)
    const events: GridEvents = { warps: [{ x: 2, y: 2, dest: 'House' }], signs: [] };
    // the buildings family modelled the house (its own cells)
    const claims = new Claims(a.N);
    for (const x of [1, 2, 3]) for (const y of [1, 2]) claims.claim(a.idx(x, y), CLAIM_OBJECT);
    const p = cliffFamily.extract({ a, events, quality: 'medium' }, claims);
    expect(p.runs.filter((r) => r.zf === 3).map((r) => r.x + 0)).toEqual([4, 5, 6, 7, 8]);
    // a building left to the legacy art keeps all of its flood fill (legacy draws it as one)
    expect(extract(a, events).p.runs.filter((r) => r.zf === 3)).toEqual([]);
  });

  it('leaves what the table does not list alone, whatever its colour: a house in the crater', () => {
    // H: a decorative house's wall (no door, no warp) in a rock colour, standing in the crater rock
    const paintHouse = (info: ReturnType<typeof fakeInfo>) => { paint(info); info.both.fill(ROCK, 0x209 * 256, 0x20a * 256); info.bottom.fill(ROCK, 0x209 * 256, 0x20a * 256); };
    const a = map(['......', '.WWWW.', '.HHWW.', '.GGGG.', '......'], paintHouse, { secondary: SYM.gTileset_Sootopolis, ids: { W: 0x2d9, G: 0x2e1, H: 0x209 } });
    const { p, claims } = extract(a);
    expect(p.runs.map((r) => r.x + 0)).toEqual([3, 4]);
    for (const x of [1, 2]) for (let y = 1; y <= 3; y++) expect(claims.bits[a.idx(x, y)], `${x},${y}`).toBe(0);
    expect(isRocky(a, 0x209)).toBe(false);
  });
});

describe('cliff build', () => {
  const kit = () => ({ uniforms: createKitUniforms(), quality: 'medium' as const, disposables: [] as { dispose(): void }[] });
  const build = (p: CliffPlacement) => cliffFamily.build(p, { a: map(['..']), events: NO_EVENTS, quality: 'medium' }, kit()) as THREE.Mesh;
  const run = (x: number, hB: number, topH: number, lip: CliffRun['lip'] = null): CliffRun => ({ x, zf: 6, hB, topH, tint: [0.6, 0.5, 0.4], lip });

  it('turns every triangle the way its normal says (no inward wedge tips, caps or lips)', () => {
    const p: CliffPlacement = {
      runs: [run(3, 0, 2, [0.4, 0.7, 0.4]), run(4, 0, 1), run(8, -0.3, 1), { ...run(20, 0, 1), wall: true }],
      sides: [
        { px: 6, dir: -1, zt: 4, zb: 5, y0: 0, y1: 2, tint: [0.6, 0.5, 0.4] },
        { px: 7, dir: 1, zt: 4, zb: 5, y0: 0, y1: 2, tint: [0.6, 0.5, 0.4] },
      ],
      ledges: (['S', 'N', 'E', 'W'] as const).map((dir, k) => ({ x: 10 + 2 * k, y: 3, h: 0, dir, grass: [0.4, 0.7, 0.4] as [number, number, number] })),
    };
    const g = build(p).geometry;
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
    const v = (k: number) => new THREE.Vector3().fromBufferAttribute(pos, k);
    let checked = 0;
    for (let t = 0; t < pos.count; t += 3) {
      const geo = v(t + 1).sub(v(t)).cross(v(t + 2).sub(v(t)));
      if (geo.length() < 1e-9) continue;
      expect(geo.dot(new THREE.Vector3().fromBufferAttribute(nor, t))).toBeGreaterThan(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('gives side-by-side walls the same vertices along their shared edge, whatever their feet', () => {
    // the same wall line and top; one stands in water (foot at the water level), one on the ground
    const edge = (r: CliffRun) => {
      const g = build({ runs: [r], sides: [], ledges: [] }).geometry;
      const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
      const out = new Map<string, number>();
      for (let k = 0; k < pos.count; k++) {
        if (nor.getZ(k) !== 1 || Math.abs(pos.getX(k) - 4) > 1e-6 || pos.getY(k) < -1e-6) continue;
        out.set(pos.getY(k).toFixed(4), pos.getZ(k));
      }
      return out;
    };
    const west = edge(run(3, -0.3, 2)), east = edge(run(4, 0, 2));
    expect(east.size).toBeGreaterThan(4);
    for (const [y, z] of east) expect(west.get(y)).toBe(z);
  });
  it('builds walls that stand out from their line and meet the plateau at the top edge', () => {
    const p: CliffPlacement = { runs: [{ x: 3, zf: 6, hB: 0, topH: 2, tint: [0.6, 0.5, 0.4], lip: null }], sides: [], ledges: [] };
    const a = map(['..']);
    const mesh = cliffFamily.build(p, { a, events: NO_EVENTS, quality: 'medium' }, kit()) as THREE.Mesh;
    const pos = mesh.geometry.getAttribute('position'), nor = mesh.geometry.getAttribute('normal');
    let face = 0;
    for (let i = 0; i < pos.count; i++) {
      if (nor.getZ(i) !== 1) continue; // the wall itself (side wedges face ±X)
      face++;
      expect(pos.getZ(i)).toBeGreaterThanOrEqual(6);
      if (Math.abs(pos.getY(i) - 2) < 1e-6) expect(pos.getZ(i)).toBeCloseTo(6, 6);
    }
    expect(face).toBeGreaterThan(0);
    expect(mesh.castShadow).toBe(true);
  });
  it('builds a free-standing wall as a capped slab: a top over its thickness, a back, closed ends', () => {
    const g = build({ runs: [{ ...run(3, 0, 1), wall: true }], sides: [], ledges: [] }).geometry;
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
    let top = 0, back = 0, ends = 0;
    for (let k = 0; k < pos.count; k++) {
      if (nor.getY(k) === 1 && Math.abs(pos.getY(k) - 1) < 1e-6 && pos.getZ(k) < 6 - 0.2) top++;
      if (nor.getZ(k) === -1) back++;
      if (Math.abs(nor.getX(k)) === 1) ends++;
    }
    expect(top).toBeGreaterThan(0);
    expect(back).toBeGreaterThan(0);
    expect(ends).toBeGreaterThan(0);
    for (let k = 0; k < pos.count; k++) expect(pos.getZ(k)).toBeGreaterThan(6 - 0.5); // (no wedge fins reaching back)
  });

  it('draws only the faces of a free-standing wall that can be seen: no bottom, no front under its face, no ends between walls', () => {
    const geo = (runs: CliffRun[]) => build({ runs, sides: [], ledges: [] }).geometry;
    const one = geo([{ ...run(3, 0, 1), wall: true }]);
    const pos = one.getAttribute('position'), nor = one.getAttribute('normal');
    let down = 0, front = 0;
    for (let k = 0; k < pos.count; k++) {
      if (nor.getY(k) < -0.5) down++;
      // (a front face at the wall's line, under the displaced face: the displaced face only touches it at the top)
      if (nor.getZ(k) > 0.5 && Math.abs(pos.getZ(k) - 6) < 1e-6 && pos.getY(k) < 1 - 1e-6) front++;
    }
    expect(down).toBe(0);
    expect(front).toBe(0);
    // the ends close the wall back from its displaced face (no slit between them)
    let endFront = 0;
    for (let k = 0; k < pos.count; k++) if (Math.abs(nor.getX(k)) > 0.5 && pos.getZ(k) > 6 + 1e-6) endFront++;
    expect(endFront).toBeGreaterThan(0);
    // two walls side by side on one line: no end faces between them
    const two = geo([{ ...run(3, 0, 1), wall: true }, { ...run(4, 0, 1), wall: true }]);
    const p2 = two.getAttribute('position'), n2 = two.getAttribute('normal');
    for (let k = 0; k < p2.count; k++) if (Math.abs(n2.getX(k)) > 0.5) expect(Math.abs(p2.getX(k) - 4) > 1e-6, `x ${p2.getX(k)}`).toBe(true);
  });

  it('builds nothing for an empty placement', () => {
    expect(cliffFamily.build({ runs: [], sides: [], ledges: [] }, { a: map(['..']), events: NO_EVENTS, quality: 'medium' }, kit())).toBeNull();
  });
});

describe("cliffs read a tile's ground layer, not the floor art a covered top layer paints over it", () => {
  // Task 16a tints the terrain of a COVERED tile from its composite where its top layer paints most of
  // it (rock tops, Ever Grande's bricks). The cliffs' rules ask what the ground layer under that art
  // is: their choices must not move with it.
  const LIGHT = px(27, 22, 20), DARK = px(12, 7, 5), GRASS = px(14, 24, 20);
  /** 9: rock whose covered top layer paints dark rock and a strip of grass over a light rock ground
   *  layer (all of it differs: the terrain samples the composite); 11: grass under covered light rock art. */
  const covered = (info: ReturnType<typeof fakeInfo>) => {
    const fill = (m: number, c: number, from: number, to: number, layers: Uint16Array[]) => { for (const l of layers) l.fill(c, m * 256 + from, m * 256 + to); };
    fill(1, GRASS, 0, 256, [info.both, info.bottom]);
    fill(9, LIGHT, 0, 256, [info.both, info.bottom]); fill(9, DARK, 0, 150, [info.both]); fill(9, GRASS, 150, 256, [info.both]);
    info.attributes[9] = LayerType.COVERED << 12; info.topCover[9] = 256;
    fill(12, GRASS, 0, 256, [info.both, info.bottom]); fill(12, LIGHT, 32, 224, [info.both]);
    info.attributes[12] = LayerType.COVERED << 12; info.topCover[12] = 192;
    fill(7, GRASS, 0, 256, [info.both, info.bottom]);
  };

  it("picks a rock mass's top tile by its ground layer (rock), not by the grass its art paints", () => {
    setRockIds((m) => m === 2 || m === 9);
    try {
      const a = map(['.......', '.RR....', '.RR....', '.##....', '.......', '.......'], covered, { ids: { R: 9 } });
      const { p, claims } = extract(a);
      expect(p.runs.map((r) => r.x + 0)).toEqual([1, 2]);
      // the top rows take the mass's commonest rock tile: 9 (four cells) over 2 (two)
      expect(claims.groundMt[a.idx(1, 1)]).toBe(9);
      expect(claims.groundMt[a.idx(2, 1)]).toBe(9);
    } finally {
      setRockIds(() => false);
    }
  });

  it("colours a ledge's lip as the ground layer under it (grass), not its covered rock art", () => {
    const a = map(['...', 'vvv', 'fff'], covered);
    expect(a.groundOf[a.idx(0, 1)]).toBe(12);
    const { p } = extract(a);
    expect(p.ledges).toHaveLength(3);
    for (const l of p.ledges) expect(l.grass).toEqual([14 / 31, 24 / 31, 20 / 31]);
  });
});
