// Interior floors and window light shafts, the pure parts (Phase 4 Task 8, phase A): floor cells, their texture bytes, the
// floor program's GLSL (sharing the terrain's cell fetch, whose program text stays byte-identical), the shafts.
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  BAND_HIDDEN, BAND_RECESS_NORTH, encodeFloor, floorCells, floorGeometry, FloorMat, floorTint, FLOOR_SAT_KNEE, FLOOR_SAT_SLOPE, interiorFloorMaterial, roomShaftMaterial,
  shaftGeometry, SHAFT_SLANT,
} from '../src/render/kit/interior/geom/floorPatterns';
import { roomLayout, windowRect, RECESS } from '../src/render/kit/interior/room';
import {
  BOARDS_CELL_GLSL, BOARDS_FW_GLSL, BOARDS_GLSL, BOARDS_SHADE_GLSL, TILES_CELL_GLSL, TILES_FW_GLSL, TILES_GLSL, TILES_SHADE_GLSL,
} from '../src/render/kit/interior/floorGlsl';
import { TERRAIN_CELL_GLSL, TERRAIN_GRID_GLSL, terrainFragColor, terrainMaterial } from '../src/render/kit/terrain';
import { CLAIM_OBJECT, CLAIM_SURFACE, Claims } from '../src/render/overworld/claims';
import type { MapAnalysis } from '../src/render/overworld/analyze';
import type { InteriorId } from '../src/render/kit/tables/building';
import { fakeInterior } from './helpers/fakeInterior';

