// Headless runner: boots the ROM in Node, feeds scripted input, writes PNG screenshots.
//
//   npx tsx tools/headless.ts --frames 2000 --shots 300,900,1500 --input "START@1000,A@1200-1205"
//   npx tsx tools/headless.ts --load-state out/s.state --frames 600 --shots 600 --save-state out/s2.state
//
// Input items: KEY@frame (5-frame press), KEY@from-to, or KEY+KEY@... ; keys: A B L R START SELECT UP DOWN LEFT RIGHT.

import fs from 'node:fs';
import path from 'node:path';
import { Gba } from '../src/gba/gba';
import { KEY } from '../src/gba/constants';
import { encodePng, upscale } from './lib/png';

interface Args {
  rom: string;
  frames: number;
  shots: number[];
  every: number;
  input: string;
  out: string;
  name: string;
  scale: number;
  loadState?: string;
  saveState?: string;
  saveFile?: string;
  writeSave?: string;
  quiet: boolean;
}

function parseArgs(argv: string[]): Args {
  const root = path.resolve(import.meta.dirname, '..');
  const rom = fs.readdirSync(root).find((f) => f.toLowerCase().endsWith('.gba')) ?? '';
  const a: Args = {
    rom: path.join(root, rom), frames: 600, shots: [], every: 0, input: '', out: path.join(root, 'out/shots'),
    name: 'shot', scale: 2, quiet: false,
  };
  for (let k = 0; k < argv.length; k++) {
    const v = argv[k + 1];
    switch (argv[k]) {
      case '--rom': a.rom = v; k++; break;
      case '--frames': a.frames = parseInt(v, 10); k++; break;
      case '--shots': a.shots = v.split(',').map((s) => parseInt(s, 10)); k++; break;
      case '--every': a.every = parseInt(v, 10); k++; break;
      case '--input': a.input = v; k++; break;
      case '--input-file': a.input = fs.readFileSync(v, 'utf8').replace(/\s+/g, ','); k++; break;
      case '--out': a.out = v; k++; break;
      case '--name': a.name = v; k++; break;
      case '--scale': a.scale = parseInt(v, 10); k++; break;
      case '--load-state': a.loadState = v; k++; break;
      case '--save-state': a.saveState = v; k++; break;
      case '--save': a.saveFile = v; k++; break;
      case '--write-save': a.writeSave = v; k++; break;
      case '--quiet': a.quiet = true; break;
    }
  }
  return a;
}

/** Expands the input script into a per-frame key mask lookup. */
function buildInput(script: string): (frame: number) => number {
  const events: { from: number; to: number; mask: number }[] = [];
  for (const item of script.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [keys, when] = item.split('@');
    let mask = 0;
    for (const k of keys.split('+')) {
      const bit = (KEY as Record<string, number>)[k.toUpperCase()];
      if (bit === undefined) throw new Error(`unknown key ${k}`);
      mask |= bit;
    }
    const [from, to] = when.split('-').map((s) => parseInt(s, 10));
    events.push({ from, to: to ?? from + 4, mask });
  }
  return (frame) => {
    let m = 0;
    for (const e of events) if (frame >= e.from && frame <= e.to) m |= e.mask;
    return m;
  };
}

function writeShot(gba: Gba, file: string, scale: number): void {
  const fb = new Uint8Array(gba.ppu.framebuffer.buffer.slice(0));
  const img = scale > 1 ? upscale(240, 160, fb, scale) : fb;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePng(240 * scale, 160 * scale, img));
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const gba = new Gba(new Uint8Array(fs.readFileSync(args.rom)), {
    now: () => new Date(2026, 9, 16, 10, 0, 0),
  });
  const unknownSwi = new Set<number>();
  gba.bios.logUnknown = (n) => unknownSwi.add(n);
  let undefinedCount = 0;
  gba.cpu.undefinedHandler = (op, thumb) => {
    if (undefinedCount++ < 5) {
      console.warn(`undefined ${thumb ? 'THUMB' : 'ARM'} op ${op.toString(16)} at ${gba.cpu.currentPC().toString(16)}`);
    }
  };
  if (args.saveFile && fs.existsSync(args.saveFile)) gba.loadSave(new Uint8Array(fs.readFileSync(args.saveFile)));
  let startFrame = 0;
  if (args.loadState) {
    gba.loadState(new Uint8Array(fs.readFileSync(args.loadState)));
    startFrame = gba.frameCount;
  }
  const input = buildInput(args.input);
  const shots = new Set(args.shots);
  const t0 = performance.now();
  for (let f = startFrame; f < startFrame + args.frames; f++) {
    gba.keys = input(f - startFrame);
    gba.runFrame();
    // drain audio so the ring buffer doesn't matter
    const rel = f - startFrame + 1;
    if (shots.has(rel) || (args.every > 0 && rel % args.every === 0)) {
      const file = path.join(args.out, `${args.name}_${String(rel).padStart(5, '0')}.png`);
      writeShot(gba, file, args.scale);
      if (!args.quiet) console.log(`shot ${file}`);
    }
  }
  const ms = performance.now() - t0;
  if (!args.quiet) {
    console.log(`${args.frames} frames in ${ms.toFixed(0)} ms (${((args.frames / ms) * 1000).toFixed(1)} fps), pc=${gba.cpu.nextPC().toString(16)} t=${gba.cpu.t}`);
  }
  if (unknownSwi.size) console.warn(`unknown SWIs: ${[...unknownSwi].map((n) => n.toString(16)).join(', ')}`);
  if (args.saveState) {
    fs.mkdirSync(path.dirname(args.saveState), { recursive: true });
    fs.writeFileSync(args.saveState, gba.saveState());
  }
  if (args.writeSave) fs.writeFileSync(args.writeSave, gba.getSave());
}

main();
