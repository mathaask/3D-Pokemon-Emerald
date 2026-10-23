// Which battle background the GBA draws (battle_bg.c DrawMainBattleBackground), as an arena kind, plus the ROM
// graphics each kind's background is made of and the kind of place it shows. Constants from pokeemerald
// include/constants/battle.h, trainers.h and map_types.h. Pure data and logic (no three.js).

export type ArenaKind = 'grass' | 'longGrass' | 'sand' | 'underwater' | 'water' | 'pond' | 'mountain' | 'cave' | 'building'
  | 'plain' | 'cavePond' | 'gym' | 'leader' | 'frontier' | 'magma' | 'aqua' | 'sidney' | 'phoebe' | 'glacia' | 'drake'
  | 'champion' | 'groudon' | 'kyogre' | 'rayquaza';

/** The ten BATTLE_ENVIRONMENT_* kinds (in their index order), then the backgrounds battle type, trainer class and map
 *  battle scene select. */
export const ARENA_KINDS: readonly ArenaKind[] = [
  'grass', 'longGrass', 'sand', 'underwater', 'water', 'pond', 'mountain', 'cave', 'building', 'plain',
  'cavePond', 'gym', 'leader', 'frontier', 'magma', 'aqua', 'sidney', 'phoebe', 'glacia', 'drake',
  'champion', 'groudon', 'kyogre', 'rayquaza',
];

/** index = BATTLE_ENVIRONMENT_* (0..9): sBattleEnvironmentTable's order. */
export const ENVIRONMENT_KINDS: readonly ArenaKind[] = ARENA_KINDS.slice(0, 10);

/** gBattleTypeFlags bits DrawMainBattleBackground tests (FRONTIER: tower, dome, palace, arena, factory, pike, pyramid). */
export const BATTLE_TYPE = { LINK: 1 << 1, TRAINER: 1 << 3, EREADER_TRAINER: 1 << 11, RECORDED_LINK: 1 << 25,
  FRONTIER: (1 << 8) | (1 << 16) | (1 << 17) | (1 << 18) | (1 << 19) | (1 << 20) | (1 << 21),
  GROUDON: 1 << 28, KYOGRE: 1 << 29, RAYQUAZA: 1 << 30 } as const;

export const TRAINER_CLASS = { LEADER: 0x20, CHAMPION: 0x26 } as const;

/** MapHeader.battleType (GetCurrentMapBattleScene). */
export const MAP_BATTLE_SCENE = { NORMAL: 0, GYM: 1, MAGMA: 2, AQUA: 3, SIDNEY: 4, PHOEBE: 5, GLACIA: 6, DRAKE: 7, FRONTIER: 8 } as const;

export const MAP_TYPE_UNDERGROUND = 4;
const MAP_TYPE_ROUTE = 3;

export interface ArenaInputs { environment: number; battleType: number; trainerClass: number; mapBattleScene: number; mapType: number }

const SCENE_KINDS: Readonly<Record<number, ArenaKind>> = {
  [MAP_BATTLE_SCENE.GYM]: 'gym', [MAP_BATTLE_SCENE.MAGMA]: 'magma', [MAP_BATTLE_SCENE.AQUA]: 'aqua',
  [MAP_BATTLE_SCENE.SIDNEY]: 'sidney', [MAP_BATTLE_SCENE.PHOEBE]: 'phoebe', [MAP_BATTLE_SCENE.GLACIA]: 'glacia',
  [MAP_BATTLE_SCENE.DRAKE]: 'drake', [MAP_BATTLE_SCENE.FRONTIER]: 'frontier',
};

/** battle_bg.c DrawMainBattleBackground: link/frontier/e-reader/recorded-link → frontier; Groudon; Kyogre; Rayquaza;
 *  a trainer battle against a Leader / the Champion; the map's battle scene; the environment (out of range: plain);
 *  a pond in an underground map → cavePond. */
export function arenaKind(i: ArenaInputs): ArenaKind {
  const t = i.battleType;
  if (t & (BATTLE_TYPE.LINK | BATTLE_TYPE.FRONTIER | BATTLE_TYPE.EREADER_TRAINER | BATTLE_TYPE.RECORDED_LINK)) return 'frontier';
  if (t & BATTLE_TYPE.GROUDON) return 'groudon';
  if (t & BATTLE_TYPE.KYOGRE) return 'kyogre';
  if (t & BATTLE_TYPE.RAYQUAZA) return 'rayquaza';
  if (t & BATTLE_TYPE.TRAINER) {
    if (i.trainerClass === TRAINER_CLASS.LEADER) return 'leader';
    if (i.trainerClass === TRAINER_CLASS.CHAMPION) return 'champion';
  }
  const scene = SCENE_KINDS[i.mapBattleScene];
  if (scene) return scene;
  const env = ENVIRONMENT_KINDS[i.environment] ?? 'plain';
  return env === 'pond' && i.mapType === MAP_TYPE_UNDERGROUND ? 'cavePond' : env;
}

