// Prints metatile ids/collision/layer/top coverage for a map region: tsx tools/analysis/cells.ts 0 9 0 0 6 20
import fs from 'node:fs';
import path from 'node:path';
import { RomReader } from '../../src/game/rom/reader';
import { loadMap } from '../../src/game/rom/maps';
import { loadTileset } from '../../src/game/rom/tileset';
const [g, n, x0, y0, x1, y1] = process.argv.slice(2).map(Number);
const root = path.resolve(import.meta.dirname, '../..');
const rom = new RomReader(new Uint8Array(fs.readFileSync(path.join(root, fs.readdirSync(root).find((f) => f.endsWith('.gba'))!))));
const map = loadMap(rom, g, n);
const p = loadTileset(rom, map.layout.primaryTileset);
const s = loadTileset(rom, map.layout.secondaryTileset);
const meta = (id: number) => (id < 512 ? { ts: p, i: id } : { ts: s, i: id - 512 });
const cover = (id: number, layer: number) => {
  const { ts, i } = meta(id);
  let c = 0;
  for (let k = 0; k < 4; k++) {
    const e = ts.metatiles[i * 8 + layer * 4 + k];
    const tile = e & 0x3ff;
    const src = tile < 512 ? p : s;
    const t = tile < 512 ? tile : tile - 512;
    for (let px = 0; px < 64; px++) if (src.pixels[t * 64 + px]) c++;
  }
  return c;
};
console.log(`${map.name} ${map.layout.width}x${map.layout.height}`);
for (let y = y0; y <= y1; y++) {
  const row: string[] = [];
  for (let x = x0; x <= x1; x++) {
    const b = map.layout.grid[y * map.layout.width + x];
    const id = b & 0x3ff;
    const { ts, i } = meta(id);
    const attr = ts.attributes[i] ?? 0;
    row.push(`${id.toString(16).padStart(3, '0')}${(b >> 10) & 3 ? '#' : '.'}e${(b >> 12).toString(16)}${['N', 'C', 'S'][attr >> 12] ?? '?'}${cover(id, 0).toString().padStart(3)}/${cover(id, 1).toString().padStart(3)}`);
  }
  console.log(y.toString().padStart(2), row.join(' '));
}
