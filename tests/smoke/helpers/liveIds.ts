// The metatile ids the game writes at runtime on the Phase 4b maps (the "live ids" every table must label a mechanic or
// leave inert, Task 4 / Task 14), from four sources:
//   scripts.inc  the map's own `setmetatile` lines (vendor/pokeemerald-src data/maps/<Map>/scripts.inc, decompEdits.ts);
//   rom          the `setmetatile` commands reachable in the ROM's own script bytecode from the map's entry points (map
//                scripts, object events, coord and bg events), following goto / call / branches into the shared scripts
//                too — the vendor checkout has no data/scripts/ (the E4 doors' elite_four.inc), and nothing is downloaded:
//                the ROM is the source. Opcode lengths come from the decomp's own macros (asm/macros/event.inc). A static
//                walk takes every branch, so a flag-gated branch the game never takes counts too (Mossdeep's and Trick
//                House 7's Ruby/Sapphire arrow lists: reached from their map scripts behind flags Emerald never sets);
//   src/<file>.c the METATILE_* names a C file writes (MapGridSetMetatileIdAt; decompEdits.ts cMetatiles), attributed to
//                the tileset whose labels they are (metatile_labels.h's `// gTileset_X` sections), on every map of it;
//   suspected    every label of the tileset named *Door*, *Open* or *Closed* that no other source names (F15: a shared
//                script may write it; the ROM walk reads the shared scripts, so these are mostly other maps' ids).
// A `setmetatile` edit carries its collision (TRUE = blocked), which a mechanic's `PuzzleId.blocked` takes (F38).
// Node only (smoke tests): reads the ROM and vendor/pokeemerald-src at test time; nothing derived here is committed.

import fs from 'node:fs';
import path from 'node:path';
import type { RomReader } from '../../../src/game/rom/reader';
import type { MapInfo } from '../../../src/game/rom/maps';
import { cMetatiles, scriptEdits, type DecompEdit } from '../../../tools/lib/decompEdits';

const SRC = path.resolve(import.meta.dirname, '../../../vendor/pokeemerald-src');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** One runtime id of a tileset. */
export interface LiveId {
  id: number;
  /** The METATILE_* name (null: an id no label names). */
  label: string | null;
  /** Where it was found: 'scripts.inc', 'rom', 'src/<file>.c', 'suspected'. */
  sources: Set<string>;
  /** The maps ("group.num") it is written on (a C file's or a suspected id: every listed map of the tileset). */
  maps: Set<string>;
  /** The collisions a script sets it with (empty: no script edit names it, e.g. a C file's). */
  blocked: Set<boolean>;
  /** Some edits name it on a cell of the map (map-local x, y), for the curators. */
  cells: Set<string>;
}

/** A map of a tileset: its key ("group.num") and ROM header (decomp name: `map.name`). */
export interface LiveMap { key: string; map: MapInfo }

// ---- metatile_labels.h, by tileset section ----

let sections: Map<string, Map<string, number>> | null = null;
/** Tileset name (without gTileset_) → its METATILE_* labels → ids, from metatile_labels.h's `// gTileset_X` sections. */
export function labelSections(): ReadonlyMap<string, ReadonlyMap<string, number>> {
  if (sections) return sections;
  sections = new Map();
  let cur: Map<string, number> | null = null;
  for (const line of read('include/constants/metatile_labels.h').split(/\r?\n/)) {
    const h = /^\/\/\s*gTileset_(\w+)/.exec(line);
    if (h) { sections.set(h[1], cur = new Map()); continue; }
    if (/^\/\/\s*Other/.test(line)) { cur = null; continue; }
    const d = /^#define\s+(METATILE_\w+)\s+(0x[0-9A-Fa-f]+|\d+)/.exec(line);
    if (d && cur) cur.set(d[1], Number(d[2]));
  }
  return sections;
}

/** The label of id `m` on a map of `tileset` (null: none): its section's, else the Ruby/Sapphire leftovers' (RS<tileset>:
 *  Mossdeep's dead arrow scripts), else, below 512, the primary's (`primary`, e.g. Building). */
export function labelOf(tileset: string, m: number, primary = 'Building'): string | null {
  for (const s of [tileset, `RS${tileset}`, ...(m < 512 ? [primary] : [])]) {
    for (const [n, id] of labelSections().get(s) ?? []) if (id === m) return n;
  }
  return null;
}

// ---- the ROM's script bytecode ----

