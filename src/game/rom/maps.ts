// Static decoder for Emerald map headers (gMapGroups -> MapHeader -> layout/events/connections).
// Struct layouts follow include/global.fieldmap.h of pokeemerald. Browser-safe.
import { RomReader } from './reader';
import { MAP_NAMES } from '../mapNames';

// ---- map grid block encoding (MAPGRID_*) ----
export const MAPGRID_METATILE_ID_MASK = 0x03ff;
export const MAPGRID_COLLISION_MASK = 0x0c00;
export const MAPGRID_ELEVATION_MASK = 0xf000;
export const MAPGRID_UNDEFINED = 0x03ff;

export const ELEVATION_TRANSITION = 0;
export const ELEVATION_SURF = 1;
export const ELEVATION_DEFAULT = 3;
export const ELEVATION_MULTI_LEVEL = 15;

export const blockMetatile = (b: number): number => b & 0x3ff;
export const blockCollision = (b: number): number => (b >> 10) & 3;
export const blockElevation = (b: number): number => (b >> 12) & 0xf;

export const MapType = {
  NONE: 0, TOWN: 1, CITY: 2, ROUTE: 3, UNDERGROUND: 4, UNDERWATER: 5, OCEAN_ROUTE: 6,
  UNKNOWN: 7, INDOOR: 8, SECRET_BASE: 9,
} as const;
export const MAP_TYPE_NAMES = [
  'NONE', 'TOWN', 'CITY', 'ROUTE', 'UNDERGROUND', 'UNDERWATER', 'OCEAN_ROUTE', 'UNKNOWN', 'INDOOR',
  'SECRET_BASE',
];

export const Connection = { NONE: 0, SOUTH: 1, NORTH: 2, WEST: 3, EAST: 4, DIVE: 5, EMERGE: 6 } as const;
export const CONNECTION_NAMES = ['none', 'down', 'up', 'left', 'right', 'dive', 'emerge'];

export const BgEventKind = {
  FACING_ANY: 0, FACING_NORTH: 1, FACING_SOUTH: 2, FACING_EAST: 3, FACING_WEST: 4,
  HIDDEN_ITEM: 7, SECRET_BASE: 8,
} as const;

// ---- types ----
export interface MapLayout {
  addr: number;
  width: number;
  height: number;
  borderAddr: number;
  /** 2x2 border blocks (Emerald borders are always 2x2). */
  border: Uint16Array;
  mapAddr: number;
  /** Raw map grid, row-major, width*height u16: metatile id (0-9), collision (10-11), elevation (12-15). */
  grid: Uint16Array;
  primaryTileset: number;
  secondaryTileset: number;
}

export interface ObjectEventTemplate {
  localId: number;
  graphicsId: number;
  kind: number;
  x: number;
  y: number;
  elevation: number;
  movementType: number;
  movementRangeX: number;
  movementRangeY: number;
  trainerType: number;
  trainerRangeOrBerryTreeId: number;
  script: number;
  flagId: number;
}

export interface WarpEvent {
  x: number;
  y: number;
  elevation: number;
  warpId: number;
  mapNum: number;
  mapGroup: number;
}

export interface CoordEvent {
  x: number;
  y: number;
  elevation: number;
  trigger: number;
  index: number;
  script: number;
}

export interface BgEvent {
  x: number;
  y: number;
  elevation: number;
  kind: number;
  /** Script pointer for sign/interaction kinds (0-4). */
  script?: number;
  hiddenItem?: { item: number; hiddenItemId: number };
  secretBaseId?: number;
}

export interface MapEvents {
  objects: ObjectEventTemplate[];
  warps: WarpEvent[];
  coordEvents: CoordEvent[];
  bgEvents: BgEvent[];
}

export interface MapConnection {
  direction: number;
  offset: number;
  mapGroup: number;
  mapNum: number;
}

