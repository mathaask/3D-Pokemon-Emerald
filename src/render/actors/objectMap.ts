// Which object events become procedural models (Modern), and when they must stay sprites.
// Graphics ids: pokeemerald include/constants/event_objects.h; anims: constants/event_object_movement.h.

/** Object-event graphics ids drawn as models. */
export const GFX = { ITEM_BALL: 59, BERRY_TREE: 60, BERRY_TREE_EARLY: 61, BERRY_TREE_LATE: 62, CUTTABLE_TREE: 82,
  BREAKABLE_ROCK: 86, PUSHABLE_BOULDER: 87, TRUCK: 94 } as const;

/** Anim of a Cut tree / breakable rock being cut / smashed (anim 0 = ANIM_STAY_STILL). */
export const ANIM_REMOVE_OBSTACLE = 1;

/** First VAR graphics id (OBJ_EVENT_GFX_VARS = NUM_OBJ_EVENT_GFX + 1): resolved through a game var, never a model. */
const GFX_VARS = 240;

export type ObjectModelKind = 'pokeball' | 'boulder' | 'crackedRock' | 'cutTree' | 'berry' | 'truck';

export interface ObjectModelRef { kind: ObjectModelKind; stage: number }   // stage: berry 1..5, else 0

const KINDS = new Map<number, ObjectModelKind>([
  [GFX.ITEM_BALL, 'pokeball'],
  [GFX.BERRY_TREE, 'berry'],
  [GFX.BERRY_TREE_EARLY, 'berry'],
  [GFX.BERRY_TREE_LATE, 'berry'],
  [GFX.CUTTABLE_TREE, 'cutTree'],
  [GFX.BREAKABLE_ROCK, 'crackedRock'],
  [GFX.PUSHABLE_BOULDER, 'boulder'],
  [GFX.TRUCK, 'truck'],
]);

/** null: draw the sprite (unmapped id, a VAR id ≥ 240, or a Cut tree / rock playing its removal animation). */
export function objectModelFor(graphicsId: number, animNum: number): ObjectModelRef | null {
  if (graphicsId >= GFX_VARS) return null;
  const kind = KINDS.get(graphicsId);
  if (kind === undefined) return null;
  if (kind === 'berry') return { kind, stage: berryStage(animNum) };
  if ((kind === 'cutTree' || kind === 'crackedRock') && animNum === ANIM_REMOVE_OBSTACLE) return null;
  return { kind, stage: 0 };
}

/** Berry trees run anim (stage − 1) (event_object_movement.c SetBerryTreeGraphics): stage = clamp(animNum + 1, 1, 5). */
export function berryStage(animNum: number): number {
  return Math.min(5, Math.max(1, animNum + 1));
}

/** Height in sprite px of the image the model stands for (the truck's 48×48 subsprite image; others: the sprite's). */
export function modelImageHeight(kind: ObjectModelKind, spriteHeight: number): number {
  return kind === 'truck' ? 48 : spriteHeight;
}
