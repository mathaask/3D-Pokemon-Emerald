// ARM7TDMI interpreter.
//
// PC convention: between instructions r[15] holds (next instruction address + 8)
// in ARM state or (+4) in THUMB state — exactly what the pipeline exposes to code.
// Handlers that branch call `branch(target)`, which stores target + one instruction
// size; the run loop then adds one more instruction size unconditionally.

import type { Bus } from './bus';
import { buildArmTable } from './arm';
import { buildThumbTable } from './thumb';

export const MODE_USR = 0x10;
export const MODE_FIQ = 0x11;
export const MODE_IRQ = 0x12;
export const MODE_SVC = 0x13;
export const MODE_ABT = 0x17;
export const MODE_UND = 0x1b;
export const MODE_SYS = 0x1f;

function bankOf(mode: number): number {
  switch (mode) {
    case MODE_FIQ: return 1;
    case MODE_IRQ: return 2;
    case MODE_SVC: return 3;
    case MODE_ABT: return 4;
    case MODE_UND: return 5;
    default: return 0; // USR and SYS share registers
  }
}

// Approximate access costs (cycles) per memory region (address >>> 24).
// Tuned to roughly match Emerald's WAITCNT (0x4317, prefetch on); undercounting
// slightly is harmless since the game is VBlank-paced.
const FETCH16 = new Uint8Array(16).fill(1);
const FETCH32 = new Uint8Array(16).fill(1);
const DATA16 = new Uint8Array(16).fill(1);
const DATA32 = new Uint8Array(16).fill(1);
for (let r = 0x8; r <= 0xd; r++) { FETCH16[r] = 2; FETCH32[r] = 4; DATA16[r] = 4; DATA32[r] = 6; }
FETCH16[2] = 3; FETCH32[2] = 6; DATA16[2] = 3; DATA32[2] = 6;
DATA32[5] = 2; DATA32[6] = 2;
DATA16[0xe] = 5; DATA32[0xe] = 5;

export type Handler = (op: number) => void;

export class Cpu {
  readonly r = new Int32Array(16);
  n = 0; z = 0; c = 0; v = 0;
  i = 1; f = 1; t = 0;
  mode = MODE_SYS;
  /** Shifter carry-out produced by the last operand-2 computation. */
  shc = 0;

  readonly bankR13 = new Int32Array(6);
  readonly bankR14 = new Int32Array(6);
  readonly spsrBank = new Int32Array(6);
  readonly fiqHi = new Int32Array(5); // r8-r12 for FIQ
  readonly usrHi = new Int32Array(5); // r8-r12 for everything else

  cycles = 0;
  halted = false;
  /** Set by the interrupt controller: IME && (IE & IF) != 0. */
  irqLine = false;
  /** Set when an IO write needs the scheduler to re-evaluate (e.g. timer started). */
  breakLoop = false;

  swiHandler: (n: number) => void = () => {};
  undefinedHandler: (op: number, thumb: boolean) => void = () => {};

  readonly armTable: Handler[];
  readonly thumbTable: Handler[];

  readonly fetch16Cost = FETCH16;
  readonly fetch32Cost = FETCH32;
  readonly data16Cost = DATA16;
  readonly data32Cost = DATA32;

  constructor(readonly bus: Bus) {
    this.armTable = buildArmTable(this);
    this.thumbTable = buildThumbTable(this);
  }

  reset(): void {
    this.r.fill(0);
    this.bankR13.fill(0);
    this.bankR14.fill(0);
    this.spsrBank.fill(0);
    this.n = this.z = this.c = this.v = 0;
    this.t = 0;
    this.i = 1;
    this.f = 1;
    this.mode = MODE_SYS;
    this.halted = false;
    this.cycles = 0;
  }

  /** Mimics the state the real BIOS leaves before jumping to the cartridge. */
  skipBios(entry = 0x08000000): void {
    this.reset();
    this.bankR13[bankOf(MODE_SVC)] = 0x03007fe0;
    this.bankR13[bankOf(MODE_IRQ)] = 0x03007fa0;
    this.mode = MODE_SYS;
    this.r[13] = 0x03007f00;
    this.i = 0;
    this.f = 0;
    this.t = 0;
    this.r[15] = entry + 8;
  }

  // ---------------------------------------------------------------- state

  getCPSR(): number {
    return (
      (this.n << 31) | (this.z << 30) | (this.c << 29) | (this.v << 28) |
      (this.i << 7) | (this.f << 6) | (this.t << 5) | this.mode
    );
  }

