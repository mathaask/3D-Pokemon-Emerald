// ARM (32-bit) instruction set. The decode table is indexed by
// bits 27-20 (high 8 bits of the index) and bits 7-4 (low 4 bits).

import type { Cpu, Handler } from './cpu';
import { MODE_USR } from './cpu';

export function buildArmTable(cpu: Cpu): Handler[] {
  const r = cpu.r;
  const table: Handler[] = new Array(4096);

  const undefinedOp: Handler = (op) => cpu.undefinedHandler(op, false);

  // ---------------------------------------------------------------- data processing core
  // `op2` is the evaluated operand 2, `rnv` the first operand. Writes Rd and flags.
  function dataProc(op: number, rnv: number, op2: number): void {
    const opcode = (op >>> 21) & 15;
    const s = (op >>> 20) & 1;
    const rd = (op >>> 12) & 15;
    const setFlags = s === 1 && rd !== 15;
    let res = 0;
    switch (opcode) {
      case 0x0: res = rnv & op2; break; // AND
      case 0x1: res = rnv ^ op2; break; // EOR
      case 0x2: res = cpu.sub(rnv, op2, setFlags); break; // SUB
      case 0x3: res = cpu.sub(op2, rnv, setFlags); break; // RSB
      case 0x4: res = cpu.add(rnv, op2, setFlags); break; // ADD
      case 0x5: res = cpu.adc(rnv, op2, setFlags); break; // ADC
      case 0x6: res = cpu.sbc(rnv, op2, setFlags); break; // SBC
      case 0x7: res = cpu.sbc(op2, rnv, setFlags); break; // RSC
      case 0x8: res = rnv & op2; cpu.setNZ(res); cpu.c = cpu.shc; return; // TST
      case 0x9: res = rnv ^ op2; cpu.setNZ(res); cpu.c = cpu.shc; return; // TEQ
      case 0xa: cpu.sub(rnv, op2, true); return; // CMP
      case 0xb: cpu.add(rnv, op2, true); return; // CMN
      case 0xc: res = rnv | op2; break; // ORR
      case 0xd: res = op2; break; // MOV
      case 0xe: res = rnv & ~op2; break; // BIC
      case 0xf: res = ~op2; break; // MVN
    }
    // Logical ops set N/Z from the result and C from the shifter.
    if (setFlags && (opcode < 2 || opcode >= 0xc)) {
      cpu.n = res >>> 31;
      cpu.z = res === 0 ? 1 : 0;
      cpu.c = cpu.shc;
    }
    if (rd === 15) {
      if (s === 1) {
        cpu.restoreSpsr();
        cpu.branch(res);
      } else {
        cpu.branch(res);
      }
    } else {
      r[rd] = res;
    }
  }

  // Operand 2: register shifted by immediate.
  const dpRegImm: Handler = (op) => {
    const rm = op & 15;
    const amount = (op >>> 7) & 31;
    const v = r[rm];
    let op2: number;
    switch ((op >>> 5) & 3) {
      case 0: op2 = cpu.lslImm(v, amount); break;
      case 1: op2 = cpu.lsrImm(v, amount); break;
      case 2: op2 = cpu.asrImm(v, amount); break;
      default: op2 = cpu.rorImm(v, amount); break;
    }
    dataProc(op, r[(op >>> 16) & 15], op2);
  };

  // Operand 2: register shifted by register. PC reads as +12 in this form.
  const dpRegReg: Handler = (op) => {
    const rm = op & 15;
    const rn = (op >>> 16) & 15;
    const amount = r[(op >>> 8) & 15] & 0xff;
    const v = rm === 15 ? r[15] + 4 : r[rm];
    let op2: number;
    switch ((op >>> 5) & 3) {
      case 0: op2 = cpu.lslReg(v, amount); break;
      case 1: op2 = cpu.lsrReg(v, amount); break;
      case 2: op2 = cpu.asrReg(v, amount); break;
      default: op2 = cpu.rorReg(v, amount); break;
    }
    cpu.cycles += 1;
    dataProc(op, rn === 15 ? r[15] + 4 : r[rn], op2);
  };

  // Operand 2: rotated 8-bit immediate.
  const dpImm: Handler = (op) => {
    const rot = (op >>> 7) & 30;
    const imm = op & 0xff;
    let op2: number;
    if (rot === 0) {
      op2 = imm;
      cpu.shc = cpu.c;
    } else {
      op2 = ((imm >>> rot) | (imm << (32 - rot))) | 0;
      cpu.shc = op2 >>> 31;
    }
    dataProc(op, r[(op >>> 16) & 15], op2);
  };

  // ---------------------------------------------------------------- PSR transfer
  const mrs: Handler = (op) => {
    const rd = (op >>> 12) & 15;
    r[rd] = op & (1 << 22) ? cpu.getSPSR() : cpu.getCPSR();
  };

  function msr(op: number, value: number): void {
    const toSpsr = (op & (1 << 22)) !== 0;
    let mask = 0;
    if (op & (1 << 19)) mask |= 0xff000000;
    if (op & (1 << 16)) mask |= 0x000000ff;
    // x/s fields (bits 17/18) are reserved on ARMv4.
    if (toSpsr) {
      if (cpu.hasSpsr()) cpu.setSPSR((cpu.getSPSR() & ~mask) | (value & mask));
      return;
    }
    if (cpu.mode === MODE_USR) mask &= 0xff000000; // user mode may only change flags
    const cur = cpu.getCPSR();
    let next = (cur & ~mask) | (value & mask);
    next = (next & ~0x20) | (cur & 0x20); // T bit is not writable via MSR
    cpu.setCPSR(next);
  }

  const msrReg: Handler = (op) => msr(op, r[op & 15]);
  const msrImm: Handler = (op) => {
    const rot = (op >>> 7) & 30;
    const imm = op & 0xff;
    msr(op, rot === 0 ? imm : ((imm >>> rot) | (imm << (32 - rot))) | 0);
  };

  // ---------------------------------------------------------------- branches
  const bx: Handler = (op) => cpu.branchX(r[op & 15]);

  const b: Handler = (op) => {
    const offset = (op << 8) >> 6;
    cpu.branch(r[15] + offset);
  };

  const bl: Handler = (op) => {
    const offset = (op << 8) >> 6;
    r[14] = r[15] - 4;
    cpu.branch(r[15] + offset);
  };

  // ---------------------------------------------------------------- multiply
  const mul: Handler = (op) => {
    const rd = (op >>> 16) & 15;
    const rn = (op >>> 12) & 15;
    const rs = (op >>> 8) & 15;
    const rm = op & 15;
    let res = Math.imul(r[rm], r[rs]);
    if (op & (1 << 21)) { res = (res + r[rn]) | 0; cpu.cycles += 1; }
    r[rd] = res;
    if (op & (1 << 20)) cpu.setNZ(res);
    cpu.cycles += 2;
  };

  const mulLong: Handler = (op) => {
    const rdHi = (op >>> 16) & 15;
    const rdLo = (op >>> 12) & 15;
    const a = r[op & 15];
    const bv = r[(op >>> 8) & 15];
    const signed = (op & (1 << 22)) !== 0;
    // 32x32 -> 64 multiply via 16-bit limbs (exact in doubles).
    const au = a >>> 0, bu = bv >>> 0;
    const aL = au & 0xffff, aH = au >>> 16, bL = bu & 0xffff, bH = bu >>> 16;
    const ll = aL * bL, lh = aL * bH, hl = aH * bL, hh = aH * bH;
    const mid = (ll >>> 16) + (lh & 0xffff) + (hl & 0xffff);
    let lo = ((mid << 16) | (ll & 0xffff)) | 0;
    let hi = (hh + (lh >>> 16) + (hl >>> 16) + (mid >>> 16)) | 0;
    if (signed) {
      if (a < 0) hi = (hi - bv) | 0;
      if (bv < 0) hi = (hi - a) | 0;
    }
    if (op & (1 << 21)) {
      const sumLo = (lo >>> 0) + (r[rdLo] >>> 0);
      lo = sumLo | 0;
      hi = (hi + r[rdHi] + (sumLo > 0xffffffff ? 1 : 0)) | 0;
      cpu.cycles += 1;
    }
    r[rdLo] = lo;
    r[rdHi] = hi;
    if (op & (1 << 20)) {
      cpu.n = hi >>> 31;
      cpu.z = hi === 0 && lo === 0 ? 1 : 0;
    }
    cpu.cycles += 3;
  };

  const swp: Handler = (op) => {
    const rn = (op >>> 16) & 15;
    const rd = (op >>> 12) & 15;
    const rm = op & 15;
    const addr = r[rn];
    if (op & (1 << 22)) {
      const tmp = cpu.read8(addr);
      cpu.write8(addr, r[rm]);
      r[rd] = tmp;
    } else {
      const tmp = cpu.read32Rot(addr);
      cpu.write32(addr, r[rm]);
      r[rd] = tmp;
    }
    cpu.cycles += 1;
  };

  // ---------------------------------------------------------------- single data transfer
  function ldrStr(op: number, offset: number): void {
    const p = (op >>> 24) & 1;
    const u = (op >>> 23) & 1;
    const byte = (op >>> 22) & 1;
    const w = (op >>> 21) & 1;
    const load = (op >>> 20) & 1;
    const rn = (op >>> 16) & 15;
    const rd = (op >>> 12) & 15;
    const base = r[rn];
    const offsetBase = u ? (base + offset) | 0 : (base - offset) | 0;
    const addr = p ? offsetBase : base;
    const writeback = p === 0 || w === 1;
    if (load) {
      const val = byte ? cpu.read8(addr) : cpu.read32Rot(addr);
      if (writeback && rn !== rd) r[rn] = offsetBase;
      cpu.cycles += 1;
      if (rd === 15) cpu.branch(val);
      else r[rd] = val;
    } else {
      const val = rd === 15 ? r[15] + 4 : r[rd];
      if (byte) cpu.write8(addr, val);
      else cpu.write32(addr, val);
      if (writeback) r[rn] = offsetBase;
    }
  }

  const ldrStrImm: Handler = (op) => ldrStr(op, op & 0xfff);

  const ldrStrReg: Handler = (op) => {
    const rm = op & 15;
    const amount = (op >>> 7) & 31;
    const v = r[rm];
    const savedShc = cpu.shc;
    let off: number;
    switch ((op >>> 5) & 3) {
      case 0: off = cpu.lslImm(v, amount); break;
      case 1: off = cpu.lsrImm(v, amount); break;
      case 2: off = cpu.asrImm(v, amount); break;
      default: off = cpu.rorImm(v, amount); break;
    }
    cpu.shc = savedShc;
    ldrStr(op, off);
  };

  // ---------------------------------------------------------------- halfword / signed transfer
  const halfword: Handler = (op) => {
    const p = (op >>> 24) & 1;
    const u = (op >>> 23) & 1;
    const imm = (op >>> 22) & 1;
    const w = (op >>> 21) & 1;
    const load = (op >>> 20) & 1;
    const rn = (op >>> 16) & 15;
    const rd = (op >>> 12) & 15;
    const sh = (op >>> 5) & 3;
    const offset = imm ? ((op >>> 4) & 0xf0) | (op & 0xf) : r[op & 15];
    const base = r[rn];
    const offsetBase = u ? (base + offset) | 0 : (base - offset) | 0;
    const addr = p ? offsetBase : base;
    const writeback = p === 0 || w === 1;
    if (load) {
      let val: number;
      if (sh === 1) val = cpu.read16Rot(addr);
      else if (sh === 2) val = (cpu.read8(addr) << 24) >> 24;
      else val = cpu.read16Signed(addr);
      if (writeback && rn !== rd) r[rn] = offsetBase;
      cpu.cycles += 1;
      if (rd === 15) cpu.branch(val);
      else r[rd] = val;
    } else {
      // sh === 1: STRH (2/3 are LDRD/STRD on ARMv5; treat as STRH-free no-ops)
      if (sh === 1) cpu.write16(addr, rd === 15 ? r[15] + 4 : r[rd]);
      if (writeback) r[rn] = offsetBase;
    }
  };

  // ---------------------------------------------------------------- block transfer
  const blockTransfer: Handler = (op) => {
    const p = (op >>> 24) & 1;
    const u = (op >>> 23) & 1;
    const sBit = (op >>> 22) & 1;
    const w = (op >>> 21) & 1;
    const load = (op >>> 20) & 1;
    const rn = (op >>> 16) & 15;
    let rlist = op & 0xffff;
    const base = r[rn];
    let count = 0;
    for (let k = rlist; k !== 0; k &= k - 1) count++;
    let bytes = count * 4;
    if (rlist === 0) { // ARMv4 quirk: empty list transfers R15 and moves the base by 0x40
      rlist = 0x8000;
      bytes = 0x40;
    }
    let addr: number;
    let newBase: number;
    if (u) {
      addr = p ? base + 4 : base;
      newBase = base + bytes;
    } else {
      addr = p ? base - bytes : base - bytes + 4;
      newBase = base - bytes;
    }
    addr |= 0;
    newBase |= 0;

    const pcInList = (rlist & 0x8000) !== 0;
    const userBank = sBit === 1 && !(load && pcInList);
    const savedMode = cpu.mode;
    if (userBank) cpu.switchMode(MODE_USR);

    if (load) {
      if (w) r[rn] = newBase; // loaded value wins if Rn is in the list
      for (let reg = 0; reg < 16; reg++) {
        if (rlist & (1 << reg)) {
          const val = cpu.read32(addr);
          addr = (addr + 4) | 0;
          if (reg === 15) {
            if (sBit) cpu.restoreSpsr();
            cpu.branch(val);
          } else {
            r[reg] = val;
          }
        }
      }
      cpu.cycles += 1;
    } else {
      let first = true;
      for (let reg = 0; reg < 16; reg++) {
        if (rlist & (1 << reg)) {
          cpu.write32(addr, reg === 15 ? r[15] + 4 : r[reg]);
          addr = (addr + 4) | 0;
          // Base is written back after the first transfer, so a later store of Rn sees the new value.
          if (first && w) r[rn] = newBase;
          first = false;
        }
      }
    }
    if (userBank) cpu.switchMode(savedMode);
  };

  // ---------------------------------------------------------------- software interrupt
  const swi: Handler = (op) => {
    cpu.cycles += 3;
    cpu.swiHandler((op >>> 16) & 0xff);
  };

  const coprocessor: Handler = () => { /* no coprocessors on GBA */ };

  // ---------------------------------------------------------------- table construction
  for (let i = 0; i < 4096; i++) {
    const hi = i >>> 4; // bits 27-20
    const lo = i & 15; // bits 7-4
    let h: Handler = undefinedOp;
    switch (hi >>> 5) {
      case 0:
        if ((lo & 9) === 9) {
          if ((lo & 6) === 0) {
            if ((hi & 0xfc) === 0x00) h = mul;
            else if ((hi & 0xf8) === 0x08) h = mulLong;
            else if ((hi & 0xfb) === 0x10) h = swp;
          } else {
            h = halfword;
          }
        } else if ((hi & 0xf9) === 0x10) {
          // TST/TEQ/CMP/CMN with S=0: PSR transfer and BX
          if (hi === 0x12 && lo === 1) h = bx;
          else if ((hi & 0xfb) === 0x10 && lo === 0) h = mrs;
          else if ((hi & 0xfb) === 0x12 && lo === 0) h = msrReg;
        } else {
          h = lo & 1 ? dpRegReg : dpRegImm;
        }
        break;
      case 1:
        if ((hi & 0xfb) === 0x32) h = msrImm;
        else if ((hi & 0xfb) === 0x30) h = undefinedOp;
        else h = dpImm;
        break;
      case 2:
        h = ldrStrImm;
        break;
      case 3:
        h = lo & 1 ? undefinedOp : ldrStrReg;
        break;
      case 4:
        h = blockTransfer;
        break;
      case 5:
        h = hi & 0x10 ? bl : b;
        break;
      case 6:
        h = coprocessor;
        break;
      case 7:
        h = hi & 0x10 ? swi : coprocessor;
        break;
    }
    table[i] = h;
  }
  return table;
}
