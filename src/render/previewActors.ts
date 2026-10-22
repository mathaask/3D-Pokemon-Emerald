// Actors for the static map preview: each object-event template of a map becomes a sprite and an
// object event as live play would spawn them (TrySpawnObjectEventTemplate in pokeemerald's
// event_object_movement.c), drawn from tiles and palettes copied into scratch OBJ VRAM / palette RAM.
// They then go through the same sprite atlas and billboards as live play.

import type { RomReader } from '../game/rom/reader';
import type { ObjectEventTemplate } from '../game/rom/maps';
import { OBJ_SIZES, type ObjectEventSnap, type SpriteSnap } from '../game/state';
import { applyComposition, needsComposition, readSubsprites } from '../game/subsprites';
import {
  NUM_OBJ_EVENT_GFX, firstAnimFrame, readFrameImage, readOamShape, readObjectGraphicsInfo, readObjectPalette,
} from '../game/rom/objectGraphics';

export interface PreviewActors { sprites: SpriteSnap[]; objects: ObjectEventSnap[] }

const OBJ_VRAM = 0x10000;
const OBJ_VRAM_TILES = 1024;
const TILE_BYTES = 32;
const OBJ_PALETTE = 256;
const OBJ_PALETTE_SLOTS = 16;

const GFX_BERRY_TREE = 60; // 60-62: berry tree, early stages, late stages
const GFX_BERRY_TREE_LATE_STAGES = 62;
const GFX_CUTTABLE_TREE = 82;
const GFX_BREAKABLE_ROCK = 86;
const BERRY_STAGES = 5;
const ANIM_REMOVE_OBSTACLE = 1;
const DIR_SOUTH = 1; // (frame 0 of a character faces south)
const MOVEMENT_TYPE_INVISIBLE = 0x4c;
const SUBSPRITES_OFF = 0;
const SUBSPRITES_ON = 1;
const SUBSPRITES_IGNORE_PRIORITY = 2;
/** pokeemerald sElevationToPriority / sElevationToSubspriteTableNum. */
const ELEVATION_TO_PRIORITY = [2, 2, 2, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 0, 0, 2];
const ELEVATION_TO_SUBSPRITE_TABLE = [1, 1, 1, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 0, 0, 1];
/**
 * Graphics id of each berry tree stage (gBerryTreeObjectEventGraphicsIdTable): live play's
 * SetBerryTreeGraphics switches the object to it (ObjectEventSetGraphicsId: its OAM size,
 * centre-to-corner and subsprite tables), BERRY_TREE_EARLY_STAGES (16×16) for the dirt pile and the
 * sprout, BERRY_TREE_LATE_STAGES (16×32) for the plants.
 */
const BERRY_STAGE_GFX = [61, 61, 62, 62, 62];
/**
 * Palette tags of the berry tree stages. Tied to the images: berry graphics 60-62 carry the Pecha
 * tree's images (sPicTable_PechaBerryTree), which live play draws in OBJ palette slots {3, 4, 4, 4, 4}
 * (gBerryTreePaletteSlotTable_Pecha) = OBJ_EVENT_PAL_TAG_NPC_2, NPC_3 ×4, not the graphics info's own
 * tag (NPC_1: it would draw the plants blue). Other berries have other images and slot tables.
 */
const PECHA_STAGE_PALETTE_TAGS = [0x1104, 0x1105, 0x1105, 0x1105, 0x1105];

/** OAM shape and size codes of a width × height sprite (0, 0 if no OBJ has that size). */
function shapeOf(width: number, height: number): { shape: number; size: number } {
  for (let shape = 0; shape < 3; shape++) {
    const size = OBJ_SIZES[shape].findIndex(([w, h]) => w === width && h === height);
    if (size >= 0) return { shape, size };
  }
  return { shape: 0, size: 0 };
}

/**
 * A sprite snapshot with every field defaulted: a 16×32 world sprite (coordOffset) at the origin,
 * centre-to-corner −(w >> 1), −(h >> 1). Unless given, the corner offsets, the screen position and
 * the raw OAM attributes follow the given fields.
 */