  setCPSR(val: number): void {
    this.switchMode(val & 0x1f);
    this.n = (val >>> 31) & 1;
    this.z = (val >>> 30) & 1;
    this.c = (val >>> 29) & 1;
    this.v = (val >>> 28) & 1;
    this.i = (val >>> 7) & 1;
    this.f = (val >>> 6) & 1;
    this.t = (val >>> 5) & 1;
  }

  /** Writes only the flag byte of the CPSR (MSR with field mask "f"). */
  setFlags(val: number): void {
    this.n = (val >>> 31) & 1;
    this.z = (val >>> 30) & 1;
    this.c = (val >>> 29) & 1;
    this.v = (val >>> 28) & 1;
  }

  hasSpsr(): boolean {
    return bankOf(this.mode) !== 0;
  }

  getSPSR(): number {
    const b = bankOf(this.mode);
    return b === 0 ? this.getCPSR() : this.spsrBank[b];
  }

  setSPSR(val: number): void {
    const b = bankOf(this.mode);
    if (b !== 0) this.spsrBank[b] = val;
  }

  switchMode(newMode: number): void {
    const ob = bankOf(this.mode);
    const nb = bankOf(newMode);
    const r = this.r;
    if (ob !== nb) {
      this.bankR13[ob] = r[13];
      this.bankR14[ob] = r[14];
      if (ob === 1 || nb === 1) {
        if (ob === 1) {
          for (let k = 0; k < 5; k++) { this.fiqHi[k] = r[8 + k]; r[8 + k] = this.usrHi[k]; }
        } else {
          for (let k = 0; k < 5; k++) { this.usrHi[k] = r[8 + k]; r[8 + k] = this.fiqHi[k]; }
        }
      }
      r[13] = this.bankR13[nb];
      r[14] = this.bankR14[nb];
    }
    this.mode = newMode;
  }

  /** Address of the instruction currently executing (valid inside handlers). */
  currentPC(): number {
    return (this.r[15] - (this.t ? 4 : 8)) >>> 0;
  }

  /** Address of the next instruction to execute (valid between instructions). */
  nextPC(): number {
    return (this.r[15] - (this.t ? 4 : 8)) >>> 0;
  }

  branch(target: number): void {
    if (this.t) this.r[15] = (target & ~1) + 2;
    else this.r[15] = (target & ~3) + 4;
    this.cycles += 2;
  }

  /** Branch-and-exchange: bit 0 of target selects THUMB. */
  branchX(target: number): void {
    this.t = target & 1;
    this.branch(target);
  }

  /** Restores CPSR from SPSR (data-processing with S and Rd=PC, LDM ^ with PC). */
  restoreSpsr(): void {
    if (this.hasSpsr()) this.setCPSR(this.spsrBank[bankOf(this.mode)]);
  }

  // ---------------------------------------------------------------- memory helpers

  read32(a: number): number {
    this.cycles += DATA32[(a >>> 24) & 15];
    return this.bus.read32(a & ~3);
  }

  /** LDR semantics: misaligned word loads rotate the aligned word. */
  read32Rot(a: number): number {
    this.cycles += DATA32[(a >>> 24) & 15];
    const v = this.bus.read32(a & ~3);
    const rot = (a & 3) << 3;
    return rot === 0 ? v : ((v >>> rot) | (v << (32 - rot))) | 0;
  }

  read16(a: number): number {
    this.cycles += DATA16[(a >>> 24) & 15];
    return this.bus.read16(a & ~1);
  }

  /** LDRH semantics: misaligned halfword loads rotate by 8. */
  read16Rot(a: number): number {
    this.cycles += DATA16[(a >>> 24) & 15];
    const v = this.bus.read16(a & ~1);
    return a & 1 ? ((v >>> 8) | (v << 24)) | 0 : v;
  }

  /** LDRSH semantics: misaligned addresses load a sign-extended byte. */
  read16Signed(a: number): number {
    this.cycles += DATA16[(a >>> 24) & 15];
    if (a & 1) return (this.bus.read8(a) << 24) >> 24;
    return (this.bus.read16(a) << 16) >> 16;
  }

  read8(a: number): number {
    this.cycles += DATA16[(a >>> 24) & 15];
    return this.bus.read8(a);
  }

  write32(a: number, v: number): void {
    this.cycles += DATA32[(a >>> 24) & 15];
    this.bus.write32(a & ~3, v);
  }