export interface MapInfo {
  group: number;
  num: number;
  /** Decomp identifier (e.g. "LittlerootTown") or `MAP_<g>_<n>` if unknown. */
  name: string;
  addr: number;
  layout: MapLayout;
  layoutId: number;
  eventsAddr: number;
  events: MapEvents;
  scriptsAddr: number;
  connections: MapConnection[];
  music: number;
  regionMapSectionId: number;
  /** Requires Flash (dark cave). */
  cave: number;
  weather: number;
  mapType: number;
  allowCycling: boolean;
  allowEscaping: boolean;
  allowRunning: boolean;
  showMapName: boolean;
  battleType: number;
}

/** Group table: address of each group's pointer array and its inferred map count. */
export interface MapGroupTable {
  groupAddrs: number[];
  counts: number[];
}

// ---- parsing ----
const MAX_DIM = 0x400;

function ptrOrZero(rom: RomReader, addr: number): number {
  const v = rom.u32(addr);
  return rom.isRomPtr(v) ? v : 0;
}

/** Cheap structural check that `addr` points to a plausible MapHeader. */
export function isPlausibleMapHeader(rom: RomReader, addr: number): boolean {
  if (!rom.isRomPtr(addr) || addr % 4 !== 0 || !rom.isRomPtr(addr + 0x1b)) return false;
  const layout = rom.u32(addr);
  if (!rom.isRomPtr(layout) || layout % 4 !== 0) return false;
  const w = rom.s32(layout);
  const h = rom.s32(layout + 4);
  if (w <= 0 || h <= 0 || w > MAX_DIM || h > MAX_DIM) return false;
  if (!rom.isRomPtr(rom.u32(layout + 8)) || !rom.isRomPtr(rom.u32(layout + 12))) return false;
  if (!rom.isRomPtr(rom.u32(layout + 16))) return false;
  const events = rom.u32(addr + 4);
  if (events !== 0 && !rom.isRomPtr(events)) return false;
  const conns = rom.u32(addr + 12);
  if (conns !== 0 && !rom.isRomPtr(conns)) return false;
  return rom.u8(addr + 0x17) <= 9; // mapType
}

/**
 * Reads gMapGroups and infers each group's map count. The group pointer arrays are laid out
 * contiguously directly before gMapGroups, so a group ends where the next one (by address)
 * begins, and the last one ends at gMapGroups. Each entry is validated as a MapHeader; a group
 * is truncated at the first implausible entry.
 */
export function readMapGroups(rom: RomReader, gMapGroups: number): MapGroupTable {
  const groupAddrs: number[] = [];
  const first = rom.u32(gMapGroups);
  if (!rom.isRomPtr(first) || first >= gMapGroups) throw new Error('gMapGroups[0] is not a valid pointer');
  for (let i = 0; i < 256; i++) {
    const p = rom.u32(gMapGroups + i * 4);
    if (!rom.isRomPtr(p) || p < first || p >= gMapGroups || p % 4 !== 0) break;
    groupAddrs.push(p);
  }
  const sorted = [...new Set(groupAddrs)].sort((a, b) => a - b);
  const counts = groupAddrs.map((start) => {
    const next = sorted.find((p) => p > start) ?? gMapGroups;
    const max = (next - start) / 4;
    let n = 0;
    while (n < max && isPlausibleMapHeader(rom, rom.u32(start + n * 4))) n++;
    return n;
  });
  return { groupAddrs, counts };
}

export function readLayout(rom: RomReader, addr: number): MapLayout {
  const width = rom.s32(addr);
  const height = rom.s32(addr + 4);
  if (width <= 0 || height <= 0 || width > MAX_DIM || height > MAX_DIM) {
    throw new Error(`Implausible layout size ${width}x${height} at 0x${addr.toString(16)}`);
  }
  const borderAddr = rom.u32(addr + 8);
  const mapAddr = rom.u32(addr + 12);
  return {
    addr,
    width,
    height,
    borderAddr,
    border: rom.isRomPtr(borderAddr) ? rom.u16Array(borderAddr, 4) : new Uint16Array(4),
    mapAddr,
    grid: rom.u16Array(mapAddr, width * height),
    primaryTileset: ptrOrZero(rom, addr + 16),
    secondaryTileset: ptrOrZero(rom, addr + 20),
  };
}

