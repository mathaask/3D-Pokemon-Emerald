// GBA hardware constants shared by every part of the core.

export const CPU_HZ = 16_777_216;
export const CYCLES_PER_LINE = 1232;
export const HDRAW_CYCLES = 1006;
export const LINES_PER_FRAME = 228;
export const VISIBLE_LINES = 160;
export const CYCLES_PER_FRAME = CYCLES_PER_LINE * LINES_PER_FRAME; // 280 896
export const SCREEN_W = 240;
export const SCREEN_H = 160;

// IO register byte offsets from 0x04000000.
export const REG = {
  DISPCNT: 0x000,
  GREENSWAP: 0x002,
  DISPSTAT: 0x004,
  VCOUNT: 0x006,
  BG0CNT: 0x008,
  BG1CNT: 0x00a,
  BG2CNT: 0x00c,
  BG3CNT: 0x00e,
  BG0HOFS: 0x010,
  BG0VOFS: 0x012,
  BG1HOFS: 0x014,
  BG1VOFS: 0x016,
  BG2HOFS: 0x018,
  BG2VOFS: 0x01a,
  BG3HOFS: 0x01c,
  BG3VOFS: 0x01e,
  BG2PA: 0x020,
  BG2PB: 0x022,
  BG2PC: 0x024,
  BG2PD: 0x026,
  BG2X: 0x028, // 32-bit (0x28 low, 0x2a high)
  BG2Y: 0x02c,
  BG3PA: 0x030,
  BG3PB: 0x032,
  BG3PC: 0x034,
  BG3PD: 0x036,
  BG3X: 0x038,
  BG3Y: 0x03c,
  WIN0H: 0x040,
  WIN1H: 0x042,
  WIN0V: 0x044,
  WIN1V: 0x046,
  WININ: 0x048,
  WINOUT: 0x04a,
  MOSAIC: 0x04c,
  BLDCNT: 0x050,
  BLDALPHA: 0x052,
  BLDY: 0x054,
  SOUND_START: 0x060,
  SOUND_END: 0x0a8, // exclusive
  FIFO_A: 0x0a0,
  FIFO_B: 0x0a4,
  DMA0SAD: 0x0b0,
  TM0CNT_L: 0x100,
  KEYINPUT: 0x130,
  KEYCNT: 0x132,
  IE: 0x200,
  IF: 0x202,
  WAITCNT: 0x204,
  IME: 0x208,
  POSTFLG: 0x300,
  HALTCNT: 0x301,
} as const;

// Interrupt bits (IE/IF).
export const IRQ = {
  VBLANK: 1 << 0,
  HBLANK: 1 << 1,
  VCOUNT: 1 << 2,
  TIMER0: 1 << 3,
  TIMER1: 1 << 4,
  TIMER2: 1 << 5,
  TIMER3: 1 << 6,
  SERIAL: 1 << 7,
  DMA0: 1 << 8,
  DMA1: 1 << 9,
  DMA2: 1 << 10,
  DMA3: 1 << 11,
  KEYPAD: 1 << 12,
  GAMEPAK: 1 << 13,
} as const;

// Key bits as used by KEYINPUT (where the hardware register is active-low).
export const KEY = {
  A: 1 << 0,
  B: 1 << 1,
  SELECT: 1 << 2,
  START: 1 << 3,
  RIGHT: 1 << 4,
  LEFT: 1 << 5,
  UP: 1 << 6,
  DOWN: 1 << 7,
  R: 1 << 8,
  L: 1 << 9,
} as const;
