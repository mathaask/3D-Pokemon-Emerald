// Histogram of impassable vertical runs between walkable cells of different elevation.
import fs from 'node:fs';
import path from 'node:path';
import { RomReader } from '../../src/game/rom/reader';
import { loadAllMaps, blockCollision, blockElevation } from '../../src/game/rom/maps';

const root = path.resolve(import.meta.dirname, '../..');
const romFile = fs.readdirSync(root).find((f) => f.endsWith('.gba'))!;
const rom = new RomReader(new Uint8Array(fs.readFileSync(path.join(root, romFile))));
const maps = loadAllMaps(rom);
const hist = new Map<string, number>();
const elevHist = new Map<string, number>();
for (const m of maps) {
  const L = m.layout;
  if (!L) continue;
  const W = L.width, H = L.height;
  for (let i = 0; i < W * H; i++) {
    const b = L.grid[i];
    const k = `${m.mapType}:e${blockElevation(b)}c${blockCollision(b) ? 1 : 0}`;
    elevHist.set(k, (elevHist.get(k) ?? 0) + 1);
  }
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H) {
      const b = L.grid[y * W + x];
      if (blockCollision(b) !== 0 || y === 0) { y++; continue; }
      // walkable at y; look for impassable run below
      let end = y + 1;
      while (end < H && blockCollision(L.grid[end * W + x]) !== 0) end++;
      if (end < H && end > y + 1) {
        const a = blockElevation(b), c = blockElevation(L.grid[end * W + x]);
        if (a !== c && a >= 3 && c >= 3 && a <= 14 && c <= 14) {
          const key = `up${a}->down${c} rows=${end - y - 1}`;
          hist.set(key, (hist.get(key) ?? 0) + 1);
        }
      }
      y = end;
    }
  }
}
console.log('maps', maps.length);
console.log([...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${v}\t${k}`).join('\n'));
console.log('--- elevation by mapType');
console.log([...elevHist.entries()].sort().map(([k, v]) => `${k}=${v}`).join('  '));
