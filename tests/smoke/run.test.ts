// Scripted headless run (APU stubbed). Env: FRAMES, SHOTS (comma list), INPUT (KEY@from-to,...), NAME, LOAD, SAVE
import { it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

it('run', async () => {
  const { Gba } = await import('../../src/gba/gba');
  const { KEY } = await import('../../src/gba/constants');
  const { encodePng, upscale } = await import('../../tools/lib/png');
  const root = path.resolve(__dirname, '../..');
  const rom = fs.readdirSync(root).find((f) => f.endsWith('.gba'))!;
  const gba = new Gba(new Uint8Array(fs.readFileSync(path.join(root, rom))), { now: () => new Date(2026, 9, 16, 10, 0, 0) });
  if (process.env.LOAD) gba.loadState(new Uint8Array(fs.readFileSync(process.env.LOAD)));
  const events = (process.env.INPUT ?? '').split(',').filter(Boolean).map((item) => {
    const [keys, when] = item.split('@');
    const mask = keys.split('+').reduce((m, k) => m | (KEY as Record<string, number>)[k.toUpperCase()], 0);
    const [from, to] = when.split('-').map(Number);
    return { from, to: to ?? from + 4, mask };
  });
  const name = process.env.NAME ?? 'run';
  const shots = (process.env.SHOTS ?? '').split(',').filter(Boolean).map(Number);
  const frames = Number(process.env.FRAMES ?? Math.max(0, ...shots));
  const out = path.join(root, 'out/shots');
  fs.mkdirSync(out, { recursive: true });
  for (let f = 1; f <= frames; f++) {
    gba.keys = events.reduce((m, e) => (f >= e.from && f <= e.to ? m | e.mask : m), 0);
    gba.runFrame();
    if (shots.includes(f)) {
      const fb = new Uint8Array(gba.ppu.framebuffer.buffer.slice(0));
      fs.writeFileSync(path.join(out, `${name}_${f}.png`), encodePng(480, 320, upscale(240, 160, fb, 2)));
    }
  }
  if (process.env.SAVE) fs.writeFileSync(process.env.SAVE, gba.saveState());
  console.log(`done ${frames} pc=${gba.cpu.nextPC().toString(16)}`);
}, 600000);
