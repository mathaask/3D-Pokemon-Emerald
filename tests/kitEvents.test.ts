import { describe, it, expect } from 'vitest';
import { gridEvents } from '../src/render/kit/events';
import type { MapEvents } from '../src/game/rom/maps';

const ev: MapEvents = {
  objects: [],
  coordEvents: [],
  warps: [{ x: 5, y: 8, elevation: 0, warpId: 0, mapGroup: 1, mapNum: 0 }],
  bgEvents: [
    { x: 3, y: 4, elevation: 0, kind: 0, script: 0x08000000 },
    { x: 6, y: 4, elevation: 0, kind: 2, script: 0x08000000 },
    { x: 9, y: 9, elevation: 0, kind: 7, hiddenItem: { item: 1, hiddenItemId: 2 } },
  ],
};

describe('gridEvents', () => {
  it('shifts live coordinates by MAP_OFFSET and keeps preview coordinates', () => {
    expect(gridEvents(ev, 7).warps[0]).toMatchObject({ x: 12, y: 15 });
    expect(gridEvents(ev, 0).warps[0]).toMatchObject({ x: 5, y: 8 });
  });
  it('names warp destinations', () => {
    expect(gridEvents(ev, 0).warps[0].dest).toBe('LittlerootTown_BrendansHouse_1F');
  });
  it('keeps interactable signs, drops hidden items', () => {
    expect(gridEvents(ev, 7).signs).toEqual([{ x: 10, y: 11 }, { x: 13, y: 11 }]);
  });
});