export function blankSprite(p: Partial<SpriteSnap> = {}): SpriteSnap {
  const s: SpriteSnap = {
    index: 0, attr0: 0, attr1: 0, attr2: 0, width: 16, height: 32, tileNum: 0, palette: 0, priority: 2,
    hflip: false, vflip: false, affine: false, doubleSize: false, bpp8: false, objMode: 0,
    x: 0, y: 0, x2: 0, y2: 0, c2cX: 0, c2cY: 0, subpriority: 0, coordOffset: true, invisible: false,
    callback: 0, template: 0, screenX: 0, screenY: 0, worldX: 0, worldY: 0, data: new Int16Array(8),
    scaleX: 1, scaleY: 1, rotation: 0,
    animNum: 0, images: 0, subspriteTables: 0, subspriteTableNum: 0, subspriteMode: 0, pieces: null,
    ...p,
  };
  if (p.c2cX === undefined) s.c2cX = -(s.width >> 1);
  if (p.c2cY === undefined) s.c2cY = -(s.height >> 1);
  if (p.screenX === undefined) s.screenX = s.x + s.x2 + s.c2cX;
  if (p.screenY === undefined) s.screenY = s.y + s.y2 + s.c2cY;
  const { shape, size } = shapeOf(s.width, s.height);
  const affineMode = s.affine ? (s.doubleSize ? 3 : 1) : 0;
  if (p.attr0 === undefined) {
    s.attr0 = (s.screenY & 0xff) | (affineMode << 8) | ((s.objMode & 3) << 10) | (s.bpp8 ? 0x2000 : 0) | (shape << 14);
  }
  if (p.attr1 === undefined) {
    s.attr1 = (s.screenX & 0x1ff) | (s.hflip ? 0x1000 : 0) | (s.vflip ? 0x2000 : 0) | (size << 14);
  }
  if (p.attr2 === undefined) s.attr2 = (s.tileNum & 0x3ff) | ((s.priority & 3) << 10) | ((s.palette & 0xf) << 12);
  return s;
}

/**
 * Sprites and object events for a map's object-event templates (sprite i ↔ object i: index =
 * spriteId = i). VAR graphics ids (≥ 239) are skipped. The tiles of each distinct (graphics id,
 * frame image) are copied once into OBJ VRAM (`vram[0x10000 + tile * 32 …]`, tiles allocated in
 * order; an image that no longer fits leaves its objects out) and each distinct palette tag gets one
 * OBJ palette slot (`palette[256 + slot * 16 …]`; past 16 tags, slot 15 is reused). Frame 0 is shown,
 * except on berry trees (gfx 60-62): animNum = localId % 5, so a map shows every growth stage, each
 * as live play shows it (the stage's graphics id 61 / 62 and its first anim frame). `removing` puts
 * Cut trees and breakable rocks (gfx 82, 86) on their breaking anim (animNum 1). A multi-piece image
 * (the truck) is composed from its subsprite table as live play draws it (subsprites.ts). Positions are
 * map-local (the preview grid has no offset); the caller sets the objects' mapGroup / mapNum.
 * Whatever is left out or drawn with a stand-in palette is reported with console.warn.
 */
