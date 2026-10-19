// Records audio from a scripted run into out/audio.wav and prints level statistics.
import { it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

it('audio', async () => {
  const { Gba } = await import('../../src/gba/gba');
  const root = path.resolve(import.meta.dirname, '../..');
  const rom = fs.readdirSync(root).find((f) => f.endsWith('.gba'))!;
  const gba = new Gba(new Uint8Array(fs.readFileSync(path.join(root, rom))), { sampleRate: 32768 });
  if (process.env.LOAD) gba.loadState(new Uint8Array(fs.readFileSync(path.join(root, process.env.LOAD))));
  const frames = Number(process.env.FRAMES ?? 2400);
  const skip = Number(process.env.SKIP ?? 0);
  const chunks: Float32Array[] = [];
  const buf = new Float32Array(8192);
  for (let f = 0; f < frames; f++) {
    gba.runFrame();
    for (;;) {
      const n = gba.apu.drain(buf);
      if (!n) break;
      if (f >= skip) chunks.push(buf.slice(0, n * 2));
    }
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const pcm = Buffer.alloc(44 + total * 2);
  pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + total * 2, 4); pcm.write('WAVE', 8); pcm.write('fmt ', 12);
  pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22); pcm.writeUInt32LE(32768, 24);
  pcm.writeUInt32LE(32768 * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36);
  pcm.writeUInt32LE(total * 2, 40);
  let o = 44, peak = 0, sumSq = 0, clipped = 0;
  for (const c of chunks) for (const v of c) {
    const s = Math.max(-1, Math.min(1, v));
    if (Math.abs(s) > 0.99) clipped++;
    peak = Math.max(peak, Math.abs(s)); sumSq += s * s;
    pcm.writeInt16LE(Math.round(s * 32767), o); o += 2;
  }
  fs.writeFileSync(path.join(root, 'out/audio.wav'), pcm);
  fs.writeFileSync(path.join(root, 'out/audio.txt'),
    `samples ${total / 2} (${(total / 2 / 32768).toFixed(1)}s) peak ${peak.toFixed(3)} rms ${Math.sqrt(sumSq / total).toFixed(4)} clipped ${clipped}\n`);
}, 300000);
