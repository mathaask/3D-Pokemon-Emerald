import { describe, expect, it } from 'vitest';
import { Bus } from '../src/gba/bus';
import { Cpu, MODE_IRQ, MODE_SYS } from '../src/gba/cpu';

const CODE = 0x03000000;

function makeCpu(code: number[], thumb = false) {
  const bus = new Bus(new Uint8Array(0x1000));
  bus.ioPort = { read16: () => 0, write16() {}, write8() {}, write32() {} };
  bus.backup = { read8: () => 0xff, write8() {} };
  const cpu = new Cpu(bus);
  cpu.reset();
  cpu.mode = MODE_SYS;
  cpu.i = 0;
  code.forEach((op, k) => {
    if (thumb) bus.write16(CODE + k * 2, op);
    else bus.write32(CODE + k * 4, op);
  });
  cpu.t = thumb ? 1 : 0;
  cpu.r[15] = CODE + (thumb ? 4 : 8);
  cpu.r[13] = 0x03007f00;
  const step = (n = 1) => { for (let k = 0; k < n; k++) cpu.run(cpu.cycles + 1); };
  return { bus, cpu, step };
}

// ---- ARM encoders
const AL = 0xe;
const dpImm = (op: number, s: number, rn: number, rd: number, imm8: number, rot = 0) =>
  ((AL << 28) | (1 << 25) | (op << 21) | (s << 20) | (rn << 16) | (rd << 12) | (rot << 8) | imm8) >>> 0;
const dpReg = (op: number, s: number, rn: number, rd: number, rm: number, shiftType = 0, amount = 0) =>
  ((AL << 28) | (op << 21) | (s << 20) | (rn << 16) | (rd << 12) | (amount << 7) | (shiftType << 5) | rm) >>> 0;
const dpRegShiftReg = (op: number, s: number, rn: number, rd: number, rm: number, shiftType: number, rs: number) =>
  ((AL << 28) | (op << 21) | (s << 20) | (rn << 16) | (rd << 12) | (rs << 8) | (shiftType << 5) | (1 << 4) | rm) >>> 0;
const OP = { AND: 0, EOR: 1, SUB: 2, RSB: 3, ADD: 4, ADC: 5, SBC: 6, RSC: 7, TST: 8, TEQ: 9, CMP: 10, CMN: 11, ORR: 12, MOV: 13, BIC: 14, MVN: 15 };
const ldrImm = (load: boolean, byte: boolean, rn: number, rd: number, off: number, opts: { p?: boolean; u?: boolean; w?: boolean } = {}) => {
  const p = opts.p ?? true, u = opts.u ?? true, w = opts.w ?? false;
  return ((AL << 28) | (1 << 26) | ((p ? 1 : 0) << 24) | ((u ? 1 : 0) << 23) | ((byte ? 1 : 0) << 22) |
    ((w ? 1 : 0) << 21) | ((load ? 1 : 0) << 20) | (rn << 16) | (rd << 12) | off) >>> 0;
};
const halfImm = (load: boolean, sh: number, rn: number, rd: number, off: number) =>
  ((AL << 28) | (1 << 24) | (1 << 23) | (1 << 22) | ((load ? 1 : 0) << 20) | (rn << 16) | (rd << 12) |
    ((off & 0xf0) << 4) | (1 << 7) | (sh << 5) | (1 << 4) | (off & 0xf)) >>> 0;
const block = (load: boolean, p: boolean, u: boolean, w: boolean, rn: number, rlist: number, s = false) =>
  ((AL << 28) | (4 << 25) | ((p ? 1 : 0) << 24) | ((u ? 1 : 0) << 23) | ((s ? 1 : 0) << 22) | ((w ? 1 : 0) << 21) |
    ((load ? 1 : 0) << 20) | (rn << 16) | rlist) >>> 0;

