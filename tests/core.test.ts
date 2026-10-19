import { describe, expect, it } from 'vitest';
import { Bus } from '../src/gba/bus';
import { Cpu } from '../src/gba/cpu';
import { Dma, DMA_HBLANK } from '../src/gba/dma';
import { Timers } from '../src/gba/timers';
import { Io } from '../src/gba/io';
import { Bios } from '../src/gba/bios';
import { Flash, Rtc } from '../src/gba/cart';

function makeSystem() {
  const bus = new Bus(new Uint8Array(0x1000));
  const cpu = new Cpu(bus);
  const irqs: number[] = [];
  const overflows: number[] = [];
  const timers = new Timers({
    get now() { return cpu.cycles; },
    raiseIrq: (bit) => { irqs.push(bit); io.raiseIrq(bit); },
    onTimerOverflow: (t) => { overflows.push(t); },
    requestReschedule: () => {},
  });
  const fifo: number[] = [];
  const dma = new Dma(bus, {
    raiseIrq: (bit) => io.raiseIrq(bit),
    chargeCycles: () => {},
    fifoWrite32: (_ch, v) => fifo.push(v),
  });
  const apu = { read16: () => 0, write8() {}, write16() {}, fifoWrite32() {} };
  const io = new Io(bus, cpu, timers, dma, { affineRefWritten() {} }, apu);
  bus.ioPort = io;
  const flash = new Flash();
  bus.backup = flash;
  const bios = new Bios(bus, cpu, io);
  return { bus, cpu, timers, dma, io, bios, irqs, overflows, fifo, flash };
}

describe('bus', () => {
  it('mirrors IWRAM, EWRAM and VRAM', () => {
    const { bus } = makeSystem();
    bus.write32(0x03007ffc, 0x12345678);
    expect(bus.read32(0x03fffffc)).toBe(0x12345678);
    bus.write16(0x02000010, 0xbeef);
    expect(bus.read16(0x02040010)).toBe(0xbeef);
    bus.write16(0x06010000, 0x1111);
    expect(bus.read16(0x06018000)).toBe(0x1111);
  });

  it('8-bit VRAM/PRAM writes fill the halfword; OAM byte writes ignored', () => {
    const { bus } = makeSystem();
    bus.write8(0x06000001, 0xab);
    expect(bus.read16(0x06000000)).toBe(0xabab);
    bus.write8(0x05000002, 0x12);
    expect(bus.read16(0x05000002)).toBe(0x1212);
    bus.write8(0x07000000, 0x12);
    expect(bus.read16(0x07000000)).toBe(0);
  });

  it('IF is write-1-to-clear', () => {
    const { bus, io } = makeSystem();
    io.raiseIrq(0x5);
    expect(bus.read16(0x04000202)).toBe(5);
    bus.write16(0x04000202, 1);
    expect(bus.read16(0x04000202)).toBe(4);
    bus.write8(0x04000202, 4);
    expect(bus.read16(0x04000202)).toBe(0);
  });

  it('IRQ line requires IME and IE&IF; halt released by IE&IF', () => {
    const { bus, io, cpu } = makeSystem();
    cpu.halted = true;
    bus.write16(0x04000200, 1);
    io.raiseIrq(1);
    expect(cpu.halted).toBe(false);
    expect(cpu.irqLine).toBe(false);
    bus.write16(0x04000208, 1);
    expect(cpu.irqLine).toBe(true);
  });
});

describe('timers', () => {
  it('counts with prescaler and overflows at the right cycle', () => {
    const { bus, cpu, timers, overflows } = makeSystem();
    bus.write16(0x04000100, 0xff00); // reload
    bus.write16(0x04000102, 0x00c1); // enable, irq, prescaler 64
    cpu.cycles = 64 * 10;
    expect(bus.read16(0x04000100)).toBe(0xff0a);
    expect(timers.nextEvent()).toBe(256 * 64);
    timers.process(256 * 64);
    expect(overflows).toEqual([0]);
    expect(bus.read16(0x04000202) & 0x8).toBe(0x8);
    expect(timers.nextEvent()).toBe(512 * 64);
  });

  it('cascade increments on parent overflow', () => {
    const { bus, timers, overflows } = makeSystem();
    bus.write16(0x04000104, 0xfffe); // timer1 reload
    bus.write16(0x04000106, 0x0084); // enable cascade
    bus.write16(0x04000100, 0xffff); // timer0 reload: overflow every cycle
    bus.write16(0x04000102, 0x0080);
    timers.process(1);
    expect(bus.read16(0x04000104)).toBe(0xffff);
    timers.process(2);
    expect(overflows).toEqual([0, 0, 1]);
    expect(bus.read16(0x04000104)).toBe(0xfffe);
  });
});

