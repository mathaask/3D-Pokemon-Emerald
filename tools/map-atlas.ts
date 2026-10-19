// Offline map atlas: renders every map of the ROM to PNG plus debug overlays for a curated set,
// tileset sheets, and statistics used to tune the 3D reconstruction heuristics.
//
// Usage: npx tsx tools/map-atlas.ts [--only <substring>] [--no-maps] [--no-sheets] [--all-debug]
// Output: out/atlas/<group>_<num>_<name>.png            full map, rendered like the game
//         out/atlas/debug/<group>_<num>_<name>_{collision,elevation,layer,behavior}.png
//         out/atlas/tilesets/<Tileset>_<first id>.png   metatile sheets (both layers | top only)
//         out/atlas/stats.txt, out/atlas/stats.json      distributions per map type / metatile
import fs from 'node:fs';
import path from 'node:path';
import { encodePng, upscale } from './lib/png';
import {
  RomReader, loadAllMaps, loadTileset, tilesetPair, behaviorName, MB, MAP_TYPE_NAMES, LAYER_TYPE_NAMES,
  type MapInfo, type Tileset, type TilesetPair,
} from '../src/game/rom/index';
import { SYM } from '../src/game/symbols';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'out/atlas');
const args = process.argv.slice(2);
const argVal = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = argVal('--only');
const doMaps = !args.includes('--no-maps');
const doSheets = !args.includes('--no-sheets');
const allDebug = args.includes('--all-debug');

/** Maps that get collision/elevation/layer/behavior debug renders. */
const CURATED = [
  'LittlerootTown', 'Route101', 'OldaleTown', 'Route102', 'Route103', 'Route104', 'PetalburgCity',
  'PetalburgWoods', 'RustboroCity', 'Route111', 'Route112', 'Route113', 'FortreeCity', 'LilycoveCity',
  'MtChimney', 'GraniteCave_1F', 'GraniteCave_B1F', 'LittlerootTown_BrendansHouse_1F',
  'LittlerootTown_BrendansHouse_2F', 'OldaleTown_PokemonCenter_1F', 'OldaleTown_Mart',
  'LittlerootTown_ProfessorBirchsLab', 'OldaleTown_House1', 'PetalburgCity_Gym', 'Route110', 'Route119',
  'Route120', 'Route114', 'Route117', 'Route106', 'MauvilleCity', 'SlateportCity', 'DewfordTown',
  'FallarborTown', 'LavaridgeTown', 'PacifidlogTown', 'SootopolisCity', 'VerdanturfTown',
  'MeteorFalls_1F_1R', 'RusturfTunnel', 'MtPyre_Exterior', 'Route121', 'Route123', 'EverGrandeCity', 'MossdeepCity',
];

// ---------------------------------------------------------------------------------------------
// Symbol names for tileset labels (tools may read the vendor symbol table directly).
const symNames = new Map<number, string>();
try {
  for (const line of fs.readFileSync(path.join(root, 'vendor/pokeemerald-sym/pokeemerald.sym'), 'utf8').split(/\r?\n/)) {
    const m = /^([0-9a-f]{8}) [gl] [0-9a-f]{8} (gTileset_\S+)$/.exec(line);
    if (m) symNames.set(parseInt(m[1], 16), m[2].replace(/^gTileset_/, ''));
  }
} catch {
  /* symbol table optional */
}
const tilesetName = (addr: number) => symNames.get(addr) ?? `ts_${addr.toString(16)}`;

// ---------------------------------------------------------------------------------------------
// Tiny 3x5 bitmap font for overlays.
const GLYPHS: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
  '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001001001',
  '8': '111101111101111', '9': '111101111001111', A: '111101111101101', B: '110101110101110',
  C: '111100100100111', D: '110101101101110', E: '111100111100111', F: '111100111100100',
  N: '101111111111101', S: '111100111001111', T: '111010010010010', '-': '000000111000000',
  '*': '101010101000000', ' ': '000000000000000',
};

const BLACK = 0xff000000;
const WHITE = 0xffffffff;