describe('ARM data processing', () => {
  it('ADD sets carry and overflow correctly', () => {
    const { cpu, step } = makeCpu([dpReg(OP.ADD, 1, 0, 2, 1)]);
    cpu.r[0] = 0x7fffffff; cpu.r[1] = 1;
    step();
    expect(cpu.r[2] >>> 0).toBe(0x80000000);
    expect([cpu.n, cpu.z, cpu.c, cpu.v]).toEqual([1, 0, 0, 1]);
  });

  it('ADDS unsigned carry', () => {
    const { cpu, step } = makeCpu([dpReg(OP.ADD, 1, 0, 2, 1)]);
    cpu.r[0] = -1; cpu.r[1] = 1;
    step();
    expect(cpu.r[2]).toBe(0);
    expect([cpu.n, cpu.z, cpu.c, cpu.v]).toEqual([0, 1, 1, 0]);
  });

  it('SUBS / CMP carry means no borrow', () => {
    const { cpu, step } = makeCpu([dpImm(OP.CMP, 1, 0, 0, 5), dpImm(OP.CMP, 1, 1, 0, 5)]);
    cpu.r[0] = 5; cpu.r[1] = 4;
    step();
    expect([cpu.z, cpu.c]).toEqual([1, 1]);
    step();
    expect([cpu.n, cpu.z, cpu.c]).toEqual([1, 0, 0]);
  });

  it('SBC and ADC use carry', () => {
    const { cpu, step } = makeCpu([dpReg(OP.ADC, 0, 0, 2, 1), dpReg(OP.SBC, 0, 0, 3, 1)]);
    cpu.r[0] = 10; cpu.r[1] = 3; cpu.c = 1;
    step();
    expect(cpu.r[2]).toBe(14);
    cpu.c = 0;
    step();
    expect(cpu.r[3]).toBe(6);
  });

  it('RSB and RSC', () => {
    const { cpu, step } = makeCpu([dpImm(OP.RSB, 1, 0, 1, 0)]);
    cpu.r[0] = 5;
    step();
    expect(cpu.r[1]).toBe(-5);
    expect(cpu.c).toBe(0);
  });

  it('immediate rotation and shifter carry for MOVS', () => {
    const { cpu, step } = makeCpu([dpImm(OP.MOV, 1, 0, 0, 0x01, 1)]); // 1 ROR 2 = 0x40000000
    step();
    expect(cpu.r[0] >>> 0).toBe(0x40000000);
    expect(cpu.c).toBe(0);
    const t2 = makeCpu([dpImm(OP.MOV, 1, 0, 0, 0x02, 1)]); // 2 ROR 2 = 0x80000000, carry = bit31
    t2.step();
    expect(t2.cpu.r[0] >>> 0).toBe(0x80000000);
    expect(t2.cpu.c).toBe(1);
  });

  it('LSR #0 means LSR #32, ASR #0 means ASR #32, ROR #0 means RRX', () => {
    const { cpu, step } = makeCpu([
      dpReg(OP.MOV, 1, 0, 1, 0, 1, 0),
      dpReg(OP.MOV, 1, 0, 2, 0, 2, 0),
      dpReg(OP.MOV, 1, 0, 3, 0, 3, 0),
    ]);
    cpu.r[0] = 0x80000001 | 0;
    step();
    expect(cpu.r[1]).toBe(0);
    expect(cpu.c).toBe(1);
    step();
    expect(cpu.r[2]).toBe(-1);
    expect(cpu.c).toBe(1);
    cpu.c = 0;
    step();
    expect(cpu.r[3] >>> 0).toBe(0x40000000);
    expect(cpu.c).toBe(1);
  });

  it('register shifts by 32 and more', () => {
    const { cpu, step } = makeCpu([
      dpRegShiftReg(OP.MOV, 1, 0, 1, 0, 0, 4), // LSL by r4
      dpRegShiftReg(OP.MOV, 1, 0, 2, 0, 1, 5), // LSR by r5
      dpRegShiftReg(OP.MOV, 1, 0, 3, 0, 3, 6), // ROR by r6
    ]);
    cpu.r[0] = 0x80000001 | 0; cpu.r[4] = 32; cpu.r[5] = 33; cpu.r[6] = 32;
    step();
    expect(cpu.r[1]).toBe(0);
    expect(cpu.c).toBe(1);
    step();
    expect(cpu.r[2]).toBe(0);
    expect(cpu.c).toBe(0);
    step();
    expect(cpu.r[3]).toBe(0x80000001 | 0);
    expect(cpu.c).toBe(1);
  });

  it('PC reads +8, and +12 for register-specified shifts', () => {
    const { cpu, step } = makeCpu([dpReg(OP.MOV, 0, 0, 0, 15), dpRegShiftReg(OP.MOV, 0, 0, 1, 15, 0, 2)]);
    cpu.r[2] = 0;
    step();
    expect(cpu.r[0]).toBe(CODE + 8);
    step();
    expect(cpu.r[1]).toBe(CODE + 4 + 12);
  });

  it('TST sets C from shifter, leaves V', () => {
    const { cpu, step } = makeCpu([dpReg(OP.TST, 1, 0, 0, 1, 1, 1)]);
    cpu.r[0] = -1; cpu.r[1] = 1; cpu.v = 1;
    step();
    expect([cpu.z, cpu.c, cpu.v]).toEqual([1, 1, 1]);
  });
});

