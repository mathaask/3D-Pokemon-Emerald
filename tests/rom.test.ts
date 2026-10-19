import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RomReader, lz77Decompress, decodeText, encodeText, loadAllMaps, loadMap, readMapGroups, loadTileset,
  renderMetatile, tilesetPair, blockMetatile, blockElevation, blockCollision, MB, Connection,
} from '../src/game/rom/index';
import { MAP_NAMES, findMap } from '../src/game/mapNames';
import { SYM } from '../src/game/symbols';

const root = path.resolve(import.meta.dirname, '..');
const romPath = path.join(root, 'Pokemon_Emerald-.gba');
const hasRom = fs.existsSync(romPath);
const mapGroupsJson = path.join(root, 'vendor/pokeemerald-src/data/maps/map_groups.json');

/** Minimal greedy GBA LZ77 (type 0x10) compressor, used to round-trip the decompressor. */
function lz77Compress(src: Uint8Array): Uint8Array {
  const out: number[] = [0x10, src.length & 0xff, (src.length >> 8) & 0xff, (src.length >> 16) & 0xff];
  let i = 0;
  while (i < src.length) {
    const flagPos = out.length;
    out.push(0);
    for (let bit = 7; bit >= 0 && i < src.length; bit--) {
      let bestLen = 0;
      let bestDisp = 0;
      for (let d = 1; d <= Math.min(4096, i); d++) {
        let l = 0;
        while (l < 18 && i + l < src.length && src[i + l] === src[i + l - d]) l++;
        if (l > bestLen) {
          bestLen = l;
          bestDisp = d;
        }
      }
      if (bestLen >= 3) {
        out[flagPos] |= 1 << bit;
        out.push(((bestLen - 3) << 4) | ((bestDisp - 1) >> 8), (bestDisp - 1) & 0xff);
        i += bestLen;
      } else {
        out.push(src[i++]);
      }
    }
  }
  while (out.length % 4) out.push(0);
  return Uint8Array.from(out);
}

describe('LZ77', () => {
  it('decodes a hand-built stream with an overlapping back-reference', () => {
    // "AB" literals, then copy len 6 from disp 2 -> "ABABABAB"
    const data = Uint8Array.from([0x10, 8, 0, 0, 0b00100000, 0x41, 0x42, 0x30, 0x01]);
    expect(Array.from(lz77Decompress(data))).toEqual(Array.from(new TextEncoder().encode('ABABABAB')));
  });

  it('round-trips synthetic data through a reference compressor', () => {
    const src = new Uint8Array(5000);
    let seed = 1234;
    for (let i = 0; i < src.length; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      // mix of runs, repeats and noise
      src[i] = i % 700 < 300 ? (i >> 4) & 0xff : i % 700 < 400 ? 0x55 : (seed >>> 24) & 0xff;
    }
    const packed = lz77Compress(src);
    expect(packed.length).toBeLessThan(src.length);
    expect(Array.from(lz77Decompress(packed))).toEqual(Array.from(src));
    // also via RomReader at a GBA address
    const rom = new RomReader(packed);
    expect(rom.lz77Size(0x08000000)).toBe(src.length);
    expect(Array.from(rom.lz77(0x08000000))).toEqual(Array.from(src));
  });

  it('rejects non-LZ77 data', () => {
    expect(() => lz77Decompress(Uint8Array.from([0x11, 1, 0, 0, 0, 0]))).toThrow();
  });
});

describe('text', () => {
  it('decodes the Gen-3 charset and control codes', () => {
    const bytes = Uint8Array.from([0xc2, 0xd9, 0xe0, 0xe0, 0xe3, 0xb8, 0x00, 0xa2, 0xa3, 0xab, 0xfe, 0xcf, 0xff, 0xbb]);
    expect(decodeText(bytes)).toBe('Hello, 12!\nU');
    expect(decodeText(encodeText('POKe Ball 7?'))).toBe('POKe Ball 7?');
    expect(decodeText(Uint8Array.from([0xfd, 0x01, 0xff]))).toBe('{PLAYER}');
    expect(decodeText(Uint8Array.from([0xfc, 0x01, 0x02, 0xbb, 0xff]))).toBe('A');
  });
});