function rgba(r: number, g: number, b: number, a = 255): number {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

function blend(dst: number, src: number, t: number): number {
  const u = 1 - t;
  const r = ((dst & 0xff) * u + (src & 0xff) * t) | 0;
  const g = (((dst >>> 8) & 0xff) * u + ((src >>> 8) & 0xff) * t) | 0;
  const b = (((dst >>> 16) & 0xff) * u + ((src >>> 16) & 0xff) * t) | 0;
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

class Canvas {
  readonly px: Uint32Array;
  constructor(readonly w: number, readonly h: number, fill = 0) {
    this.px = new Uint32Array(w * h).fill(fill);
  }
  set(x: number, y: number, c: number) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
  }
  tint(x0: number, y0: number, w: number, h: number, c: number, t: number) {
    const xa = Math.max(0, x0), xb = Math.min(this.w, x0 + w);
    for (let y = Math.max(0, y0); y < Math.min(this.h, y0 + h); y++) {
      for (let x = xa, i = y * this.w + xa; x < xb; x++, i++) this.px[i] = blend(this.px[i], c, t);
    }
  }
  rect(x0: number, y0: number, w: number, h: number, c: number) {
    const xa = Math.max(0, x0), xb = Math.min(this.w, x0 + w);
    for (let y = Math.max(0, y0); y < Math.min(this.h, y0 + h); y++) this.px.fill(c, y * this.w + xa, y * this.w + xb);
  }
  frame(x0: number, y0: number, w: number, h: number, c: number) {
    this.rect(x0, y0, w, 1, c);
    this.rect(x0, y0 + h - 1, w, 1, c);
    this.rect(x0, y0, 1, h, c);
    this.rect(x0 + w - 1, y0, 1, h, c);
  }
  /** Draws text on a black label box; glyphs are 3x5 scaled by `scale`. */
  text(x: number, y: number, s: string, c = WHITE, scale = 2) {
    this.rect(x - 1, y - 1, s.length * 4 * scale + 1, 5 * scale + 2, BLACK);
    let cx = x;
    for (const ch of s.toUpperCase()) {
      const g = GLYPHS[ch] ?? GLYPHS[' '];
      for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
        if (g.charCodeAt(gy * 3 + gx) === 49) this.rect(cx + gx * scale, y + gy * scale, scale, scale, c);
      }
      cx += 4 * scale;
    }
  }
  png(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, encodePng(this.w, this.h, new Uint8Array(this.px.buffer)));
  }
}

// ---------------------------------------------------------------------------------------------
const romFile = fs.existsSync(path.join(root, 'Pokemon_Emerald-.gba'))
  ? 'Pokemon_Emerald-.gba'
  : fs.readdirSync(root).find((f) => f.toLowerCase().endsWith('.gba'));
if (!romFile) throw new Error('No .gba ROM found in project root');
const rom = new RomReader(new Uint8Array(fs.readFileSync(path.join(root, romFile))));
const maps = loadAllMaps(rom, SYM.gMapGroups);
console.log(`${maps.length} maps`);

const tilesetCache = new Map<number, Tileset | null>();
function getTileset(addr: number): Tileset | null {
  if (!addr) return null;
  if (!tilesetCache.has(addr)) tilesetCache.set(addr, loadTileset(rom, addr));
  return tilesetCache.get(addr)!;
}
function pairFor(m: MapInfo): TilesetPair {
  return tilesetPair(getTileset(m.layout.primaryTileset)!, getTileset(m.layout.secondaryTileset));
}

const fileBase = (m: MapInfo) => `${m.group}_${m.num}_${m.name}`;

function renderMap(m: MapInfo): Canvas {
  const { width, height, grid } = m.layout;
  const pair = pairFor(m);
  const c = new Canvas(width * 16, height * 16);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    pair.drawMetatile(grid[y * width + x] & 0x3ff, 'both', c.px, c.w, x * 16, y * 16, true);
  }
  return c;
}

const ELEV_COLORS = [
  rgba(255, 0, 255), rgba(0, 120, 255), rgba(0, 200, 120), rgba(240, 240, 240), rgba(255, 220, 0),
  rgba(255, 140, 0), rgba(255, 40, 40), rgba(160, 0, 200), rgba(120, 60, 20), rgba(0, 255, 255),
  rgba(128, 128, 0), rgba(0, 128, 128), rgba(128, 0, 0), rgba(0, 0, 128), rgba(64, 64, 64),
  rgba(0, 0, 0),
];

