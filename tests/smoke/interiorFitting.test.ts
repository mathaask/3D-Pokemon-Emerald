// The furniture fitting rules on the real maps (Phase 4 final review C, I1; needs the ROM): every in-scope interior
// (interiorScope, 137 maps) extracted as World.build runs the interior families (margin 14, floors flattened), each
// furniture piece built on its own by the real generators (index.ts' composition) at every quality, and its triangles
// clipped to the cells under them. Pins the walkable-furniture ruling on the generated geometry, not only on the
// footprints (furniture.ts: WALKABLE_SEAT):
//   (a) over every walkable cell a non-stairs piece owns, no furniture triangle rises above floorY + WALKABLE_SEAT (the
//       stairs' own cells are ruled out: the player climbs them, the stairwell's rail stands on its warp cell);
//   (b) no furniture triangle stands over a walkable cell no piece owns (a model never spills onto free floor);
//   and the footprints that drive them: a walkable cell's own footprint, and a whole non-stairs piece on walkable
//   cells, are at most WALKABLE_SEAT high.
//   npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/interiorFitting.test.ts

import { describe, it, expect } from 'vitest';
import { loadRom, loadStaticMap } from './helpers/staticMap';
import { analyze, K, type MapAnalysis } from '../../src/render/overworld/analyze';
import { flattenFloors } from '../../src/render/overworld/world';
import { RomReader } from '../../src/game/rom/reader';
import { loadAllMaps } from '../../src/game/rom/maps';
import { extractAll } from '../../src/render/kit/semantics';
import { gridEvents } from '../../src/render/kit/events';
import { INTERIOR_FAMILIES } from '../../src/render/kit/interior/index';
import { interiorScope } from '../../src/render/kit/interior/scope';
import { HOME_GENERATORS } from '../../src/render/kit/interior/furnitureHome';
import { SERVICE_GENERATORS } from '../../src/render/kit/interior/furnitureService';
import {
  newFurnitureOut, WALKABLE_SEAT, type FurnitureGenerator, type FurniturePiece,
} from '../../src/render/kit/interior/furniture';
import type { FurnitureKind } from '../../src/render/kit/tables/building';
import type { Quality } from '../../src/render/post';

/** The world's margin (World.margin). */
const MARGIN = 14;
/** A triangle must reach this far into a cell to stand over it: geometry ending on a cell's edge (a bed's side on the
 *  line between its blocked foot and its walkable head) does not. */
const INSET = 0.01;
/** Height slack (float rounding). */
const EPS = 1e-4;
const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];
const GENERATORS: Partial<Record<FurnitureKind, FurnitureGenerator>> = { ...HOME_GENERATORS, ...SERVICE_GENERATORS };
const STAIRS: ReadonlySet<FurnitureKind> = new Set<FurnitureKind>(['stairsUp', 'stairsDown']);

/** As furniture.ts: room material the player can stand on (a walkable cell, a Sootopolis 0x3FF floor block included). */
const walkable = (a: MapAnalysis, i: number) => (a.kind[i] !== K.Void ? a.col[i] === 0 : a.real3ff[i] === 1);
/** As furniture.ts: the floor height under cell i. */
function floorAt(a: MapAnalysis, i: number): number {
  const h = a.kind[i] === K.Floor ? a.height[i] : a.groundH[i];
  return Number.isNaN(h) ? 0 : Math.max(0, h);
}

interface Scoped { key: string; name: string; a: MapAnalysis; pieces: FurniturePiece[] }

function loadInScope(): Scoped[] {
  const out: Scoped[] = [];
  for (const m of loadAllMaps(new RomReader(loadRom()))) {
    const s = loadStaticMap(m.group, m.num);
    const key = `${m.group}.${m.num}`;
    if (!interiorScope(s.opts, key)) continue;
    const a = analyze(s.grid, { ...s.opts, margin: MARGIN });
    flattenFloors(a);
    const ex = extractAll({ a, events: gridEvents(s.map.events, 0), quality: 'medium' }, INTERIOR_FAMILIES);
    out.push({ key, name: s.map.name, a, pieces: (ex.payloads.get('furniture') ?? []) as FurniturePiece[] });
  }
  return out;
}

/** The highest point of triangle (p, q, r) over the rectangle x [x0, x1] × z [z0, z1] (Sutherland–Hodgman in the
 *  xz plane, y carried along), or −Infinity when it does not reach in. A vertical triangle clips to a segment. */
function topOver(t: ArrayLike<number>, x0: number, x1: number, z0: number, z1: number): number {
  let poly: number[][] = [[t[0], t[1], t[2]], [t[3], t[4], t[5]], [t[6], t[7], t[8]]];
  const clip = (axis: 0 | 2, v: number, keepAbove: boolean) => {
    const res: number[][] = [];
    const inn = (p: number[]) => (keepAbove ? p[axis] >= v : p[axis] <= v);
    for (let k = 0; k < poly.length; k++) {
      const A = poly[k], B = poly[(k + 1) % poly.length], ia = inn(A), ib = inn(B);
      if (ia) res.push(A);
      if (ia !== ib) {
        const s = (v - A[axis]) / (B[axis] - A[axis]);
        res.push([A[0] + (B[0] - A[0]) * s, A[1] + (B[1] - A[1]) * s, A[2] + (B[2] - A[2]) * s]);
      }
    }
    poly = res;
  };
  clip(0, x0, true); if (poly.length) clip(0, x1, false);
  if (poly.length) clip(2, z0, true); if (poly.length) clip(2, z1, false);
  return poly.length ? Math.max(...poly.map((p) => p[1])) : -Infinity;
}