export function readEvents(rom: RomReader, addr: number): MapEvents {
  const ev: MapEvents = { objects: [], warps: [], coordEvents: [], bgEvents: [] };
  if (!rom.isRomPtr(addr)) return ev;
  const nObj = rom.u8(addr);
  const nWarp = rom.u8(addr + 1);
  const nCoord = rom.u8(addr + 2);
  const nBg = rom.u8(addr + 3);
  const pObj = rom.u32(addr + 4);
  const pWarp = rom.u32(addr + 8);
  const pCoord = rom.u32(addr + 12);
  const pBg = rom.u32(addr + 16);
  if (rom.isRomPtr(pObj)) {
    for (let i = 0; i < nObj; i++) {
      const a = pObj + i * 0x18;
      const range = rom.u16(a + 0x0a);
      ev.objects.push({
        localId: rom.u8(a),
        graphicsId: rom.u8(a + 1),
        kind: rom.u8(a + 2),
        x: rom.s16(a + 4),
        y: rom.s16(a + 6),
        elevation: rom.u8(a + 8),
        movementType: rom.u8(a + 9),
        movementRangeX: range & 0xf,
        movementRangeY: (range >> 4) & 0xf,
        trainerType: rom.u16(a + 0x0c),
        trainerRangeOrBerryTreeId: rom.u16(a + 0x0e),
        script: rom.u32(a + 0x10),
        flagId: rom.u16(a + 0x14),
      });
    }
  }
  if (rom.isRomPtr(pWarp)) {
    for (let i = 0; i < nWarp; i++) {
      const a = pWarp + i * 8;
      ev.warps.push({
        x: rom.s16(a),
        y: rom.s16(a + 2),
        elevation: rom.u8(a + 4),
        warpId: rom.u8(a + 5),
        mapNum: rom.u8(a + 6),
        mapGroup: rom.u8(a + 7),
      });
    }
  }
  if (rom.isRomPtr(pCoord)) {
    for (let i = 0; i < nCoord; i++) {
      const a = pCoord + i * 16;
      ev.coordEvents.push({
        x: rom.s16(a),
        y: rom.s16(a + 2),
        elevation: rom.u8(a + 4),
        trigger: rom.u16(a + 6),
        index: rom.u16(a + 8),
        script: rom.u32(a + 12),
      });
    }
  }
  if (rom.isRomPtr(pBg)) {
    for (let i = 0; i < nBg; i++) {
      const a = pBg + i * 12;
      const kind = rom.u8(a + 5);
      const e: BgEvent = { x: rom.u16(a), y: rom.u16(a + 2), elevation: rom.u8(a + 4), kind };
      if (kind === BgEventKind.HIDDEN_ITEM) {
        e.hiddenItem = { item: rom.u16(a + 8), hiddenItemId: rom.u16(a + 10) };
      } else if (kind === BgEventKind.SECRET_BASE) {
        e.secretBaseId = rom.u32(a + 8);
      } else {
        e.script = rom.u32(a + 8);
      }
      ev.bgEvents.push(e);
    }
  }
  return ev;
}

export function readConnections(rom: RomReader, addr: number): MapConnection[] {
  if (!rom.isRomPtr(addr)) return [];
  const count = rom.s32(addr);
  const list = rom.u32(addr + 4);
  if (count <= 0 || count > 16 || !rom.isRomPtr(list)) return [];
  const out: MapConnection[] = [];
  for (let i = 0; i < count; i++) {
    const a = list + i * 12;
    out.push({ direction: rom.u8(a), offset: rom.s32(a + 4), mapGroup: rom.u8(a + 8), mapNum: rom.u8(a + 9) });
  }
  return out;
}