  write16(a: number, v: number): void {
    this.cycles += DATA16[(a >>> 24) & 15];
    this.bus.write16(a & ~1, v);
  }

  write8(a: number, v: number): void {
    this.cycles += DATA16[(a >>> 24) & 15];
    this.bus.write8(a, v);
  }

  // ---------------------------------------------------------------- flags

  checkCond(cond: number): boolean {
    switch (cond) {
      case 0x0: return this.z === 1;
      case 0x1: return this.z === 0;
      case 0x2: return this.c === 1;
      case 0x3: return this.c === 0;
      case 0x4: return this.n === 1;
      case 0x5: return this.n === 0;
      case 0x6: return this.v === 1;
      case 0x7: return this.v === 0;
      case 0x8: return this.c === 1 && this.z === 0;
      case 0x9: return this.c === 0 || this.z === 1;
      case 0xa: return this.n === this.v;
      case 0xb: return this.n !== this.v;
      case 0xc: return this.z === 0 && this.n === this.v;
      case 0xd: return this.z === 1 || this.n !== this.v;
      case 0xe: return true;
      default: return false;
    }
  }

  setNZ(res: number): void {
    this.n = res >>> 31;
    this.z = res === 0 ? 1 : 0;
  }

  add(a: number, b: number, setFlags: boolean): number {
    const res = (a + b) | 0;
    if (setFlags) {
      this.n = res >>> 31;
      this.z = res === 0 ? 1 : 0;
      this.c = (a >>> 0) + (b >>> 0) > 0xffffffff ? 1 : 0;
      this.v = (~(a ^ b) & (a ^ res)) >>> 31;
    }
    return res;
  }

  adc(a: number, b: number, setFlags: boolean): number {
    const carry = this.c;
    const res = (a + b + carry) | 0;
    if (setFlags) {
      this.n = res >>> 31;
      this.z = res === 0 ? 1 : 0;
      this.c = (a >>> 0) + (b >>> 0) + carry > 0xffffffff ? 1 : 0;
      this.v = (~(a ^ b) & (a ^ res)) >>> 31;
    }
    return res;
  }

  sub(a: number, b: number, setFlags: boolean): number {
    const res = (a - b) | 0;
    if (setFlags) {
      this.n = res >>> 31;
      this.z = res === 0 ? 1 : 0;
      this.c = a >>> 0 >= b >>> 0 ? 1 : 0;
      this.v = ((a ^ b) & (a ^ res)) >>> 31;
    }
    return res;
  }

  sbc(a: number, b: number, setFlags: boolean): number {
    const borrow = 1 - this.c;
    const res = (a - b - borrow) | 0;
    if (setFlags) {
      this.n = res >>> 31;
      this.z = res === 0 ? 1 : 0;
      this.c = a >>> 0 >= (b >>> 0) + borrow ? 1 : 0;
      this.v = ((a ^ b) & (a ^ res)) >>> 31;
    }
    return res;
  }

  // ---------------------------------------------------------------- shifter
  // Immediate-amount forms (amount 0 has the special LSR/ASR #32 and RRX meanings).

  lslImm(v: number, n: number): number {
    if (n === 0) { this.shc = this.c; return v; }
    this.shc = (v >>> (32 - n)) & 1;
    return v << n;
  }

  lsrImm(v: number, n: number): number {
    if (n === 0) { this.shc = v >>> 31; return 0; }
    this.shc = (v >>> (n - 1)) & 1;
    return (v >>> n) | 0;
  }

  asrImm(v: number, n: number): number {
    if (n === 0) { this.shc = v >>> 31; return v >> 31; }
    this.shc = (v >> (n - 1)) & 1;
    return v >> n;
  }

  rorImm(v: number, n: number): number {
    if (n === 0) { // RRX
      this.shc = v & 1;
      return ((this.c << 31) | (v >>> 1)) | 0;
    }
    this.shc = (v >>> (n - 1)) & 1;
    return ((v >>> n) | (v << (32 - n))) | 0;
  }

  // Register-amount forms (amount is Rs & 0xff).

  lslReg(v: number, n: number): number {
    if (n === 0) { this.shc = this.c; return v; }
    if (n < 32) { this.shc = (v >>> (32 - n)) & 1; return v << n; }
    this.shc = n === 32 ? v & 1 : 0;
    return 0;
  }

  lsrReg(v: number, n: number): number {
    if (n === 0) { this.shc = this.c; return v; }
    if (n < 32) { this.shc = (v >>> (n - 1)) & 1; return (v >>> n) | 0; }
    this.shc = n === 32 ? v >>> 31 : 0;
    return 0;
  }

