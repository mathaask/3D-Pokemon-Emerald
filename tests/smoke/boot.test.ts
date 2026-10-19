import { it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';


it('boots', async () => {
  const { Gba } = await import('../../src/gba/gba');
  const { encodePng, upscale } = await import('../../tools/lib/png');
  const root = path.resolve(__dirname, '../..');
  const rom = fs.readdirSync(root).find((f) => f.endsWith('.gba'))!;
  const gba = new Gba(new Uint8Array(fs.readFileSync(path.join(root, rom))));
  let undef = 0;
  gba.cpu.undefinedHandler = (op, t) => { if (undef++ < 5) console.log('undef', t, op.toString(16), gba.cpu.currentPC().toString(16)); };
  const out = path.join(root, 'out/shots');
  fs.mkdirSync(out, { recursive: true });
  const shots = (process.env.SHOTS ?? '60,200,400,700,1000').split(',').map(Number);
  const frames = Math.max(...shots);
  const t0 = performance.now();
  for (let f = 1; f <= frames; f++) {
    gba.runFrame();
    if (shots.includes(f)) {
      const fb = new Uint8Array(gba.ppu.framebuffer.buffer.slice(0));
      fs.writeFileSync(path.join(out, `boot_${f}.png`), encodePng(480, 320, upscale(240, 160, fb, 2)));
    }
  }
  console.log(`${frames} frames in ${(performance.now() - t0).toFixed(0)}ms pc=${gba.cpu.nextPC().toString(16)}`);
}, 120000);