describe('ARM loads/stores', () => {
  it('LDR unaligned rotates', () => {
    const { cpu, bus, step } = makeCpu([ldrImm(true, false, 0, 1, 1)]);
    bus.write32(0x02000000, 0x44332211);
    cpu.r[0] = 0x02000000;
    step();
    expect(cpu.r[1] >>> 0).toBe(0x11443322);
  });

  it('LDRH unaligned rotates, LDRSH unaligned loads signed byte, LDRSB', () => {
    const { cpu, bus, step } = makeCpu([halfImm(true, 1, 0, 1, 1), halfImm(true, 3, 0, 2, 1), halfImm(true, 2, 0, 3, 2)]);
    bus.write32(0x02000000, 0x44f382f1);
    cpu.r[0] = 0x02000000;
    step();
    expect(cpu.r[1] >>> 0).toBe(0xf1000082);
    step();
    expect(cpu.r[2]).toBe(-126); // byte 0x82 sign-extended
    step();
    expect(cpu.r[3]).toBe(-13); // 0xf3
  });

  it('pre-index with writeback and post-index', () => {
    const { cpu, bus, step } = makeCpu([
      ldrImm(false, false, 0, 1, 4, { p: true, w: true }),
      ldrImm(false, false, 0, 2, 8, { p: false }),
    ]);
    cpu.r[0] = 0x02000000; cpu.r[1] = 0x1111; cpu.r[2] = 0x2222;
    step();
    expect(bus.read32(0x02000004)).toBe(0x1111);
    expect(cpu.r[0]).toBe(0x02000004);
    step();
    expect(bus.read32(0x02000004)).toBe(0x2222);
    expect(cpu.r[0]).toBe(0x0200000c);
  });

  it('STRB and LDRB', () => {
    const { cpu, bus, step } = makeCpu([ldrImm(false, true, 0, 1, 3), ldrImm(true, true, 0, 2, 3)]);
    cpu.r[0] = 0x02000000; cpu.r[1] = 0x1ab;
    step(2);
    expect(bus.read8(0x02000003)).toBe(0xab);
    expect(cpu.r[2]).toBe(0xab);
  });

  it('STMDB/LDMIA (push/pop) order and writeback', () => {
    const { cpu, bus, step } = makeCpu([block(false, true, false, true, 13, 0x4006), block(true, false, true, true, 13, 0x0018)]);
    cpu.r[1] = 1; cpu.r[2] = 2; cpu.r[14] = 0xe;
    step();
    expect(cpu.r[13]).toBe(0x03007f00 - 12);
    expect(bus.read32(0x03007f00 - 12)).toBe(1);
    expect(bus.read32(0x03007f00 - 8)).toBe(2);
    expect(bus.read32(0x03007f00 - 4)).toBe(0xe);
    step();
    expect(cpu.r[3]).toBe(1);
    expect(cpu.r[4]).toBe(2);
    expect(cpu.r[13]).toBe(0x03007f00 - 4);
  });

  it('STM with base in list stores old base when first, new base otherwise', () => {
    const t1 = makeCpu([block(false, false, true, true, 0, 0x0003)]); // STMIA r0!, {r0, r1}
    t1.cpu.r[0] = 0x02000000;
    t1.step();
    expect(t1.bus.read32(0x02000000)).toBe(0x02000000);
    const t2 = makeCpu([block(false, false, true, true, 1, 0x0003)]); // STMIA r1!, {r0, r1}
    t2.cpu.r[1] = 0x02000000;
    t2.step();
    expect(t2.bus.read32(0x02000004)).toBe(0x02000008);
  });

  it('LDM with base in list: loaded value wins', () => {
    const { cpu, bus, step } = makeCpu([block(true, false, true, true, 0, 0x0003)]);
    bus.write32(0x02000000, 0xaaaa); bus.write32(0x02000004, 0xbbbb);
    cpu.r[0] = 0x02000000;
    step();
    expect(cpu.r[0]).toBe(0xaaaa);
    expect(cpu.r[1]).toBe(0xbbbb);
  });

  it('SWP', () => {
    const swp = ((AL << 28) | (0x10 << 20) | (0 << 16) | (1 << 12) | (9 << 4) | 2) >>> 0;
    const { cpu, bus, step } = makeCpu([swp]);
    bus.write32(0x02000000, 0x1234);
    cpu.r[0] = 0x02000000; cpu.r[2] = 0x5678;
    step();
    expect(cpu.r[1]).toBe(0x1234);
    expect(bus.read32(0x02000000)).toBe(0x5678);
  });
});

