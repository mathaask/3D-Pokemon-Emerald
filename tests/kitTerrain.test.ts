import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MB } from '../src/game/behaviors';
import { cellLook, decorationPixels, groundMaterial, GroundMat, terrainFamily } from '../src/render/kit/terrain';
import { bgr555ToSrgb, classifyGroundColor, wetGround } from '../src/render/kit/palette';
import { Claims, CLAIM_DECOR, CLAIM_OBJECT, CLAIM_SURFACE } from '../src/render/overworld/claims';
import { NO_EVENTS } from '../src/render/kit/events';
import { createKitUniforms } from '../src/render/kit/materials';
import { analyze, K, type MapAnalysis } from '../src/render/overworld/analyze';
import { fakeAnalysis, fakeGrid, fakeInfo } from './helpers/fakeMap';
import { SYM } from '../src/game/symbols';
import { SECONDARY_KEEP_LEGACY } from '../src/render/kit/tables/secondary';

describe('groundMaterial', () => {
  const grass: [number, number, number] = [0.45, 0.78, 0.65];
  it('behaviour wins over colour', () => {
    expect(groundMaterial(MB.SAND, grass)).toBe(GroundMat.Sand);
    expect(groundMaterial(MB.FORTREE_BRIDGE, grass)).toBe(GroundMat.Deck);
    expect(groundMaterial(MB.ASHGRASS, grass)).toBe(GroundMat.Gravel);
  });
  it('falls back to the colour class', () => {
    expect(groundMaterial(MB.NORMAL, grass)).toBe(GroundMat.Grass);
    expect(groundMaterial(MB.NORMAL, [0.65, 0.84, 0.78])).toBe(GroundMat.Path);
    expect(groundMaterial(MB.NORMAL, [0.81, 0.81, 0.87])).toBe(GroundMat.Paving);
  });
  it('beach shallows are sand', () => {
    expect(groundMaterial(MB.SHALLOW_WATER, [0.61, 0.65, 0.74])).toBe(GroundMat.Sand);
  });
  it('water-coloured ground is wet sand, not paving', () => {
    expect(groundMaterial(MB.NORMAL, [0.32, 0.42, 0.84])).toBe(GroundMat.Sand);
  });
});

/** BGR555 pixel of an sRGB colour given in 31sts. */
const px = (r: number, g: number, b: number) => r | (g << 5) | (b << 10);
/** Fills metatile `m` of a layer with consecutive runs of [pixel, count]. */
const paint = (layer: Uint16Array, m: number, runs: [number, number][]) => {
  let p = m * 256;
  for (const [v, n] of runs) { layer.fill(v, p, p + n); p += n; }
};
// Hoenn ROM colours: the sea, its wave lines, shallows over sand, foam, grass shades, a puddle.
const SEA = px(10, 13, 26), SEA2 = px(13, 16, 26), SHALLOW = px(19, 20, 23), FOAM = px(21, 24, 28);
const GRASS = px(14, 24, 20), PUDDLE = px(14, 23, 30);
const COVERED = 1 << 12;

