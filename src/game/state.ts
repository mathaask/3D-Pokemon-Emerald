// Per-frame snapshot of Emerald's live state, read from emulated RAM.
// Struct layouts follow pokeemerald (BPEE rev 0); addresses come from SYM.

import type { Bus } from '../gba/bus';
import { Mem } from './mem';
import { SYM } from './symbols';
import { OBJ_SIZES, SUBSPRITE_TABLE_SIZE, applyComposition, readSubsprites, type PlacedPiece, type SubspritePiece } from './subsprites';

export { OBJ_SIZES };

export type Scene = 'overworld' | 'battle' | 'screen2d' | 'transition' | 'battleTransition';

export const MAP_OFFSET = 7;

export interface ObjectEventSnap {
  index: number;
  spriteId: number;
  graphicsId: number;
  localId: number;
  mapGroup: number;
  mapNum: number;
  /** Cell coordinates in backup-map space (MAP_OFFSET included). */
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  elevation: number;
  prevElevation: number;
  facing: number;
  invisible: boolean;
  isPlayer: boolean;
  offScreen: boolean;
}

export interface SpriteSnap {
  index: number;
  /** Raw OAM attributes copied from gSprites[i].oam. */
  attr0: number;
  attr1: number;
  attr2: number;
  width: number;
  height: number;
  tileNum: number;
  palette: number;
  priority: number;
  hflip: boolean;
  vflip: boolean;
  affine: boolean;
  doubleSize: boolean;
  bpp8: boolean;
  objMode: number;
  x: number;
  y: number;
  x2: number;
  y2: number;
  c2cX: number;
  c2cY: number;
  subpriority: number;
  coordOffset: boolean;
  invisible: boolean;
  callback: number;
  template: number;
  /** Screen-space top-left as the GBA would draw it. */
  screenX: number;
  screenY: number;
  /** For world sprites: centre-x and bottom-y in backup-map pixel space. */
  worldX: number;
  worldY: number;
  data: Int16Array;
  /** Affine scale (1 = unscaled) and rotation (radians) derived from the OAM matrix. */
  scaleX: number;
  scaleY: number;
  rotation: number;
  /** Current anim of the sprite's anim table (a berry tree's growth stage, an obstacle breaking). */
  animNum: number;
  /** ROM pointer of the sprite's SpriteFrameImage table: identifies a berry type / object graphics. */
  images: number;
  /** ROM pointer of the sprite's SubspriteTable array (0: none), the table in use and the mode
   *  (0 off, 1 on, 2 on ignoring priority): pieces drawn as several OAM entries (the truck). */
  subspriteTables: number;
  subspriteTableNum: number;
  subspriteMode: number;
  /** A world sprite whose subsprite table builds an image other than its base OAM's (the 48×48 truck on a 32×32
   *  OAM), composed (subsprites.ts applyComposition): its pieces, offsets inside the composed image; width/height,
   *  c2cX/c2cY, screen and world position are then the composed image's. null: the sprite's own OAM image. */
  pieces: readonly PlacedPiece[] | null;
}

export interface MapHeaderSnap {
  layout: number;
  events: number;
  scripts: number;
  connections: number;
  music: number;
  layoutId: number;
  regionMapSection: number;
  cave: number;
  weather: number;
  mapType: number;
  flags: number;
  battleType: number;
}

export interface LayoutSnap {
  width: number;
  height: number;
  border: number;
  map: number;
  primaryTileset: number;
  secondaryTileset: number;
}

export interface BattlerSnap {
  species: number;
  hp: number;
  maxHP: number;
  level: number;
  status1: number;
  position: number;
  spriteId: number;
}

const SPRITE_SIZE = 0x44;
const OBJECT_EVENT_SIZE = 0x24;

const OVERWORLD_CB2 = new Set<number>([SYM.CB2_Overworld]);
const TRANSITION_CB2 = new Set<number>([
  SYM.CB2_LoadMap, SYM.CB2_DoChangeMap, SYM.CB2_ReturnToField, SYM.CB2_ReturnToFieldContinueScript,
  SYM.CB2_ReturnToFieldContinueScriptPlayMapMusic, SYM.CB2_ReturnToFieldFadeFromBlack, SYM.CB2_ReturnToFieldLocal,
  SYM.CB2_ReturnToFieldLink, SYM.CB2_ReturnToFieldWithOpenMenu, SYM.CB2_WhiteOut, SYM.CB2_ContinueSavedGame,
]);