describe('ARM multiply, branches, PSR', () => {
  it('MUL / MLA', () => {
    const mla = ((AL << 28) | (1 << 21) | (1 << 20) | (3 << 16) | (2 << 12) | (1 << 8) | (9 << 4) | 0) >>> 0;
    const { cpu, step } = makeCpu([mla]);
    cpu.r[0] = 6; cpu.r[1] = -7; cpu.r[2] = 2;
    step();
    expect(cpu.r[3]).toBe(-40);
    expect(cpu.n).toBe(1);
  });

  it('UMULL / SMULL / SMLAL', () => {
    const long = (u: number, a: number, hi: number, lo: number, rs: number, rm: number) =>
      ((AL << 28) | (1 << 23) | (u << 22) | (a << 21) | (hi << 16) | (lo << 12) | (rs << 8) | (9 << 4) | rm) >>> 0;
    const { cpu, step } = makeCpu([long(0, 0, 3, 2, 1, 0), long(1, 0, 5, 4, 1, 0), long(1, 1, 5, 4, 1, 0)]);
    cpu.r[0] = -1; cpu.r[1] = -1;
    step();
    // 0xffffffff * 0xffffffff = 0xfffffffe00000001
    expect(cpu.r[2] >>> 0).toBe(1);
    expect(cpu.r[3] >>> 0).toBe(0xfffffffe);
    step();
    // -1 * -1 = 1
    expect(cpu.r[4]).toBe(1);
    expect(cpu.r[5]).toBe(0);
    step();
    expect(cpu.r[4]).toBe(2);
    expect(cpu.r[5]).toBe(0);
    // signed: 0x12345678 * -3
    const t = makeCpu([long(1, 0, 3, 2, 1, 0)]);
    t.cpu.r[0] = 0x12345678; t.cpu.r[1] = -3;
    t.step();
    const expected = BigInt(0x12345678) * BigInt(-3);
    const lo = Number(expected & 0xffffffffn);
    const hi = Number((expected >> 32n) & 0xffffffffn);
    expect(t.cpu.r[2] >>> 0).toBe(lo);
    expect(t.cpu.r[3] >>> 0).toBe(hi);
  });

  it('B, BL and BX to THUMB', () => {
    const b = (link: boolean, off: number) => ((AL << 28) | (5 << 25) | ((link ? 1 : 0) << 24) | ((off >> 2) & 0xffffff)) >>> 0;
    const bx = ((AL << 28) | 0x012fff10 | 0) >>> 0;
    const { cpu, step } = makeCpu([b(true, 8)]); // target = CODE + 8 + 8
    step();
    expect(cpu.r[14]).toBe(CODE + 4);
    expect(cpu.nextPC()).toBe(CODE + 16);
    const t = makeCpu([bx]);
    t.cpu.r[0] = 0x03000101;
    t.step();
    expect(t.cpu.t).toBe(1);
    expect(t.cpu.nextPC()).toBe(0x03000100);
  });

  it('conditional execution skips', () => {
    const movne = (dpImm(OP.MOV, 0, 0, 0, 7) & 0x0fffffff) | (0x1 << 28);
    const { cpu, step } = makeCpu([movne >>> 0]);
    cpu.z = 1;
    step();
    expect(cpu.r[0]).toBe(0);
  });

  it('MRS/MSR switch mode and bank registers', () => {
    const mrs = ((AL << 28) | 0x010f0000 | (0 << 12)) >>> 0; // MRS r0, CPSR
    const msr = ((AL << 28) | 0x0129f000 | 1) >>> 0; // MSR CPSR_fc, r1
    const { cpu, step } = makeCpu([mrs, msr]);
    cpu.r[13] = 0x1234;
    step();
    expect(cpu.r[0] & 0x1f).toBe(MODE_SYS);
    cpu.r[1] = (0x80 | MODE_IRQ | 0xf0000000) | 0;
    step();
    expect(cpu.mode).toBe(MODE_IRQ);
    expect([cpu.n, cpu.z, cpu.c, cpu.v, cpu.i]).toEqual([1, 1, 1, 1, 1]);
    expect(cpu.r[13]).not.toBe(0x1234);
    cpu.switchMode(MODE_SYS);
    expect(cpu.r[13]).toBe(0x1234);
  });

  it('SUBS PC, LR, #4 returns from IRQ and restores CPSR', () => {
    const subs = dpImm(OP.SUB, 1, 14, 15, 4);
    const { cpu, step, bus } = makeCpu([0]);
    bus.write32(0x03000100, subs);
    cpu.t = 1;
    cpu.r[15] = CODE + 0x20 + 4; // next thumb instruction at CODE+0x20
    cpu.irqLine = true;
    // take IRQ manually then execute handler instruction at 0x18? Use a direct check of takeIrq.
    cpu.takeIrq();
    expect(cpu.mode).toBe(MODE_IRQ);
    expect(cpu.r[14]).toBe(CODE + 0x20 + 4);
    expect(cpu.t).toBe(0);
    // jump to our handler
    cpu.r[15] = 0x03000100 + 8;
    cpu.irqLine = false;
    step();
    expect(cpu.mode).toBe(MODE_SYS);
    expect(cpu.t).toBe(1);
    expect(cpu.nextPC()).toBe(CODE + 0x20);
  });
});

