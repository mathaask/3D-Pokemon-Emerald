// Cartridge hardware: 128 KB Flash (Macronix MX29L010 protocol) and the
// Seiko S-3511A real-time clock wired to the GPIO port.

import type { BackupPort, GpioPort } from './bus';

export class Flash implements BackupPort {
  readonly data = new Uint8Array(0x20000).fill(0xff);
  private bank = 0;
  private cmdState = 0; // 0: idle, 1: got AA@5555, 2: got 55@2AAA
  private idMode = false;
  private eraseArmed = false;
  private pendingWrite = false;
  private pendingBank = false;
  dirty = false;
  /** Called after any modification (used to persist saves). */
  onWrite: () => void = () => {};

  read8(addr: number): number {
    if (this.idMode && addr < 2) return addr === 0 ? 0xc2 : 0x09; // Macronix, 128 KB
    return this.data[(this.bank << 16) | addr];
  }

  write8(addr: number, v: number): void {
    if (this.pendingWrite) {
      this.data[(this.bank << 16) | addr] = v;
      this.pendingWrite = false;
      this.markDirty();
      return;
    }
    if (this.pendingBank) {
      if (addr === 0) this.bank = v & 1;
      this.pendingBank = false;
      return;
    }
    if (v === 0xf0 && this.cmdState === 0) { // "terminate" from any address
      this.idMode = false;
      return;
    }
    if (this.cmdState === 0 && addr === 0x5555 && v === 0xaa) { this.cmdState = 1; return; }
    if (this.cmdState === 1 && addr === 0x2aaa && v === 0x55) { this.cmdState = 2; return; }
    if (this.cmdState === 2) {
      this.cmdState = 0;
      if (addr === 0x5555) {
        switch (v) {
          case 0x90: this.idMode = true; return;
          case 0xf0: this.idMode = false; return;
          case 0x80: this.eraseArmed = true; return;
          case 0x10:
            if (this.eraseArmed) { this.data.fill(0xff); this.markDirty(); }
            this.eraseArmed = false;
            return;
          case 0xa0: this.pendingWrite = true; return;
          case 0xb0: this.pendingBank = true; return;
        }
      } else if (v === 0x30 && this.eraseArmed) {
        const start = (this.bank << 16) | (addr & 0xf000);
        this.data.fill(0xff, start, start + 0x1000);
        this.eraseArmed = false;
        this.markDirty();
        return;
      }
    }
    this.cmdState = 0;
  }

  private markDirty(): void {
    this.dirty = true;
    this.onWrite();
  }

  load(d: Uint8Array): void {
    this.data.fill(0xff);
    this.data.set(d.subarray(0, this.data.length));
  }

  serialize(): Uint8Array {
    const out = new Uint8Array(0x20000 + 8);
    out.set(this.data);
    out.set([this.bank, this.cmdState, this.idMode ? 1 : 0, this.eraseArmed ? 1 : 0,
      this.pendingWrite ? 1 : 0, this.pendingBank ? 1 : 0], 0x20000);
    return out;
  }

  deserialize(d: Uint8Array): void {
    this.data.set(d.subarray(0, 0x20000));
    const s = d.subarray(0x20000);
    this.bank = s[0]; this.cmdState = s[1]; this.idMode = s[2] === 1;
    this.eraseArmed = s[3] === 1; this.pendingWrite = s[4] === 1; this.pendingBank = s[5] === 1;
  }
}

// RTC command numbers (bits 4-6 of the command byte, LSB-first on the wire).
const RTC_RESET = 0;
const RTC_DATETIME = 2;
const RTC_CONTROL = 4;
const RTC_TIME = 6;
const RTC_BYTES = [0, 0, 7, 0, 1, 0, 3, 0];

function bcd(n: number): number {
  return ((Math.floor(n / 10) % 10) << 4) | (n % 10);
}

/** S-3511A RTC behind the cartridge GPIO pins: bit0 SCK, bit1 SIO, bit2 CS. */
export class Rtc implements GpioPort {
  readable = false;
  private pins = 0;
  private direction = 0;

  private step = 0;
  private bits = 0;
  private bitsRead = 0;
  private bytesRemaining = 0;
  private commandActive = false;
  private command = 0;
  private control = 0x40; // 24-hour mode, no power-failure flag
  private readonly time = new Uint8Array(7);