  asrReg(v: number, n: number): number {
    if (n === 0) { this.shc = this.c; return v; }
    if (n < 32) { this.shc = (v >> (n - 1)) & 1; return v >> n; }
    this.shc = v >>> 31;
    return v >> 31;
  }

  rorReg(v: number, n: number): number {
    if (n === 0) { this.shc = this.c; return v; }
    n &= 31;
    if (n === 0) { this.shc = v >>> 31; return v; }
    this.shc = (v >>> (n - 1)) & 1;
    return ((v >>> n) | (v << (32 - n))) | 0;
  }

  // ---------------------------------------------------------------- exceptions

  /** Enters the IRQ exception (vector 0x18). Called between instructions. */
  takeIrq(): void {
    const cpsr = this.getCPSR();
    const ret = this.nextPC() + 4;
    this.switchMode(MODE_IRQ);
    this.spsrBank[bankOf(MODE_IRQ)] = cpsr;
    this.r[14] = ret;
    this.t = 0;
    this.i = 1;
    this.r[15] = 0x18 + 8;
    this.cycles += 3;
  }

  // ---------------------------------------------------------------- execution

  /** Executes instructions until `cycles >= limit`, the CPU halts, or breakLoop is set. */
  run(limit: number): void {
    const r = this.r;
    const bus = this.bus;
    const rom16 = bus.rom16;
    const rom32 = bus.rom32;
    const iwram16 = bus.iwram16;
    const iwram32 = bus.iwram32;
    const armTable = this.armTable;
    const thumbTable = this.thumbTable;
    this.breakLoop = false;
    while (this.cycles < limit && !this.halted && !this.breakLoop) {
      if (this.irqLine && this.i === 0) this.takeIrq();
      if (this.t) {
        const pc = (r[15] - 4) >>> 0;
        const region = pc >>> 24;
        let op: number;
        if (region === 0x08) op = rom16[(pc & 0x1ffffff) >>> 1];
        else if (region === 0x03) op = iwram16[(pc & 0x7fff) >>> 1];
        else op = bus.read16(pc);
        this.cycles += FETCH16[region & 15];
        thumbTable[op >>> 6](op);
        r[15] += this.t ? 2 : 4;
      } else {
        const pc = (r[15] - 8) >>> 0;
        const region = pc >>> 24;
        let op: number;
        if (region === 0x08) op = rom32[(pc & 0x1ffffff) >>> 2];
        else if (region === 0x03) op = iwram32[(pc & 0x7fff) >>> 2];
        else op = bus.read32(pc);
        this.cycles += FETCH32[region & 15];
        const cond = op >>> 28;
        if (cond === 0xe || this.checkCond(cond)) {
          armTable[((op >>> 16) & 0xff0) | ((op >>> 4) & 0xf)](op);
        }
        r[15] += this.t ? 2 : 4;
      }
    }
  }

  /** Executes exactly one instruction (used by tests). */
  step(): void {
    this.run(this.cycles + 1);
  }

  // ---------------------------------------------------------------- save state

  serialize(): Int32Array {
    const out = new Int32Array(16 + 6 * 3 + 10 + 12);
    out.set(this.r, 0);
    out.set(this.bankR13, 16);
    out.set(this.bankR14, 22);
    out.set(this.spsrBank, 28);
    out.set(this.fiqHi, 34);
    out.set(this.usrHi, 39);
    out[44] = this.getCPSR();
    out[45] = this.halted ? 1 : 0;
    out[46] = this.cycles % 0x40000000;
    return out;
  }

  deserialize(d: Int32Array): void {
    this.r.set(d.subarray(0, 16));
    this.bankR13.set(d.subarray(16, 22));
    this.bankR14.set(d.subarray(22, 28));
    this.spsrBank.set(d.subarray(28, 34));
    this.fiqHi.set(d.subarray(34, 39));
    this.usrHi.set(d.subarray(39, 44));
    // setCPSR would bank-swap; restore fields directly instead.
    const cpsr = d[44];
    this.mode = cpsr & 0x1f;
    this.n = (cpsr >>> 31) & 1; this.z = (cpsr >>> 30) & 1;
    this.c = (cpsr >>> 29) & 1; this.v = (cpsr >>> 28) & 1;
    this.i = (cpsr >>> 7) & 1; this.f = (cpsr >>> 6) & 1; this.t = (cpsr >>> 5) & 1;
    this.halted = d[45] === 1;
  }
}