/** Colour category of a behaviour for the behaviour overlay. */
function behaviorColor(b: number): number | null {
  if (b === MB.NORMAL) return null;
  if (b === MB.TALL_GRASS || b === MB.LONG_GRASS || b === MB.SHORT_GRASS || b === MB.ASHGRASS ||
      b === MB.LONG_GRASS_SOUTH_EDGE) return rgba(0, 220, 0);
  if ((b >= 0x10 && b <= 0x1a) || b === MB.SEAWEED || b === MB.SEAWEED_NO_SURFACING || b === MB.HOT_SPRINGS ||
      (b >= 0x50 && b <= 0x53)) return rgba(0, 120, 255);
  if (b >= 0x30 && b <= 0x37) return rgba(255, 0, 0); // directional impassable
  if (b >= 0x38 && b <= 0x3f) return rgba(255, 140, 0); // ledges
  if (b >= 0x40 && b <= 0x48) return rgba(255, 255, 0); // forced walk / slide
  if (b >= 0x60 && b <= 0x6e) return rgba(255, 0, 255); // doors & warps
  if (b >= 0x70 && b <= 0x7f) return rgba(150, 90, 30); // bridges
  if (b === MB.SAND || b === MB.DEEP_SAND || b === MB.FOOTPRINTS) return rgba(240, 210, 120);
  if (b === MB.ICE || b === MB.THIN_ICE || b === MB.CRACKED_ICE) return rgba(180, 255, 255);
  if (b === MB.COUNTER || b >= 0xe0 || (b >= 0x83 && b <= 0x8f)) return rgba(0, 255, 255); // furniture/interactables
  if (b >= 0x90 && b <= 0x9d) return rgba(120, 0, 200); // secret base spots
  if (b === MB.CAVE || b === MB.INDOOR_ENCOUNTER || b === MB.MOUNTAIN_TOP) return rgba(140, 140, 140);
  return rgba(255, 255, 255);
}

const hex = (v: number, n: number) => v.toString(16).toUpperCase().padStart(n, '0');

function renderDebug(m: MapInfo, base: Canvas, kind: 'collision' | 'elevation' | 'layer' | 'behavior'): Canvas {
  const S = 2;
  const { width, height, grid } = m.layout;
  const pair = pairFor(m);
  const c = new Canvas(base.w * S, base.h * S);
  c.px.set(new Uint32Array(upscale(base.w, base.h, new Uint8Array(base.px.buffer), S).buffer));
  const cs = 16 * S;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const b = grid[y * width + x];
    const id = b & 0x3ff;
    const col = (b >> 10) & 3;
    const elev = b >> 12;
    const X = x * cs;
    const Y = y * cs;
    if (kind === 'collision') {
      if (col) {
        c.tint(X, Y, cs, cs, rgba(255, 0, 0), 0.45);
        if (col !== 1) c.text(X + 2, Y + 2, String(col));
      } else c.tint(X, Y, cs, cs, rgba(0, 0, 0), 0.15);
    } else if (kind === 'elevation') {
      c.tint(X, Y, cs, cs, ELEV_COLORS[elev], 0.45);
      c.text(X + 2, Y + 2, hex(elev, 1));
      if (col) c.frame(X + 1, Y + 1, cs - 2, cs - 2, rgba(255, 0, 0));
    } else if (kind === 'layer') {
      const lt = pair.layerType(id);
      const topCov = pair.layerCoverage(id, true);
      const color = lt === 0 ? rgba(0, 90, 255) : lt === 1 ? rgba(0, 220, 0) : rgba(255, 0, 200);
      if (topCov > 0 || lt !== 0) c.tint(X, Y, cs, cs, color, topCov > 0 ? 0.45 : 0.2);
      c.text(X + 2, Y + 2, (LAYER_TYPE_NAMES[lt] ?? '?')[0] + (topCov > 0 ? 'T' : ''));
      // bar = top-layer opaque coverage
      if (topCov > 0) c.rect(X + 2, Y + cs - 5, Math.max(1, Math.round(((cs - 4) * topCov) / 256)), 3, WHITE);
    } else {
      const bh = pair.behavior(id);
      const color = behaviorColor(bh);
      if (color !== null) {
        c.tint(X, Y, cs, cs, color, 0.45);
        c.text(X + 2, Y + 2, hex(bh, 2));
      }
    }
  }
  // map grid lines every metatile (faint)
  for (let y = 0; y < c.h; y += cs) c.tint(0, y, c.w, 1, BLACK, 0.35);
  for (let x = 0; x < c.w; x += cs) c.tint(x, 0, 1, c.h, BLACK, 0.35);
  return c;
}

