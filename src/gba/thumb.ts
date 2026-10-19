// THUMB (16-bit) instruction set. Decode table indexed by bits 15-6.

import type { Cpu, Handler } from './cpu';

export function buildThumbTable(cpu: Cpu): Handler[] {
  const r = cpu.r;
  const table: Handler[] = new Array(1024);
  const undefinedOp: Handler = (op) => cpu.undefinedHandler(op, true);

  // Format 1: move shifted register
  const lslImm: Handler = (op) => {
    const res = cpu.lslImm(r[(op >>> 3) & 7], (op >>> 6) & 31);
    r[op & 7] = res;
    cpu.setNZ(res | 0);
    cpu.c = cpu.shc;
  };
  const lsrImm: Handler = (op) => {
    const res = cpu.lsrImm(r[(op >>> 3) & 7], (op >>> 6) & 31);
    r[op & 7] = res;
    cpu.setNZ(res | 0);
    cpu.c = cpu.shc;
  };
  const asrImm: Handler = (op) => {
    const res = cpu.asrImm(r[(op >>> 3) & 7], (op >>> 6) & 31);
    r[op & 7] = res;
    cpu.setNZ(res | 0);
    cpu.c = cpu.shc;
  };

  // Format 2: add/subtract
  const addReg: Handler = (op) => { r[op & 7] = cpu.add(r[(op >>> 3) & 7], r[(op >>> 6) & 7], true); };
  const subReg: Handler = (op) => { r[op & 7] = cpu.sub(r[(op >>> 3) & 7], r[(op >>> 6) & 7], true); };
  const addImm3: Handler = (op) => { r[op & 7] = cpu.add(r[(op >>> 3) & 7], (op >>> 6) & 7, true); };
  const subImm3: Handler = (op) => { r[op & 7] = cpu.sub(r[(op >>> 3) & 7], (op >>> 6) & 7, true); };

  // Format 3: move/compare/add/subtract immediate
  const movImm: Handler = (op) => { const v = op & 0xff; r[(op >>> 8) & 7] = v; cpu.n = 0; cpu.z = v === 0 ? 1 : 0; };
  const cmpImm: Handler = (op) => { cpu.sub(r[(op >>> 8) & 7], op & 0xff, true); };
  const addImm8: Handler = (op) => { const rd = (op >>> 8) & 7; r[rd] = cpu.add(r[rd], op & 0xff, true); };
  const subImm8: Handler = (op) => { const rd = (op >>> 8) & 7; r[rd] = cpu.sub(r[rd], op & 0xff, true); };

  // Format 4: ALU operations
  const alu: Handler = (op) => {
    const rd = op & 7;
    const rs = (op >>> 3) & 7;
    const a = r[rd];
    const bv = r[rs];
    let res: number;
    switch ((op >>> 6) & 15) {
      case 0x0: res = a & bv; r[rd] = res; cpu.setNZ(res); return; // AND
      case 0x1: res = a ^ bv; r[rd] = res; cpu.setNZ(res); return; // EOR
      case 0x2: res = cpu.lslReg(a, bv & 0xff) | 0; r[rd] = res; cpu.setNZ(res); cpu.c = cpu.shc; cpu.cycles++; return; // LSL
      case 0x3: res = cpu.lsrReg(a, bv & 0xff) | 0; r[rd] = res; cpu.setNZ(res); cpu.c = cpu.shc; cpu.cycles++; return; // LSR
      case 0x4: res = cpu.asrReg(a, bv & 0xff) | 0; r[rd] = res; cpu.setNZ(res); cpu.c = cpu.shc; cpu.cycles++; return; // ASR
      case 0x5: r[rd] = cpu.adc(a, bv, true); return; // ADC
      case 0x6: r[rd] = cpu.sbc(a, bv, true); return; // SBC
      case 0x7: res = cpu.rorReg(a, bv & 0xff) | 0; r[rd] = res; cpu.setNZ(res); cpu.c = cpu.shc; cpu.cycles++; return; // ROR
      case 0x8: cpu.setNZ(a & bv); return; // TST
      case 0x9: r[rd] = cpu.sub(0, bv, true); return; // NEG
      case 0xa: cpu.sub(a, bv, true); return; // CMP
      case 0xb: cpu.add(a, bv, true); return; // CMN
      case 0xc: res = a | bv; r[rd] = res; cpu.setNZ(res); return; // ORR
      case 0xd: res = Math.imul(a, bv); r[rd] = res; cpu.setNZ(res); cpu.cycles += 2; return; // MUL
      case 0xe: res = a & ~bv; r[rd] = res; cpu.setNZ(res); return; // BIC
      default: res = ~bv; r[rd] = res; cpu.setNZ(res); return; // MVN
    }
  };

  // Format 5: hi register operations / branch exchange
  const hiAdd: Handler = (op) => {
    const rd = (op & 7) | ((op >>> 4) & 8);
    const rs = (op >>> 3) & 15;
    const res = (r[rd] + r[rs]) | 0;
    if (rd === 15) cpu.branch(res);
    else r[rd] = res;
  };
  const hiCmp: Handler = (op) => {
    const rd = (op & 7) | ((op >>> 4) & 8);
    const rs = (op >>> 3) & 15;
    cpu.sub(r[rd], r[rs], true);
  };
  const hiMov: Handler = (op) => {
    const rd = (op & 7) | ((op >>> 4) & 8);
    const rs = (op >>> 3) & 15;
    if (rd === 15) cpu.branch(r[rs]);
    else r[rd] = r[rs];
  };
  const bx: Handler = (op) => {
    const rs = (op >>> 3) & 15;
    let target = r[rs];
    if (rs === 15) target &= ~2; // BX PC switches to ARM at a word-aligned address
    cpu.branchX(target);
  };

  // Format 6: PC-relative load
  const ldrPc: Handler = (op) => {
    r[(op >>> 8) & 7] = cpu.read32(((r[15] & ~2) + ((op & 0xff) << 2)) | 0);
    cpu.cycles += 1;
  };

  // Format 7: load/store with register offset
  const strReg: Handler = (op) => { cpu.write32(r[(op >>> 3) & 7] + r[(op >>> 6) & 7], r[op & 7]); };
  const strbReg: Handler = (op) => { cpu.write8(r[(op >>> 3) & 7] + r[(op >>> 6) & 7], r[op & 7]); };
  const ldrReg: Handler = (op) => { r[op & 7] = cpu.read32Rot((r[(op >>> 3) & 7] + r[(op >>> 6) & 7]) | 0); cpu.cycles++; };
  const ldrbReg: Handler = (op) => { r[op & 7] = cpu.read8((r[(op >>> 3) & 7] + r[(op >>> 6) & 7]) | 0); cpu.cycles++; };

  // Format 8: load/store sign-extended byte/halfword
  const strhReg: Handler = (op) => { cpu.write16(r[(op >>> 3) & 7] + r[(op >>> 6) & 7], r[op & 7]); };
  const ldsbReg: Handler = (op) => { r[op & 7] = (cpu.read8((r[(op >>> 3) & 7] + r[(op >>> 6) & 7]) | 0) << 24) >> 24; cpu.cycles++; };
  const ldrhReg: Handler = (op) => { r[op & 7] = cpu.read16Rot((r[(op >>> 3) & 7] + r[(op >>> 6) & 7]) | 0); cpu.cycles++; };
  const ldshReg: Handler = (op) => { r[op & 7] = cpu.read16Signed((r[(op >>> 3) & 7] + r[(op >>> 6) & 7]) | 0); cpu.cycles++; };

  // Format 9: load/store with immediate offset
  const strImm: Handler = (op) => { cpu.write32(r[(op >>> 3) & 7] + (((op >>> 6) & 31) << 2), r[op & 7]); };
  const ldrImm: Handler = (op) => { r[op & 7] = cpu.read32Rot((r[(op >>> 3) & 7] + (((op >>> 6) & 31) << 2)) | 0); cpu.cycles++; };
  const strbImm: Handler = (op) => { cpu.write8(r[(op >>> 3) & 7] + ((op >>> 6) & 31), r[op & 7]); };
  const ldrbImm: Handler = (op) => { r[op & 7] = cpu.read8((r[(op >>> 3) & 7] + ((op >>> 6) & 31)) | 0); cpu.cycles++; };

  // Format 10: load/store halfword
  const strhImm: Handler = (op) => { cpu.write16(r[(op >>> 3) & 7] + (((op >>> 6) & 31) << 1), r[op & 7]); };
  const ldrhImm: Handler = (op) => { r[op & 7] = cpu.read16Rot((r[(op >>> 3) & 7] + (((op >>> 6) & 31) << 1)) | 0); cpu.cycles++; };

  // Format 11: SP-relative load/store
  const strSp: Handler = (op) => { cpu.write32(r[13] + ((op & 0xff) << 2), r[(op >>> 8) & 7]); };
  const ldrSp: Handler = (op) => { r[(op >>> 8) & 7] = cpu.read32Rot((r[13] + ((op & 0xff) << 2)) | 0); cpu.cycles++; };

  // Format 12: load address
  const addPc: Handler = (op) => { r[(op >>> 8) & 7] = ((r[15] & ~2) + ((op & 0xff) << 2)) | 0; };
  const addSp: Handler = (op) => { r[(op >>> 8) & 7] = (r[13] + ((op & 0xff) << 2)) | 0; };

  // Format 13: add offset to stack pointer
  const addSpImm: Handler = (op) => {
    const off = (op & 0x7f) << 2;
    r[13] = op & 0x80 ? (r[13] - off) | 0 : (r[13] + off) | 0;
  };

  // Format 14: push/pop
  const push: Handler = (op) => {
    const rlist = op & 0xff;
    const lr = (op & 0x100) !== 0;
    let count = lr ? 1 : 0;
    for (let k = rlist; k !== 0; k &= k - 1) count++;
    let addr = (r[13] - count * 4) | 0;
    r[13] = addr;
    for (let reg = 0; reg < 8; reg++) {
      if (rlist & (1 << reg)) { cpu.write32(addr, r[reg]); addr += 4; }
    }
    if (lr) cpu.write32(addr, r[14]);
  };
  const pop: Handler = (op) => {
    const rlist = op & 0xff;
    const pc = (op & 0x100) !== 0;
    let addr = r[13];
    for (let reg = 0; reg < 8; reg++) {
      if (rlist & (1 << reg)) { r[reg] = cpu.read32(addr); addr = (addr + 4) | 0; }
    }
    let target = 0;
    if (pc) { target = cpu.read32(addr); addr = (addr + 4) | 0; }
    r[13] = addr;
    cpu.cycles += 1;
    if (pc) cpu.branch(target); // ARMv4: POP {pc} does not change instruction set
  };

  // Format 15: multiple load/store
  const stmia: Handler = (op) => {
    const rb = (op >>> 8) & 7;
    const rlist = op & 0xff;
    let addr = r[rb];
    if (rlist === 0) { // empty list quirk
      cpu.write32(addr, r[15] + 2);
      r[rb] = (addr + 0x40) | 0;
      return;
    }
    let count = 0;
    for (let k = rlist; k !== 0; k &= k - 1) count++;
    const newBase = (addr + count * 4) | 0;
    let first = true;
    for (let reg = 0; reg < 8; reg++) {
      if (rlist & (1 << reg)) {
        cpu.write32(addr, r[reg]);
        addr = (addr + 4) | 0;
        if (first) { r[rb] = newBase; first = false; }
      }
    }
  };
  const ldmia: Handler = (op) => {
    const rb = (op >>> 8) & 7;
    const rlist = op & 0xff;
    let addr = r[rb];
    if (rlist === 0) {
      const v = cpu.read32(addr);
      r[rb] = (addr + 0x40) | 0;
      cpu.branch(v);
      return;
    }
    for (let reg = 0; reg < 8; reg++) {
      if (rlist & (1 << reg)) { r[reg] = cpu.read32(addr); addr = (addr + 4) | 0; }
    }
    if (!(rlist & (1 << rb))) r[rb] = addr;
    cpu.cycles += 1;
  };

  // Format 16: conditional branch
  const bcond: Handler = (op) => {
    if (cpu.checkCond((op >>> 8) & 15)) cpu.branch(r[15] + (((op & 0xff) << 24) >> 23));
  };

  // Format 17: software interrupt
  const swi: Handler = (op) => {
    cpu.cycles += 3;
    cpu.swiHandler(op & 0xff);
  };

  // Format 18: unconditional branch
  const b: Handler = (op) => { cpu.branch(r[15] + (((op & 0x7ff) << 21) >> 20)); };

  // Format 19: long branch with link (two halves)
  const blHigh: Handler = (op) => { r[14] = (r[15] + (((op & 0x7ff) << 21) >> 9)) | 0; };
  const blLow: Handler = (op) => {
    const next = (r[15] - 2) | 1;
    const target = (r[14] + ((op & 0x7ff) << 1)) | 0;
    r[14] = next;
    cpu.branch(target);
  };

  for (let i = 0; i < 1024; i++) {
    const op = i << 6;
    let h: Handler = undefinedOp;
    if ((op & 0xe000) === 0x0000) {
      if ((op & 0x1800) === 0x1800) {
        // format 2
        const sub = (op & 0x200) !== 0;
        const imm = (op & 0x400) !== 0;
        h = imm ? (sub ? subImm3 : addImm3) : (sub ? subReg : addReg);
      } else {
        h = [lslImm, lsrImm, asrImm][(op >>> 11) & 3];
      }
    } else if ((op & 0xe000) === 0x2000) {
      h = [movImm, cmpImm, addImm8, subImm8][(op >>> 11) & 3];
    } else if ((op & 0xfc00) === 0x4000) {
      h = alu;
    } else if ((op & 0xfc00) === 0x4400) {
      h = [hiAdd, hiCmp, hiMov, bx][(op >>> 8) & 3];
    } else if ((op & 0xf800) === 0x4800) {
      h = ldrPc;
    } else if ((op & 0xf200) === 0x5000) {
      h = [strReg, strbReg, ldrReg, ldrbReg][(op >>> 10) & 3];
    } else if ((op & 0xf200) === 0x5200) {
      h = [strhReg, ldsbReg, ldrhReg, ldshReg][(op >>> 10) & 3];
    } else if ((op & 0xe000) === 0x6000) {
      h = [strImm, ldrImm, strbImm, ldrbImm][(op >>> 11) & 3];
    } else if ((op & 0xf000) === 0x8000) {
      h = op & 0x800 ? ldrhImm : strhImm;
    } else if ((op & 0xf000) === 0x9000) {
      h = op & 0x800 ? ldrSp : strSp;
    } else if ((op & 0xf000) === 0xa000) {
      h = op & 0x800 ? addSp : addPc;
    } else if ((op & 0xff00) === 0xb000) {
      h = addSpImm;
    } else if ((op & 0xf600) === 0xb400) {
      h = op & 0x800 ? pop : push;
    } else if ((op & 0xf000) === 0xc000) {
      h = op & 0x800 ? ldmia : stmia;
    } else if ((op & 0xff00) === 0xdf00) {
      h = swi;
    } else if ((op & 0xf000) === 0xd000) {
      h = (op & 0x0f00) === 0x0e00 ? undefinedOp : bcond;
    } else if ((op & 0xf800) === 0xe000) {
      h = b;
    } else if ((op & 0xf000) === 0xf000) {
      h = op & 0x800 ? blLow : blHigh;
    }
    table[i] = h;
  }
  return table;
}