export class GameState {
  readonly mem: Mem;
  scene: Scene = 'screen2d';
  callback1 = 0;
  callback2 = 0;
  inBattle = false;
  frame = 0;

  mapGroup = -1;
  mapNum = -1;
  header: MapHeaderSnap | null = null;
  layout: LayoutSnap | null = null;
  backupWidth = 0;
  backupHeight = 0;
  backupMapPtr = 0;

  posX = 0;
  posY = 0;
  /** Camera centre in backup-map pixel space (where the GBA screen centre is). */
  cameraX = 0;
  cameraY = 0;
  /** Converts sprite.x -> map pixel: mapPx = sprite.x + spriteToMapX. */
  spriteToMapX = 0;
  spriteToMapY = 0;
  spriteCoordOffsetX = 0;
  spriteCoordOffsetY = 0;

  objects: ObjectEventSnap[] = [];
  player: ObjectEventSnap | null = null;
  playerFlags = 0;
  sprites: SpriteSnap[] = [];

  weather = 0;
  /** Dark-cave level (0 = lit; higher = smaller light radius). */
  flashLevel = 0;
  fadeActive = false;
  fadeY = 0;
  fadeColor = 0;

  hours = 12;
  minutes = 0;

  battleType = 0;
  battlersCount = 0;
  battleEnvironment = 0;
  battlers: BattlerSnap[] = [];
  attacker = 0;
  target = 0;
  animActive = false;

  /** Subsprite tables read so far, by table address (ROM tables only: they never change). */
  private subspriteCache = new Map<number, SubspritePiece[] | null>();

  constructor(bus: Bus) {
    this.mem = new Mem(bus);
  }

  update(): void {
    const m = this.mem;
    this.frame++;
    this.callback1 = m.u32(SYM.gMain);
    this.callback2 = m.u32(SYM.gMain + 4);
    this.inBattle = (m.u8(SYM.gMain + 0x439) & 2) !== 0;

    // Stored THUMB function pointers have bit 0 set; symbol addresses are even.
    const cb2 = (this.callback2 & ~1) >>> 0;
    if (cb2 === SYM.BattleMainCB2 || (this.inBattle && cb2 !== SYM.CB2_Overworld)) {
      this.scene = 'battle';
    } else if (OVERWORLD_CB2.has(cb2)) {
      this.scene = 'overworld';
    } else if (cb2 === SYM.CB2_OverworldBasic) {
      // Only used while a battle transition plays over the field (battle_transition.c).
      this.scene = 'battleTransition';
    } else if (TRANSITION_CB2.has(cb2)) {
      this.scene = 'transition';
    } else {
      this.scene = 'screen2d';
    }

    this.readFade();
    this.readSprites();
    if (this.scene === 'overworld' || this.scene === 'transition' || this.scene === 'battleTransition') this.readOverworld();
    if (this.scene === 'battle') this.readBattle();
  }

  private readFade(): void {
    const m = this.mem;
    const a = SYM.gPaletteFade;
    const w = m.u32(a + 4); // delayCounter:6, y:5, targetY:5, blendColor:15, active:1
    this.fadeY = (w >>> 6) & 0x1f;
    this.fadeColor = (w >>> 16) & 0x7fff;
    this.fadeActive = (w >>> 31) !== 0;
  }

