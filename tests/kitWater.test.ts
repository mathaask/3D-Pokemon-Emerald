import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { shoreDistance, waterFamily } from '../src/render/kit/water';
import { analyze, K, type MapAnalysis } from '../src/render/overworld/analyze';
import { Claims, CLAIM_OBJECT, CLAIM_SURFACE, CLAIM_WATER_UNDER } from '../src/render/overworld/claims';
import { NO_EVENTS } from '../src/render/kit/events';
import { createKitUniforms } from '../src/render/kit/materials';
import { fakeInfo } from './helpers/fakeMap';
import { MB } from '../src/game/behaviors';

describe('shoreDistance', () => {
  it('counts water cells away from land', () => {
    const info = fakeInfo();
    info.attributes[3] = MB.OCEAN_WATER; // metatile 3 = water
    const rows = ['.wwww', '.wwww', '.wwww'];
    const w = 5, h = 3;
    const cells = new Uint16Array(w * h);
    rows.forEach((r, y) => [...r].forEach((ch, x) => { cells[y * w + x] = ch === 'w' ? 3 | 0x1000 : 1 | 0x3000; }));
    const a = analyze({ width: w, height: h, cells, border: [3, 3, 3, 3], borderW: 2, borderH: 2, borderPhase: 0 },
      { info, generalPrimary: false, indoor: false, underground: false, underwater: false, margin: 0 });
    const d = shoreDistance(a);
    expect(d[a.idx(0, 1)]).toBe(0);
    expect(d[a.idx(1, 1)]).toBe(1);
    expect(d[a.idx(2, 1)]).toBe(2);
    expect(d[a.idx(4, 1)]).toBe(4);
  });
});

// Metatiles of the synthetic sea: 3 open water; 4 water under a bridge deck (top layer drawn over
// the player); 5 a boat (blocked, mostly blue, covered top-layer art); 6 blocked plain water;
// 0x150/0x151/0x158/0x159 the General tileset's 2x2 sea rock; 7 a rock standing in the water (blocked,
// drawn over water, a block: not blue enough to lie flat); 8 a fence (blocked, no water in its art).
const OVERHANG = 4, BOAT = 5, PLAIN = 6, STANDING = 7, FENCE = 8;
const ROCK = { T: 0x150, U: 0x151, B: 0x158, N: 0x159 } as const;

function sea(rows: string[], underwater = false): MapAnalysis {
  const info = fakeInfo();
  info.attributes[3] = MB.OCEAN_WATER;
  info.attributes[OVERHANG] = MB.OCEAN_WATER; // layer 0: top layer drawn over the player
  info.topCover[OVERHANG] = 120;
  info.attributes[BOAT] = 1 << 12; // NORMAL behaviour, COVERED layer
  info.topCover[BOAT] = 80;
  for (const m of [BOAT, PLAIN, ...Object.values(ROCK)]) info.blue[m] = 0.9;
  for (const m of Object.values(ROCK)) { info.attributes[m] = 1 << 12; info.topCover[m] = 50; }
  info.blue[STANDING] = 0.3; info.blue[FENCE] = 0;
  const w = rows[0].length, h = rows.length;
  const cells = new Uint16Array(w * h);
  const code: Record<string, number> = { w: 3 | 0x1000, o: OVERHANG | 0x1000, b: BOAT | 0x1400, p: PLAIN | 0x1400, k: STANDING | 0x1400, f: FENCE | 0x1400 };
  for (const [k, m] of Object.entries(ROCK)) code[k] = m | 0x1400;
  rows.forEach((r, y) => [...r].forEach((ch, x) => { cells[y * w + x] = code[ch] ?? 1 | 0x3000; }));
  return analyze({ width: w, height: h, cells, border: [3, 3, 3, 3], borderW: 2, borderH: 2, borderPhase: 0 },
    { info, generalPrimary: true, indoor: false, underground: false, underwater, margin: 0 });
}

const ctx = (a: MapAnalysis) => ({ a, events: NO_EVENTS, quality: 'medium' as const });