describe('cellLook', () => {
  it('ignores dark outline and shadow pixels', () => {
    const a = fakeAnalysis(['...']);
    a.info.bottom.fill(px(7, 10, 0), 5 * 256, 5 * 256 + 150); // dark olive shadow (dominant)
    a.info.bottom.fill(px(7, 17, 6), 5 * 256 + 150, 6 * 256); // the grass itself
    expect(cellLook(a, 5, new Map()).tint).toEqual([7 / 31, 17 / 31, 6 / 31]);
  });
  it('takes a deck colour from the planks on the top layer', () => {
    const a = fakeAnalysis(['...']);
    a.info.attributes[5] = MB.FORTREE_BRIDGE;
    a.info.bottom.fill(px(7, 17, 6), 5 * 256, 6 * 256); // canopy under the bridge
    a.info.both.fill(px(8, 9, 13), 5 * 256, 5 * 256 + 140); // plank outlines
    a.info.both.fill(px(25, 26, 20), 5 * 256 + 140, 6 * 256); // planks
    const look = cellLook(a, 5, new Map());
    expect(look.mat).toBe(GroundMat.Deck);
    expect(look.tint).toEqual([25 / 31, 26 / 31, 20 / 31]);
  });
  it('takes a deck colour from the planks, not the water between them', () => {
    const a = fakeAnalysis(['...']);
    a.info.attributes[5] = MB.BRIDGE_OVER_OCEAN;
    paint(a.info.bottom, 5, [[SEA, 256]]);
    paint(a.info.both, 5, [[SEA, 120], [px(12, 12, 15), 70], [px(16, 16, 19), 66]]);
    expect(cellLook(a, 5, new Map()).tint).toEqual(bgr555ToSrgb(px(12, 12, 15)));
  });
  it('a shore tile is its shallows, not the sea it borders', () => {
    // Mossdeep / Lilycove 0x1ae: deep sea on one half, shallows on the other, nothing on top.
    const a = fakeAnalysis(['...']);
    a.info.attributes[5] = MB.SHALLOW_WATER;
    paint(a.info.bottom, 5, [[SEA, 118], [SHALLOW, 114], [SEA2, 14], [FOAM, 10]]);
    paint(a.info.both, 5, [[SEA, 118], [SHALLOW, 114], [SEA2, 14], [FOAM, 10]]);
    const look = cellLook(a, 5, new Map());
    expect(look.mat).toBe(GroundMat.Sand);
    expect(look.tint).toEqual(bgr555ToSrgb(SHALLOW));
  });
  it('an overhang over a backdrop of sea and grass stands on grass', () => {
    // Slateport 0x290: a roof edge on the top layer (drawn over objects) hides a shore tile.
    const a = fakeAnalysis(['...']);
    paint(a.info.bottom, 5, [[SEA, 118], [SEA2, 10], [GRASS, 110], [px(20, 26, 24), 11], [px(8, 22, 16), 7]]);
    paint(a.info.both, 5, [[px(27, 26, 29), 240], [SEA, 16]]);
    const look = cellLook(a, 5, new Map());
    expect(look.mat).toBe(GroundMat.Grass);
    expect(look.tint).toEqual(bgr555ToSrgb(GRASS));
  });
  it('a covered tile over a water backdrop takes the ground its top layer paints on the floor', () => {
    const a = fakeAnalysis(['...']);
    a.info.attributes[5] = COVERED;
    paint(a.info.bottom, 5, [[SEA, 236], [SEA2, 20]]);
    paint(a.info.both, 5, [[GRASS, 200], [SEA, 56]]);
    const look = cellLook(a, 5, new Map());
    expect(look.mat).toBe(GroundMat.Grass);
    expect(look.tint).toEqual(bgr555ToSrgb(GRASS));
  });
  it('without water, a covered tile whose top layer paints less than half of it takes its ground from the bottom layer', () => {
    const a = fakeAnalysis(['...']);
    a.info.attributes[5] = COVERED;
    paint(a.info.bottom, 5, [[px(16, 6, 4), 201], [px(19, 12, 10), 55]]); // mostly shadow
    paint(a.info.both, 5, [[px(22, 19, 9), 100], [px(16, 6, 4), 101], [px(19, 12, 10), 55]]);
    expect(cellLook(a, 5, new Map()).tint).toEqual(bgr555ToSrgb(px(19, 12, 10)));
  });
  describe('a covered tile whose top layer paints most of the floor', () => {
    // Ever Grande's brick path (0x23d): bricks and mortar on the covered top layer over a grass bottom.
    const BRICK = px(25, 19, 16), MORTAR = px(17, 11, 9);
    const brickPath = (attr: number, brick = 180) => {
      const a = fakeAnalysis(['...']);
      a.info.attributes[5] = attr;
      a.info.topCover[5] = 256;
      paint(a.info.bottom, 5, [[GRASS, 256]]);
      paint(a.info.both, 5, [[BRICK, brick], [MORTAR, 40], [GRASS, 216 - brick]]);
      return cellLook(a, 5, new Map());
    };
    it('takes its look from the top layer: the floor the player sees', () => {
      const look = brickPath(COVERED);
      expect(look.tint).toEqual(bgr555ToSrgb(BRICK));
      expect(look.mat).not.toBe(GroundMat.Grass);
    });
    it('but not when it paints less than half of the tile', () => {
      expect(brickPath(COVERED, 80).tint).toEqual(bgr555ToSrgb(GRASS));
    });
    it("counts only the top layer's pixels that differ from the ground under them", () => {
      // a full top layer redrawing the same grass, with a few bricks
      const a = fakeAnalysis(['...']);
      a.info.attributes[5] = COVERED;
      a.info.topCover[5] = 256;
      paint(a.info.bottom, 5, [[GRASS, 256]]);
      paint(a.info.both, 5, [[BRICK, 110], [GRASS, 146]]);
      expect(cellLook(a, 5, new Map()).tint).toEqual(bgr555ToSrgb(GRASS));
    });
    it("never on a normal tile (its top layer is an overhang drawn over objects) or a ledge (the cliffs draw its lip)", () => {
      expect(brickPath(0).tint).toEqual(bgr555ToSrgb(GRASS));
      expect(brickPath(COVERED | MB.JUMP_SOUTH).tint).toEqual(bgr555ToSrgb(GRASS));
    });
    it('never on a Dive map (its seabed keeps its look)', () => {
      const a = fakeAnalysis(['...'], { underwater: true });
      a.info.attributes[5] = COVERED;
      paint(a.info.bottom, 5, [[GRASS, 256]]);
      paint(a.info.both, 5, [[BRICK, 180], [MORTAR, 40], [GRASS, 36]]);
      expect(cellLook(a, 5, new Map()).tint).toEqual(bgr555ToSrgb(GRASS));
    });
  });
  it('ground that is water all over is wet ground, not open water', () => {
    // A puddle's corner: a grass fringe on the covered top layer does not make it dry land.
    const puddle = fakeAnalysis(['...']);
    puddle.info.attributes[5] = MB.PUDDLE | COVERED;
    paint(puddle.info.bottom, 5, [[PUDDLE, 256]]);
    paint(puddle.info.both, 5, [[PUDDLE, 200], [GRASS, 40], [px(10, 6, 8), 16]]);
    const p = cellLook(puddle, 5, new Map());
    expect(p.mat).toBe(GroundMat.Dirt);
    expect(p.tint).toEqual(wetGround(bgr555ToSrgb(PUDDLE)));
    // The sea behind an overhang's art (Mossdeep's rocket gantry): no ground anywhere.
    const sea = fakeAnalysis(['...']);
    paint(sea.info.bottom, 5, [[SEA, 256]]);
    paint(sea.info.both, 5, [[px(29, 18, 14), 200], [SEA, 56]]);
    const s = cellLook(sea, 5, new Map());
    expect(s.mat).toBe(GroundMat.Sand);
    expect(s.tint).toEqual(wetGround(bgr555ToSrgb(SEA)));
    for (const t of [p.tint, s.tint]) expect(classifyGroundColor(t)).not.toBe('water');
  });
  it('on a Dive map the seabed keeps its own water colours', () => {
    // Underwater Route 124's seabed is drawn indigo: that is its identity (spec §4.4), not water.
    const a = fakeAnalysis(['...'], { underwater: true });
    const INDIGO = px(14, 9, 25);
    paint(a.info.bottom, 5, [[INDIGO, 150], [px(12, 16, 12), 106]]);
    paint(a.info.both, 5, [[INDIGO, 150], [px(12, 16, 12), 106]]);
    const look = cellLook(a, 5, new Map());
    expect(look.mat).toBe(GroundMat.Sand);
    expect(look.tint).toEqual(bgr555ToSrgb(INDIGO));
  });
});