  private readOverworld(): void {
    const m = this.mem;
    const sb1 = m.u32(SYM.gSaveBlock1Ptr);
    if (!m.isPtr(sb1)) return;
    this.posX = m.s16(sb1);
    this.posY = m.s16(sb1 + 2);
    this.mapGroup = m.s8(sb1 + 4);
    this.mapNum = m.s8(sb1 + 5);

    const h = SYM.gMapHeader;
    this.header = {
      layout: m.u32(h), events: m.u32(h + 4), scripts: m.u32(h + 8), connections: m.u32(h + 12),
      music: m.u16(h + 0x10), layoutId: m.u16(h + 0x12), regionMapSection: m.u8(h + 0x14), cave: m.u8(h + 0x15),
      weather: m.u8(h + 0x16), mapType: m.u8(h + 0x17), flags: m.u8(h + 0x1a), battleType: m.u8(h + 0x1b),
    };
    const l = this.header.layout;
    this.layout = m.isPtr(l)
      ? { width: m.s32(l), height: m.s32(l + 4), border: m.u32(l + 8), map: m.u32(l + 12), primaryTileset: m.u32(l + 16), secondaryTileset: m.u32(l + 20) }
      : null;
    this.backupWidth = m.s32(SYM.gBackupMapLayout);
    this.backupHeight = m.s32(SYM.gBackupMapLayout + 4);
    this.backupMapPtr = m.u32(SYM.gBackupMapLayout + 8);

    // Camera: see SetSpritePosToMapCoords() in event_object_movement.c.
    const totalX = m.s16(SYM.gTotalCameraPixelOffsetX);
    const totalY = m.s16(SYM.gTotalCameraPixelOffsetY);
    const fcX = m.s32(SYM.gFieldCamera + 0x10);
    const fcY = m.s32(SYM.gFieldCamera + 0x14);
    let dx = -totalX - fcX;
    let dy = -totalY - fcY;
    if (fcX > 0) dx += 16;
    if (fcX < 0) dx -= 16;
    if (fcY > 0) dy += 16;
    if (fcY < 0) dy -= 16;
    // sprite.x = ((mapX - pos.x) << 4) + dx + 8  =>  mapPx = sprite.x - dx + pos.x * 16
    this.spriteToMapX = -((dx << 16) >> 16) + this.posX * 16;
    this.spriteToMapY = -((dy << 16) >> 16) + this.posY * 16;
    this.spriteCoordOffsetX = m.s16(SYM.gSpriteCoordOffsetX);
    this.spriteCoordOffsetY = m.s16(SYM.gSpriteCoordOffsetY);
    // The GBA screen centre (120, 80) in map pixels.
    this.cameraX = 120 - this.spriteCoordOffsetX + this.spriteToMapX;
    this.cameraY = 80 - this.spriteCoordOffsetY + this.spriteToMapY;

    for (const s of this.sprites) {
      if (!s.coordOffset) continue;
      s.worldX = s.x + s.x2 + this.spriteToMapX;
      s.worldY = s.y + s.c2cY + s.height + this.spriteToMapY;
      // a multi-piece image (the truck): its composed size, placement and pieces
      if (s.subspriteMode !== 0 && s.subspriteTables !== 0) {
        const pieces = this.subsprites(s.subspriteTables, s.subspriteTableNum);
        if (pieces) applyComposition(s, pieces);
      }
    }

    this.objects.length = 0;
    this.player = null;
    for (let i = 0; i < 16; i++) {
      const a = SYM.gObjectEvents + i * OBJECT_EVENT_SIZE;
      const flags = m.u32(a);
      if (!(flags & 1)) continue;
      const o: ObjectEventSnap = {
        index: i,
        spriteId: m.u8(a + 4),
        graphicsId: m.u8(a + 5),
        localId: m.u8(a + 8),
        mapNum: m.u8(a + 9),
        mapGroup: m.u8(a + 10),
        elevation: m.u8(a + 11) & 0xf,
        prevElevation: m.u8(a + 11) >>> 4,
        x: m.s16(a + 0x10),
        y: m.s16(a + 0x12),
        prevX: m.s16(a + 0x14),
        prevY: m.s16(a + 0x16),
        facing: m.u8(a + 0x18) & 0xf,
        invisible: (flags & (1 << 13)) !== 0,
        offScreen: (flags & (1 << 14)) !== 0,
        isPlayer: (flags & (1 << 16)) !== 0,
      };
      this.objects.push(o);
      if (o.isPlayer) this.player = o;
    }
    this.playerFlags = m.u8(SYM.gPlayerAvatar);
    this.weather = m.u8(SYM.gWeather + 0x6d0);
    this.flashLevel = m.u8(sb1 + 0x30);
    this.hours = m.s8(SYM.gLocalTime + 2);
    this.minutes = m.s8(SYM.gLocalTime + 3);
  }