const OP = { END: 0x02, RETURN: 0x03, CALL: 0x04, GOTO: 0x05, GOTO_IF: 0x06, CALL_IF: 0x07, GOTO_STD: 0x08,
  CALL_STD: 0x09, GOTO_STD_IF: 0x0a, CALL_STD_IF: 0x0b, RETURN_RAM: 0x0c, KILL_SCRIPT: 0x0d, TRAINER_BATTLE: 0x5c,
  SET_METATILE: 0xa2 } as const;

let opLengths: Map<number, number> | null = null;
/** Script opcode → its command's length in bytes (opcode included), from data/script_cmd_table.inc (the opcode order) and
 *  asm/macros/event.inc (each `.byte SCR_OP_X` and the data directives after it; helper macros `map` 2, `formatwarp` 7,
 *  `stringvar` 1). `trainerbattle` (variable) is decoded by type. An opcode two macros give different lengths is left
 *  out (the walk stops there, counted as unknown). */
export function scriptOpLengths(): ReadonlyMap<number, number> {
  if (opLengths) return opLengths;
  const index = new Map<string, number>();
  for (const m of read('data/script_cmd_table.inc').matchAll(/script_cmd_table_entry\s+(SCR_OP_\w+)/g)) index.set(m[1], index.size);
  const seen = new Map<string, Set<number>>();
  let cur: { op: string; len: number } | null = null;
  const done = () => { if (cur) (seen.get(cur.op) ?? seen.set(cur.op, new Set()).get(cur.op)!).add(cur.len); cur = null; };
  for (const raw of read('asm/macros/event.inc').split(/\r?\n/)) {
    const line = raw.replace(/@.*$/, '').trim();
    const op = /^\.byte\s+(SCR_OP_\w+)\s*$/.exec(line);
    if (op) { done(); cur = { op: op[1], len: 1 }; continue; }
    if (!cur) continue;
    const d = /^\.(byte|2byte|4byte)\s+(.+)$/.exec(line);
    if (d) { cur.len += { byte: 1, '2byte': 2, '4byte': 4 }[d[1] as 'byte' | '2byte' | '4byte'] * d[2].split(',').length; continue; }
    const helper = /^(map|formatwarp|stringvar)\b/.exec(line);
    if (helper) { cur.len += { map: 2, formatwarp: 7, stringvar: 1 }[helper[1] as 'map' | 'formatwarp' | 'stringvar']; continue; }
    done();
  }
  done();
  opLengths = new Map();
  for (const [name, lens] of seen) {
    const n = index.get(name);
    if (n !== undefined && lens.size === 1) opLengths.set(n, [...lens][0]);
  }
  return opLengths;
}

/** trainerbattle's pointers per type (TRAINER_BATTLE_*), and which of them is an event script (0-based; -1 none). */
const TRAINER_POINTERS: Readonly<Record<number, [number, number]>> = {
  0: [2, -1], 1: [3, 2], 2: [3, 2], 3: [1, -1], 4: [3, -1], 5: [2, -1], 6: [4, 3], 7: [3, -1], 8: [4, 3], 9: [2, -1],
  10: [2, -1], 11: [2, -1], 12: [2, -1],
};

/** What a walk of the ROM's scripts found: the constant `setmetatile` edits, and the commands it could not decode. */
export interface RomWalk { edits: DecompEdit[]; unknownOps: Map<number, number>; scripts: number }

/** Every script a map can start (map scripts and their var tables, object events, coord events, bg events), walked
 *  through every branch; each `setmetatile` with constant arguments (not a VAR_ / 0x4000+) is an edit. */
