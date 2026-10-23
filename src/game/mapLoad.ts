// Is the game in the middle of loading a map? The renderer reads the emulated state at the end of each video frame,
// but the game's own frame (its VBlank-paced main loop) runs on past that point, so a map connection's crossing —
// CameraMove: LoadMapFromCameraTransition (the new map's location and header, ..., InitMap: its backup grid, tileset,
// palettes), then MoveMapViewToBackup — can straddle a frame end. The renderer then reads the new map's header over the
// old map's grid (Route 101 → Littleroot, 30 frames in: the world was built twice, from half-loaded data first).
// The game never halts at its idle wait (WaitForVBlank spins on a flag), so the CPU's halt state cannot tell; the
// code it is executing can.

import type { Mem } from './mem';
import { currentScene } from './state';
import { SYM, SYM_SIZE } from './symbols';

/** Tops of pokeemerald's stacks in IWRAM (crt0.s: sp_sys = IWRAM_END - 0x1c0, sp_irq = IWRAM_END - 0x60): user/system
 *  (the main code, and interrupt handlers once IntrMain moves to system mode) and IRQ (the interrupted code's return
 *  address while a handler runs). Above the user stack's top lies the IRQ stack's dead part: never scanned with it. */
export const USER_STACK_TOP = 0x03007e40;
export const IRQ_STACK_TOP = 0x03007fa0;
/** Deepest live stack scanned (bytes): pokeemerald's stays far shallower; a corrupt stack pointer costs no more. */
const MAX_STACK_SCAN = 0x1000;

const MODE_USR = 0x10, MODE_IRQ = 0x12, MODE_SYS = 0x1f;
/** Register banks (gba/cpu.ts bankOf): user/system, IRQ. */
const BANK_USER = 0, BANK_IRQ = 2;

/** What insideFunction reads of the CPU (gba/cpu.ts Cpu): the current mode's registers, the banked SP / LR copies of
 *  the other modes, the executing instruction's address. */
export interface CpuRegs {
  readonly r: Int32Array;
  readonly mode: number;
  readonly bankR13: Int32Array;
  readonly bankR14: Int32Array;
  currentPC(): number;
}

/**
 * Whether the CPU is executing `fn` (its code at [addr, addr + size)) or something it called: the PC is in it, or a
 * return address into it is live — the link register (a leaf callee; the interrupted code's while an IRQ handler runs),
 * a word on the live user/system stack (from its stack pointer up to the top), or on the live IRQ stack (an interrupt
 * in progress whose handler moved to system mode; an empty IRQ stack leaves the stale banked IRQ link register unread).
 */
export function insideFunction(fn: { addr: number; size: number }, cpu: CpuRegs, read32: (a: number) => number): boolean {
  const end = fn.addr + fn.size;
  // (a return address points past its call, an IRQ's 4 past the interrupted instruction — end + 2 for the function's
  // last Thumb halfword: never at the first byte)
  const returnsInto = (v: number) => {
    const a = (v & ~1) >>> 0;
    return a > fn.addr && a <= end + 2;
  };
  const pc = cpu.currentPC() >>> 0;
  if (pc >= fn.addr && pc < end) return true;
  const user = cpu.mode === MODE_USR || cpu.mode === MODE_SYS;
  if (returnsInto(cpu.r[14]) || (!user && returnsInto(cpu.bankR14[BANK_USER]))) return true;
  const scan = (sp: number, top: number) => {
    if (sp >= top || sp < top - MAX_STACK_SCAN) return false;
    for (let a = sp & ~3; a < top; a += 4) if (returnsInto(read32(a))) return true;
    return false;
  };
  const userSp = (user ? cpu.r[13] : cpu.bankR13[BANK_USER]) >>> 0;
  const irqSp = (cpu.mode === MODE_IRQ ? cpu.r[13] : cpu.bankR13[BANK_IRQ]) >>> 0;
  return scan(userSp, USER_STACK_TOP) || scan(irqSp, IRQ_STACK_TOP);
}

/** A map connection is being crossed: the game is inside CameraMove (loading the next map), its data half written. */
export function crossingInProgress(cpu: CpuRegs, mem: Mem): boolean {
  return insideFunction({ addr: SYM.CameraMove, size: SYM_SIZE.CameraMove }, cpu, (a) => mem.u32(a));
}

/** A map load in progress: a connection's crossing (inside CameraMove, within a frame or two) or a warp (its loading
 *  frames, black). */
export type MapLoad = 'crossing' | 'warp';

/** Which map load the game is in, if any: a warp's load (a map-loading main callback, GameState's 'transition' scene: the
 *  new map's header and tilesets arrive frames before its grid, the screen faded out), or crossing a connection
 *  (crossingInProgress). */
export function mapLoadInProgress(cpu: CpuRegs, mem: Mem): MapLoad | null {
  if (currentScene(mem) === 'transition') return 'warp';
  return crossingInProgress(cpu, mem) ? 'crossing' : null;
}
