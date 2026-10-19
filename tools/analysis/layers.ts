// Renders each PPU layer of a save state separately: tsx tools/analysis/layers.ts out/battle1.state name
import fs from 'node:fs';
import path from 'node:path';
import { Gba } from '../../src/gba/gba';
import { encodePng, upscale } from '../lib/png';
const [statePath, name] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, '../..');
const rom = fs.readdirSync(root).find((f) => f.endsWith('.gba'))!;
const gba = new Gba(new Uint8Array(fs.readFileSync(path.join(root, rom))));
gba.loadState(new Uint8Array(fs.readFileSync(path.join(root, statePath))));
const out = path.join(root, 'out/layers');
fs.mkdirSync(out, { recursive: true });
for (const [label, mask] of [['bg0', 1], ['bg1', 2], ['bg2', 4], ['bg3', 8], ['obj', 16]] as [string, number][]) {
  gba.ppu.overlayMask = mask;
  gba.runFrame();
  const img = new Uint8Array(gba.ppu.overlay.buffer.slice(0));
  // show transparent as magenta
  const u32 = new Uint32Array(img.buffer);
  for (let i = 0; i < u32.length; i++) if ((u32[i] >>> 24) === 0) u32[i] = 0xffff00ff;
  fs.writeFileSync(path.join(out, `${name}_${label}.png`), encodePng(480, 320, upscale(240, 160, img, 2)));
}
console.log('dispcnt', gba.bus.io16[0].toString(16), 'bgcnt', [4, 5, 6, 7].map((i) => gba.bus.io16[i].toString(16)).join(' '));