describe.skipIf(!hasRom)('ROM maps and tilesets', () => {
  const rom = hasRom ? new RomReader(new Uint8Array(fs.readFileSync(romPath))) : (null as unknown as RomReader);

  it('decodes species names', () => {
    expect(decodeText(rom, SYM.gSpeciesNames + 277 * 11, 11)).toBe('TREECKO');
    expect(decodeText(rom, SYM.gSpeciesNames + 1 * 11, 11)).toBe('BULBASAUR');
  });

  it('infers all map groups and counts', () => {
    const table = readMapGroups(rom, SYM.gMapGroups);
    expect(table.counts.length).toBe(34);
    expect(table.counts.reduce((a, b) => a + b, 0)).toBe(518);
    expect(table.counts).toEqual(MAP_NAMES.map((g) => g.length));
    const maps = loadAllMaps(rom, SYM.gMapGroups);
    expect(maps.length).toBe(518);
    for (const m of maps) {
      expect(m.layout.grid.length).toBe(m.layout.width * m.layout.height);
      expect(rom.isRomPtr(m.layout.primaryTileset)).toBe(true);
    }
  });

  it('finds Littleroot Town at group 0 num 9 with the expected layout', () => {
    if (fs.existsSync(mapGroupsJson)) {
      const json = JSON.parse(fs.readFileSync(mapGroupsJson, 'utf8'));
      expect(json[json.group_order[0]].indexOf('LittlerootTown')).toBe(9);
    }
    expect(findMap('LittlerootTown')).toEqual([0, 9]);
    const m = loadMap(rom, 0, 9, SYM.gMapGroups);
    expect(m.name).toBe('LittlerootTown');
    expect(m.layout.width).toBe(20);
    expect(m.layout.height).toBe(20);
    expect(m.layout.primaryTileset).toBe(SYM.gTileset_General);
    expect(m.layout.secondaryTileset).toBe(SYM.gTileset_Petalburg);
    expect(m.connections).toEqual([{ direction: Connection.NORTH, offset: 0, mapGroup: 0, mapNum: 16 }]);
    expect(m.events.warps.length).toBe(3);
    expect(m.events.objects.length).toBeGreaterThan(3);
    // Brendan's house door: Petalburg metatile 0x248 with ANIMATED_DOOR behaviour at (5, 8)
    const b = m.layout.grid[8 * 20 + 5];
    expect(blockMetatile(b)).toBe(0x248);
    expect(blockCollision(b)).toBe(1);
    expect(blockElevation(m.layout.grid[9 * 20 + 5])).toBe(3);
  });

  it('decodes tilesets and renders metatiles', () => {
    const general = loadTileset(rom, SYM.gTileset_General);
    const petalburg = loadTileset(rom, SYM.gTileset_Petalburg);
    expect(general.isSecondary).toBe(false);
    expect(general.numMetatiles).toBe(512);
    expect(general.numTiles).toBe(512);
    expect(petalburg.isSecondary).toBe(true);
    expect(petalburg.numMetatiles).toBe(144);
    const pair = tilesetPair(general, petalburg);
    expect(pair.behavior(0x00d)).toBe(MB.TALL_GRASS);
    expect(pair.behavior(0x248)).toBe(MB.ANIMATED_DOOR);
    const grass = renderMetatile(general, petalburg, 0x001, 'both');
    expect(grass.length).toBe(16 * 16 * 4);
    for (let i = 3; i < grass.length; i += 4) expect(grass[i]).toBe(255);
    const emptyTop = renderMetatile(general, petalburg, 0x001, 'top');
    expect(emptyTop.every((v) => v === 0)).toBe(true);
  });
});