export function mapName(group: number, num: number): string {
  return MAP_NAMES[group]?.[num] ?? `MAP_${group}_${num}`;
}

/** Parses the MapHeader at `addr`. `layoutCache` lets maps sharing a layout share the object. */
export function readMapHeader(
  rom: RomReader,
  addr: number,
  group: number,
  num: number,
  layoutCache?: Map<number, MapLayout>,
): MapInfo {
  const layoutAddr = rom.u32(addr);
  let layout = layoutCache?.get(layoutAddr);
  if (!layout) {
    layout = readLayout(rom, layoutAddr);
    layoutCache?.set(layoutAddr, layout);
  }
  const eventsAddr = rom.u32(addr + 4);
  const flags = rom.u8(addr + 0x1a);
  return {
    group,
    num,
    name: mapName(group, num),
    addr,
    layout,
    layoutId: rom.u16(addr + 0x12),
    eventsAddr,
    events: readEvents(rom, eventsAddr),
    scriptsAddr: rom.u32(addr + 8),
    connections: readConnections(rom, rom.u32(addr + 12)),
    music: rom.u16(addr + 0x10),
    regionMapSectionId: rom.u8(addr + 0x14),
    cave: rom.u8(addr + 0x15),
    weather: rom.u8(addr + 0x16),
    mapType: rom.u8(addr + 0x17),
    allowCycling: (flags & 1) !== 0,
    allowEscaping: (flags & 2) !== 0,
    allowRunning: (flags & 4) !== 0,
    showMapName: (flags >> 3) !== 0,
    battleType: rom.u8(addr + 0x1b),
  };
}

/** Default gMapGroups address for Emerald BPEE rev 0 (SYM.gMapGroups). */
export const EMERALD_MAP_GROUPS = 0x08486578;

/**
 * Address of map (group, num)'s MapHeader, read straight from gMapGroups like the game's
 * Overworld_GetMapHeaderByGroupAndId (no group-table scan: cheap enough for live play); 0 if the
 * entry is no plausible header.
 */
export function mapHeaderAddr(rom: RomReader, group: number, num: number, gMapGroups = EMERALD_MAP_GROUPS): number {
  const groupAddr = rom.u32(gMapGroups + group * 4);
  if (!rom.isRomPtr(groupAddr) || !rom.isRomPtr(groupAddr + num * 4 + 3)) return 0;
  const addr = rom.u32(groupAddr + num * 4);
  return isPlausibleMapHeader(rom, addr) ? addr : 0;
}

/** Loads one map by (group, num). */
export function loadMap(rom: RomReader, group: number, num: number, gMapGroups = EMERALD_MAP_GROUPS): MapInfo {
  const table = readMapGroups(rom, gMapGroups);
  if (group < 0 || group >= table.counts.length || num < 0 || num >= table.counts[group]) {
    throw new Error(`No map ${group}.${num}`);
  }
  return readMapHeader(rom, rom.u32(table.groupAddrs[group] + num * 4), group, num);
}

/** Loads every map header of the game, ordered by group then num. */
export function loadAllMaps(rom: RomReader, gMapGroups = EMERALD_MAP_GROUPS): MapInfo[] {
  const table = readMapGroups(rom, gMapGroups);
  const cache = new Map<number, MapLayout>();
  const maps: MapInfo[] = [];
  table.groupAddrs.forEach((ga, g) => {
    for (let n = 0; n < table.counts[g]; n++) maps.push(readMapHeader(rom, rom.u32(ga + n * 4), g, n, cache));
  });
  return maps;
}

/** Grid accessors (out-of-range coordinates read the 2x2 border like the game does). */
export function blockAt(layout: MapLayout, x: number, y: number): number {
  if (x >= 0 && y >= 0 && x < layout.width && y < layout.height) return layout.grid[y * layout.width + x];
  return layout.border[((y & 1) << 1) | (x & 1)] | MAPGRID_COLLISION_MASK;
}