/** Claims with the table cells claimed CLAIM_OBJECT, as the furniture family would. */
const claimsWithTable = (a: MapAnalysis, ids: readonly (InteriorId | null)[]) => {
  const c = new Claims(a.N);
  ids.forEach((id, i) => { if (id === 'table') c.claim(i, CLAIM_OBJECT); });
  return c;
};
const HOUSE = ['          ', ' WWOOWWWW ', ' WWOOWFWW ', ' ........ ', ' ..TT.... ', ' ..TT..rr ', ' ......rr ', ' ....M... ', '          '];
const cellsOf = (rows: string[], claims?: (a: MapAnalysis, ids: readonly (InteriorId | null)[]) => Claims) => {
  const { a, ids } = fakeInterior(rows);
  const cells = floorCells(a, ids, roomLayout(a, ids, []), claims ? claims(a, ids) : new Claims(a.N));
  return { a, ids, cells, at: (x: number, y: number) => cells.find((c) => c.i === a.idx(x, y)) };
};
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('interior floor cells', () => {
  it('gives the rug its kind and border edges, and the table cells the rug under them', () => {
    const { a, ids } = fakeInterior(['          ', ' WWWWWWWW ', ' ........ ', ' ..rrrr.. ', ' ..rTTr.. ', ' ..rrrr.. ', ' ........ ', '          ']);
    const cells = floorCells(a, ids, roomLayout(a, ids, []), claimsWithTable(a, ids));
    const at = (x: number, y: number) => cells.find((c) => c.i === a.idx(x, y))!;
    expect(at(4, 4).mat).toBe(FloorMat.Rug);                        // under the table: the rug around it
    expect(at(3, 3).edges).toBe(0b1001);                             // NW corner of the rug: border N and W
    expect(at(4, 3).edges).toBe(0b0001);
    expect(at(5, 2).mat).toBe(FloorMat.Boards);
  });

  it('leaves the stairwell without floor', () => {
    const { a, ids } = fakeInterior(['        ', ' WWWWWW ', ' ...s.. ', ' ...... ', '        ']);
    const cells = floorCells(a, ids, roomLayout(a, ids, []), new Claims(a.N));
    expect(cells.some((c) => c.i === a.idx(4, 2))).toBe(false);
    expect(cells.some((c) => c.i === a.idx(3, 2))).toBe(true);
  });

  it('floors the back wall\'s recess, stairsUp, the mat (bordered) and Sootopolis 0x3FF blocks; leaves unknown cells legacy', () => {
    const { at } = cellsOf(['         ', ' WWWWWWW ', ' S...... ', ' _....?. ', ' ...M... ', '         ']);
    expect(at(2, 1)?.mat).toBe(FloorMat.Boards);                     // band: its recess row, from the wall's inner face
    expect(at(2, 1)?.north).toBe(BAND_RECESS_NORTH);
    expect(at(2, 2)?.north).toBeUndefined();                         // a room cell: whole
    expect(at(1, 2)?.mat).toBe(FloorMat.Boards);                     // stairsUp: the boards beside it
    expect(at(1, 3)?.mat).toBe(FloorMat.Boards);                     // a walkable 0x3FF block (real3ff): floor
    expect(at(4, 4)?.mat).toBe(FloorMat.Mat);
    expect(at(4, 4)?.edges).toBe(0b1111);                            // boards N/E/W, the void S: a border all round
    expect(at(6, 3)).toBeUndefined();                                // a blocked unknown cell no family claimed: legacy
  });

  it('lays no floor behind the back wall: a 2-row band keeps its cells, but quads only from the inner face south', () => {
    const { a, ids } = fakeInterior(['          ', ' WWOOWWWW ', ' WWOOWFWW ', ' ........ ', ' ........ ', '          ']);
    const L = roomLayout(a, ids, []);
    const cells = floorCells(a, ids, L, new Claims(a.N));
    const at = (x: number, y: number) => cells.find((c) => c.i === a.idx(x, y));
    expect(at(2, 1)?.north).toBe(BAND_HIDDEN);                       // behind the wall: claimed, no quad
    expect(at(2, 2)?.north).toBe(BAND_RECESS_NORTH);                 // the recess row
    const pos = floorGeometry(a, cells).getAttribute('position');
    expect(pos.count).toBe(cells.filter((c) => c.north !== BAND_HIDDEN).length * 6);
    // un-projected z = y + h: no vertex north of the back wall's inner face (backLine − RECESS) in its column
    for (let k = 0; k < pos.count; k++) {
      const x = Math.min(pos.getX(k), a.maxX - 1), bl = L.backLine[Math.floor(x) - a.minX];
      const z = pos.getZ(k) - pos.getY(k);
      if (bl >= 0) expect(z, `vertex ${k}`).toBeGreaterThanOrEqual(bl - RECESS - 1e-6);
    }
  });

  it('keeps a cell another family surfaced, and gives a lone piece of furniture the room floor', () => {
    const { a, ids } = fakeInterior(['         ', ' WWWWWWW ', ' ....... ', ' .TTTTT. ', ' .TTTTT. ', ' .TTTTT. ', ' ....... ', '         ']);
    const claims = claimsWithTable(a, ids);
    claims.claim(a.idx(1, 2), CLAIM_SURFACE);
    const cells = floorCells(a, ids, roomLayout(a, ids, []), claims);
    expect(cells.some((c) => c.i === a.idx(1, 2))).toBe(false);
    const mid = cells.find((c) => c.i === a.idx(4, 4))!;             // no walkable floor around it: the room's floorTile
    expect(mid.mat).toBe(FloorMat.Boards);
    expect(cells.every((c) => c.h === 0)).toBe(true);                // flat
  });

  it('gives one kind one tint per area', () => {
    const { a, ids } = fakeInterior(['        ', ' WWWWWW ', ' ...... ', ' .rRr.. ', ' ...... ', '        '],
      { R: { mt: 0x210, blocked: false, id: 'rug' } });
    a.info.bottom.fill(0x001f, 0x206 * 256, 0x207 * 256);            // 'r': red
    a.info.bottom.fill(0x7c00, 0x210 * 256, 0x211 * 256);            // 'R': blue
    const cells = floorCells(a, ids, roomLayout(a, ids, []), new Claims(a.N));
    const at = (x: number, y: number) => cells.find((c) => c.i === a.idx(x, y))!;
    expect(at(3, 3).tint).toEqual(at(2, 3).tint);
    expect(at(3, 3).tint[0]).toBeGreaterThan(at(3, 3).tint[2]);      // the area's most common: red
  });

  it('gives furniture on a rug edge row the rug (between rug cells), and votes elsewhere with sides weighing twice', () => {
    // Brendan's 1F: the table and chairs stand on the rug's top rows; the north neighbours are boards
    const { a, ids } = fakeInterior(['          ', ' WWWWWWWW ', ' ........ ', ' .rcTTcr. ', ' .rcTTcr. ', ' .rrrrrr. ', ' ......c. ', ' ........ ', '          '],
      { c: { mt: 0x208, blocked: true, id: 'chair' } });
    const c = new Claims(a.N);
    ids.forEach((id, i) => { if (id === 'table' || id === 'chair') c.claim(i, CLAIM_OBJECT); });
    const cells = floorCells(a, ids, roomLayout(a, ids, []), c);
    const at = (x: number, y: number) => cells.find((q) => q.i === a.idx(x, y))!;
    for (const [x, y] of [[3, 3], [4, 3], [5, 3], [6, 3], [6, 4]]) expect(at(x, y).mat, `${x},${y}`).toBe(FloorMat.Rug);
    expect(at(7, 6).mat).toBe(FloorMat.Boards);    // the lone chair below the rug's corner: between boards along its row; N + NW rug (3) vs boards 9
  });

  it('softens a floor tint towards the tile mean and compresses its saturation', () => {
    const { a } = fakeInterior(['    ', ' .. ', '    ']);
    a.info.bottom.fill(0x03ff, 0x205 * 256, 0x205 * 256 + 200);     // saturated yellow …
    a.info.bottom.fill(0x0010, 0x205 * 256 + 200, 0x206 * 256);     // … with dark red lines
    const t = floorTint(a.info, 0x205);
    const hsl = { h: 0, s: 0, l: 0 };
    new THREE.Color().setRGB(t[0], t[1], t[2], THREE.SRGBColorSpace).getHSL(hsl, THREE.SRGBColorSpace);
    expect(hsl.s).toBeGreaterThan(FLOOR_SAT_KNEE); expect(hsl.s).toBeLessThanOrEqual(FLOOR_SAT_KNEE + (1 - FLOOR_SAT_KNEE) * FLOOR_SAT_SLOPE + 1e-6);
    expect(hsl.h).toBeGreaterThan(0.1); expect(hsl.h).toBeLessThan(0.18);   // still yellow
    a.info.bottom.fill(0x4210, 0x205 * 256, 0x206 * 256);           // a grey tile stays grey
    const g = floorTint(a.info, 0x205);
    expect(Math.max(...g) - Math.min(...g)).toBeLessThan(0.05);
  });

  it('packs kind and edges in the alpha byte', () => {
    const { a } = fakeInterior(['    ', ' .. ', '    ']);
    const data = encodeFloor(a, [{ i: 7, h: 0, mat: FloorMat.Rug, tint: [1, 0.5, 0], edges: 0b0101 }]);
    expect([...data.subarray(28, 32)]).toEqual([255, 128, 0, (3 << 4) | 0b0101]);
    expect([...data.subarray(24, 28)]).toEqual([255, 128, 0, (3 << 4) | 0b0101]);   // its neighbour: dilated
  });

  it('lays one flat quad per cell, facing up', () => {
    const { a, cells } = cellsOf(['      ', ' WWWW ', ' .... ', '      ']);
    const g = floorGeometry(a, cells);
    expect(g.getAttribute('position').count).toBe(cells.length * 6);
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    const e1 = new THREE.Vector3().fromBufferAttribute(p, 1).sub(new THREE.Vector3().fromBufferAttribute(p, 0));
    const e2 = new THREE.Vector3().fromBufferAttribute(p, 2).sub(new THREE.Vector3().fromBufferAttribute(p, 0));
    expect(e1.cross(e2).y).toBeGreaterThan(0);
    expect(n.getY(0)).toBe(1);
  });
});