export function romScriptEdits(rom: RomReader, map: MapInfo, tileset: string, primary = 'Building'): RomWalk {
  const lens = scriptOpLengths();
  const starts: number[] = [];
  const add = (p: number | undefined) => { if (p && rom.isRomPtr(p)) starts.push(p >>> 0); };
  if (rom.isRomPtr(map.scriptsAddr)) {
    for (let a = map.scriptsAddr >>> 0; ; a += 5) {
      const type = rom.u8(a);
      if (type === 0) break;
      const p = rom.u32(a + 1);
      if (type === 2 || type === 4) {          // MAP_SCRIPT_ON_FRAME_TABLE / ON_WARP_INTO_MAP_TABLE: (var, value, script)…
        if (!rom.isRomPtr(p)) continue;
        for (let t = p >>> 0; rom.u16(t) !== 0; t += 8) add(rom.u32(t + 4));
      } else add(p);
    }
  }
  for (const o of map.events.objects) add(o.script);
  for (const c of map.events.coordEvents) add(c.script);
  for (const b of map.events.bgEvents) add(b.script);

  const visited = new Set<number>(), edits: DecompEdit[] = [], unknownOps = new Map<number, number>();
  const queue = [...starts];
  while (queue.length) {
    let pc = queue.pop()!;
    while (rom.isRomPtr(pc) && !visited.has(pc)) {
      visited.add(pc);
      const op = rom.u8(pc);
      if (op === OP.END || op === OP.RETURN || op === OP.RETURN_RAM || op === OP.KILL_SCRIPT || op === OP.GOTO_STD) break;
      if (op === OP.GOTO) { queue.push(rom.u32(pc + 1) >>> 0); break; }
      if (op === OP.CALL) { queue.push(rom.u32(pc + 1) >>> 0); pc += 5; continue; }
      if (op === OP.GOTO_IF || op === OP.CALL_IF) { queue.push(rom.u32(pc + 2) >>> 0); pc += 6; continue; }
      if (op === OP.TRAINER_BATTLE) {
        const spec = TRAINER_POINTERS[rom.u8(pc + 1)];
        if (!spec) { unknownOps.set(op, (unknownOps.get(op) ?? 0) + 1); break; }
        if (spec[1] >= 0) queue.push(rom.u32(pc + 6 + 4 * spec[1]) >>> 0);
        pc += 6 + 4 * spec[0];
        continue;
      }
      if (op === OP.SET_METATILE) {
        const x = rom.u16(pc + 1), y = rom.u16(pc + 3), m = rom.u16(pc + 5), imp = rom.u16(pc + 7);
        if (x < 0x4000 && y < 0x4000 && m < 0x4000 && imp < 0x4000) {
          edits.push({ x, y, metatile: m & 0x3ff, blocked: imp !== 0, label: labelOf(tileset, m & 0x3ff, primary) ?? '' });
        }
      }
      const n = lens.get(op);
      if (n === undefined) { unknownOps.set(op, (unknownOps.get(op) ?? 0) + 1); break; }
      pc += n;
    }
  }
  return { edits, unknownOps, scripts: starts.length };
}

// ---- the worklist ----

let cFiles: Map<string, ReadonlyMap<string, number>> | null = null;
/** Every src/*.c that calls MapGridSetMetatileIdAt → the METATILE_* names it writes (cMetatiles). */
function cWrites(): ReadonlyMap<string, ReadonlyMap<string, number>> {
  if (cFiles) return cFiles;
  cFiles = new Map();
  for (const f of fs.readdirSync(path.join(SRC, 'src')).filter((n) => n.endsWith('.c')).sort()) {
    if (!read(`src/${f}`).includes('MapGridSetMetatileIdAt')) continue;
    cFiles.set(f, cMetatiles(f));
  }
  return cFiles;
}

/** The live ids of one tileset (`tileset`: its name without gTileset_) on its maps, by id. */
export function liveIdsOf(rom: RomReader, tileset: string, maps: readonly LiveMap[], primary = 'Building'): { ids: Map<number, LiveId>; walks: Map<string, RomWalk> } {
  const ids = new Map<number, LiveId>();
  const get = (m: number, label: string | null) => {
    let e = ids.get(m);
    if (!e) ids.set(m, e = { id: m, label, sources: new Set(), maps: new Set(), blocked: new Set(), cells: new Set() });
    if (!e.label && label) e.label = label;
    return e;
  };
  const allMaps = maps.map((m) => m.key);
  const walks = new Map<string, RomWalk>();
  for (const { key, map } of maps) {
    const local = fs.existsSync(path.join(SRC, `data/maps/${map.name}/scripts.inc`)) ? scriptEdits(map.name) : [];
    const walk = romScriptEdits(rom, map, tileset, primary);
    walks.set(key, walk);
    for (const [src, edits] of [['scripts.inc', local], ['rom', walk.edits]] as const) {
      for (const e of edits) {
        const l = get(e.metatile, e.label || labelOf(tileset, e.metatile, primary));
        l.sources.add(src); l.maps.add(key); l.blocked.add(e.blocked); l.cells.add(`${key}:${e.x},${e.y}`);
      }
    }
  }
  const own = labelSections().get(tileset) ?? new Map<string, number>();
  for (const [file, names] of cWrites()) {
    for (const [name, m] of names) {
      if (own.get(name) !== m) continue;
      const l = get(m, name);
      l.sources.add(`src/${file}`);
      for (const k of allMaps) l.maps.add(k);
    }
  }
  for (const [name, m] of own) {
    if (!/Door|Open|Closed/.test(name) || ids.has(m)) continue;   // (only where no script or C file names it)
    const l = get(m, name);
    l.sources.add('suspected');
    for (const k of allMaps) l.maps.add(k);
  }
  return { ids, walks };
}