/** A piece's triangles (all four soups), built on its own: 9 floats each. */
function trianglesOf(p: FurniturePiece, q: Quality): Float32Array[] {
  const out = newFurnitureOut();
  GENERATORS[p.kind]!(p, out, q);
  const tris: Float32Array[] = [];
  for (const s of [out.tall, out.low, out.glow, out.glowLow]) {
    if (s.empty) continue;
    const g = s.geometry(), pos = g.getAttribute('position').array as Float32Array;
    for (let k = 0; k + 9 <= pos.length; k += 9) tris.push(pos.subarray(k, k + 9));
    g.dispose();
  }
  return tris;
}

/** The fitting violations of one map at one quality. */
function violations(m: Scoped, q: Quality): string[] {
  const { a } = m;
  const owner = new Map<number, FurniturePiece>();
  for (const p of m.pieces) for (const c of p.cells) owner.set(c, p);
  let maxH = 0;
  for (let i = 0; i < a.N; i++) maxH = Math.max(maxH, floorAt(a, i));
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const p of m.pieces) {
    for (const t of trianglesOf(p, q)) {
      const tx0 = Math.min(t[0], t[3], t[6]), tx1 = Math.max(t[0], t[3], t[6]);
      const tz0 = Math.min(t[2], t[5], t[8]), tz1 = Math.max(t[2], t[5], t[8]);
      // cell (x, y) on floor h covers x [x, x + 1], z [y + h, y + 1 + h]
      for (let x = Math.floor(tx0); x <= Math.floor(tx1); x++) {
        for (let y = Math.floor(tz0 - maxH); y <= Math.floor(tz1); y++) {
          if (!a.inside(x, y)) continue;
          const i = a.idx(x, y);
          if (!walkable(a, i)) continue;
          const o = owner.get(i);
          if (o && STAIRS.has(o.kind)) continue;               // the stairs' own cells: climbed (ruled)
          const h = floorAt(a, i);
          const top = topOver(t, x + INSET, x + 1 - INSET, y + h + INSET, y + 1 + h - INSET);
          if (top === -Infinity) continue;
          const tag = `${m.key} ${q} ${p.kind}@${p.xy[0].join(',')} over (${x},${y})`;
          if (!o) {
            if (!seen.has(tag + ' free')) { seen.add(tag + ' free'); bad.push(`${tag}: a free walkable cell (top ${(top - h).toFixed(3)})`); }
          } else if (top > h + WALKABLE_SEAT + EPS && !seen.has(tag)) {
            seen.add(tag);
            bad.push(`${tag} (${o.kind}'s): top ${(top - h).toFixed(3)} > ${WALKABLE_SEAT}`);
          }
        }
      }
    }
  }
  return bad;
}

const IN_SCOPE: Scoped[] = loadInScope();

describe('furniture fitting on the real maps', () => {
  it('reads every in-scope map and its pieces', () => {
    expect(IN_SCOPE).toHaveLength(137);
    expect(IN_SCOPE.reduce((n, m) => n + m.pieces.length, 0)).toBeGreaterThan(1000);   // (1272 at the final review)
    // (the rules below bite: walkable cells under pieces other than stairs exist on many maps)
    const walkableOwned = IN_SCOPE.reduce((n, m) => n + m.pieces.filter((p) => !STAIRS.has(p.kind))
      .reduce((k, p) => k + p.cells.filter((c) => walkable(m.a, c)).length, 0), 0);
    expect(walkableOwned).toBeGreaterThan(100);
  });

  it('caps the footprints on walkable cells at WALKABLE_SEAT', () => {
    const bad: string[] = [];
    for (const m of IN_SCOPE) {
      for (const p of m.pieces) {
        if (STAIRS.has(p.kind)) continue;
        p.cells.forEach((c, k) => {
          if (walkable(m.a, c) && p.cellFeet[k].height > WALKABLE_SEAT) bad.push(`${m.key} ${p.kind}@${p.xy[k].join(',')}: ${p.cellFeet[k].height}`);
        });
        if (p.cells.every((c) => walkable(m.a, c)) && p.foot.height > WALKABLE_SEAT) bad.push(`${m.key} ${p.kind}@${p.xy[0].join(',')}: foot ${p.foot.height}`);
      }
    }
    expect(bad).toEqual([]);
  });

  for (const q of QUALITIES) {
    it(`builds no furniture above WALKABLE_SEAT over a walkable cell, nor any over free walkable floor (${q})`, () => {
      const bad = IN_SCOPE.flatMap((m) => violations(m, q));
      expect(bad.slice(0, 40), `${bad.length} violations`).toEqual([]);
    });
  }
});
