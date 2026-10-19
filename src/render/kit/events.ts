// Map events (ROM, map-local coordinates) → grid-space doors and signs for the semantic layer.

import { mapName, BgEventKind, type MapEvents } from '../../game/rom/maps';

export interface GridWarp { x: number; y: number; dest: string }
export interface GridSign { x: number; y: number }
export interface GridEvents { warps: GridWarp[]; signs: GridSign[] }

export const NO_EVENTS: GridEvents = { warps: [], signs: [] };

/** `offset` is MAP_OFFSET (7) for the live backup grid and 0 for the static preview grid. */
export function gridEvents(ev: MapEvents, offset: number): GridEvents {
  return {
    warps: ev.warps.map((w) => ({ x: w.x + offset, y: w.y + offset, dest: mapName(w.mapGroup, w.mapNum) })),
    signs: ev.bgEvents
      .filter((b) => b.kind <= BgEventKind.FACING_WEST)
      .map((b) => ({ x: b.x + offset, y: b.y + offset })),
  };
}
