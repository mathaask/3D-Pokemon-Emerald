// GBA sound: four PSG channels (Game Boy compatible) + DirectSound FIFO A/B.
// Output is generated directly at the host sample rate. Square waves are band-limited
// (PolyBLEP) and the FIFO channels are linearly interpolated between samples, so the
// m4a music engine sounds clean instead of harsh/aliased.

import { CPU_HZ } from './constants';

const DUTY = [0.125, 0.25, 0.5, 0.75];
const RING = 16384;

function polyBlep(t: number, dt: number): number {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

class Envelope {
  initial = 0;
  increase = false;
  period = 0;
  volume = 0;
  timer = 0;

  write(v: number): void {
    this.initial = v >> 4;
    this.increase = (v & 8) !== 0;
    this.period = v & 7;
  }

  dacOn(raw: number): boolean {
    return (raw & 0xf8) !== 0;
  }

  trigger(): void {
    this.volume = this.initial;
    this.timer = this.period || 8;
  }

  clock(): void {
    if (this.period === 0) return;
    if (--this.timer <= 0) {
      this.timer = this.period;
      if (this.increase && this.volume < 15) this.volume++;
      else if (!this.increase && this.volume > 0) this.volume--;
    }
  }
}

class Square {
  enabled = false;
  duty = 2;
  length = 0;
  lengthEnable = false;
  freq = 0;
  phase = 0;
  env = new Envelope();
  envRaw = 0;
  // sweep (channel 1 only)
  sweepPeriod = 0;
  sweepNegate = false;
  sweepShift = 0;
  sweepTimer = 0;
  sweepEnabled = false;
  shadow = 0;

  hz(): number {
    return 131072 / (2048 - this.freq);
  }

  sweepCalc(): number {
    const delta = this.shadow >> this.sweepShift;
    const f = this.sweepNegate ? this.shadow - delta : this.shadow + delta;
    if (f > 2047) this.enabled = false;
    return f;
  }

  trigger(hasSweep: boolean): void {
    this.enabled = this.env.dacOn(this.envRaw);
    if (this.length === 0) this.length = 64;
    this.env.trigger();
    if (hasSweep) {
      this.shadow = this.freq;
      this.sweepTimer = this.sweepPeriod || 8;
      this.sweepEnabled = this.sweepPeriod !== 0 || this.sweepShift !== 0;
      if (this.sweepShift !== 0) this.sweepCalc();
    }
  }

  clockSweep(): void {
    if (--this.sweepTimer <= 0) {
      this.sweepTimer = this.sweepPeriod || 8;
      if (this.sweepEnabled && this.sweepPeriod !== 0) {
        const f = this.sweepCalc();
        if (f <= 2047 && this.sweepShift !== 0) {
          this.shadow = f;
          this.freq = f;
          this.sweepCalc();
        }
      }
    }
  }

  clockLength(): void {
    if (this.lengthEnable && this.length > 0 && --this.length === 0) this.enabled = false;
  }

  /** Band-limited square sample in [-1, 1] scaled by volume (0..15). */
  sample(sampleRate: number): number {
    if (!this.enabled) return 0;
    const dt = Math.min(0.5, this.hz() / sampleRate);
    const d = DUTY[this.duty];
    const t = this.phase;
    let v = t < d ? 1 : -1;
    v += polyBlep(t, dt);
    let t2 = t - d;
    if (t2 < 0) t2 += 1;
    v -= polyBlep(t2, dt);
    this.phase += dt;
    if (this.phase >= 1) this.phase -= 1;
    return v * this.env.volume;
  }
}

class Wave {
  dacOn = false;
  enabled = false;
  dimension64 = false;
  bank = 0;
  length = 0;
  lengthEnable = false;
  volumeCode = 0;
  force75 = false;
  freq = 0;
  pos = 0;
  ram = new Uint8Array(32); // two banks of 16 bytes

  trigger(): void {
    this.enabled = this.dacOn;
    if (this.length === 0) this.length = 256;
    this.pos = 0;
  }

  clockLength(): void {
    if (this.lengthEnable && this.length > 0 && --this.length === 0) this.enabled = false;
  }

  sample(sampleRate: number): number {
    if (!this.enabled) return 0;
    const count = this.dimension64 ? 64 : 32;
    const startBank = this.dimension64 ? 0 : this.bank;
    const i = Math.floor(this.pos) % count;
    const bankIdx = this.dimension64 ? ((this.bank + (i >> 5)) & 1) : startBank;
    const byte = this.ram[bankIdx * 16 + ((i & 31) >> 1)];
    const s = i & 1 ? byte & 15 : byte >> 4;
    this.pos += (2097152 / (2048 - this.freq)) / sampleRate;
    if (this.pos >= count) this.pos -= count * Math.floor(this.pos / count);
    let gain: number;
    if (this.force75) gain = 0.75;
    else gain = [0, 1, 0.5, 0.25][this.volumeCode];
    return (s - 7.5) * 2 * gain;
  }
}

class Noise {
  enabled = false;
  length = 0;
  lengthEnable = false;
  env = new Envelope();
  envRaw = 0;
  divisor = 0;
  width7 = false;
  shift = 0;
  lfsr = 0x7fff;
  acc = 0;

  trigger(): void {
    this.enabled = this.env.dacOn(this.envRaw);
    if (this.length === 0) this.length = 64;
    this.env.trigger();
    this.lfsr = this.width7 ? 0x7f : 0x7fff;
  }

  clockLength(): void {
    if (this.lengthEnable && this.length > 0 && --this.length === 0) this.enabled = false;
  }

  sample(sampleRate: number): number {
    if (!this.enabled) return 0;
    const r = this.divisor === 0 ? 0.5 : this.divisor;
    const rate = 524288 / r / (1 << (this.shift + 1));
    this.acc += rate / sampleRate;
    let hi = 0, n = 0;
    while (this.acc >= 1) {
      this.acc -= 1;
      const bit = (this.lfsr ^ (this.lfsr >> 1)) & 1;
      this.lfsr >>= 1;
      if (this.width7) this.lfsr = (this.lfsr & ~0x40) | (bit << 6);
      else this.lfsr |= bit << 14;
      hi += this.lfsr & 1 ? 0 : 1;
      n++;
      if (n > 64) { this.acc = 0; break; }
    }
    // Average over the LFSR steps in this output sample (cheap anti-aliasing).
    const level = n > 0 ? (hi / n) * 2 - 1 : (this.lfsr & 1 ? -1 : 1);
    return level * this.env.volume;
  }
}

class Fifo {
  buf = new Int8Array(32);
  read = 0;
  count = 0;
  prev = 0;
  cur = 0;
  /** APU cycle at which `cur` was latched and the measured interval between pops. */
  latchedAt = 0;
  interval = 1254;

  reset(): void {
    this.read = 0;
    this.count = 0;
  }

  push(b: number): void {
    if (this.count >= 32) return;
    this.buf[(this.read + this.count) & 31] = b;
    this.count++;
  }

  pop(now: number): void {
    const v = this.count > 0 ? this.buf[this.read] : this.cur;
    if (this.count > 0) {
      this.read = (this.read + 1) & 31;
      this.count--;
    }
    const iv = now - this.latchedAt;
    if (iv > 0 && iv < 100000) this.interval = this.interval * 0.5 + iv * 0.5;
    this.latchedAt = now;
    this.prev = this.cur;
    this.cur = v;
  }

  value(now: number): number {
    const f = Math.min(1, (now - this.latchedAt) / this.interval);
    return this.prev + (this.cur - this.prev) * f;
  }
}

export class Apu {
  private regs = new Uint8Array(0x50);
  private ch1 = new Square();
  private ch2 = new Square();
  private ch3 = new Wave();
  private ch4 = new Noise();
  private fifoA = new Fifo();
  private fifoB = new Fifo();
  private master = false;
  private cycle = 0;
  private sampleAcc = 0;
  private seqAcc = 0;
  private seqStep = 0;
  private readonly cyclesPerSample: number;
  private ring = new Float32Array(RING * 2);
  private ringWrite = 0;
  private ringCount = 0;
  // output filters
  private dcL = 0; private dcR = 0; private dcInL = 0; private dcInR = 0;
  private lpL = 0; private lpR = 0;
  private readonly dcR_coef: number;
  private readonly lpCoef: number;

  constructor(private sampleRate: number) {
    this.cyclesPerSample = CPU_HZ / sampleRate;
    this.dcR_coef = 1 - (2 * Math.PI * 20) / sampleRate;
    this.lpCoef = 1 - Math.exp((-2 * Math.PI * 15000) / sampleRate);
    this.reset();
  }

  reset(): void {
    this.regs.fill(0);
    this.ch1 = new Square();
    this.ch2 = new Square();
    this.ch3 = new Wave();
    this.ch4 = new Noise();
    this.fifoA = new Fifo();
    this.fifoB = new Fifo();
    this.master = false;
    this.ringWrite = 0;
    this.ringCount = 0;
    this.regs[0x28] = 0x00;
    this.regs[0x29] = 0x02; // SOUNDBIAS = 0x200
  }

  // ---------------------------------------------------------------- register access

  read16(off: number): number {
    const r = this.regs;
    const w = r[off] | (r[off + 1] << 8);
    switch (off) {
      case 0x00: return w & 0x007f;
      case 0x02: return w & 0xffc0;
      case 0x04: return w & 0x4000;
      case 0x08: return w & 0xffc0;
      case 0x0c: return w & 0x4000;
      case 0x10: return w & 0x00e0;
      case 0x12: return w & 0xe000;
      case 0x14: return w & 0x4000;
      case 0x18: return w & 0xff00;
      case 0x1c: return w & 0x40ff;
      case 0x20: return w & 0xff77;
      case 0x22: return w & 0x770f;
      case 0x24: {
        let s = this.master ? 0x80 : 0;
        if (this.ch1.enabled) s |= 1;
        if (this.ch2.enabled) s |= 2;
        if (this.ch3.enabled) s |= 4;
        if (this.ch4.enabled) s |= 8;
        return s;
      }
      case 0x28: return w & 0xc3fe;
      default:
        if (off >= 0x30 && off < 0x40) {
          const bank = this.ch3.bank ^ 1;
          const i = off - 0x30;
          return this.ch3.ram[bank * 16 + i] | (this.ch3.ram[bank * 16 + i + 1] << 8);
        }
        return 0;
    }
  }

  write16(off: number, v: number): void {
    this.write8(off, v & 0xff);
    this.write8(off + 1, (v >> 8) & 0xff);
  }

  write8(off: number, v: number): void {
    v &= 0xff;
    if (off >= 0x40 && off < 0x48) {
      (off < 0x44 ? this.fifoA : this.fifoB).push((v << 24) >> 24);
      return;
    }
    if (off >= 0x30 && off < 0x40) {
      this.ch3.ram[(this.ch3.bank ^ 1) * 16 + (off - 0x30)] = v;
      return;
    }
    // While the master enable is off, the PSG registers can't be written.
    if (!this.master && off < 0x24) return;
    this.regs[off] = v;
    const c1 = this.ch1, c2 = this.ch2, c3 = this.ch3, c4 = this.ch4;
    switch (off) {
      case 0x00:
        c1.sweepShift = v & 7;
        c1.sweepNegate = (v & 8) !== 0;
        c1.sweepPeriod = (v >> 4) & 7;
        break;
      case 0x02: c1.duty = v >> 6; c1.length = 64 - (v & 63); break;
      case 0x03: c1.envRaw = v; c1.env.write(v); if (!c1.env.dacOn(v)) c1.enabled = false; break;
      case 0x04: c1.freq = (c1.freq & 0x700) | v; break;
      case 0x05:
        c1.freq = (c1.freq & 0xff) | ((v & 7) << 8);
        c1.lengthEnable = (v & 0x40) !== 0;
        if (v & 0x80) c1.trigger(true);
        break;
      case 0x08: c2.duty = v >> 6; c2.length = 64 - (v & 63); break;
      case 0x09: c2.envRaw = v; c2.env.write(v); if (!c2.env.dacOn(v)) c2.enabled = false; break;
      case 0x0c: c2.freq = (c2.freq & 0x700) | v; break;
      case 0x0d:
        c2.freq = (c2.freq & 0xff) | ((v & 7) << 8);
        c2.lengthEnable = (v & 0x40) !== 0;
        if (v & 0x80) c2.trigger(false);
        break;
      case 0x10:
        c3.dimension64 = (v & 0x20) !== 0;
        c3.bank = (v >> 6) & 1;
        c3.dacOn = (v & 0x80) !== 0;
        if (!c3.dacOn) c3.enabled = false;
        break;
      case 0x12: c3.length = 256 - v; break;
      case 0x13: c3.volumeCode = (v >> 5) & 3; c3.force75 = (v & 0x80) !== 0; break;
      case 0x14: c3.freq = (c3.freq & 0x700) | v; break;
      case 0x15:
        c3.freq = (c3.freq & 0xff) | ((v & 7) << 8);
        c3.lengthEnable = (v & 0x40) !== 0;
        if (v & 0x80) c3.trigger();
        break;
      case 0x18: c4.length = 64 - (v & 63); break;
      case 0x19: c4.envRaw = v; c4.env.write(v); if (!c4.env.dacOn(v)) c4.enabled = false; break;
      case 0x1c: c4.divisor = v & 7; c4.width7 = (v & 8) !== 0; c4.shift = v >> 4; break;
      case 0x1d:
        c4.lengthEnable = (v & 0x40) !== 0;
        if (v & 0x80) c4.trigger();
        break;
      case 0x23:
        if (v & 0x08) this.fifoA.reset();
        if (v & 0x80) this.fifoB.reset();
        this.regs[0x23] = v & 0x77;
        break;
      case 0x24: {
        const on = (v & 0x80) !== 0;
        if (!on && this.master) {
          for (let k = 0; k < 0x24; k++) this.regs[k] = 0;
          this.ch1 = new Square();
          this.ch2 = new Square();
          const ram = this.ch3.ram;
          this.ch3 = new Wave();
          this.ch3.ram = ram;
          this.ch4 = new Noise();
        }
        this.master = on;
        this.regs[0x24] = v & 0x80;
        break;
      }
    }
  }

  fifoWrite32(channel: 0 | 1, v: number): void {
    const f = channel === 0 ? this.fifoA : this.fifoB;
    f.push((v << 24) >> 24);
    f.push((v << 16) >> 24);
    f.push((v << 8) >> 24);
    f.push(v >> 24);
  }

  timerOverflow(timer: number): number {
    const cntH = this.regs[0x22] | (this.regs[0x23] << 8);
    let refill = 0;
    if (((cntH >> 10) & 1) === timer) {
      this.fifoA.pop(this.cycle);
      if (this.fifoA.count <= 16) refill |= 1;
    }
    if (((cntH >> 14) & 1) === timer) {
      this.fifoB.pop(this.cycle);
      if (this.fifoB.count <= 16) refill |= 2;
    }
    return refill;
  }

  // ---------------------------------------------------------------- sample generation

  private clockSequencer(): void {
    const step = this.seqStep;
    if ((step & 1) === 0) {
      this.ch1.clockLength(); this.ch2.clockLength(); this.ch3.clockLength(); this.ch4.clockLength();
    }
    if (step === 2 || step === 6) this.ch1.clockSweep();
    if (step === 7) {
      this.ch1.env.clock(); this.ch2.env.clock(); this.ch4.env.clock();
    }
    this.seqStep = (step + 1) & 7;
  }

  advance(cycles: number): void {
    const SEQ = CPU_HZ / 512;
    this.seqAcc += cycles;
    while (this.seqAcc >= SEQ) {
      this.seqAcc -= SEQ;
      if (this.master) this.clockSequencer();
    }
    this.sampleAcc += cycles;
    const start = this.cycle;
    this.cycle += cycles;
    let t = start;
    while (this.sampleAcc >= this.cyclesPerSample) {
      this.sampleAcc -= this.cyclesPerSample;
      t += this.cyclesPerSample;
      this.mix(Math.min(t, this.cycle));
    }
  }

  private mix(now: number): void {
    const r = this.regs;
    const cntL = r[0x20] | (r[0x21] << 8);
    const cntH = r[0x22] | (r[0x23] << 8);
    let left = 0, right = 0;
    if (this.master) {
      const sr = this.sampleRate;
      const s1 = this.ch1.sample(sr);
      const s2 = this.ch2.sample(sr);
      const s3 = this.ch3.sample(sr);
      const s4 = this.ch4.sample(sr);
      let pl = 0, pr = 0;
      if (cntL & 0x1000) pl += s1;
      if (cntL & 0x2000) pl += s2;
      if (cntL & 0x4000) pl += s3;
      if (cntL & 0x8000) pl += s4;
      if (cntL & 0x0100) pr += s1;
      if (cntL & 0x0200) pr += s2;
      if (cntL & 0x0400) pr += s3;
      if (cntL & 0x0800) pr += s4;
      const ratio = [0.25, 0.5, 1, 0][cntH & 3];
      pl *= (((cntL >> 4) & 7) + 1) * ratio;
      pr *= ((cntL & 7) + 1) * ratio;
      const a = this.fifoA.value(now) * (cntH & 4 ? 4 : 2);
      const b = this.fifoB.value(now) * (cntH & 8 ? 4 : 2);
      left = pl + (cntH & 0x0200 ? a : 0) + (cntH & 0x2000 ? b : 0);
      right = pr + (cntH & 0x0100 ? a : 0) + (cntH & 0x1000 ? b : 0);
    }
    // 10-bit DAC range around the bias, then normalise.
    left = Math.max(-512, Math.min(511, left)) / 512;
    right = Math.max(-512, Math.min(511, right)) / 512;
    // DC blocker + gentle low-pass.
    const dl = left - this.dcInL + this.dcR_coef * this.dcL;
    const dr = right - this.dcInR + this.dcR_coef * this.dcR;
    this.dcInL = left; this.dcInR = right; this.dcL = dl; this.dcR = dr;
    this.lpL += this.lpCoef * (dl - this.lpL);
    this.lpR += this.lpCoef * (dr - this.lpR);
    const w = this.ringWrite;
    this.ring[w * 2] = this.lpL;
    this.ring[w * 2 + 1] = this.lpR;
    this.ringWrite = (w + 1) % RING;
    if (this.ringCount < RING) this.ringCount++;
  }

  available(): number {
    return this.ringCount;
  }

  drain(out: Float32Array): number {
    const n = Math.min(this.ringCount, out.length >> 1);
    let readPos = (this.ringWrite - this.ringCount + RING) % RING;
    for (let i = 0; i < n; i++) {
      out[i * 2] = this.ring[readPos * 2];
      out[i * 2 + 1] = this.ring[readPos * 2 + 1];
      readPos = (readPos + 1) % RING;
    }
    this.ringCount -= n;
    return n;
  }

  // ---------------------------------------------------------------- save states

  serialize(): Uint8Array {
    const out = new Uint8Array(0x50 + 32 + 1);
    out.set(this.regs, 0);
    out.set(this.ch3.ram, 0x50);
    out[0x70] = this.master ? 1 : 0;
    return out;
  }

  deserialize(d: Uint8Array): void {
    this.reset();
    this.master = true;
    // Replay register writes so channel state is rebuilt (without triggering notes).
    for (let off = 0; off < 0x30; off++) {
      if (off === 0x05 || off === 0x0d || off === 0x15 || off === 0x1d) this.write8(off, d[off] & 0x7f);
      else if (off !== 0x24) this.write8(off, d[off]);
    }
    this.ch3.ram.set(d.subarray(0x50, 0x70));
    this.master = d[0x70] === 1;
    this.regs[0x24] = this.master ? 0x80 : 0;
  }
}