describe('terrain extract', () => {
  it('covers walkable cells and the ground under claimed objects', () => {
    const a = fakeAnalysis(['....', '.##.', '....']);
    const claims = new Claims(a.N);
    const objectCell = a.idx(1, 1);
    claims.claim(objectCell, CLAIM_OBJECT);
    claims.groundY[objectCell] = 0.5;
    const p = terrainFamily.extract({ a, events: NO_EVENTS, quality: 'medium' }, claims);
    const covered = new Set(p.cells.map((c) => c.i));
    expect(covered.has(a.idx(0, 0))).toBe(true);
    expect(covered.has(objectCell)).toBe(true);
    expect(p.cells.find((c) => c.i === objectCell)!.h).toBe(0.5);
    // the unclaimed block cell keeps its legacy ground
    expect(covered.has(a.idx(2, 1))).toBe(false);
    expect(a.kind[a.idx(2, 1)]).toBe(K.Block);
    for (const c of p.cells) expect(claims.has(c.i, CLAIM_SURFACE)).toBe(true);
  });
  it('leaves walk-in doors, ladders, treehouse walkways and bike rails to the legacy pixel art', () => {
    const info = fakeInfo();
    info.attributes[3] = MB.NON_ANIMATED_DOOR;
    info.attributes[4] = MB.LADDER;
    info.attributes[5] = MB.NO_RUNNING; // Fortree's treehouse platforms and their ladders
    info.attributes[6] = MB.HORIZONTAL_RAIL; // Acro Bike rail over water (rail on the top layer)
    const grid = fakeGrid(['......', '......']);
    for (let x = 1; x <= 4; x++) grid.cells[x] = (x + 2) | 0x3000;
    const a = analyze(grid, { info, generalPrimary: false, indoor: false, underground: false, underwater: false, margin: 1 });
    const claims = new Claims(a.N);
    const p = terrainFamily.extract({ a, events: NO_EVENTS, quality: 'medium' }, claims);
    const covered = new Set(p.cells.map((c) => c.i));
    for (let x = 1; x <= 4; x++) {
      expect(a.kind[a.idx(x, 0)]).toBe(K.Floor);
      expect(covered.has(a.idx(x, 0))).toBe(false);
      expect(claims.has(a.idx(x, 0), CLAIM_SURFACE)).toBe(false);
    }
    expect(covered.has(a.idx(0, 0))).toBe(true);
    expect(covered.has(a.idx(5, 0))).toBe(true);
  });
  it('leaves the curated landmarks of a town tileset (the Battle Frontier emblems) to the legacy pixel art', () => {
    // Battle Frontier East's Poké Ball emblem in front of the Battle Tower: 0x318 (a corner of its slab).
    const grid = fakeGrid(['...']);
    grid.cells[1] = 0x318 | 0x3000;
    const run = (secondaryTileset: number) => {
      const a = analyze(grid, { info: fakeInfo(), generalPrimary: false, indoor: false, underground: false, underwater: false, secondaryTileset, margin: 1 });
      const claims = new Claims(a.N);
      const covered = new Set(terrainFamily.extract({ a, events: NO_EVENTS, quality: 'medium' }, claims).cells.map((c) => c.i));
      expect(a.kind[a.idx(1, 0)]).toBe(K.Floor);
      expect(covered.has(a.idx(0, 0))).toBe(true);
      return { emblem: covered.has(a.idx(1, 0)), claimed: claims.has(a.idx(1, 0), CLAIM_SURFACE) };
    };
    expect(run(SYM.gTileset_BattleFrontierOutsideEast)).toEqual({ emblem: false, claimed: false });
    // (the same id in another town's tileset is that town's ground)
    expect(run(SYM.gTileset_BattleFrontierOutsideWest)).toEqual({ emblem: true, claimed: true });
  });
  it('keeps every curated landmark id a secondary (town) id', () => {
    for (const [ts, ids] of SECONDARY_KEEP_LEGACY) {
      expect(ts).toBeGreaterThan(0);
      for (const m of ids) expect(m).toBeGreaterThanOrEqual(512);
    }
  });
});