/** Inputs that make arenaKind return `kind` (the static preview's). */
export function arenaInputsFor(kind: ArenaKind): ArenaInputs {
  const i: ArenaInputs = { environment: 0, battleType: 0, trainerClass: 0, mapBattleScene: 0, mapType: MAP_TYPE_ROUTE };
  const env = ENVIRONMENT_KINDS.indexOf(kind);
  if (env >= 0) return { ...i, environment: env };
  switch (kind) {
    case 'cavePond': return { ...i, environment: 5, mapType: MAP_TYPE_UNDERGROUND };
    case 'gym': return { ...i, environment: 8, battleType: BATTLE_TYPE.TRAINER, mapBattleScene: MAP_BATTLE_SCENE.GYM };
    case 'leader': return { ...i, environment: 8, battleType: BATTLE_TYPE.TRAINER, mapBattleScene: MAP_BATTLE_SCENE.GYM,
      trainerClass: TRAINER_CLASS.LEADER };
    case 'champion': return { ...i, environment: 8, battleType: BATTLE_TYPE.TRAINER, trainerClass: TRAINER_CLASS.CHAMPION };
    case 'frontier': return { ...i, environment: 8, battleType: 1 << 8 };
    case 'magma': return { ...i, environment: 8, mapBattleScene: MAP_BATTLE_SCENE.MAGMA };
    case 'aqua': return { ...i, environment: 8, mapBattleScene: MAP_BATTLE_SCENE.AQUA };
    case 'sidney': return { ...i, environment: 8, mapBattleScene: MAP_BATTLE_SCENE.SIDNEY };
    case 'phoebe': return { ...i, environment: 8, mapBattleScene: MAP_BATTLE_SCENE.PHOEBE };
    case 'glacia': return { ...i, environment: 8, mapBattleScene: MAP_BATTLE_SCENE.GLACIA };
    case 'drake': return { ...i, environment: 8, mapBattleScene: MAP_BATTLE_SCENE.DRAKE };
    case 'groudon': return { ...i, battleType: BATTLE_TYPE.GROUDON };
    case 'kyogre': return { ...i, battleType: BATTLE_TYPE.KYOGRE };
    case 'rayquaza': return { ...i, battleType: BATTLE_TYPE.RAYQUAZA };
  }
  throw new Error(`unknown arena kind ${kind as string}`);
}

/** The ROM graphics of a background (SYM names): LZ77 tiles, LZ77 tilemap, LZ77 palette (BG palettes 2–4). */
export interface ArenaBackground { tiles: string; tilemap: string; palette: string }

const bg = (gfx: string, palette: string): ArenaBackground =>
  ({ tiles: `gBattleEnvironmentTiles_${gfx}`, tilemap: `gBattleEnvironmentTilemap_${gfx}`, palette: `gBattleEnvironmentPalette_${palette}` });

export const ARENA_BACKGROUND: Readonly<Record<ArenaKind, ArenaBackground>> = {
  grass: bg('TallGrass', 'TallGrass'),
  longGrass: bg('LongGrass', 'LongGrass'),
  sand: bg('Sand', 'Sand'),
  underwater: bg('Underwater', 'Underwater'),
  water: bg('Water', 'Water'),
  pond: bg('PondWater', 'PondWater'),
  mountain: bg('Rock', 'Rock'),
  cave: bg('Cave', 'Cave'),
  building: bg('Building', 'Building'),
  plain: bg('Building', 'Plain'),
  cavePond: bg('PondWater', 'PondWater'),
  gym: bg('Building', 'BuildingGym'),
  leader: bg('Building', 'BuildingLeader'),
  frontier: bg('Building', 'Frontier'),
  magma: bg('Stadium', 'StadiumMagma'),
  aqua: bg('Stadium', 'StadiumAqua'),
  sidney: bg('Stadium', 'StadiumSidney'),
  phoebe: bg('Stadium', 'StadiumPhoebe'),
  glacia: bg('Stadium', 'StadiumGlacia'),
  drake: bg('Stadium', 'StadiumDrake'),
  champion: bg('Stadium', 'StadiumWallace'),
  groudon: bg('Cave', 'Groudon'),
  kyogre: bg('Water', 'Kyogre'),
  rayquaza: bg('Rayquaza', 'Rayquaza'),
};

export type ArenaSetting = 'outdoor' | 'water' | 'underwater' | 'cave' | 'indoor' | 'sky';

/** outdoor: grass, longGrass, plain, sand, mountain; water: water, pond; underwater; cave: cave, cavePond, groudon,
 *  kyogre (Marine Cave); indoor: building, gym, leader, frontier, magma, aqua, sidney, phoebe, glacia, drake, champion;
 *  sky: rayquaza (Sky Pillar). */
export const ARENA_SETTING: Readonly<Record<ArenaKind, ArenaSetting>> = {
  grass: 'outdoor', longGrass: 'outdoor', plain: 'outdoor', sand: 'outdoor', mountain: 'outdoor',
  water: 'water', pond: 'water',
  underwater: 'underwater',
  cave: 'cave', cavePond: 'cave', groudon: 'cave', kyogre: 'cave',
  building: 'indoor', gym: 'indoor', leader: 'indoor', frontier: 'indoor', magma: 'indoor', aqua: 'indoor',
  sidney: 'indoor', phoebe: 'indoor', glacia: 'indoor', drake: 'indoor', champion: 'indoor',
  rayquaza: 'sky',
};
