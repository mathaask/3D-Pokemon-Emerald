// Drives the headless emulator with a small command language and saves screenshots/states.
//
//   npx tsx tools/play.ts --load out/lr_out.state --save out/next.state "A*6/40" "wait 120" "UP 3" "shot here"
//
// Commands:
//   KEY            press KEY for 4 frames, then release for 8
//   KEY*N/G        press KEY N times, G frames apart (default G = 30)
//   UP|DOWN|LEFT|RIGHT N   hold direction for N tiles (16 frames per tile, walking speed)
//   hold KEY F     hold KEY for F frames
//   wait F         run F frames with no input
//   shot NAME      write out/play/NAME.png
//   state NAME     write out/play/NAME.state
//   fasttext       set the in-game text speed option to FAST
//   until-battle D1 D2 [max]  pace between two directions until a battle (transition) starts
//   until-map G.N [max]   run (pressing A every 30 frames) until the player is on map G.N

import fs from 'node:fs';
import path from 'node:path';
import { Gba } from '../src/gba/gba';
import { KEY } from '../src/gba/constants';
import { GameState } from '../src/game/state';
import { SYM } from '../src/game/symbols';
import { encodePng, upscale } from './lib/png';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
let load = '';
let save = '';
let savFile = '';
const cmds: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--load') load = args[++i];
  else if (args[i] === '--save') save = args[++i];
  else if (args[i] === '--sav') savFile = args[++i];
  else cmds.push(args[i]);
}

const romFile = fs.readdirSync(root).find((f) => f.toLowerCase().endsWith('.gba'))!;
const gba = new Gba(new Uint8Array(fs.readFileSync(path.join(root, romFile))), {
  now: () => new Date(2026, 9, 16, 10, 0, 0),
});
if (savFile) gba.loadSave(new Uint8Array(fs.readFileSync(path.join(root, savFile))));
if (load) gba.loadState(new Uint8Array(fs.readFileSync(path.join(root, load))));
const state = new GameState(gba.bus);
const outDir = path.join(root, 'out/play');
fs.mkdirSync(outDir, { recursive: true });

const keyBit = (k: string): number => {
  const b = (KEY as Record<string, number>)[k.toUpperCase()];
  if (b === undefined) throw new Error(`unknown key ${k}`);
  return b;
};

function frames(n: number, keys = 0): void {
  for (let i = 0; i < n; i++) {
    gba.keys = keys;
    gba.runFrame();
  }
}

function shot(name: string): void {
  const fb = new Uint8Array(gba.ppu.framebuffer.buffer.slice(0));
  fs.writeFileSync(path.join(outDir, `${name}.png`), encodePng(480, 320, upscale(240, 160, fb, 2)));
}

for (const cmd of cmds) {
  const parts = cmd.trim().split(/\s+/);
  const head = parts[0];
  if (head === 'wait') frames(parseInt(parts[1], 10));
  else if (head === 'shot') shot(parts[1]);
  else if (head === 'fasttext') {
    // OPTIONS_TEXT_SPEED_FAST in gSaveBlock2 (bits 0-2 of the u16 at +0x14)
    const sb2 = state.mem.u32(SYM.gSaveBlock2Ptr);
    const v = gba.bus.read16(sb2 + 0x14);
    gba.bus.write16(sb2 + 0x14, (v & ~7) | 2);
  }
  else if (head === 'state') fs.writeFileSync(path.join(outDir, `${parts[1]}.state`), gba.saveState());
  else if (head === 'flash') fs.writeFileSync(path.join(outDir, `${parts[1]}.sav`), gba.getSave());
  else if (head === 'hold') frames(parseInt(parts[2], 10), keyBit(parts[1]));
  else if (['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(head.toUpperCase()) && parts[1]) {
    frames(parseInt(parts[1], 10) * 16, keyBit(head));
    frames(2);
  } else if (head === 'until-battle') {
    // pace between two directions until a battle transition starts
    const a = keyBit(parts[1]), b = keyBit(parts[2]);
    const max = parseInt(parts[3] ?? '6000', 10);
    let f = 0, dir = a, stepFrames = 0;
    for (; f < max; f++) {
      state.update();
      if (state.scene === 'battleTransition' || state.scene === 'battle') break;
      gba.keys = dir;
      gba.runFrame();
      if (++stepFrames >= 32) { stepFrames = 0; dir = dir === a ? b : a; }
    }
    gba.keys = 0;
    console.log(`until-battle: ${f >= max ? 'TIMEOUT' : 'ok'} after ${f} frames (scene ${state.scene})`);
  } else if (head === 'until-map') {
    const [g, n] = parts[1].split('.').map(Number);
    const max = parseInt(parts[2] ?? '3000', 10);
    let f = 0;
    for (; f < max; f += 30) {
      state.update();
      if (state.mapGroup === g && state.mapNum === n && state.scene === 'overworld') break;
      frames(4, KEY.A);
      frames(26);
    }
    console.log(`until-map ${parts[1]}: ${f >= max ? 'TIMEOUT' : 'ok'} after ${f} frames`);
  } else {
    const m = /^(\w+)(?:\*(\d+)(?:\/(\d+))?)?$/.exec(head);
    if (!m) throw new Error(`bad command ${cmd}`);
    const bit = keyBit(m[1]);
    const count = m[2] ? parseInt(m[2], 10) : 1;
    const gap = m[3] ? parseInt(m[3], 10) : 30;
    for (let k = 0; k < count; k++) {
      frames(4, bit);
      frames(Math.max(4, gap - 4));
    }
  }
}
state.update();
console.log(`scene=${state.scene} map=${state.mapGroup}.${state.mapNum} pos=${state.posX},${state.posY} frame=${gba.frameCount}`);
if (save) fs.writeFileSync(path.join(root, save), gba.saveState());
