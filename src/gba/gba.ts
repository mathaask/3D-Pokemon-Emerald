// Top-level GBA: wires the components together and runs the scanline scheduler.

import { Bus } from './bus';
import { Cpu } from './cpu';
import { Io } from './io';
import { Timers } from './timers';
import { Dma, DMA_HBLANK, DMA_VBLANK } from './dma';
import { Bios } from './bios';
import { Flash, Rtc } from './cart';
import { Ppu } from './ppu';
import { Apu } from './apu';
import {
  CYCLES_PER_LINE, HDRAW_CYCLES, IRQ, LINES_PER_FRAME, REG, VISIBLE_LINES,
} from './constants';

export interface GbaOptions {
  sampleRate?: number;
  now?: () => Date;
}

const DISPSTAT_IDX = REG.DISPSTAT >>> 1;
const VCOUNT_IDX = REG.VCOUNT >>> 1;

export class Gba {
  readonly bus: Bus;
  readonly cpu: Cpu;
  readonly io: Io;
  readonly timers: Timers;
  readonly dma: Dma;
  readonly ppu: Ppu;
  readonly apu: Apu;
  readonly bios: Bios;
  readonly flash: Flash;
  readonly rtc: Rtc;

  frameCount = 0;
  /** Absolute cycle at which the current scanline started. */
  private lineStart = 0;
  private apuSynced = 0;
  /** Optional hook invoked once per frame right as VBlank begins (line 160). */
  onVBlank: (() => void) | null = null;

  constructor(rom: Uint8Array, opts: GbaOptions = {}) {
    this.bus = new Bus(rom);
    this.cpu = new Cpu(this.bus);
    this.ppu = new Ppu(this.bus);
    this.apu = new Apu(opts.sampleRate ?? 48000);
    const self = this;
    this.timers = new Timers({
      get now() { return self.cpu.cycles; },
      raiseIrq: (bit) => self.io.raiseIrq(bit),
      onTimerOverflow: (timer, at) => self.onTimerOverflow(timer, at),
      requestReschedule: () => { self.cpu.breakLoop = true; },
    });
    this.dma = new Dma(this.bus, {
      raiseIrq: (bit) => self.io.raiseIrq(bit),
      chargeCycles: (n) => { self.cpu.cycles += n; },
      fifoWrite32: (ch, v) => self.apu.fifoWrite32(ch, v),
    });
    this.io = new Io(this.bus, this.cpu, this.timers, this.dma, this.ppu, this.apu);
    this.bus.ioPort = this.io;
    this.flash = new Flash();
    this.bus.backup = this.flash;
    this.rtc = new Rtc(opts.now);
    this.bus.gpio = this.rtc;
    this.bios = new Bios(this.bus, this.cpu, this.io);
    this.reset();
  }

  reset(): void {
    this.bus.ewram.fill(0);
    this.bus.iwram.fill(0);
    this.bus.pram.fill(0);
    this.bus.vram.fill(0);
    this.bus.oam.fill(0);
    this.io.reset();
    this.timers.reset();
    this.dma.reset();
    this.ppu.reset();
    this.apu.reset();
    this.cpu.skipBios();
    this.lineStart = 0;
    this.apuSynced = 0;
    this.frameCount = 0;
  }

  get keys(): number {
    return this.io.keys;
  }

  set keys(v: number) {
    if (v !== this.io.keys) {
      this.io.keys = v & 0x3ff;
      this.io.checkKeypadIrq();
    }
  }

  private syncApu(to: number): void {
    if (to > this.apuSynced) {
      this.apu.advance(to - this.apuSynced);
      this.apuSynced = to;
    }
  }

  private onTimerOverflow(timer: number, at: number): void {
    if (timer > 1) return;
    this.syncApu(at);
    const refill = this.apu.timerOverflow(timer);
    if (refill) this.dma.soundRequest(refill);
  }

  /** Runs the CPU (and timers) until the absolute cycle `target`. */
  private runUntil(target: number): void {
    const cpu = this.cpu;
    const timers = this.timers;
    while (cpu.cycles < target) {
      const next = Math.min(target, timers.nextEvent());
      if (cpu.halted) {
        if (next > cpu.cycles) cpu.cycles = next;
      } else {
        cpu.run(next);
      }
      if (timers.nextEvent() <= cpu.cycles) timers.process(cpu.cycles);
    }
  }