/** Metatile sheet: 8 per row, each cell = [both layers | top layer only] at 3x, with labels. */
function renderSheet(primary: Tileset, secondary: Tileset | null, first: number, count: number): Canvas {
  const pair = tilesetPair(primary, secondary);
  const K = 3;
  const cellW = 16 * K * 2 + 6;
  const cellH = 16 * K + 26;
  const rows = Math.ceil(count / 8);
  const c = new Canvas(cellW * 8, cellH * rows, rgba(40, 40, 40));
  const tmp = new Uint32Array(256);
  for (let i = 0; i < count; i++) {
    const id = first + i;
    const X = (i % 8) * cellW;
    const Y = Math.floor(i / 8) * cellH;
    for (const [n, layer] of [[0, 'both'], [1, 'top']] as const) {
      // checkerboard for transparency in the top-only view
      for (let p = 0; p < 256; p++) tmp[p] = n === 1 ? (((p & 15) >> 2) + ((p >> 6) & 3)) & 1 ? rgba(200, 0, 200) : rgba(120, 0, 120) : pair.backdrop;
      pair.drawMetatile(id, layer, tmp, 16, 0, 0, false);
      for (let py = 0; py < 16 * K; py++) for (let px = 0; px < 16 * K; px++) {
        c.set(X + n * 16 * K + px + 2 * n, Y + 24 + py, tmp[((py / K) | 0) * 16 + ((px / K) | 0)]);
      }
    }
    const lt = pair.layerType(id);
    c.text(X + 2, Y + 2, hex(id, 3), rgba(255, 255, 0));
    c.text(X + 36, Y + 2, (LAYER_TYPE_NAMES[lt] ?? '?')[0], lt === 0 ? rgba(120, 170, 255) : lt === 1 ? rgba(0, 255, 0) : rgba(255, 0, 200));
    c.text(X + 52, Y + 2, hex(pair.behavior(id), 2));
  }
  return c;
}

// ---------------------------------------------------------------------------------------------
fs.mkdirSync(outDir, { recursive: true });
const curated = new Set(CURATED);
let written = 0;
if (doMaps) {
  for (const m of maps) {
    if (only && !m.name.toLowerCase().includes(only.toLowerCase())) continue;
    const base = renderMap(m);
    base.png(path.join(outDir, `${fileBase(m)}.png`));
    written++;
    if (allDebug || curated.has(m.name)) {
      for (const kind of ['collision', 'elevation', 'layer', 'behavior'] as const) {
        renderDebug(m, base, kind).png(path.join(outDir, 'debug', `${fileBase(m)}_${kind}.png`));
      }
    }
  }
  console.log(`wrote ${written} map renders to ${path.relative(root, outDir)}`);
}

if (doSheets) {
  // every (primary, secondary) pair in use: sheet each primary once (with its first partner) and
  // each secondary with its most common primary.
  const pairs = new Map<number, number>();
  for (const m of maps) {
    const { primaryTileset: p, secondaryTileset: s } = m.layout;
    if (!pairs.has(p)) pairs.set(p, s);
    if (s && !pairs.has(s)) pairs.set(s, p);
  }
  for (const [addr, partner] of pairs) {
    const ts = getTileset(addr)!;
    const primary = ts.isSecondary ? getTileset(partner)! : ts;
    const secondary = ts.isSecondary ? ts : getTileset(partner);
    const base = ts.isSecondary ? 512 : 0;
    for (let first = 0; first < ts.numMetatiles; first += 128) {
      renderSheet(primary, secondary, base + first, Math.min(128, ts.numMetatiles - first)).png(
        path.join(outDir, 'tilesets', `${tilesetName(addr)}_${hex(base + first, 3)}.png`),
      );
    }
  }
  console.log(`wrote tileset sheets for ${pairs.size} tilesets`);
}

