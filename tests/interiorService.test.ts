import { describe, expect, it } from 'vitest';
import { piece, newOut, boxOf, run, countClusters, hashOut, tris } from './helpers/furniture';
import { SERVICE_GENERATORS, againstWall, cellsArea, flightDir } from '../src/render/kit/interior/furnitureService';
import { FURNITURE_SPEC, fitFurniture, isLow } from '../src/render/kit/interior/furniture';
import { RECESS } from '../src/render/kit/interior/room';
import { BALL_RED, COUNTER } from '../src/render/kit/interior/geom/serviceFurniture';

const KINDS = ['pc', 'healer', 'pcCounter', 'counter', 'martShelf'] as const;

describe('service furniture', () => {
  it.each(KINDS)('%s stays inside its footprint at its height, in the right soups', (kind) => {
    const out = newOut(), p = piece(kind); SERVICE_GENERATORS[kind]!(p, out, 'medium');
    const b = boxOf(out), f = p.foot;
    expect(b.min.x).toBeGreaterThanOrEqual(f.x0 - 1e-3); expect(b.max.x).toBeLessThanOrEqual(f.x1 + 1e-3);
    expect(b.min.z).toBeGreaterThanOrEqual(f.z0 - 1e-3); expect(b.max.z).toBeLessThanOrEqual(f.z1 + 1e-3);
    // (serving counters stand COUNTER.height, under the spec: the clerk behind reads from the chest up — ruling I2)
    expect(b.max.y).toBeCloseTo(kind === "counter" || kind === "pcCounter" ? COUNTER.height : FURNITURE_SPEC[kind].height, 1);
    if (isLow(kind)) expect(out.tall.empty && out.glass.empty && out.glow.empty).toBe(true);
    else expect(out.low.empty && out.glassLow.empty && out.glowLow.empty).toBe(true);
  });

  it('gives the healing machine six cradles and a lit panel', () => {
    const out = newOut(); SERVICE_GENERATORS.healer!(piece('healer'), out, 'medium');
    expect(out.glow.empty).toBe(false);
    expect(countClusters(out.tall, [0.85, 0.15, 0.15])).toBe(6);       // six red ball halves (sRGB; the helper compares lin())
    expect(BALL_RED).toEqual([0.85, 0.15, 0.15]);
  });

  it('lights the computer screen in the low glow (it never fades)', () => {
    const out = run(SERVICE_GENERATORS, 'pc');
    expect(out.glowLow.empty).toBe(false); expect(out.glow.empty).toBe(true);
  });

  it('follows an L-shaped counter cell by cell', () => {
    const L = piece('pcCounter', { xy: [[2, 4], [3, 4], [3, 5]], cellFeet: [fitFurniture('pcCounter', 2, 2, 4, 4, 0, -Infinity),
      fitFurniture('pcCounter', 3, 3, 4, 4, 0, -Infinity), fitFurniture('pcCounter', 3, 3, 5, 5, 0, -Infinity)] });
    const out = newOut(); SERVICE_GENERATORS.pcCounter!(L, out, 'medium');
    const p = out.low.geometry().getAttribute('position');
    for (let i = 0; i < p.count; i++) expect(p.getX(i) < 3 - 1e-3 && p.getZ(i) > 5 + 1e-3).toBe(false);   // nothing over (2, 5)
  });

  it('builds a counter ring (Dept Store) round its walkable cells, its sides reaching the bar', () => {
    // ∩: the bar on row 5 (x 6..11), the sides down x 6 and x 11 to row 7; cells (7..10, 6..7) are walkable floor
    const xy: [number, number][] = [[6, 5], [7, 5], [8, 5], [9, 5], [10, 5], [11, 5], [6, 6], [11, 6], [6, 7], [11, 7]];
    const ring = piece('counter', { xy, cellFeet: xy.map(([x, y]) => fitFurniture('counter', x, x, y, y, 0, -Infinity)),
      foot: fitFurniture('counter', 6, 11, 5, 7, 0, -Infinity) });
    const out = newOut(); SERVICE_GENERATORS.counter!(ring, out, 'medium');
    const p = out.low.geometry().getAttribute('position');
    let sideAt6 = false;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      expect(x > 7 + 1e-3 && x < 11 - 1e-3 && z > 6 + 1e-3).toBe(false);        // nothing over the enclosed floor
      if (x < 7 && Math.abs(z - 6) < 1e-6) sideAt6 = true;                       // the west side meets the bar
    }
    expect(sideAt6).toBe(true);
    expect(boxOf(out).max.z).toBeCloseTo(8, 6);                                  // the sides run down to row 7
  });

  it('keeps the nurse counter low and its bar clear of her feet (she reads from the chest up)', () => {
    // Pokémon Center 1F: the U (arms x 4 and 8..9 down from the wall, bar on row 3); the nurse stands at (7, 2), feet at z 3
    const xy: [number, number][] = [[4, 1], [9, 1], [4, 2], [8, 2], [9, 2], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3]];
    const wallZ = 1.5 + 0.03;
    const u = piece("pcCounter", { xy, cells: xy.map((_, i) => i), cellFeet: xy.map(([x, y]) => fitFurniture("pcCounter", x, x, y, y, 0, wallZ)),
      foot: fitFurniture("pcCounter", 4, 9, 1, 3, 0, wallZ) });
    const out = newOut(); SERVICE_GENERATORS.pcCounter!(u, out, "medium");
    const p = out.low.geometry().getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      expect(p.getY(i)).toBeLessThanOrEqual(0.9 + 1e-6);
      if (p.getX(i) > 5 + 1e-3 && p.getX(i) < 8 - 1e-3) expect(p.getZ(i)).toBeGreaterThanOrEqual(3.25);   // in front of the nurse: only the bar
    }
  });

  it('turns a Mart shelf cut by the wall into a one-sided wall unit', () => {
    const wall = piece('martShelf', { foot: { ...piece('martShelf').foot, z0: 5.59 } });
    expect(againstWall(piece('martShelf'))).toBe(false); expect(againstWall(wall)).toBe(true);
    const b = boxOf(run(SERVICE_GENERATORS, 'martShelf', 'medium', { foot: wall.foot }));
    expect(b.min.z).toBeGreaterThanOrEqual(5.59 - 1e-3); expect(b.max.y).toBeCloseTo(1.6, 3);
    expect(hashOut(run(SERVICE_GENERATORS, 'martShelf'))).toBe(hashOut(run(SERVICE_GENERATORS, 'martShelf')));
    expect(tris(run(SERVICE_GENERATORS, 'martShelf', 'low'))).toBeLessThan(tris(run(SERVICE_GENERATORS, 'martShelf', 'high')));
  });

  it('climbs the stairs into the wall and sinks the stairwell under the floor', () => {
    const up = boxOf(run(SERVICE_GENERATORS, 'stairsUp')), down = boxOf(run(SERVICE_GENERATORS, 'stairsDown'));
    expect(up.max.y).toBeCloseTo(1.6, 1); expect(down.min.y).toBeLessThan(-0.5);
  });

  it('reaches the flight up into the recess and the stairwell over its whole cells', () => {
    const one = { xy: [[2, 1]] as [number, number][], cells: [0], facing: 'S' as const };
    const foot = fitFurniture('stairsUp', 2, 2, 1, 1, 0, 0.5 + 0.03);
    const up = piece('stairsUp', { ...one, foot, cellFeet: [{ ...foot, height: 0.45 }] });
    expect(flightDir(up)).toBe('N');
    const b = boxOf(run(SERVICE_GENERATORS, 'stairsUp', 'medium', up));
    expect(b.min.z).toBeCloseTo(foot.z0 - RECESS, 6); expect(b.max.y).toBeCloseTo(1.6, 1);
    const dfoot = fitFurniture('stairsDown', 2, 2, 1, 1, 0, 0.53);
    const down = piece('stairsDown', { ...one, foot: dfoot, cellFeet: [dfoot] });
    expect(cellsArea(down)).toEqual({ x0: 2, x1: 3, z0: 1, z1: 2, y: 0 });
    const d = boxOf(run(SERVICE_GENERATORS, 'stairsDown', 'medium', down));
    expect(d.min.x).toBeCloseTo(2, 6); expect(d.max.x).toBeCloseTo(3, 6); expect(d.min.z).toBeCloseTo(1, 6); expect(d.max.z).toBeCloseTo(2, 6);
  });
});
