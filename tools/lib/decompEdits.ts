// Runtime metatile edits from the pokeemerald decomp (vendor/pokeemerald-src, gitignored like the ROM): the metatile labels,
// the `setmetatile` lists of a map's scripts and the labels a C file writes with MapGridSetMetatileIdAt. Node only (the
// harness and smoke tests read them at run time; nothing derived here is committed beyond ids and coordinates).
//
// A script's `setmetatile x, y, METATILE_…, TRUE|FALSE` is map-local (ScrCmd_setmetatile adds MAP_OFFSET) and becomes
// MapGridSetMetatileIdAt(x, y, id | (TRUE ? MAPGRID_IMPASSABLE : 0)): the cell keeps its elevation and takes the id and
// the collision of the argument (editRaw).

import fs from 'node:fs';
import path from 'node:path';

/** One cell edit: map-local cell, metatile id, blocked (collision 0x0C00) or not; `label` the METATILE_* name. */
export interface DecompEdit { x: number; y: number; metatile: number; blocked: boolean; label: string }

const SRC = path.resolve(import.meta.dirname, '../../vendor/pokeemerald-src');

function decompFile(rel: string): string {
  if (!fs.existsSync(SRC)) {
    throw new Error(`vendor/pokeemerald-src is missing (the pokeemerald decomp, gitignored like the ROM): needed for ${rel}`);
  }
  const f = path.join(SRC, rel);
  if (!fs.existsSync(f)) throw new Error(`no ${rel} in vendor/pokeemerald-src`);
  return fs.readFileSync(f, 'utf8');
}

let labels: Map<string, number> | null = null;

/** METATILE_* → id, from include/constants/metatile_labels.h. */
export function metatileLabels(): ReadonlyMap<string, number> {
  if (!labels) {
    labels = new Map();
    for (const m of decompFile('include/constants/metatile_labels.h').matchAll(/^#define\s+(METATILE_\w+)\s+(0x[0-9A-Fa-f]+|\d+)/gm)) {
      labels.set(m[1], Number(m[2]));
    }
  }
  return labels;
}

/** The id of a METATILE_* label, or of `label+n` / `label-n` (a metatile n ids away: the bottom half of a two-row door
 *  frame is its top + METATILE_ROW_WIDTH 8, as the C code writes it). Throws on an unknown label. */
export function metatileId(label: string): number {
  const m = /^(METATILE_\w+)\s*(?:([+-])\s*(\d+|0x[0-9A-Fa-f]+))?$/.exec(label.trim());
  const id = m ? metatileLabels().get(m[1]) : undefined;
  if (!m || id === undefined) throw new Error(`unknown metatile label ${label}`);
  return m[2] ? id + (m[2] === '+' ? 1 : -1) * Number(m[3]) : id;
}

/** Every `setmetatile x, y, METATILE_…, TRUE|FALSE` of data/maps/<mapName>/scripts.inc, map-local; with `label`, only
 *  those under that script label (up to the next label). A setmetatile whose coordinates or metatile are variables is
 *  skipped (none in the maps the harness edits); an unknown label throws. */
export function scriptEdits(mapName: string, label?: string): DecompEdit[] {
  const text = decompFile(`data/maps/${mapName}/scripts.inc`);
  const lines = text.split(/\r?\n/);
  let from = 0, to = lines.length;
  if (label) {
    const at = lines.findIndex((l) => new RegExp(`^${label}::?\\s*$`).test(l));
    if (at < 0) throw new Error(`no script label ${label} in ${mapName}/scripts.inc`);
    from = at + 1;
    const next = lines.findIndex((l, i) => i >= from && /^\w+::?\s*$/.test(l));
    if (next >= 0) to = next;
  }
  const out: DecompEdit[] = [];
  for (const l of lines.slice(from, to)) {
    const m = /^\s*setmetatile\s+(\d+)\s*,\s*(\d+)\s*,\s*(METATILE_\w+)\s*,\s*(TRUE|FALSE|1|0)\s*$/.exec(l);
    if (!m) continue;
    out.push({ x: Number(m[1]), y: Number(m[2]), metatile: metatileId(m[3]), blocked: m[4] === 'TRUE' || m[4] === '1', label: m[3] });
  }
  return out;
}

/** The METATILE_* names a C file of src/ writes with MapGridSetMetatileIdAt (field_tasks.c, field_specials.c,
 *  rotating_tile_puzzle.c …), resolved to ids: the names inside the calls' arguments, and those of the file's `static
 *  const` tables (the writes that take their id from a table: Pacifidlog's log frames, Petalburg's sliding doors).
 *  (rotating_tile_puzzle.c writes none: Mossdeep's and Trick House 7's switches move the statues, not the arrows.) */
export function cMetatiles(file: string): ReadonlyMap<string, number> {
  const text = decompFile(`src/${file}`);
  const names = new Set<string>();
  // (StartAshFieldEffect: the ash grass's write, made by MapGridSetMetatileIdAt once its field effect ends)
  for (const m of text.matchAll(/(?:MapGridSetMetatileIdAt|StartAshFieldEffect)\s*\(([^;]*?)\)\s*;/gs)) {
    for (const n of m[1].matchAll(/METATILE_\w+/g)) names.add(n[0]);
  }
  if (names.size || /MapGridSetMetatileIdAt/.test(text)) {
    for (const m of text.matchAll(/static\s+const\s+[^=;]*=\s*\{([^;]*?)\}\s*;/gs)) {
      for (const n of m[1].matchAll(/METATILE_\w+/g)) names.add(n[0]);
    }
  }
  const ids = metatileLabels();
  const out = new Map<string, number>();
  for (const n of [...names].sort()) {
    const id = ids.get(n);
    if (id !== undefined) out.set(n, id);
  }
  return out;
}

/** The grid's u16 after the edit: elevation kept, collision 0x0C00 when blocked, else 0, metatile bits 0–9. */
export function editRaw(old: number, e: Pick<DecompEdit, 'metatile' | 'blocked'>): number {
  return (old & 0xf000) | (e.blocked ? 0x0c00 : 0) | (e.metatile & 0x3ff);
}
