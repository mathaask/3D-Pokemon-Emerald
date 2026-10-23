import { describe, it, expect } from 'vitest';
import { insideFunction, IRQ_STACK_TOP, mapLoadInProgress, USER_STACK_TOP, type CpuRegs } from '../src/game/mapLoad';
import type { Mem } from '../src/game/mem';
import { SYM } from '../src/game/symbols';

const FN = { addr: 0x0808887c, size: 0xd4 };
const INSIDE = FN.addr + 0x40;
const OUTSIDE = 0x08085000;
const SYS = 0x1f, IRQ = 0x12;

/** A CPU in `mode` at `pc` with `r14` (the current mode's), the user/system and IRQ banks' SP/LR, and IWRAM words. */
function machine(o: { pc?: number; mode?: number; lr?: number; userSp?: number; userLr?: number; irqSp?: number; irqLr?: number;
  words?: Record<number, number> }): { cpu: CpuRegs; read32: (a: number) => number } {
  const mode = o.mode ?? SYS;
  const r = new Int32Array(16);
  const bankR13 = new Int32Array(6), bankR14 = new Int32Array(6);
  bankR13[0] = o.userSp ?? USER_STACK_TOP; bankR14[0] = o.userLr ?? OUTSIDE;
  bankR13[2] = o.irqSp ?? IRQ_STACK_TOP; bankR14[2] = o.irqLr ?? OUTSIDE;
  // (the current mode's registers live in r: the banked copies are stale, as in the emulator)
  if (mode === SYS) { r[13] = bankR13[0]; r[14] = o.lr ?? bankR14[0]; bankR13[0] = 0; bankR14[0] = 0; }
  else { r[13] = bankR13[2]; r[14] = o.lr ?? bankR14[2]; bankR13[2] = 0; bankR14[2] = 0; }
  const words = o.words ?? {};
  return { cpu: { r, mode, bankR13, bankR14, currentPC: () => o.pc ?? OUTSIDE }, read32: (a) => words[a] ?? 0 };
}

const inside = (m: ReturnType<typeof machine>) => insideFunction(FN, m.cpu, m.read32);

describe('insideFunction (is the game executing a function: map load in progress)', () => {
  it('nothing points into the function: false', () => {
    expect(inside(machine({}))).toBe(false);
  });

  it('the PC is in it (its last byte included, the next one not)', () => {
    expect(inside(machine({ pc: INSIDE }))).toBe(true);
    expect(inside(machine({ pc: FN.addr + FN.size - 2 }))).toBe(true);
    expect(inside(machine({ pc: FN.addr + FN.size }))).toBe(false);
  });

  it('a leaf callee: the link register returns into it (Thumb bit set)', () => {
    expect(inside(machine({ lr: INSIDE | 1 }))).toBe(true);
  });

  it('a deeper callee: a return address on the live user stack', () => {
    const sp = USER_STACK_TOP - 0x40;
    expect(inside(machine({ userSp: sp, words: { [sp + 0x1c]: INSIDE | 1 } }))).toBe(true);
    // below the stack pointer the stack is dead: a stale return address there does not count
    expect(inside(machine({ userSp: sp, words: { [sp - 4]: INSIDE | 1 } }))).toBe(false);
    // the scan ends at the stack's top (crt0's sp_sys, IWRAM_END - 0x1c0): above it lies the IRQ stack's dead part
    expect(USER_STACK_TOP).toBe(0x03007e40);
    expect(inside(machine({ userSp: sp, words: { [USER_STACK_TOP]: INSIDE | 1 } }))).toBe(false);
    expect(inside(machine({ userSp: sp, words: { [USER_STACK_TOP + 0x40]: INSIDE + 4 } }))).toBe(false);
  });

  it('in an interrupt handler (IRQ mode): the interrupted code\'s banked registers and stack', () => {
    const sp = USER_STACK_TOP - 0x20;
    expect(inside(machine({ mode: IRQ, userLr: INSIDE | 1 }))).toBe(true);
    expect(inside(machine({ mode: IRQ, userSp: sp, words: { [sp + 8]: INSIDE | 1 } }))).toBe(true);
    // the IRQ's own return address: the interrupted PC (+4, ARM)
    expect(inside(machine({ mode: IRQ, lr: INSIDE + 4 }))).toBe(true);
    // an IRQ taken at its last Thumb halfword returns to end + 2; past that, not inside
    expect(inside(machine({ mode: IRQ, lr: FN.addr + FN.size + 2 }))).toBe(true);
    expect(inside(machine({ mode: IRQ, lr: FN.addr + FN.size + 4 }))).toBe(false);
  });

  it('a handler moved to system mode (pokeemerald IntrMain): the interrupted PC on the live IRQ stack', () => {
    const irqSp = IRQ_STACK_TOP - 0x14;
    expect(inside(machine({ irqSp, words: { [irqSp + 0x10]: INSIDE + 4 } }))).toBe(true);
    // no interrupt in progress (its stack empty): a stale banked IRQ return address does not count
    expect(inside(machine({ irqLr: INSIDE + 4 }))).toBe(false);
  });
});

describe('mapLoadInProgress (which map load the game is in)', () => {
  /** IWRAM / EWRAM as read by Mem: gMain.callback2 and the in-battle flag; the rest zero. */
  const mem = (callback2: number): Mem => ({
    u32: (a: number) => (a === SYM.gMain + 4 ? callback2 : 0),
    u8: () => 0,
  }) as unknown as Mem;
  const idle = machine({}).cpu;

  it("a warp's loading callback (the 'transition' scene): a warp", () => {
    expect(mapLoadInProgress(idle, mem(SYM.CB2_LoadMap | 1))).toBe('warp');
    expect(mapLoadInProgress(idle, mem(SYM.CB2_DoChangeMap | 1))).toBe('warp');
  });

  it('inside CameraMove in the overworld: a crossing', () => {
    const cpu = machine({ pc: SYM.CameraMove + 0x10 }).cpu;
    expect(mapLoadInProgress(cpu, mem(SYM.CB2_Overworld | 1))).toBe('crossing');
  });

  it('otherwise none', () => {
    expect(mapLoadInProgress(idle, mem(SYM.CB2_Overworld | 1))).toBe(null);
  });
});
