// Renders out/audio.wav (stereo s16) as a spectrogram PNG: x = time, y = frequency (log), 0..8 kHz.
import fs from 'node:fs';
import path from 'node:path';
import { encodePng } from '../lib/png';
const root = path.resolve(import.meta.dirname, '../..');
const wav = fs.readFileSync(path.join(root, 'out/audio.wav'));
const rate = wav.readUInt32LE(24);
const n = (wav.length - 44) / 4;
const mono = new Float32Array(n);
for (let i = 0; i < n; i++) mono[i] = (wav.readInt16LE(44 + i * 4) + wav.readInt16LE(46 + i * 4)) / 65536;
const N = 2048, hop = 512, W = Math.floor((n - N) / hop), H = 300;
const img = new Uint8Array(W * H * 4);
const re = new Float32Array(N), im = new Float32Array(N);
function fft() {
  for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= N; len <<= 1) { const a = -2 * Math.PI / len; for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) { const c = Math.cos(a * k), s = Math.sin(a * k); const xr = re[i + k + len / 2] * c - im[i + k + len / 2] * s, xi = re[i + k + len / 2] * s + im[i + k + len / 2] * c; re[i + k + len / 2] = re[i + k] - xr; im[i + k + len / 2] = im[i + k] - xi; re[i + k] += xr; im[i + k] += xi; } }
}
for (let x = 0; x < W; x++) {
  for (let i = 0; i < N; i++) { re[i] = mono[x * hop + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); im[i] = 0; }
  fft();
  for (let y = 0; y < H; y++) {
    const f = 60 * Math.pow(8000 / 60, (H - 1 - y) / (H - 1));
    const bin = Math.round(f / rate * N);
    const mag = Math.hypot(re[bin], im[bin]);
    const db = Math.max(0, Math.min(1, (20 * Math.log10(mag / (N / 4) + 1e-9) + 70) / 60));
    const o = (y * W + x) * 4;
    img[o] = db * 255; img[o + 1] = db * db * 255; img[o + 2] = (1 - db) * 80 * db; img[o + 3] = 255;
  }
}
fs.writeFileSync(path.join(root, 'out/spectrogram.png'), encodePng(W, H, img));
console.log(`${W}x${H}`);
