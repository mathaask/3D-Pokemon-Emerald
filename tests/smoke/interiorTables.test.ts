// Interior id tables on the real maps (needs the ROM): the in-scope interiors (D1; Phase 4b's 45 maps with the 4b scope
// on), each table's coverage of its own maps' cells, its pins, its agreement with the interaction behaviours, and the
// curators' worklists:
//   out/interior-ids.txt     per Phase 4 tileset, per metatile id used on its maps' in-map non-void cells: hex id, cells,
//                            maps (count and the first few), behaviour, layer type, blocked share, current label
//                            (`-` = unlabelled)
//   out/interior-ids-4b.txt  the same for Phase 4b's 23 tilesets, on their listed maps (the 4b scope on)
//   out/live-ids.txt         per Phase 4b tileset, every id the game writes at runtime on its maps (helpers/liveIds.ts:
//                            the maps' scripts.inc, the ROM's script bytecode with the shared scripts, the C files, and the
//                            *Door* / *Open* / *Closed* labels as suspected), with its collision and its current label
//   (the first run also copies the 4b ones to out/interior-ids-4b.task2.txt / out/live-ids.task2.txt: the fixed worklists
//   of the curators, Task 4; delete them to take them again)
//   npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/interiorTables.test.ts

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadRom, loadStaticMap, type StaticMap } from './helpers/staticMap';
import { liveIdsOf, type LiveId } from './helpers/liveIds';
import { scriptEdits } from '../../tools/lib/decompEdits';
import { analyze, K, type MapAnalysis } from '../../src/render/overworld/analyze';
import { RomReader } from '../../src/game/rom/reader';
import { loadAllMaps } from '../../src/game/rom/maps';
import { behaviorName, LAYER_TYPE_NAMES } from '../../src/game/rom/tileset';
import { MB } from '../../src/game/behaviors';
import { SYM } from '../../src/game/symbols';
import {
  BEHAVIOR_IDS, BUILDING_PRIMARY, INTERIOR_TABLES, interiorIds, type InteriorId, type InteriorTable,
} from '../../src/render/kit/tables/building';
import { interiorScope, setPhase4bScope, PHASE4B_DEFAULT, PHASE4B_MAPS } from '../../src/render/kit/interior/scope';

const OUT = path.resolve(import.meta.dirname, '../../out');

/** Behaviours whose cells are exactly their `BEHAVIOR_IDS` kind: a table labels them that kind or leaves them unlabelled. */
const STRICT = new Set<number>([MB.TELEVISION, MB.PC, MB.BOOKSHELF, MB.PICTURE_BOOK_SHELF, MB.POKEMON_CENTER_BOOKSHELF, MB.SHOP_SHELF]);

/** The ROM script walk misses these maps' `setmetatile` lines of scripts.inc, and rightly: no event, map script or
 *  branch of the ROM reaches them (Ruby/Sapphire leftovers; Task 1's Mossdeep / Trick House 7 finding). Count per map. */
const UNREACHED: Readonly<Record<string, number>> = { '14.0': 8, '29.9': 10 };

interface Room { key: string; name: string; s: StaticMap; a: MapAnalysis }

const tilesetName = new Map<number, string>(Object.entries(SYM).filter(([k]) => k.startsWith('gTileset_'))
  .map(([k, v]) => [v as number, k.slice('gTileset_'.length)]));

/** Whether a table labels id `m` itself (its secondary ids; below 512 the Building primary, or its own `ids` on another
 *  primary): the behaviour fallback does not count. */
const tableLabel = (t: InteriorTable, m: number): InteriorId | undefined =>
  (m >= 512 || (t.primary !== undefined && t.primary !== SYM.gTileset_Building) ? t.ids.get(m) : BUILDING_PRIMARY.get(m));

/** Map-local in-map non-void cells of an analysis built with margin 0. */
function* roomCells(a: MapAnalysis): Generator<number> {
  for (let i = 0; i < a.N; i++) if (a.kind[i] !== K.Void) yield i;
}

const rom = new RomReader(loadRom());
let all: { key: string; name: string; s: StaticMap }[] | null = null;
const analyses = new Map<string, MapAnalysis>();
/** The in-scope interiors with the 4b scope off (Phase 4's 137) or on (182). */
function inScope(phase4b: boolean): Room[] {
  all ??= loadAllMaps(rom).map((m) => ({ key: `${m.group}.${m.num}`, name: m.name, s: loadStaticMap(m.group, m.num) }));
  setPhase4bScope(phase4b);
  try {
    return all.filter((m) => interiorScope(m.s.opts, m.key)).map((m) => {
      let a = analyses.get(m.key);
      if (!a) analyses.set(m.key, a = analyze(m.s.grid, { ...m.s.opts, margin: 0 }));
      return { ...m, a };
    });
  } finally {
    setPhase4bScope(PHASE4B_DEFAULT);
  }
}
afterAll(() => setPhase4bScope(PHASE4B_DEFAULT));