// ---------------------------------------------------------------------------------------------
// Statistics.
interface MtStat {
  uses: number;
  maps: Set<string>;
  collision: number[];
  elevation: number[];
}
const elevByType: Record<string, number[]> = {};
const collisionByBehavior = new Map<number, number[]>();
const mtStats = new Map<string, MtStat>(); // key `${tileset}:${id}`
for (const m of maps) {
  const pair = pairFor(m);
  const type = MAP_TYPE_NAMES[m.mapType] ?? String(m.mapType);
  const hist = (elevByType[type] ??= new Array(16).fill(0));
  const { grid } = m.layout;
  for (let i = 0; i < grid.length; i++) {
    const b = grid[i];
    const id = b & 0x3ff;
    const elev = b >> 12;
    const col = (b >> 10) & 3;
    hist[elev]++;
    const bh = pair.behavior(id);
    const ch = collisionByBehavior.get(bh) ?? [0, 0, 0, 0];
    ch[col]++;
    collisionByBehavior.set(bh, ch);
    const tsAddr = id < 512 ? m.layout.primaryTileset : m.layout.secondaryTileset;
    const key = `${tilesetName(tsAddr)}:${id}`;
    let st = mtStats.get(key);
    if (!st) mtStats.set(key, (st = { uses: 0, maps: new Set(), collision: [0, 0, 0, 0], elevation: new Array(16).fill(0) }));
    st.uses++;
    st.maps.add(m.name);
    st.collision[col]++;
    st.elevation[elev]++;
  }
}

const lines: string[] = [];
lines.push('# Elevation histogram per map type (cells)');
for (const [t, h] of Object.entries(elevByType)) {
  const tot = h.reduce((a, b) => a + b, 0);
  lines.push(`${t.padEnd(12)} total ${tot}  ` + h.map((v, i) => (v ? `${hex(i, 1)}:${((100 * v) / tot).toFixed(1)}%` : '')).filter(Boolean).join(' '));
}
lines.push('');
lines.push('# Collision by behaviour (cells: col0 col1 col2 col3)');
for (const [b, c] of [...collisionByBehavior].sort((a, b) => a[0] - b[0])) {
  lines.push(`${hex(b, 2)} ${behaviorName(b).padEnd(30)} ${c.join(' ')}`);
}
lines.push('');
lines.push('# Per-map summary: name type WxH tilesets | elevations used');
for (const m of maps) {
  const used = new Map<number, number>();
  for (const b of m.layout.grid) used.set(b >> 12, (used.get(b >> 12) ?? 0) + 1);
  lines.push(`${fileBase(m).padEnd(48)} ${(MAP_TYPE_NAMES[m.mapType] ?? '?').padEnd(11)} ${m.layout.width}x${m.layout.height} ` +
    `${tilesetName(m.layout.primaryTileset)}+${tilesetName(m.layout.secondaryTileset)} | ` +
    [...used].sort((a, b) => a[0] - b[0]).map(([e, n]) => `${hex(e, 1)}:${n}`).join(' '));
}
lines.push('');
for (const tsName of ['General', 'Building']) {
  const tsAddr = [...symNames].find(([, n]) => n === tsName)?.[0];
  if (!tsAddr) continue;
  const ts = getTileset(tsAddr)!;
  const pair = tilesetPair(ts, null);
  lines.push(`# ${tsName} metatiles: id behaviour layer topCov botCov | uses maps col%% elev-histogram`);
  for (let id = 0; id < ts.numMetatiles; id++) {
    const st = mtStats.get(`${tsName}:${id}`);
    const a = ts.attributes[id];
    const colPct = st ? Math.round((100 * (st.uses - st.collision[0])) / st.uses) : 0;
    const elev = st ? st.elevation.map((v, i) => (v ? `${hex(i, 1)}:${v}` : '')).filter(Boolean).join(' ') : '';
    lines.push(`${hex(id, 3)} ${behaviorName(a & 0xff).padEnd(26)} ${(LAYER_TYPE_NAMES[a >> 12] ?? '?').padEnd(7)} ` +
      `${String(pair.layerCoverage(id, true)).padStart(3)} ${String(pair.layerCoverage(id, false)).padStart(3)} | ` +
      `${String(st?.uses ?? 0).padStart(5)} ${String(st?.maps.size ?? 0).padStart(3)} ${String(colPct).padStart(3)}% ${elev}`);
  }
  lines.push('');
}
fs.writeFileSync(path.join(outDir, 'stats.txt'), lines.join('\n'));
fs.writeFileSync(
  path.join(outDir, 'stats.json'),
  JSON.stringify({
    elevationByMapType: elevByType,
    collisionByBehavior: Object.fromEntries([...collisionByBehavior].map(([b, c]) => [behaviorName(b), c])),
    metatiles: Object.fromEntries(
      [...mtStats].map(([k, s]) => [k, { uses: s.uses, maps: s.maps.size, collision: s.collision, elevation: s.elevation }]),
    ),
  }),
);
console.log('wrote stats.txt / stats.json');