  private startLine(line: number): void {
    const io16 = this.bus.io16;
    io16[VCOUNT_IDX] = line;
    let stat = io16[DISPSTAT_IDX] & ~2; // leave HBlank
    if (line === VISIBLE_LINES) {
      stat |= 1;
      io16[DISPSTAT_IDX] = stat;
      if (stat & 0x08) this.io.raiseIrq(IRQ.VBLANK);
      this.dma.trigger(DMA_VBLANK);
      if (this.onVBlank) this.onVBlank();
    } else if (line === LINES_PER_FRAME - 1) {
      stat &= ~1;
    }
    if (line === stat >>> 8) {
      stat |= 4;
      io16[DISPSTAT_IDX] = stat;
      if (stat & 0x20) this.io.raiseIrq(IRQ.VCOUNT);
    } else {
      stat &= ~4;
    }
    io16[DISPSTAT_IDX] = stat;
  }

  private hblank(line: number): void {
    const io16 = this.bus.io16;
    const stat = io16[DISPSTAT_IDX] | 2;
    io16[DISPSTAT_IDX] = stat;
    if (line < VISIBLE_LINES) {
      this.ppu.renderScanline(line);
      this.dma.trigger(DMA_HBLANK);
    }
    if (stat & 0x10) this.io.raiseIrq(IRQ.HBLANK);
  }

  /** Emulates one full video frame (228 scanlines). */
  runFrame(): void {
    for (let line = 0; line < LINES_PER_FRAME; line++) {
      this.startLine(line);
      this.runUntil(this.lineStart + HDRAW_CYCLES);
      this.hblank(line);
      this.runUntil(this.lineStart + CYCLES_PER_LINE);
      this.lineStart += CYCLES_PER_LINE;
      this.syncApu(this.cpu.cycles);
    }
    this.frameCount++;
  }

  // ---------------------------------------------------------------- saves

  getSave(): Uint8Array {
    return this.flash.data.slice();
  }

  loadSave(d: Uint8Array): void {
    this.flash.load(d);
  }

  get saveDirty(): boolean {
    return this.flash.dirty;
  }

  set saveDirty(v: boolean) {
    this.flash.dirty = v;
  }

  saveState(): Uint8Array {
    const parts: Uint8Array[] = [];
    const add = (a: ArrayBufferView) => {
      parts.push(new Uint8Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength)));
    };
    const bus = this.bus;
    add(bus.ewram); add(bus.iwram); add(bus.io); add(bus.pram); add(bus.vram); add(bus.oam);
    add(this.cpu.serialize());
    add(this.timers.serialize());
    add(this.dma.serialize());
    add(this.flash.serialize());
    add(this.rtc.serialize());
    add(this.bios.serialize());
    add(this.apu.serialize());
    add(new Float64Array([this.cpu.cycles, this.lineStart, this.apuSynced, this.frameCount, this.io.keys]));
    // Layout: u32 count, then u32 lengths, then payloads.
    const header = new Uint32Array(1 + parts.length);
    header[0] = parts.length;
    parts.forEach((p, k) => { header[1 + k] = p.length; });
    const total = header.byteLength + parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    out.set(new Uint8Array(header.buffer), 0);
    let off = header.byteLength;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }

  loadState(state: Uint8Array): void {
    const view = new DataView(state.buffer, state.byteOffset, state.byteLength);
    const count = view.getUint32(0, true);
    const parts: Uint8Array[] = [];
    let off = 4 + count * 4;
    for (let k = 0; k < count; k++) {
      const len = view.getUint32(4 + k * 4, true);
      parts.push(state.slice(off, off + len));
      off += len;
    }
    const bus = this.bus;
    let k = 0;
    bus.ewram.set(parts[k++]); bus.iwram.set(parts[k++]); bus.io.set(parts[k++]);
    bus.pram.set(parts[k++]); bus.vram.set(parts[k++]); bus.oam.set(parts[k++]);
    this.cpu.deserialize(new Int32Array(parts[k++].buffer));
    this.timers.deserialize(new Float64Array(parts[k++].buffer));
    this.dma.deserialize(new Float64Array(parts[k++].buffer));
    this.flash.deserialize(parts[k++]);
    this.rtc.deserialize(parts[k++]);
    this.bios.deserialize(parts[k++]);
    this.apu.deserialize(parts[k++]);
    const misc = new Float64Array(parts[k++].buffer);
    this.cpu.cycles = misc[0];
    this.lineStart = misc[1];
    this.apuSynced = misc[2];
    this.frameCount = misc[3];
    this.io.keys = misc[4];
    this.io.updateIrq();
    bus.vramDirty = bus.pramDirty = bus.oamDirty = true;
  }
}