  private readSprites(): void {
    const m = this.mem;
    this.sprites.length = 0;
    for (let i = 0; i < 64; i++) {
      const a = SYM.gSprites + i * SPRITE_SIZE;
      const flags = m.u16(a + 0x3e);
      if (!(flags & 1)) continue;
      const attr0 = m.u16(a);
      const attr1 = m.u16(a + 2);
      const attr2 = m.u16(a + 4);
      const affineMode = (attr0 >>> 8) & 3;
      const shape = (attr0 >>> 14) & 3;
      const size = (attr1 >>> 14) & 3;
      const [width, height] = OBJ_SIZES[shape][size];
      const x = m.s16(a + 0x20);
      const y = m.s16(a + 0x22);
      const x2 = m.s16(a + 0x24);
      const y2 = m.s16(a + 0x26);
      const c2cX = m.s8(a + 0x28);
      const c2cY = m.s8(a + 0x29);
      const coordOffset = (flags & 2) !== 0;
      let scaleX = 1, scaleY = 1, rotation = 0;
      if (affineMode & 1) {
        const mtx = SYM.gOamMatrices + ((attr1 >>> 9) & 31) * 8;
        const pa = m.s16(mtx), pb = m.s16(mtx + 2), pc = m.s16(mtx + 4), pd = m.s16(mtx + 6);
        // The matrix maps screen -> texture; invert its scale for the visible size.
        const ha = Math.hypot(pa, pc), hb = Math.hypot(pb, pd);
        scaleX = ha > 0 ? 256 / ha : 1;
        scaleY = hb > 0 ? 256 / hb : 1;
        rotation = Math.atan2(pc, pa);
      }
      const data = new Int16Array(8);
      for (let k = 0; k < 8; k++) data[k] = m.s16(a + 0x2e + k * 2);
      const subsprites = m.u8(a + 0x42); // subspriteTableNum:6 | subspriteMode:2
      this.sprites.push({
        index: i, attr0, attr1, attr2, width, height,
        tileNum: attr2 & 0x3ff,
        palette: (attr2 >>> 12) & 0xf,
        priority: (attr2 >>> 10) & 3,
        hflip: affineMode === 0 && (attr1 & 0x1000) !== 0,
        vflip: affineMode === 0 && (attr1 & 0x2000) !== 0,
        affine: (affineMode & 1) !== 0,
        doubleSize: affineMode === 3,
        bpp8: (attr0 & 0x2000) !== 0,
        objMode: (attr0 >>> 10) & 3,
        x, y, x2, y2, c2cX, c2cY,
        subpriority: m.u8(a + 0x43),
        coordOffset,
        invisible: (flags & 4) !== 0,
        callback: m.u32(a + 0x1c),
        template: m.u32(a + 0x14),
        screenX: x + x2 + c2cX + (coordOffset ? m.s16(SYM.gSpriteCoordOffsetX) : 0),
        screenY: y + y2 + c2cY + (coordOffset ? m.s16(SYM.gSpriteCoordOffsetY) : 0),
        worldX: 0,
        worldY: 0,
        data,
        scaleX, scaleY, rotation,
        animNum: m.u8(a + 0x2a),
        images: m.u32(a + 0x0c),
        subspriteTables: m.u32(a + 0x18),
        subspriteTableNum: subsprites & 0x3f,
        subspriteMode: subsprites >>> 6,
        pieces: null,
      });
    }
  }

  /** The pieces of table `tableNum` of a SubspriteTable array (null: none), cached per table address. */
  private subsprites(tables: number, tableNum: number): SubspritePiece[] | null {
    const address = tables + SUBSPRITE_TABLE_SIZE * tableNum;
    let pieces = this.subspriteCache.get(address);
    if (pieces === undefined) {
      pieces = readSubsprites(this.mem, tables, tableNum);
      const region = tables >>> 24;
      if (region === 8 || region === 9) this.subspriteCache.set(address, pieces);
    }
    return pieces;
  }

  private readBattle(): void {
    const m = this.mem;
    this.battleType = m.u32(SYM.gBattleTypeFlags);
    this.battlersCount = m.u8(SYM.gBattlersCount);
    this.battleEnvironment = m.u8(SYM.gBattleEnvironment);
    this.attacker = m.u8(SYM.gBattlerAttacker);
    this.target = m.u8(SYM.gBattlerTarget);
    this.animActive = m.u8(SYM.gAnimScriptActive) !== 0;
    this.battlers.length = 0;
    for (let b = 0; b < Math.min(4, this.battlersCount); b++) {
      const a = SYM.gBattleMons + b * 0x58;
      this.battlers.push({
        species: m.u16(a),
        hp: m.u16(a + 0x28),
        maxHP: m.u16(a + 0x2c),
        level: m.u8(a + 0x2a),
        status1: m.u32(a + 0x4c),
        position: m.u8(SYM.gBattlerPositions + b),
        spriteId: m.u8(SYM.gBattlerSpriteIds + b),
      });
    }
  }

  /** Reads the live metatile grid (gBackupMapLayout), including script edits. */
  readBackupGrid(): Uint16Array {
    const w = this.backupWidth;
    const h = this.backupHeight;
    const out = new Uint16Array(Math.max(0, w * h));
    const bytes = this.mem.bytes(this.backupMapPtr, w * h * 2);
    out.set(new Uint16Array(bytes.buffer, 0, w * h));
    return out;
  }
}