describe('water extract', () => {
  it('claims water but leaves overhangs and objects drawn on the water to the legacy art, drawing the water on under them', () => {
    const a = sea(['.wwww', '.wobp', '.wwww']);
    const claims = new Claims(a.N);
    const p = waterFamily.extract(ctx(a), claims);
    const claimed = (x: number, y: number) => claims.has(a.idx(x, y), CLAIM_SURFACE);
    expect(claimed(1, 0)).toBe(true);
    expect(claimed(4, 1)).toBe(true); // blocked plain water is still water
    expect(claimed(2, 1)).toBe(false); // bridge deck / eaves over the water
    expect(claimed(3, 1)).toBe(false); // boat
    expect(claimed(0, 1)).toBe(false); // land
    // the water runs on under the overhang and the boat (their art stays legacy, its water cut out)
    const under = (x: number, y: number) => claims.has(a.idx(x, y), CLAIM_WATER_UNDER);
    expect([under(2, 1), under(3, 1), under(1, 0), under(0, 1)]).toEqual([true, true, false, false]);
    expect(p.cells.length).toBe(12);
    expect(p.cells.find((c) => c.i === a.idx(3, 1))!.level).toBe(a.height[a.idx(1, 0)]);
    expect(p.rocks).toEqual([]);
  });

  it('turns the General 2x2 sea rock into a boulder centred on the block', () => {
    const a = sea(['wwwww', 'wTUww', 'wBNww', 'wwwww']);
    const claims = new Claims(a.N);
    const p = waterFamily.extract(ctx(a), claims);
    expect(p.rocks).toEqual([2, 2, a.height[a.idx(1, 2)]]);
    for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]]) expect(claims.has(a.idx(x, y), CLAIM_SURFACE)).toBe(true);
  });

  it('leaves a rock with an overhang cell to the legacy art, all four cells of it', () => {
    const a = sea(['wwwww', 'woUww', 'wBNww', 'wwwww']); // top-left rock cell carries an overhang
    const claims = new Claims(a.N);
    const p = waterFamily.extract(ctx(a), claims);
    expect(p.rocks).toEqual([]);
    for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]]) expect(claims.has(a.idx(x, y), CLAIM_SURFACE)).toBe(false);
    expect(claims.has(a.idx(0, 1), CLAIM_SURFACE)).toBe(true);
  });

  it('leaves a rock to the legacy art when an earlier family claimed one of its cells', () => {
    const a = sea(['wwwww', 'wTUww', 'wBNww', 'wwwww']);
    const claims = new Claims(a.N);
    claims.claim(a.idx(2, 1), CLAIM_SURFACE);
    const p = waterFamily.extract(ctx(a), claims);
    expect(p.rocks).toEqual([]);
    for (const [x, y] of [[1, 1], [1, 2], [2, 2]]) expect(claims.has(a.idx(x, y), CLAIM_SURFACE)).toBe(false);
  });

  it('draws no surface water on a Dive map (its water cells are the seabed, left to the legacy art)', () => {
    const a = sea(['.wwww', '.wTUw', '.wBNw'], true);
    const claims = new Claims(a.N);
    const p = waterFamily.extract(ctx(a), claims);
    expect(p.cells).toEqual([]);
    expect(p.rocks).toEqual([]);
    expect(claims.bits.every((b) => b === 0)).toBe(true);
    const kit = { uniforms: createKitUniforms(), quality: 'medium' as const, disposables: [] as { dispose(): void }[] };
    expect(waterFamily.build(p, ctx(a), kit)).toBeNull();
  });

  it('builds surface, seabed and rocks, and hands its texture to the kit', () => {
    const a = sea(['.wwwww', '.wTUww', '.wBNww', '.wwwww']);
    const claims = new Claims(a.N);
    const p = waterFamily.extract(ctx(a), claims);
    const kit = { uniforms: createKitUniforms(), quality: 'medium' as const, disposables: [] as { dispose(): void }[] };
    const g = waterFamily.build(p, ctx(a), kit) as THREE.Group;
    expect(g.children.length).toBe(3); // surface, seabed (cells within 2 of the shore), rocks
    const [surface, bed] = g.children as THREE.Mesh[];
    expect(surface.geometry.getAttribute('position').count).toBe(p.cells.length * 6);
    const shallow = p.cells.filter((c) => p.dist[c.i] <= 2).length;
    expect(bed.geometry.getAttribute('position').count).toBe(shallow * 6);
    // No depth write: blob shadows and decals on the water stay visible when the swell rises past them.
    expect((surface.material as THREE.Material).depthWrite).toBe(false);
    expect(kit.disposables.length).toBe(1);
    const tex = kit.disposables[0] as THREE.DataTexture;
    expect((tex.image.data as Uint8Array)[a.idx(3, 2) * 4 + 3]).toBe(255); // rock flag on the corner's SE cell
  });
});

