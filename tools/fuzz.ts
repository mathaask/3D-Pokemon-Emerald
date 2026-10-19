// Random-input soak test: mashes buttons for N frames and reports emulator anomalies
// (undefined instructions, unknown SWIs, PC outside executable memory).
//   npx tsx tools/fuzz.ts out/r101.state 30000 [seed]

import fs from 'node:fs';
import path from 'node:path';
import { Gba } from '../src/gba/gba';
import { GameState } from '../src/game/state';

const [statePath, framesArg, seedArg] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, '..');
const rom = fs.readdirSync(root).find((f) => f.endsWith('.gba'))!;
const gba = new Gba(new Uint8Array(fs.readFileSync(path.join(root, rom))));
if (statePath) gba.loadState(new Uint8Array(fs.readFileSync(path.join(root, statePath))));
const frames = parseInt(framesArg ?? '20000', 10);
let seed = parseInt(seedArg ?? '1', 10) >>> 0;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const issues = new Map<string, number>();
const note = (k: string) => issues.set(k, (issues.get(k) ?? 0) + 1);
gba.cpu.undefinedHandler = (op, thumb) => note(`undefined ${thumb ? 'T' : 'A'} ${op.toString(16)} @${gba.cpu.currentPC().toString(16)}`);
gba.bios.logUnknown = (n) => note(`swi ${n.toString(16)}`);
const st = new GameState(gba.bus);
const scenes = new Map<string, number>();
const maps = new Set<string>();
let keys = 0;
let hold = 0;
const t0 = performance.now();
for (let f = 0; f < frames; f++) {
  if (hold-- <= 0) {
    // Bias towards movement and A/B; avoid START+SELECT+A+B (soft reset) chords.
    const r = rnd();
    keys = r < 0.55 ? 1 << (4 + Math.floor(rnd() * 4)) : r < 0.8 ? 1 : r < 0.93 ? 2 : r < 0.97 ? 8 : 0;
    hold = 4 + Math.floor(rnd() * 40);
  }
  gba.keys = keys;
  gba.runFrame();
  const pc = gba.cpu.nextPC();
  const region = pc >>> 24;
  if (region !== 0x08 && region !== 0x03 && region !== 0x02 && region !== 0x00) note(`pc ${pc.toString(16)}`);
  if (f % 60 === 0) {
    st.update();
    scenes.set(st.scene, (scenes.get(st.scene) ?? 0) + 1);
    if (st.scene === 'overworld') maps.add(`${st.mapGroup}.${st.mapNum}`);
  }
}
const secs = (performance.now() - t0) / 1000;
console.log(`${frames} frames in ${secs.toFixed(1)}s (${(frames / secs).toFixed(0)} fps)`);
console.log('scenes', JSON.stringify(Object.fromEntries(scenes)));
console.log('maps visited', [...maps].join(' '));
console.log(issues.size ? [...issues].map(([k, n]) => `${n}x ${k}`).join('\n') : 'no anomalies');
fs.writeFileSync(path.join(root, 'out/fuzz.state'), gba.saveState());