describe('terrain: decoration it cannot paint', () => {
  // Ground art on grass: decoration (two flower heads), and ground the terrain does paint: speckles,
  // a sand corner, stripes, decoration the top layer hides, a pool, one small blob, blobs in the
  // ground's own colour, grey stones on grass, sand flags in dark joints.
  const PINK = px(29, 16, 22), YELLOW = px(31, 30, 12), SANDY = px(30, 26, 10), BLUE = px(8, 12, 28);
  const SAND = px(28, 25, 14), SAND2 = px(31, 28, 13), STONE = px(24, 24, 20);
  const DECOR = 3, SPECKLE = 4, CORNER = 5, STRIPES = 6, HIDDEN = 7, POOL = 8, SMALL = 9, TINTED = 10, LEDGE = 11;
  const STONES = 12, FLAGS = 13, GREY = px(16, 16, 18), JOINT = px(8, 6, 4);
  function tiles() {
    const info = fakeInfo();
    const rect = (layer: Uint16Array, m: number, x0: number, y0: number, w: number, h: number, c: number) => {
      for (let y = y0; y < y0 + h; y++) layer.fill(c, m * 256 + y * 16 + x0, m * 256 + y * 16 + x0 + w);
    };
    const both = (m: number, x0: number, y0: number, w: number, h: number, c: number) => { rect(info.bottom, m, x0, y0, w, h, c); rect(info.both, m, x0, y0, w, h, c); };
    for (const m of [1, DECOR, SPECKLE, CORNER, STRIPES, HIDDEN, POOL, SMALL, LEDGE, STONES]) both(m, 0, 0, 16, 16, GRASS);
    both(STONES, 2, 2, 5, 5, GREY); both(STONES, 9, 8, 5, 5, GREY);
    both(FLAGS, 0, 0, 16, 16, JOINT);
    for (const [x, y] of [[1, 1], [9, 1], [1, 9], [9, 9]]) both(FLAGS, x, y, 5, 5, SAND);
    for (const m of [DECOR, HIDDEN, LEDGE]) { both(m, 2, 2, 5, 5, PINK); both(m, 9, 8, 5, 5, YELLOW); } // 50 px of flowers
    info.attributes[LEDGE] = MB.JUMP_SOUTH;
    for (let k = 0; k < 40; k++) both(SPECKLE, (k % 8) * 2 + (Math.floor(k / 8) % 2), Math.floor(k / 8) * 3 + 1, 1, 1, YELLOW);
    both(CORNER, 0, 8, 8, 8, SANDY);
    for (const y of [3, 7, 11]) both(STRIPES, 0, y, 16, 1, YELLOW);
    rect(info.both, HIDDEN, 0, 0, 16, 16, STONE); info.topCover[HIDDEN] = 256; info.attributes[HIDDEN] = COVERED;
    both(POOL, 2, 2, 5, 5, BLUE); both(POOL, 9, 8, 5, 5, BLUE);
    both(SMALL, 5, 5, 4, 4, PINK);
    both(TINTED, 0, 0, 16, 16, SAND); both(TINTED, 2, 2, 5, 5, SAND2); both(TINTED, 9, 8, 5, 5, SAND2);
    return info;
  }
  const at = (ids: number[], claim?: (a: MapAnalysis, claims: Claims) => void) => {
    const grid = fakeGrid(['.'.repeat(ids.length + 2)]);
    ids.forEach((m, k) => { grid.cells[k + 1] = m | 0x3000; });
    const a = analyze(grid, { info: tiles(), generalPrimary: false, indoor: false, underground: false, underwater: false, margin: 1 });
    const claims = new Claims(a.N);
    claim?.(a, claims);
    const covered = new Set(terrainFamily.extract({ a, events: NO_EVENTS, quality: 'medium' }, claims).cells.map((c) => c.i));
    return { a, claims, covered };
  };

  it('counts the vivid blobs set inside a tile that the tint does not paint', () => {
    const info = tiles();
    const grass = bgr555ToSrgb(GRASS);
    expect(decorationPixels(info, DECOR, grass)).toBe(50);
    for (const m of [SPECKLE, CORNER, STRIPES, HIDDEN, POOL]) expect(decorationPixels(info, m, grass), `tile ${m}`).toBe(0);
    expect(decorationPixels(info, SMALL, grass)).toBe(16);
    expect(decorationPixels(info, TINTED, bgr555ToSrgb(SAND))).toBe(0);
    // (painted grass, the sand there is as far from the tint: one blob over the whole tile, a ground)
    expect(decorationPixels(info, TINTED, grass)).toBe(0);
    expect(decorationPixels(info, STONES, grass)).toBe(0); // (no vivid colour)
    expect(decorationPixels(info, FLAGS, bgr555ToSrgb(SAND))).toBe(0); // (the ground's own colour)
    expect(decorationPixels(info, FLAGS, grass)).toBe(100);
  });

  it('leaves a walkable cell whose ground art is decoration no family models to the legacy art', () => {
    const { a, claims, covered } = at([DECOR]);
    expect(a.kind[a.idx(1, 0)]).toBe(K.Floor);
    expect(covered.has(a.idx(1, 0))).toBe(false);
    expect(claims.has(a.idx(1, 0), CLAIM_SURFACE)).toBe(false);
    expect(covered.has(a.idx(0, 0))).toBe(true);
  });

  it('paints the ground under decoration a family models (3D flowers)', () => {
    const { a, claims, covered } = at([DECOR], (a2, c) => c.claim(a2.idx(1, 0), CLAIM_DECOR));
    expect(covered.has(a.idx(1, 0))).toBe(true);
    expect(claims.has(a.idx(1, 0), CLAIM_SURFACE)).toBe(true);
  });

  it("paints plain ground: speckles, another ground's corner, stripes, hidden art, a pool, one small blob, stones, flags", () => {
    const ids = [SPECKLE, CORNER, STRIPES, HIDDEN, POOL, SMALL, TINTED, STONES, FLAGS];
    const { a, covered } = at(ids);
    ids.forEach((m, k) => expect(covered.has(a.idx(k + 1, 0)), `tile ${m}`).toBe(true));
  });

  it('still covers a ledge (the cliffs draw its lip) and the ground under a claimed object', () => {
    const { a, covered } = at([LEDGE, DECOR], (a2, c) => c.claim(a2.idx(2, 0), CLAIM_OBJECT));
    expect(a.kind[a.idx(1, 0)]).toBe(K.Ledge);
    expect(covered.has(a.idx(1, 0))).toBe(true);
    expect(covered.has(a.idx(2, 0))).toBe(true);
  });
});