  constructor(private now: () => Date = () => new Date()) {}

  read16(off: number): number {
    if (!this.readable) return 0;
    switch (off) {
      case 0xc4: return this.pins;
      case 0xc6: return this.direction;
      case 0xc8: return this.readable ? 1 : 0;
      default: return 0;
    }
  }

  write16(off: number, v: number): void {
    switch (off) {
      case 0xc4:
        this.pins = (this.pins & ~this.direction) | (v & this.direction);
        this.clock();
        break;
      case 0xc6:
        this.direction = v & 0xf;
        break;
      case 0xc8:
        this.readable = (v & 1) !== 0;
        break;
    }
  }

  private output(pins: number): void {
    this.pins = (this.pins & this.direction) | (pins & ~this.direction & 0xf);
  }

  private isReading(): boolean {
    return (this.command & 0x80) !== 0;
  }

  private clock(): void {
    const p = this.pins;
    switch (this.step) {
      case 0:
        if ((p & 5) === 1) this.step = 1;
        break;
      case 1:
        if ((p & 5) === 5) this.step = 2;
        else if ((p & 5) !== 1) this.step = 0;
        break;
      case 2:
        if (!(p & 1)) {
          // SCK low: latch the data bit presented by the game.
          this.bits &= ~(1 << this.bitsRead);
          this.bits |= ((p & 2) >>> 1) << this.bitsRead;
        } else if (p & 4) {
          // SCK rising edge with CS high: shift one bit.
          if (!this.commandActive || !this.isReading()) {
            this.bitsRead++;
            if (this.bitsRead === 8) this.processByte();
          } else {
            this.output(5 | (this.outputBit() << 1));
            this.bitsRead++;
            if (this.bitsRead === 8) {
              this.bytesRemaining--;
              if (this.bytesRemaining <= 0) {
                this.commandActive = false;
                this.command = 0;
              }
              this.bitsRead = 0;
            }
          }
        } else {
          // CS dropped: end of transfer.
          this.bitsRead = 0;
          this.bytesRemaining = 0;
          this.commandActive = false;
          this.command = 0;
          this.step = p & 1;
          this.output(1);
        }
        break;
    }
  }

  private processByte(): void {
    this.bytesRemaining--;
    if (!this.commandActive) {
      if ((this.bits & 0xf) === 0x6) {
        this.command = this.bits;
        const cmd = (this.bits >>> 4) & 7;
        this.bytesRemaining = RTC_BYTES[cmd];
        this.commandActive = this.bytesRemaining > 0;
        if (cmd === RTC_RESET) this.control = 0;
        else if (cmd === RTC_DATETIME || cmd === RTC_TIME) this.updateClock();
      }
    } else if (((this.command >>> 4) & 7) === RTC_CONTROL) {
      this.control = this.bits;
    }
    this.bits = 0;
    this.bitsRead = 0;
    if (this.bytesRemaining <= 0) {
      this.commandActive = false;
      this.command = 0;
    }
  }

  private outputBit(): number {
    if (!this.commandActive) return 0;
    let byte = 0;
    switch ((this.command >>> 4) & 7) {
      case RTC_CONTROL: byte = this.control; break;
      case RTC_DATETIME:
      case RTC_TIME: byte = this.time[7 - this.bytesRemaining]; break;
    }
    return (byte >>> this.bitsRead) & 1;
  }

  private updateClock(): void {
    const d = this.now();
    this.time[0] = bcd(d.getFullYear() % 100);
    this.time[1] = bcd(d.getMonth() + 1);
    this.time[2] = bcd(d.getDate());
    this.time[3] = d.getDay();
    this.time[4] = bcd(this.control & 0x40 ? d.getHours() : d.getHours() % 12);
    this.time[5] = bcd(d.getMinutes());
    this.time[6] = bcd(d.getSeconds());
  }

  serialize(): Uint8Array {
    return new Uint8Array([this.readable ? 1 : 0, this.pins, this.direction, this.control]);
  }

  deserialize(d: Uint8Array): void {
    this.readable = d[0] === 1;
    this.pins = d[1];
    this.direction = d[2];
    this.control = d[3];
    this.step = 0;
    this.commandActive = false;
  }
}