interface IdUse { cells: number; blocked: number; maps: string[]; beh: number; layer: number }

/** A table's own rooms: its tileset's in-scope maps (those it lists, if it lists any). */
const ownRooms = (rooms: Room[], addr: number, t: InteriorTable) =>
  rooms.filter((r) => r.s.opts.secondaryTileset === addr && (!t.maps || t.maps.includes(r.key)));

/** Checks one table on its own rooms (target, pins, behaviours) and appends its worklist section to `lines`. */
function checkTable(addr: number, t: InteriorTable, rooms: Room[], lines: string[], contradictions: string[]): void {
  const own = ownRooms(rooms, addr, t);
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
    const key = `${p.map[0]}.${p.map[1]}`, r = own.find((q) => q.key === key);
    const at = `${t.name} pin ${p.map.join('.')} ${p.x},${p.y}`;
    expect(r, `${at}: an in-scope map of this table`).toBeDefined();
    expect(interiorIds(r!.a, key)[r!.a.idx(p.x, p.y)], at).toBe(p.id);
  }
}

/** Writes `file` to out/, and the curators' fixed copy `<file>.task2.txt` beside it the first time. */
function writeWorklist(file: string, lines: string[]): void {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, file), lines.join('\n'));
  const copy = path.join(OUT, file.replace(/\.txt$/, '.task2.txt'));
  if (!fs.existsSync(copy)) fs.writeFileSync(copy, lines.join('\n'));
}

