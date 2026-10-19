// Builds classifier inputs for any map straight from the ROM (no emulator, no GPU), the same
// way the browser preview does: tiles into a scratch VRAM, palettes 0-12, metatile analysis.

import fs from 'node:fs';
import path from 'node:path';
import { Bus } from '../../../src/gba/bus';
import { Mem } from '../../../src/game/mem';
import { RomReader } from '../../../src/game/rom/reader';
import { loadMap, type MapInfo } from '../../../src/game/rom/maps';
import { loadTileset } from '../../../src/game/rom/tileset';
import { SYM } from '../../../src/game/symbols';
import { MetatileAtlas } from '../../../src/render/overworld/metatileAtlas';
import { analyzeMetatiles, type TileInfo } from '../../../src/render/overworld/tileInfo';
import type { GridData } from '../../../src/render/overworld/world';
import type { ClassifyOptions } from '../../../src/render/overworld/classify';

const root = path.resolve(import.meta.dirname, '../../..');
let romBytes: Uint8Array | null = null;

export function loadRom(): Uint8Array {
  if (!romBytes) {
    const f = fs.readdirSync(root).find((n) => n.toLowerCase().endsWith('.gba'));
    if (!f) throw new Error('No .gba ROM in the project root');
    romBytes = new Uint8Array(fs.readFileSync(path.join(root, f)));
  }
  return romBytes;
}

export interface StaticMap {
  map: MapInfo;
  rom: RomReader;
  grid: GridData;
  info: TileInfo;
  opts: Omit<ClassifyOptions, 'margin'>;
}

export function loadStaticMap(group: number, num: number): StaticMap {
  const bytes = loadRom();
  const rom = new RomReader(bytes);
  const map = loadMap(rom, group, num);
  const primary = loadTileset(rom, map.layout.primaryTileset);
  const secondary = loadTileset(rom, map.layout.secondaryTileset);
  const bus = new Bus(bytes);
  bus.vram.set(primary.tiles.subarray(0, 0x4000), 0);
  bus.vram.set(secondary.tiles.subarray(0, 0x4000), 0x4000);
  const palette = new Uint16Array(256);
  palette.set(primary.palettes.subarray(0, 6 * 16), 0);
  palette.set(secondary.palettes.subarray(6 * 16, 13 * 16), 6 * 16);
  palette[0] = 0;
  const atlas = new MetatileAtlas({ vram: null, palette: null } as never, 1);
  atlas.setTilesets(new Mem(bus), map.layout.primaryTileset, map.layout.secondaryTileset);
  const info = analyzeMetatiles(bus, atlas.entries, atlas.attributes, 0, palette);
  return {
    map,
    rom,
    info,
    grid: {
      width: map.layout.width, height: map.layout.height, cells: map.layout.grid,
      border: [...map.layout.border], borderW: 2, borderH: 2, borderPhase: 0,
    },
    opts: {
      info,
      generalPrimary: map.layout.primaryTileset === SYM.gTileset_General,
      indoor: map.mapType === 8 || map.mapType === 9,
      underground: map.mapType === 4,
      underwater: map.mapType === 5,
      secondaryTileset: map.layout.secondaryTileset,
    },
  };
}