describe('water extract: secret-base spots', () => {
  it('claims no secret-base spot the analysis lays flat as water, nor a sea rock standing on one', () => {
    const a = sea(['.wwww', '.wpww', '.TUww', '.BNww']);
    a.beh[a.idx(2, 1)] = MB.SECRET_BASE_SPOT_BLUE_CAVE_OPEN; // (plain blocked water art)
    a.beh[a.idx(2, 3)] = MB.SECRET_BASE_SPOT_BLUE_CAVE; // (the rock's bottom-right cell)
    const claims = new Claims(a.N);
    const p = waterFamily.extract(ctx(a), claims);
    expect(claims.bits[a.idx(2, 1)]).toBe(0);
    expect(claims.bits[a.idx(2, 3)]).toBe(0);
    expect(p.rocks).toEqual([]);
    expect(claims.has(a.idx(1, 0), CLAIM_SURFACE)).toBe(true);
  });
});

describe('water extract: under the legacy art', () => {
  it('draws the water on under a block standing in it (not a fence on the shore, nor an object a family took)', () => {
    const a = sea(['.wwww', 'fwkww', '.wwkw', '.wwww']);
    expect(a.kind[a.idx(2, 1)]).toBe(K.Block);
    expect(a.kind[a.idx(0, 1)]).toBe(K.Block);
    const claims = new Claims(a.N);
    claims.claim(a.idx(3, 2), CLAIM_OBJECT); // (a family models this one)
    const p = waterFamily.extract(ctx(a), claims);
    expect(claims.bits[a.idx(2, 1)]).toBe(CLAIM_WATER_UNDER);
    expect(p.cells.find((c) => c.i === a.idx(2, 1))!.level).toBe(a.groundH[a.idx(2, 1)]);
    expect(claims.has(a.idx(0, 1), CLAIM_WATER_UNDER)).toBe(false);
    expect(claims.has(a.idx(3, 2), CLAIM_WATER_UNDER)).toBe(false);
    // it is water for the shore: no shoreline (foam) around it
    expect(p.dist[a.idx(2, 1)]).toBeGreaterThan(0);
    expect(p.dist[a.idx(2, 1)]).toBe(Math.min(p.dist[a.idx(1, 1)], p.dist[a.idx(3, 1)]) + 1);
  });

  it("takes water for ground by its colours, not its behaviour (a boat's water tile laid flat by the analysis)", () => {
    // 'k' stands in front of a boat cell ('b': blocked, mostly blue, NORMAL behaviour, water for the
    // analysis): the ground the analysis finds behind it is the boat's tile, drawn mostly in water
    const b = sea(['.www', '.kww', 'wbww']);
    b.info.both.fill(8 | (12 << 5) | (26 << 10), BOAT * 256, BOAT * 256 + 200);
    expect(b.kind[b.idx(1, 1)]).toBe(K.Block);
    expect(b.groundOf[b.idx(1, 1)]).toBe(BOAT); // (south of it, found first)
    expect(b.kind[b.idx(1, 2)]).toBe(K.Water);
    const claims = new Claims(b.N);
    waterFamily.extract(ctx(b), claims);
    expect(claims.has(b.idx(1, 1), CLAIM_WATER_UNDER)).toBe(true);
    // (a ground tile drawn in land colours is no water, whatever the analysis made of it)
    const c = sea(['.www', '.kww', 'wbww']);
    c.info.both.fill(14 | (24 << 5) | (20 << 10), BOAT * 256, BOAT * 256 + 256);
    const claims2 = new Claims(c.N);
    waterFamily.extract(ctx(c), claims2);
    expect(claims2.has(c.idx(1, 1), CLAIM_WATER_UNDER)).toBe(false);
  });
});