describe('interior floor program', () => {
  it('keeps the terrain program text byte-identical (the cell fetch shared, not copied)', () => {
    const m = terrainMaterial(new THREE.Texture(), new THREE.Vector2(), new THREE.Vector2(1, 1));
    // recorded from terrain.ts before TERRAIN_GRID_GLSL / TERRAIN_CELL_GLSL were split out of it
    expect([m.fragColor!.length, sha(m.fragColor!)]).toEqual([2070, 'd304a329823af0e2b873b55ac48df2900440031b9db9deedad469a6ca805c6ae']);
    expect([m.fragHead!.length, sha(m.fragHead!)]).toEqual([2020, '63f6cdb55d51cd71295994539b55ee3c5595aef1f7a7a8ab0366bcfe5c019794']);
    const custom = terrainFragColor('/*WARP*/\n');                  // the battle ground's composition
    expect([custom.length, sha(custom)]).toEqual([1818, '52c1510ceb927ba30fc17873c1687e397f0274723fbe7ee710c7b45131f0803b']);
    expect(m.fragColor).toContain(TERRAIN_GRID_GLSL + '  // Organic borders');
    expect(m.fragColor).toContain(TERRAIN_CELL_GLSL);
  });

  it('composes the terrain cell fetch, inlines the pinned board / tile text, declares no uFloor uniforms', () => {
    const o = interiorFloorMaterial(new THREE.Texture(), new THREE.Vector2(), new THREE.Vector2(1, 1));
    expect(o.hookKey).toBe('interiorFloor');
    const glsl = String(o.fragHead) + String(o.fragColor);
    expect(o.fragColor).toContain(TERRAIN_GRID_GLSL);
    // the terrain's cell fetch (its g, ic lines), its texel fetched once: kind, tint and edges from one `cd`
    const [gLine, icLine] = TERRAIN_CELL_GLSL.split('\n');
    expect(o.fragColor).toContain(`${gLine}\n${icLine}\n  vec4 cd = texelFetch(tCells, ic, 0);\n  int mat = int(cd.a * 255.0 + 0.5) >> 4;\n`);
    expect(o.fragColor!.match(/texelFetch\(/g)).toHaveLength(1);
    // the snippets in their parts (whole = parts joined, byte for byte: the battle's hall floor composes the whole)
    expect(BOARDS_CELL_GLSL + BOARDS_FW_GLSL + BOARDS_SHADE_GLSL).toBe(BOARDS_GLSL);
    expect(TILES_CELL_GLSL + TILES_FW_GLSL + TILES_SHADE_GLSL).toBe(TILES_GLSL);
    expect([sha(BOARDS_GLSL), sha(TILES_GLSL)]).toEqual([          // recorded before the split
      'd9c7dc0e0d71a08ced99c5ca90d2ce51dd4d6d3b337d32538956bbf0b40909ae', 'e5412d15d78a963f7249248a3a05b9c06793ff98db1f0aaa923f5c27cdfc21ff',
    ]);
    for (const part of [BOARDS_CELL_GLSL, BOARDS_FW_GLSL, BOARDS_SHADE_GLSL, TILES_CELL_GLSL, TILES_FW_GLSL, TILES_SHADE_GLSL]) {
      expect(o.fragColor).toContain(part);
    }
    expect(o.fragColor).toContain('vec4 uFloor = vec4(0.0, 0.55, 0.38, 0.07);');
    expect(o.fragColor).toContain('vec4 uFloor = vec4(1.0, 1.0, 0.22, 0.025);');
    expect(glsl).not.toMatch(/uniform\s+vec[34]\s+uFloor/);
    expect(glsl).not.toMatch(/kitFbm2|warp \+|texture\(/);           // no organic warp, no bilinear tint blend
    expect(o.fragColor).not.toMatch(/\d\.\d{7,}/);                   // float literals stay short
    // braces balance (the inlined blocks are closed)
    expect([...glsl].filter((c) => c === '{').length).toBe([...glsl].filter((c) => c === '}').length);
  });

  it('runs only the cell kind\'s pattern, every derivative taken before the branch on the kind', () => {
    const c = interiorFloorMaterial(new THREE.Texture(), new THREE.Vector2(), new THREE.Vector2(1, 1)).fragColor!;
    const branch = c.indexOf('if (mat == 0)');
    expect(branch).toBeGreaterThan(0);
    expect(c.lastIndexOf('fwidth(')).toBeLessThan(branch);              // fwidth(fp) and both patterns' footprints
    expect(c.match(/fwidth\(/g)).toHaveLength(3);
    // one pattern per branch: boards, tiles, else fabric (carpet; rugs and mats with their borders)
    const tiles = c.indexOf('} else if (mat == 1)'), fabric = c.indexOf('} else {', tiles);
    expect(branch < tiles && tiles < fabric).toBe(true);
    expect(c.slice(branch, tiles)).toContain(BOARDS_SHADE_GLSL);
    expect(c.slice(tiles, fabric)).toContain(TILES_SHADE_GLSL);
    expect(c.slice(fabric)).toMatch(/kitNoise2[\s\S]*kRug[\s\S]*kMat/);
    expect(c.slice(0, branch)).not.toMatch(/kitNoise2\(|kRug|kMat|float near/);   // no pattern work before the branch
  });
});

describe('window light shafts', () => {
  it('lays one shaft per window, from the glass to the floor, gone at night', () => {
    const { a, ids } = fakeInterior(HOUSE);
    const L = roomLayout(a, ids, [{ x: 5, y: 7, dest: 'LITTLEROOT_TOWN' }]);
    const g = shaftGeometry(L)!; g.computeBoundingBox();
    const w = windowRect(L, L.features[0]);
    expect(g.boundingBox!.min.y).toBeCloseTo(0, 1);
    expect(g.boundingBox!.max.y).toBeLessThanOrEqual(w.y1 + 1e-3); expect(g.boundingBox!.max.y).toBeGreaterThan(w.y0);
    expect(g.boundingBox!.min.x).toBeGreaterThanOrEqual(w.x0 - 1e-3); expect(g.boundingBox!.max.z).toBeGreaterThan(3 - RECESS);
    const m = roomShaftMaterial(0.4);
    expect(m.transparent).toBe(true); expect(m.depthWrite).toBe(false); expect(m.blending).toBe(THREE.AdditiveBlending);
    expect(String(m.fragEmissive ?? '') + String(m.fragColor ?? '')).toContain('uOutdoorNight');
    expect(m.hookKey).toBe('roomShaft');
    expect(m.uniforms!.uShaftAlpha.value).toBe(0.4);
  });

  it('slants 0.6 south per unit fall, carries across/along colours, one strip per window, none without', () => {
    const { a, ids } = fakeInterior(['          ', ' WOOWWOWW ', ' WOOWWOWW ', ' ........ ', ' ........ ', '          ']);
    const L = roomLayout(a, ids, []);
    expect(L.features.filter((f) => f.kind === 'window')).toHaveLength(2);
    const g = shaftGeometry(L)!;
    expect(g.getAttribute('position').count).toBe(8);
    expect(g.getIndex()!.count).toBe(12);
    const p = g.getAttribute('position'), c = g.getAttribute('color');
    const w = windowRect(L, L.features[0]);
    // corner 0 at the glass (along 0), corner 3 on the floor (along 1), 0.6 south per unit of fall
    expect(p.getZ(0)).toBeCloseTo(w.z, 5);
    expect(p.getZ(3) - p.getZ(0)).toBeCloseTo(SHAFT_SLANT * (p.getY(0) - p.getY(3)), 5);
    expect([c.getX(0), c.getY(0), c.getX(2), c.getY(2)]).toEqual([0, 0, 1, 1]);
    const { a: a2, ids: ids2 } = fakeInterior(['        ', ' WWWWWW ', ' ...... ', '        ']);
    expect(shaftGeometry(roomLayout(a2, ids2, []))).toBeNull();
  });
});
