// Map events (ROM, map-local coordinates) → grid-space doors and signs for the semantic layer.

import {
  mapName, mapHeaderAddr, readConnections, readEvents, BgEventKind, Connection, type MapEvents,
} from '../../game/rom/maps';
import type { RomReader } from '../../game/rom/reader';

export interface GridWarp { x: number; y: number; dest: string }
export interface GridSign { x: number; y: number }
export interface GridEvents { warps: GridWarp[]; signs: GridSign[] }

export const NO_EVENTS: GridEvents = { warps: [], signs: [] };

/**
 * Events moved by (dx, dy) into grid coordinates: MAP_OFFSET (7) for the current map in the live
 * backup grid, 0 for the static preview grid, a strip's shift (stripPlacement) for a connected map.
 */
export function gridEvents(ev: MapEvents, dx: number, dy = dx): GridEvents {
  return {
    warps: ev.warps.map((w) => ({ x: w.x + dx, y: w.y + dy, dest: mapName(w.mapGroup, w.mapNum) })),
    signs: ev.bgEvents
      .filter((b) => b.kind <= BgEventKind.FACING_WEST)
      .map((b) => ({ x: b.x + dx, y: b.y + dy })),
  };
}

export interface MapSize { width: number; height: number }

/** Where a connected map's cells land in the live backup grid. */
export interface StripPlacement {
  /** Backup-grid cell = connected-map cell + (dx, dy). */
  dx: number;
  dy: number;
  /** The cells the game copies from the connected map: [x0, x1) × [y0, y1), backup-grid coordinates. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * A connected map's strip in the live backup grid (gBackupMapLayout), as pokeemerald's fieldmap.c
 * lays it out (Fill{South,North,West,East}Connection; the grid is the current map plus
 * MAP_OFFSET_W = 2·MAP_OFFSET + 1 columns and MAP_OFFSET_H = 2·MAP_OFFSET rows, the map at
 * (MAP_OFFSET, MAP_OFFSET)):
 *  - south: the connected map's top MAP_OFFSET rows below the map, column + offset + MAP_OFFSET;
 *  - north: its bottom MAP_OFFSET rows in rows 0..MAP_OFFSET-1, column + offset + MAP_OFFSET;
 *  - west: its right MAP_OFFSET columns in columns 0..MAP_OFFSET-1, row + offset + MAP_OFFSET;
 *  - east: its left MAP_OFFSET + 1 columns right of the map (to the grid's edge), row + offset +
 *    MAP_OFFSET;
 * each clipped to the connected map and the grid. Dive/emerge connections are not laid out; null
 * for those and for a strip that falls off the grid.
 */
export function stripPlacement(direction: number, offset: number, main: MapSize, conn: MapSize,
  mapOffset: number): StripPlacement | null {
  const gridW = main.width + 2 * mapOffset + 1;
  const gridH = main.height + 2 * mapOffset;
  let dx: number, dy: number;
  // the band of the grid the strip may fill: [bx0, bx1) × [by0, by1)
  let bx0 = 0, bx1 = gridW, by0 = 0, by1 = gridH;
  switch (direction) {
    case Connection.SOUTH:
      dx = offset + mapOffset; dy = main.height + mapOffset;
      by0 = dy; by1 = dy + mapOffset;
      break;
    case Connection.NORTH:
      dx = offset + mapOffset; dy = mapOffset - conn.height;
      by1 = mapOffset;
      break;
    case Connection.WEST:
      dx = mapOffset - conn.width; dy = offset + mapOffset;
      bx1 = mapOffset;
      break;
    case Connection.EAST:
      dx = main.width + mapOffset; dy = offset + mapOffset;
      bx0 = dx; bx1 = dx + mapOffset + 1;
      break;
    default:
      return null;
  }
  const x0 = Math.max(bx0, dx, 0), x1 = Math.min(bx1, dx + conn.width, gridW);
  const y0 = Math.max(by0, dy, 0), y1 = Math.min(by1, dy + conn.height, gridH);
  return x0 < x1 && y0 < y1 ? { dx, dy, x0, y0, x1, y1 } : null;
}

export interface ConnectedEvents { placement: StripPlacement; events: MapEvents }

const inStrip = (p: StripPlacement, x: number, y: number) => x >= p.x0 && x < p.x1 && y >= p.y0 && y < p.y1;

/**
 * The live backup grid's events: the current map's at (mapOffset, mapOffset), then each connected
 * map's moved into its strip, keeping only those on the cells the game copied there (connections
 * are copied in order, so a cell two strips share shows — and belongs to — the later one).
 */
export function backupGridEvents(own: MapEvents, connected: ConnectedEvents[], mapOffset: number): GridEvents {
  const out = gridEvents(own, mapOffset);
  connected.forEach(({ placement: p, events }, i) => {
    const later = connected.slice(i + 1);
    const shows = (x: number, y: number) => inStrip(p, x, y) && !later.some((c) => inStrip(c.placement, x, y));
    const g = gridEvents(events, p.dx, p.dy);
    for (const w of g.warps) if (shows(w.x, w.y)) out.warps.push(w);
    for (const s of g.signs) if (shows(s.x, s.y)) out.signs.push(s);
  });
  return out;
}

/**
 * Warps and signs of the live backup grid from the ROM: the current map's events table plus those
 * of every map its connections table (MapHeader.connections) lays out around it. `main` is the
 * current map's layout size.
 */
export function liveGridEvents(rom: RomReader, eventsAddr: number, connectionsAddr: number, main: MapSize,
  mapOffset: number): GridEvents {
  const connected: ConnectedEvents[] = [];
  for (const c of readConnections(rom, connectionsAddr)) {
    const header = mapHeaderAddr(rom, c.mapGroup, c.mapNum);
    if (!header) continue;
    const layout = rom.u32(header);
    const conn = { width: rom.s32(layout), height: rom.s32(layout + 4) };
    const placement = stripPlacement(c.direction, c.offset, main, conn, mapOffset);
    if (placement) connected.push({ placement, events: readEvents(rom, rom.u32(header + 4)) });
  }
  return backupGridEvents(readEvents(rom, eventsAddr), connected, mapOffset);
}