describe('interior id tables on the real maps', () => {
  it('scopes 137 interiors: the houses, Pokémon Centers, Marts and labs, not the gyms or the Dept Store rooftop', () => {
    const keys = inScope(false).map((r) => r.key);
    expect(keys.length).toBe(137);
    expect(keys).not.toContain('13.21');                             // Dept Store rooftop (OUT_OF_SCOPE_MAPS)
    for (const k of ['1.0', '2.0', '2.2', '2.4', '1.4']) expect(keys, k).toContain(k);    // (2.0: a GenericBuilding house)
    for (const k of ['8.1', '25.0', '25.40']) expect(keys, k).not.toContain(k);    // Petalburg Gym, a secret base, the truck
  });

  it('scopes 182 with the 4b scope on: the 45 maps of D1, not the link rooms, the Frontier or the contest lobby', () => {
    const keys = inScope(true).map((r) => r.key);
    expect(keys.length).toBe(182);
    for (const k of PHASE4B_MAPS.keys()) expect(keys, k).toContain(k);
    for (const k of ['25.24', '25.25', '25.26', '25.27', '25.60', '13.4', '13.21', '24.53', '27.1', '11.1']) expect(keys, k).not.toContain(k);
    const p4 = new Set(inScope(false).map((r) => r.key));
    expect(p4.size).toBe(137);                                       // (and off again)
    expect(keys.filter((k) => !p4.has(k)).sort()).toEqual([...PHASE4B_MAPS.keys()].sort());   // exactly the 45 added
    // (no Battle Frontier map comes in: its 26.* in scope are Phase 4's Pokémon Center and houses)
    expect(keys.filter((k) => k.startsWith('26.') && !p4.has(k))).toEqual([]);
  });

  it('labels each tileset to its target on its own maps, agrees with the interaction behaviours, reads its pins; writes the worklists', () => {
    const rooms = inScope(true);
    const head = (what: string) => [
      `Interior id worklist (tests/smoke/interiorTables.test.ts): per ${what} tileset, every metatile id on its maps'`,
      'in-map non-void cells. table = labelled by the secondary table or the Building primary (legacy included);',
      'fallback = unlabelled, given a kind by its behaviour (BEHAVIOR_IDS); label - = unlabelled.',
      '',
    ];
    const p4 = head('Phase 4 in-scope'), p4b = head('Phase 4b (the 4b scope on: each table on its listed maps)');
    const contradictions: string[] = [];
    for (const [addr, t] of INTERIOR_TABLES) checkTable(addr, t, rooms, t.maps ? p4b : p4, contradictions);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'interior-ids.txt'), p4.join('\n'));
    writeWorklist('interior-ids-4b.txt', p4b);
    expect(contradictions).toEqual([]);
  });

  it('lists every id the game writes at runtime on the 4b maps (scripts, the ROM\'s shared scripts, C files); writes the live-id worklist', () => {
    const rooms = inScope(true);
    const lines = [
      'Live-id worklist (tests/smoke/interiorTables.test.ts, helpers/liveIds.ts): per Phase 4b tileset, every metatile id the',
      'game writes at runtime on its maps. Every one must be a mechanic (a `puzzle` entry, its kind in `ids`) or inert',
      '(legacy / unlabelled, no interaction behaviour). sources: scripts.inc = the map\'s own setmetatile lines; rom = a',
      'setmetatile the ROM\'s script bytecode reaches from the map\'s scripts and events, shared scripts included (a static',
      'walk: a flag-gated branch the game never takes counts too, e.g. Mossdeep\'s and Trick House 7\'s R/S arrow lists);',
      'scripts.inc without rom = no script of the ROM reaches it (dead); src/<file>.c = written by C code; suspected = a',
      '*Door* / *Open* / *Closed* label of the tileset no other source names (F15). blocked = the collision a script sets',
      'it with (TRUE blocked / FALSE / both; - none names it).',
      '',
    ];
    let total = 0;
    for (const [addr, t] of INTERIOR_TABLES) {
      if (!t.maps) continue;
      const own = ownRooms(rooms, addr, t);
      const ts = tilesetName.get(addr)!, primary = tilesetName.get(t.primary ?? SYM.gTileset_Building)!;
      const { ids, walks } = liveIdsOf(rom, ts, own.map((r) => ({ key: r.key, map: r.s.map })), primary);
      for (const [key, w] of walks) expect([...w.unknownOps.keys()], `${key}: script commands the walk could not decode`).toEqual([]);
      const live = [...ids.values()].sort((p, q) => p.id - q.id);
      total += live.length;
      const scripted = live.filter((l) => l.sources.has('scripts.inc') || l.sources.has('rom')).length;
      lines.push(`== ${t.name} (0x${addr.toString(16)}): ${own.length} maps (${own.map((r) => r.key).join(', ')}), ${live.length} live ids `
        + `(${scripted} set by scripts, ${live.length - scripted} by C code or suspected)`);
      lines.push(`id     ${'label'.padEnd(49)}  ${'sources'.padEnd(38)}  blocked  ${'maps'.padEnd(14)}  ${'cells (first)'.padEnd(37)}  label now`);
      for (const l of live) lines.push(liveLine(t, l));
      lines.push('');
    }
    writeWorklist('live-ids.txt', lines);
    expect(total).toBeGreaterThan(0);
  });

  it('decodes the ROM\'s scripts: every scripts.inc setmetatile is reached but the unreached R/S leftovers; the E4 doors close by the shared script (F15)', () => {
    for (const [addr, t] of INTERIOR_TABLES) {
      if (!t.maps) continue;
      const own = ownRooms(inScope(true), addr, t);
      const ts = tilesetName.get(addr)!, primary = tilesetName.get(t.primary ?? SYM.gTileset_Building)!;
      const { walks } = liveIdsOf(rom, ts, own.map((r) => ({ key: r.key, map: r.s.map })), primary);
      for (const r of own) {
        const w = walks.get(r.key)!;
        const key = (e: { x: number; y: number; metatile: number; blocked: boolean }) => `${e.x},${e.y},${e.metatile},${e.blocked}`;
        const reached = new Set(w.edits.map(key));
        const local = localEdits(r.name);
        expect(local.filter((e) => !reached.has(key(e))).length, `${r.key} ${r.name}`).toBe(UNREACHED[r.key] ?? 0);
      }
    }
    const e4 = INTERIOR_TABLES.get(SYM.gTileset_EliteFour)!;
    const sidney = ownRooms(inScope(true), SYM.gTileset_EliteFour, e4).find((r) => r.key === '16.0')!;
    const { ids } = liveIdsOf(rom, 'EliteFour', [{ key: '16.0', map: sidney.s.map }]);
    expect(ids.get(0x206)?.sources.has('rom')).toBe(true);           // EntryDoor_ClosedTop, blocked (Task 1's probe: frame 99)
    expect([...ids.get(0x206)!.blocked]).toEqual([true]);
    expect(ids.get(0x20e)?.cells.has('16.0:6,13')).toBe(true);       // EntryDoor_ClosedBottom
  });
});

/** A map's scripts.inc edits (none when it has no scripts.inc of its own). */
const localEdits = (name: string) => {
  try { return scriptEdits(name); } catch { return []; }
};

/** One worklist line: id, label, sources, collision, maps, cells, and what the table labels it now (a mechanic's kind and
 *  state, a plain label, or `-`). */
function liveLine(t: InteriorTable, l: LiveId): string {
  const b = l.blocked.size === 2 ? 'both' : l.blocked.has(true) ? 'TRUE' : l.blocked.has(false) ? 'FALSE' : '-';
  const p = t.puzzle?.get(l.id);
  const now = p ? `${p.kind} state ${p.state} variant ${p.variant}${p.blocked ? ' blocked' : ''} (mechanic)` : (t.ids.get(l.id) ?? '-');
  const maps = [...l.maps];
  return `0x${l.id.toString(16).padStart(3, '0')}  ${(l.label ?? '?').padEnd(49)}  ${[...l.sources].join(',').padEnd(38)}  `
    + `${b.padEnd(7)}  ${(maps.length > 2 ? `${maps.slice(0, 2).join(',')},+${maps.length - 2}` : maps.join(',')).padEnd(14)}  `
    + `${[...l.cells].slice(0, 3).join(' ').padEnd(37)}  ${now}`;
}