describe('THUMB', () => {
  it('format 1-3: shifts, add/sub, immediates', () => {
    const { cpu, step } = makeCpu([
      0x2005, // MOV r0, #5
      0x0081, // LSL r1, r0, #2  -> 20
      0x1842, // ADD r2, r0, r1  -> 25
      0x1e53, // SUB r3, r2, #1  -> 24
      0x2b18, // CMP r3, #24
      0x0fc4, // LSR r4, r0, #31 -> 0
    ], true);
    step(5);
    expect([cpu.r[0], cpu.r[1], cpu.r[2], cpu.r[3]]).toEqual([5, 20, 25, 24]);
    expect([cpu.z, cpu.c]).toEqual([1, 1]);
    step();
    expect(cpu.r[4]).toBe(0);
  });

  it('format 4 ALU: NEG, MUL, BIC, MVN, ROR', () => {
    const { cpu, step } = makeCpu([
      0x4248, // NEG r0, r1
      0x4350, // MUL r0, r2
      0x4393, // BIC r3, r2
      0x43d4, // MVN r4, r2
      0x41cd, // ROR r5, r1
    ], true);
    cpu.r[1] = 3; cpu.r[2] = 7; cpu.r[3] = 0xff; cpu.r[5] = 0x10;
    step();
    expect(cpu.r[0]).toBe(-3);
    step();
    expect(cpu.r[0]).toBe(-21);
    step();
    expect(cpu.r[3]).toBe(0xf8);
    step();
    expect(cpu.r[4]).toBe(~7);
    step();
    expect(cpu.r[5] >>> 0).toBe(0x00000002);
  });

  it('format 5: hi register MOV/ADD/BX', () => {
    const { cpu, step } = makeCpu([0x4680, 0x4440, 0x4700], true); // MOV r8, r0; ADD r0, r8; BX r0
    cpu.r[0] = 0x03000200;
    step(2);
    expect(cpu.r[8]).toBe(0x03000200);
    expect(cpu.r[0]).toBe(0x06000400);
    cpu.r[0] = 0x03000200; // ARM target
    step();
    expect(cpu.t).toBe(0);
    expect(cpu.nextPC()).toBe(0x03000200);
  });

  it('format 6: PC-relative load uses word-aligned PC', () => {
    const { cpu, bus, step } = makeCpu([0x0000, 0x4801], true); // at CODE+2: LDR r0, [pc, #4]
    bus.write32(CODE + 8, 0xcafebabe | 0);
    step(2); // first op is LSL r0,r0,#0 (nop)
    // instr at CODE+2, PC = CODE+6 -> aligned CODE+4, +4 = CODE+8
    expect(cpu.r[0] >>> 0).toBe(0xcafebabe);
  });

  it('format 7-10 loads/stores', () => {
    const { cpu, bus, step } = makeCpu([
      0x5088, // STR r0, [r1, r2]
      0x5c8b, // LDRB r3, [r1, r2]
      0x5e8c, // LDSH r4, [r1, r2]
      0x8048, // STRH r0, [r1, #2]
      0x684d, // LDR r5, [r1, #4]
    ], true);
    cpu.r[0] = 0x8765abcd | 0; cpu.r[1] = 0x02000000; cpu.r[2] = 4;
    step();
    expect(bus.read32(0x02000004)).toBe(0x8765abcd | 0);
    step();
    expect(cpu.r[3]).toBe(0xcd);
    step();
    expect(cpu.r[4]).toBe(0xffffabcd | 0);
    step();
    expect(bus.read16(0x02000002)).toBe(0xabcd);
    step();
    expect(cpu.r[5]).toBe(0x8765abcd | 0);
  });

  it('format 14: PUSH/POP with LR/PC', () => {
    const { cpu, step } = makeCpu([0xb503, 0xbd0c], true); // PUSH {r0,r1,lr}; POP {r2,r3,pc}
    cpu.r[0] = 1; cpu.r[1] = 2; cpu.r[14] = 0x03000401;
    step();
    expect(cpu.r[13]).toBe(0x03007f00 - 12);
    step();
    expect([cpu.r[2], cpu.r[3]]).toEqual([1, 2]);
    expect(cpu.t).toBe(1);
    expect(cpu.nextPC()).toBe(0x03000400);
  });

  it('format 15: LDMIA/STMIA writeback', () => {
    const { cpu, bus, step } = makeCpu([0xc006, 0xc90c], true); // STMIA r0!, {r1,r2}; LDMIA r1!, {r2,r3}
    cpu.r[0] = 0x02000000; cpu.r[1] = 0x02000000; cpu.r[2] = 0x55;
    step();
    expect(cpu.r[0]).toBe(0x02000008);
    expect(bus.read32(0x02000000)).toBe(0x02000000);
    step();
    expect(cpu.r[1]).toBe(0x02000008);
    expect(cpu.r[2]).toBe(0x02000000);
    expect(cpu.r[3]).toBe(0x55);
  });

  it('format 16/18/19: branches and BL', () => {
    const { cpu, step } = makeCpu([0xd002], true); // BEQ +4 (target = pc+4+4)
    cpu.z = 1;
    step();
    expect(cpu.nextPC()).toBe(CODE + 8);
    const t = makeCpu([0xf000, 0xf802], true); // BL +4 from CODE (target = CODE+4+4)
    t.step(2);
    expect(t.cpu.nextPC()).toBe(CODE + 8);
    expect(t.cpu.r[14]).toBe(CODE + 5);
    const t2 = makeCpu([0xe7fe], true); // B . (infinite loop)
    t2.step();
    expect(t2.cpu.nextPC()).toBe(CODE);
  });

  it('format 12/13: ADD rd, sp/pc and ADD sp, #imm', () => {
    const { cpu, step } = makeCpu([0xa801, 0xb082, 0xa101], true); // ADD r0, sp, #4; SUB sp, #8; ADD r1, pc, #4
    step();
    expect(cpu.r[0]).toBe(0x03007f04);
    step();
    expect(cpu.r[13]).toBe(0x03007ef8);
    step();
    // instr at CODE+4, pc = CODE+8 (aligned), +4
    expect(cpu.r[1]).toBe(CODE + 12);
  });

  it('SWI calls handler with comment', () => {
    const { cpu, step } = makeCpu([0xdf05], true);
    let got = -1;
    cpu.swiHandler = (n) => { got = n; };
    step();
    expect(got).toBe(5);
  });
});