describe('terrain build', () => {
  it('emits one top per cell plus banks, every triangle facing its normal', () => {
    const a = fakeAnalysis(['.....', '.###.', '.....']);
    const claims = new Claims(a.N);
    // Ground under claimed objects at assorted heights (row 0 is at 1, row 2 at 0): banks rising
    // and falling in both directions.
    [1.5, 0.25, 0.75].forEach((h, k) => {
      claims.claim(a.idx(k + 1, 1), CLAIM_OBJECT);
      claims.groundY[a.idx(k + 1, 1)] = h;
    });
    const ctx = { a, events: NO_EVENTS, quality: 'medium' as const };
    const p = terrainFamily.extract(ctx, claims);
    const kit = { uniforms: createKitUniforms(), quality: 'medium' as const, disposables: [] as { dispose(): void }[] };
    const mesh = terrainFamily.build(p, ctx, kit) as THREE.Mesh;
    expect(kit.disposables).toHaveLength(1);
    const pos = mesh.geometry.getAttribute('position');
    const nor = mesh.geometry.getAttribute('normal');
    const quads = pos.count / 6;
    expect(quads).toBeGreaterThan(p.cells.length);
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), n = new THREE.Vector3();
    const kinds = new Set<string>();
    for (let t = 0; t < pos.count; t += 3) {
      va.fromBufferAttribute(pos, t);
      vb.fromBufferAttribute(pos, t + 1).sub(va);
      vc.fromBufferAttribute(pos, t + 2).sub(va);
      n.fromBufferAttribute(nor, t);
      expect(vb.cross(vc).dot(n)).toBeGreaterThan(0);
      kinds.add(n.toArray().map((v) => Math.sign(Math.round(v * 10))).join(','));
    }
    // tops, both S-bank orientations and both E-bank orientations
    for (const k of ['0,1,0', '0,0,1', '0,1,-1', '1,0,0', '-1,0,0']) expect(kinds.has(k)).toBe(true);
  });
});
