import { describe, expect, it } from 'vitest';
import { Apu } from '../src/gba/apu';

const RATE = 48000;
const CPS = 16777216 / RATE;

function render(apu: Apu, seconds: number): Float32Array {
  apu.advance(Math.round(seconds * 16777216));
  const out = new Float32Array(apu.available() * 2);
  apu.drain(out);
  return out;
}

function enableMaster(apu: Apu): void {
  apu.write8(0x24, 0x80);       // master on
  apu.write16(0x20, 0xff77);    // all channels both sides, max volume
  apu.write16(0x22, 0x0002 | 0x0300 | 0x3000 | 0x04 | 0x08); // PSG 100%, DMA A/B both sides 100%
}

function zeroCrossings(buf: Float32Array): number {
  let n = 0;
  for (let i = 2; i < buf.length; i += 2) if ((buf[i - 2] < 0) !== (buf[i] < 0)) n++;
  return n;
}

describe('apu', () => {
  it('channel 2 square plays at the programmed frequency', () => {
    const apu = new Apu(RATE);
    enableMaster(apu);
    apu.write8(0x08, 0x80);           // 50% duty
    apu.write8(0x09, 0xf0);           // volume 15, no envelope
    const f = 2048 - 131072 / 440;    // 440 Hz
    apu.write8(0x0c, Math.round(f) & 0xff);
    apu.write8(0x0d, 0x80 | ((Math.round(f) >> 8) & 7));
    const buf = render(apu, 0.25);
    const hz = zeroCrossings(buf) / 2 / 0.25;
    expect(hz).toBeGreaterThan(420);
    expect(hz).toBeLessThan(460);
  });

  it('decreasing envelope reaches silence', () => {
    const apu = new Apu(RATE);
    enableMaster(apu);
    apu.write8(0x09, 0xf1);           // vol 15, decrease every 1/64 s
    apu.write8(0x0c, 0x00);
    apu.write8(0x0d, 0x87);
    render(apu, 0.4);
    const tail = render(apu, 0.05);
    let peak = 0;
    for (const v of tail) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThan(0.01);
  });

  it('length counter stops the channel and status reflects it', () => {
    const apu = new Apu(RATE);
    enableMaster(apu);
    apu.write8(0x08, 0x3f);           // length 1 step
    apu.write8(0x09, 0xf0);
    apu.write8(0x0d, 0xc7);           // trigger + length enable
    expect(apu.read16(0x24) & 2).toBe(2);
    render(apu, 0.02);
    expect(apu.read16(0x24) & 2).toBe(0);
  });

  it('sweep overflow disables channel 1', () => {
    const apu = new Apu(RATE);
    enableMaster(apu);
    apu.write8(0x00, 0x11);           // period 1, increase, shift 1
    apu.write8(0x03, 0xf0);
    apu.write8(0x04, 0xff);
    apu.write8(0x05, 0x86);           // freq 0x6ff
    render(apu, 0.1);
    expect(apu.read16(0x24) & 1).toBe(0);
  });

  it('wave RAM writes go to the bank not being played', () => {
    const apu = new Apu(RATE);
    enableMaster(apu);
    apu.write8(0x10, 0x40);           // bank 1 selected for playback
    apu.write8(0x30, 0xab);
    expect(apu.read16(0x30) & 0xff).toBe(0xab);
    apu.write8(0x10, 0x00);           // select bank 0: CPU now sees bank 1
    expect(apu.read16(0x30) & 0xff).toBe(0);
  });

  it('noise channel produces varying output', () => {
    const apu = new Apu(RATE);
    enableMaster(apu);
    apu.write8(0x19, 0xf0);
    apu.write8(0x1c, 0x21);
    apu.write8(0x1d, 0x80);
    const buf = render(apu, 0.05);
    const set = new Set(Array.from(buf.slice(1000, 1200)).map((v) => v.toFixed(3)));
    expect(set.size).toBeGreaterThan(10);
  });

  it('FIFO pops on its timer and asks for refill at <= 16 bytes', () => {
    const apu = new Apu(RATE);
    enableMaster(apu);
    for (let k = 0; k < 6; k++) apu.fifoWrite32(0, 0x40404040);
    expect(apu.timerOverflow(0) & 1).toBe(0); // 24 -> 23 bytes
    for (let k = 0; k < 7; k++) apu.timerOverflow(0);
    expect(apu.timerOverflow(0) & 1).toBe(1); // 15 left
    expect(apu.timerOverflow(1) & 1).toBe(0); // FIFO A is on timer 0
    apu.advance(CPS * 200);
    const buf = new Float32Array(400);
    apu.drain(buf);
    expect(Math.max(...buf)).toBeGreaterThan(0.05);
  });

  it('FIFO reset bit clears the queue', () => {
    const apu = new Apu(RATE);
    enableMaster(apu);
    for (let k = 0; k < 8; k++) apu.fifoWrite32(0, 0x01010101);
    apu.write8(0x23, 0x08 | 0x03);
    expect(apu.timerOverflow(0) & 1).toBe(1);
  });

  it('master disable clears PSG registers and blocks writes', () => {
    const apu = new Apu(RATE);
    enableMaster(apu);
    apu.write8(0x09, 0xf0);
    apu.write8(0x24, 0x00);
    expect(apu.read16(0x08)).toBe(0);
    apu.write8(0x09, 0xf0);
    expect(apu.read16(0x08)).toBe(0);
  });

  it('frequency registers read back as zero (write-only bits)', () => {
    const apu = new Apu(RATE);
    enableMaster(apu);
    apu.write16(0x0c, 0x47ff);
    expect(apu.read16(0x0c)).toBe(0x4000);
  });

  it('serialize round-trips register state', () => {
    const apu = new Apu(RATE);
    enableMaster(apu);
    apu.write8(0x08, 0x80);
    apu.write8(0x30, 0x12);
    const b = new Apu(RATE);
    b.deserialize(apu.serialize());
    expect(b.read16(0x08)).toBe(apu.read16(0x08));
    expect(b.read16(0x24) & 0x80).toBe(0x80);
  });
});