describe('dma', () => {
  it('immediate 32-bit copy with increment', () => {
    const { bus } = makeSystem();
    for (let k = 0; k < 4; k++) bus.write32(0x02000000 + k * 4, k + 1);
    bus.write32(0x040000d4, 0x02000000);
    bus.write32(0x040000d8, 0x03000000);
    bus.write16(0x040000dc, 4);
    bus.write16(0x040000de, 0x8400); // enable, 32-bit, immediate
    expect(bus.read32(0x0300000c)).toBe(4);
    expect(bus.read16(0x040000de) & 0x8000).toBe(0);
  });

  it('fixed source fill (16-bit) and decrement destination', () => {
    const { bus } = makeSystem();
    bus.write16(0x02000000, 0x7777);
    bus.write32(0x040000d4, 0x02000000);
    bus.write32(0x040000d8, 0x03000006);
    bus.write16(0x040000dc, 4);
    bus.write16(0x040000de, 0x8000 | (2 << 7) | (1 << 5));
    expect(bus.read16(0x03000000)).toBe(0x7777);
    expect(bus.read16(0x03000006)).toBe(0x7777);
  });

  it('HBlank repeat DMA re-triggers with reload destination', () => {
    const { bus, dma } = makeSystem();
    bus.write16(0x02000000, 1);
    bus.write16(0x02000002, 2);
    bus.write32(0x040000b0, 0x02000000);
    bus.write32(0x040000b4, 0x04000010);
    bus.write16(0x040000b8, 1);
    bus.write16(0x040000ba, 0x8000 | (2 << 12) | (1 << 9) | (3 << 5));
    dma.trigger(DMA_HBLANK);
    expect(bus.io16[0x10 >>> 1]).toBe(1);
    dma.trigger(DMA_HBLANK);
    expect(bus.io16[0x10 >>> 1]).toBe(2);
  });

  it('sound FIFO DMA pushes 4 words', () => {
    const { bus, dma, fifo } = makeSystem();
    for (let k = 0; k < 8; k++) bus.write32(0x02000000 + k * 4, k);
    bus.write32(0x040000bc, 0x02000000);
    bus.write32(0x040000c0, 0x040000a0);
    bus.write16(0x040000c6, 0x8000 | (3 << 12) | (1 << 9) | (1 << 10) | (2 << 5));
    dma.soundRequest(1);
    expect(fifo).toEqual([0, 1, 2, 3]);
    dma.soundRequest(1);
    expect(fifo.length).toBe(8);
  });
});

describe('bios', () => {
  it('Div handles signs', () => {
    const { cpu, bios } = makeSystem();
    cpu.r[0] = -7; cpu.r[1] = 2;
    bios.swi(6);
    expect([cpu.r[0], cpu.r[1], cpu.r[3]]).toEqual([-3, -1, 3]);
  });

  it('Sqrt', () => {
    const { cpu, bios } = makeSystem();
    cpu.r[0] = 1000000;
    bios.swi(8);
    expect(cpu.r[0]).toBe(1000);
  });

  it('LZ77 decompresses a known stream', () => {
    const { bus, bios } = makeSystem();
    // "ABCABCABCX": literal A B C, then copy len 6 disp 3, then literal X
    const data = [0x10, 10, 0, 0, 0b00010000, 0x41, 0x42, 0x43, 0x30, 0x02, 0x58];
    data.forEach((b, k) => bus.write8(0x02000000 + k, b));
    bus.write8(0x0200000b, 0);
    const out = bios.lz77(0x02000000);
    expect(String.fromCharCode(...out)).toBe('ABCABCABCX');
  });

  it('CpuSet fill and CpuFastSet copy', () => {
    const { bus, cpu, bios } = makeSystem();
    bus.write32(0x02000000, 0xdeadbeef | 0);
    cpu.r[0] = 0x02000000; cpu.r[1] = 0x03000000; cpu.r[2] = (1 << 24) | (1 << 26) | 3;
    bios.swi(0x0b);
    expect(bus.read32(0x03000008)).toBe(0xdeadbeef | 0);
    for (let k = 0; k < 8; k++) bus.write32(0x02000100 + k * 4, k * 3);
    cpu.r[0] = 0x02000100; cpu.r[1] = 0x03000100; cpu.r[2] = 5; // rounded up to 8
    bios.swi(0x0c);
    expect(bus.read32(0x0300011c)).toBe(21);
  });

  it('IntrWait halts and survives the IRQ handler setting the BIOS flag', () => {
    const { bus, cpu, bios } = makeSystem();
    cpu.reset();
    cpu.t = 1;
    cpu.r[15] = 0x03000000 + 4;
    bus.write16(0x03000000, 0xdf05); // SWI 5
    cpu.run(cpu.cycles + 1);
    expect(cpu.halted).toBe(true);
    expect(cpu.nextPC()).toBe(0x03000000); // will re-execute the SWI
    // IRQ handler sets the VBlank bit in the BIOS IF word
    bus.write16(0x03007ff8, 1);
    cpu.halted = false;
    cpu.run(cpu.cycles + 1);
    expect(cpu.halted).toBe(false);
    expect(cpu.nextPC()).toBe(0x03000002);
    expect(bus.read16(0x03007ff8)).toBe(0);
    void bios;
  });
});

