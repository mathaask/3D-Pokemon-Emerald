// Interior id tables on the real maps (needs the ROM): the in-scope interiors (D1), each secondary table's coverage of
// its maps' cells, its pins, its agreement with the interaction behaviours, and the curators' worklist:
//   out/interior-ids.txt  per in-scope tileset, per metatile id used on its maps' in-map non-void cells: hex id, cells,
//                         maps (count and the first few), behaviour, layer type, blocked share, current label
//                         (`-` = unlabelled)
//   npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/interiorTables.test.ts

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadRom, loadStaticMap, type StaticMap } from './helpers/staticMap';
import { analyze, K, type MapAnalysis } from '../../src/render/overworld/analyze';
import { RomReader } from '../../src/game/rom/reader';
import { loadAllMaps } from '../../src/game/rom/maps';
import { behaviorName, LAYER_TYPE_NAMES } from '../../src/game/rom/tileset';
import { MB } from '../../src/game/behaviors';
import {
  BEHAVIOR_IDS, BUILDING_PRIMARY, INTERIOR_TABLES, interiorIds, type InteriorId, type InteriorTable,
} from '../../src/render/kit/tables/building';
import { interiorScope } from '../../src/render/kit/interior/scope';

const OUT = path.resolve(import.meta.dirname, '../../out');

/** Behaviours whose cells are exactly their `BEHAVIOR_IDS` kind: a table labels them that kind or leaves them unlabelled. */
const STRICT = new Set<number>([MB.TELEVISION, MB.PC, MB.BOOKSHELF, MB.PICTURE_BOOK_SHELF, MB.POKEMON_CENTER_BOOKSHELF, MB.SHOP_SHELF]);

interface Room { key: string; s: StaticMap; a: MapAnalysis }

/** The label a table gives id `m` (the secondary table for 512+, the Building primary below): the behaviour fallback
 *  does not count. */
const tableLabel = (t: InteriorTable, m: number): InteriorId | undefined => (m >= 512 ? t.ids.get(m) : BUILDING_PRIMARY.get(m));

/** Map-local in-map non-void cells of an analysis built with margin 0. */
function* roomCells(a: MapAnalysis): Generator<number> {
  for (let i = 0; i < a.N; i++) if (a.kind[i] !== K.Void) yield i;
}

let rooms: Room[] | null = null;
function inScope(): Room[] {
  if (rooms) return rooms;
  rooms = [];
  for (const m of loadAllMaps(new RomReader(loadRom()))) {
    const s = loadStaticMap(m.group, m.num);
    if (!interiorScope(s.opts, `${m.group}.${m.num}`)) continue;
    rooms.push({ key: `${m.group}.${m.num}`, s, a: analyze(s.grid, { ...s.opts, margin: 0 }) });
  }
  return rooms;
}

interface IdUse { cells: number; blocked: number; maps: string[]; beh: number; layer: number }

describe('interior id tables on the real maps', () => {
  it('scopes 137 interiors: the houses, Pokémon Centers, Marts and labs, not the gyms or the Dept Store rooftop', () => {
    const keys = inScope().map((r) => r.key);
    expect(keys.length).toBe(137);
    expect(keys).not.toContain('13.21');                             // Dept Store rooftop (OUT_OF_SCOPE_MAPS)
    for (const k of ['1.0', '2.0', '2.2', '2.4', '1.4']) expect(keys, k).toContain(k);    // (2.0: a GenericBuilding house)
    for (const k of ['8.1', '25.0', '25.40']) expect(keys, k).not.toContain(k);    // Petalburg Gym, a secret base, the truck
  });

  it('labels each tileset to its target, agrees with the interaction behaviours, reads its pins; writes the worklist', () => {
    const lines: string[] = [
      'Interior id worklist (tests/smoke/interiorTables.test.ts): per in-scope tileset, every metatile id on its maps\'',
      'in-map non-void cells. table = labelled by the secondary table or the Building primary (legacy included);',
      'fallback = unlabelled, given a kind by its behaviour (BEHAVIOR_IDS); label - = unlabelled.',
      '',
    ];
    const contradictions: string[] = [];
    for (const [addr, t] of INTERIOR_TABLES) {
      const own = inScope().filter((r) => r.s.opts.secondaryTileset === addr);
      const used = new Map<number, IdUse>();
      let cells = 0, labelled = 0, fallback = 0, voids = 0;
      for (const r of own) {
        const a = r.a;
        for (let i = 0; i < a.N; i++) if (a.kind[i] === K.Void) voids++;
        for (const i of roomCells(a)) {
          const m = a.mt[i];
          cells++;
          if (tableLabel(t, m) !== undefined) labelled++;
          else if (BEHAVIOR_IDS.has(a.beh[i])) fallback++;
          let u = used.get(m);
          if (!u) used.set(m, u = { cells: 0, blocked: 0, maps: [], beh: a.beh[i], layer: a.layer[i] });
          u.cells++;
          if (a.col[i]) u.blocked++;
          if (u.maps[u.maps.length - 1] !== r.key) u.maps.push(r.key);
        }
      }
      const pct = (n: number) => `${(100 * n / Math.max(1, cells)).toFixed(1)} %`;
      lines.push(`== ${t.name} (0x${addr.toString(16)}): ${own.length} maps, ${cells} cells (+${voids} void), ${used.size} ids used; `
        + `table ${pct(labelled)} (target ${(100 * t.target).toFixed(0)} %), fallback ${pct(fallback)}, unknown ${pct(cells - labelled - fallback)}`);
      lines.push('id     cells  maps  examples                 behaviour                    layer    blocked  label');
      for (const [m, u] of [...used].sort((p, q) => p[0] - q[0])) {
        const label = tableLabel(t, m);
        lines.push(`0x${m.toString(16).padStart(3, '0')}  ${String(u.cells).padStart(5)}  ${String(u.maps.length).padStart(4)}  `
          + `${u.maps.slice(0, 4).join(',').padEnd(23)}  ${behaviorName(u.beh).padEnd(27)}  ${(LAYER_TYPE_NAMES[u.layer] ?? '?').padEnd(7)}  `
          + `${(100 * u.blocked / u.cells).toFixed(0).padStart(5)} %  ${label ?? '-'}`);
        const kind = BEHAVIOR_IDS.get(u.beh);
        if (STRICT.has(u.beh) && label !== undefined && label !== kind) {
          contradictions.push(`${t.name} 0x${m.toString(16)} ${behaviorName(u.beh)}: ${label}, not ${kind}`);
        }
      }
      lines.push('');
      expect(labelled / Math.max(1, cells), `${t.name}: table-labelled share`).toBeGreaterThanOrEqual(t.target);

      for (const p of t.pins) {
        const r = inScope().find((q) => q.key === `${p.map[0]}.${p.map[1]}`);
        const at = `${t.name} pin ${p.map.join('.')} ${p.x},${p.y}`;
        expect(r?.s.opts.secondaryTileset, `${at}: an in-scope map of this tileset`).toBe(addr);
        expect(interiorIds(r!.a)[r!.a.idx(p.x, p.y)], at).toBe(p.id);
      }
    }
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'interior-ids.txt'), lines.join('\n'));
    expect(contradictions).toEqual([]);
  });
});