export function buildPreviewActors(rom: RomReader, vram: Uint8Array, palette: Uint16Array,
  templates: readonly ObjectEventTemplate[], opts: { removing: boolean }): PreviewActors {
  const sprites: SpriteSnap[] = [];
  const objects: ObjectEventSnap[] = [];
  const tiles = new Map<string, number>(); // "graphicsId:frame" -> first tile
  const slots = new Map<number, number>(); // palette tag -> OBJ palette slot
  let nextTile = 0;
  templates.forEach((t, n) => {
    if (t.graphicsId >= NUM_OBJ_EVENT_GFX) return;
    const what = `template ${n} (local id ${t.localId}, gfx ${t.graphicsId})`;
    // the graphics the object spawns with, and those it shows (a berry tree switches per stage)
    const spawnInfo = readObjectGraphicsInfo(rom, t.graphicsId);
    const berry = t.graphicsId >= GFX_BERRY_TREE && t.graphicsId <= GFX_BERRY_TREE_LATE_STAGES;
    let animNum = 0;
    if (berry) animNum = t.localId % BERRY_STAGES;
    else if (opts.removing && (t.graphicsId === GFX_CUTTABLE_TREE || t.graphicsId === GFX_BREAKABLE_ROCK)) animNum = ANIM_REMOVE_OBSTACLE;
    const graphicsId = berry ? BERRY_STAGE_GFX[animNum] : t.graphicsId;
    const info = berry ? readObjectGraphicsInfo(rom, graphicsId) : spawnInfo;
    if (!spawnInfo || !info) {
      console.warn(`[previewActors] ${what}: no graphics info for gfx ${graphicsId}; left out`);
      return;
    }
    const frame = berry ? firstAnimFrame(rom, info, animNum) : 0;

    const key = `${graphicsId}:${frame}`;
    let tile = tiles.get(key);
    if (tile === undefined) {
      const image = readFrameImage(rom, info, frame);
      const count = Math.ceil(image.length / TILE_BYTES);
      if (nextTile + count > OBJ_VRAM_TILES) {
        console.warn(`[previewActors] ${what}: its ${count} tiles overflow OBJ VRAM (${nextTile} of ${OBJ_VRAM_TILES} used); left out`);
        return;
      }
      vram.set(image, OBJ_VRAM + nextTile * TILE_BYTES);
      tile = nextTile;
      nextTile += count;
      tiles.set(key, tile);
    }

    const tag = berry ? PECHA_STAGE_PALETTE_TAGS[animNum] : info.paletteTag;
    let slot = slots.get(tag);
    if (slot === undefined) {
      slot = Math.min(slots.size, OBJ_PALETTE_SLOTS - 1);
      slots.set(tag, slot);
      const colours = readObjectPalette(rom, tag);
      const hex = `0x${tag.toString(16)}`;
      if (!colours) console.warn(`[previewActors] ${what}: no palette with tag ${hex}; drawn with OBJ palette ${slot} as it is`);
      else if (slots.size > OBJ_PALETTE_SLOTS) console.warn(`[previewActors] ${what}: palette tag ${hex} past ${OBJ_PALETTE_SLOTS} slots; drawn with slot ${slot}'s colours`);
      else palette.set(colours, OBJ_PALETTE + slot * 16);
    }

    // Size: the base OAM (the image may be larger and drawn as subsprites: the truck, composed below).
    // SetSpritePosToMapCoords + centerToCornerVec: x = cell * 16 + 8, y = cell * 16 + 16 + c2cY
    const { shape, size } = readOamShape(rom, info);
    const [width, height] = OBJ_SIZES[shape][size];
    const c2cX = -(info.width >> 1);
    const c2cY = -(info.height >> 1);
    const worldX = t.x * 16 + 8;
    // (live play: y + c2cY + OAM height, i.e. y*16 + 16 + 2 c2cY + OAM height; image heights are even)
    const worldY = t.y * 16 + 16 - info.height + height;
    const i = sprites.length;
    const elevation = t.elevation & 0xf;
    const data = new Int16Array(8);
    data[0] = i; // sObjEventId
    const sprite = blankSprite({
      index: i, width, height, tileNum: tile, palette: slot, priority: ELEVATION_TO_PRIORITY[elevation],
      // GBA sprite position with the camera at the map origin (live play: worldY = y + c2cY + height)
      x: worldX, y: worldY - c2cY - height, c2cX, c2cY, worldX, worldY, data,
      invisible: t.movementType === MOVEMENT_TYPE_INVISIBLE,
      animNum, images: info.images, subspriteTables: info.subspriteTables,
      // (InitObjectPriorityByElevation: whether or not there are tables)
      subspriteTableNum: ELEVATION_TO_SUBSPRITE_TABLE[elevation],
      // subsprites are switched on at spawn only if the spawn graphics have tables (SetSubspriteTables):
      // a berry tree spawns as gfx 60 (none); ObjectEventSetGraphicsId swaps tables, not the mode. This is
      // the map-entry state only: after a return to field (SpawnObjectEventOnReturnToField) live play respawns
      // berry trees from gfx 61/62 with subsprites on
      subspriteMode: spawnInfo.subspriteTables ? SUBSPRITES_ON : SUBSPRITES_OFF,
    });
    // a multi-piece image (the truck: 48×48 on a 32×32 OAM) is drawn from its pieces, as live play does: the
    // graphics info's table 0 with subsprites on, composed like GameState's sprites
    const pieces = readSubsprites(rom, info.subspriteTables, 0);
    if (pieces && needsComposition(pieces, width, height)) {
      sprite.subspriteTableNum = 0;
      sprite.subspriteMode = SUBSPRITES_IGNORE_PRIORITY;
      applyComposition(sprite, pieces);
    }
    sprites.push(sprite);
    objects.push({
      index: i, spriteId: i, graphicsId, localId: t.localId, mapGroup: 0, mapNum: 0,
      x: t.x, y: t.y, prevX: t.x, prevY: t.y, elevation, prevElevation: elevation, facing: DIR_SOUTH,
      invisible: t.movementType === MOVEMENT_TYPE_INVISIBLE, isPlayer: false, offScreen: false,
    });
  });
  return { sprites, objects };
}