describe('flash', () => {
  const cmd = (f: Flash, v: number) => { f.write8(0x5555, 0xaa); f.write8(0x2aaa, 0x55); f.write8(0x5555, v); };

  it('reports Macronix 128K id', () => {
    const f = new Flash();
    cmd(f, 0x90);
    expect([f.read8(0), f.read8(1)]).toEqual([0xc2, 0x09]);
    cmd(f, 0xf0);
    expect(f.read8(0)).toBe(0xff);
  });

  it('programs bytes, switches banks, erases sectors', () => {
    const f = new Flash();
    cmd(f, 0xa0); f.write8(0x1234, 0x42);
    expect(f.read8(0x1234)).toBe(0x42);
    cmd(f, 0xb0); f.write8(0, 1);
    expect(f.read8(0x1234)).toBe(0xff);
    cmd(f, 0xa0); f.write8(0x1234, 0x99);
    cmd(f, 0xb0); f.write8(0, 0);
    expect(f.read8(0x1234)).toBe(0x42);
    cmd(f, 0x80); f.write8(0x5555, 0xaa); f.write8(0x2aaa, 0x55); f.write8(0x1000, 0x30);
    expect(f.read8(0x1234)).toBe(0xff);
    expect(f.data[0x11234]).toBe(0x99);
    expect(f.dirty).toBe(true);
  });
});

describe('rtc', () => {
  // Drive the GPIO pins exactly like pokeemerald's siirtc.c does.
  function transfer(rtc: Rtc, cmd: number, readBytes: number): number[] {
    rtc.write16(0xc8, 1);
    rtc.write16(0xc6, 7);
    rtc.write16(0xc4, 1); // SCK hi, CS lo
    rtc.write16(0xc4, 5); // CS hi
    for (let i = 0; i < 8; i++) { // command MSB first
      const bit = (cmd >> (7 - i)) & 1;
      rtc.write16(0xc4, (bit << 1) | 4);
      rtc.write16(0xc4, (bit << 1) | 5);
    }
    rtc.write16(0xc6, 5); // SIO as input
    const out: number[] = [];
    for (let b = 0; b < readBytes; b++) {
      let v = 0;
      for (let i = 0; i < 8; i++) {
        rtc.write16(0xc4, 4);
        rtc.write16(0xc4, 5);
        v |= ((rtc.read16(0xc4) >> 1) & 1) << i;
      }
      out.push(v);
    }
    rtc.write16(0xc4, 1);
    rtc.write16(0xc4, 1);
    return out;
  }

  it('reads status (24h) and BCD date/time', () => {
    const rtc = new Rtc(() => new Date(2026, 9, 16, 21, 34, 56));
    expect(transfer(rtc, 0x63, 1)).toEqual([0x40]);
    expect(transfer(rtc, 0x65, 7)).toEqual([0x26, 0x10, 0x16, 5, 0x21, 0x34, 0x56]);
    expect(transfer(rtc, 0x67, 3)).toEqual([0x21, 0x34, 0x56]);
  });
});
