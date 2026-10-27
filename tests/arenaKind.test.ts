import { describe, it, expect } from 'vitest';
import { arenaKind, arenaInputsFor, ARENA_KINDS, ENVIRONMENT_KINDS, ARENA_BACKGROUND, ARENA_SETTING, BATTLE_TYPE,
  TRAINER_CLASS, MAP_BATTLE_SCENE, MAP_TYPE_UNDERGROUND } from '../src/render/battle/arenaKind';

const base = { environment: 0, battleType: 0, trainerClass: 0, mapBattleScene: 0, mapType: 3 };

describe('arenaKind', () => {
  it('maps the ten battle environments as the GBA table does', () => {
    expect(ENVIRONMENT_KINDS).toEqual(['grass', 'longGrass', 'sand', 'underwater', 'water', 'pond', 'mountain', 'cave', 'building', 'plain']);
    ENVIRONMENT_KINDS.forEach((k, environment) => expect(arenaKind({ ...base, environment })).toBe(k));
    expect(arenaKind({ ...base, environment: 10 })).toBe('plain');
  });
  it('follows DrawMainBattleBackground\'s precedence', () => {
    expect(arenaKind({ ...base, battleType: BATTLE_TYPE.LINK | BATTLE_TYPE.GROUDON })).toBe('frontier');
    expect(arenaKind({ ...base, battleType: 1 << 8 })).toBe('frontier');                      // Battle Tower
    expect(arenaKind({ ...base, battleType: BATTLE_TYPE.GROUDON | BATTLE_TYPE.KYOGRE })).toBe('groudon');
    expect(arenaKind({ ...base, battleType: BATTLE_TYPE.KYOGRE })).toBe('kyogre');
    expect(arenaKind({ ...base, battleType: BATTLE_TYPE.RAYQUAZA })).toBe('rayquaza');
    expect(arenaKind({ ...base, battleType: BATTLE_TYPE.TRAINER, trainerClass: TRAINER_CLASS.LEADER, mapBattleScene: MAP_BATTLE_SCENE.GYM })).toBe('leader');
    expect(arenaKind({ ...base, battleType: BATTLE_TYPE.TRAINER, trainerClass: TRAINER_CLASS.CHAMPION })).toBe('champion');
    expect(arenaKind({ ...base, trainerClass: TRAINER_CLASS.LEADER })).toBe('grass');           // wild: the class is not read
    expect(arenaKind({ ...base, battleType: BATTLE_TYPE.TRAINER, mapBattleScene: MAP_BATTLE_SCENE.GYM })).toBe('gym');
    expect(arenaKind({ ...base, environment: 8, mapBattleScene: MAP_BATTLE_SCENE.DRAKE })).toBe('drake');
    expect(arenaKind({ ...base, mapBattleScene: MAP_BATTLE_SCENE.FRONTIER })).toBe('frontier');
  });
  it('puts a pond inside an underground map in a cave', () => {
    expect(arenaKind({ ...base, environment: 5, mapType: MAP_TYPE_UNDERGROUND })).toBe('cavePond');
    expect(arenaKind({ ...base, environment: 5 })).toBe('pond');
  });
  it('round-trips every kind through arenaInputsFor', () => {
    expect(ARENA_KINDS).toHaveLength(24);
    for (const k of ARENA_KINDS) expect(arenaKind(arenaInputsFor(k))).toBe(k);
  });
  it('names a background and a setting for every kind', () => {
    for (const k of ARENA_KINDS) {
      expect(ARENA_BACKGROUND[k].tiles).toMatch(/^gBattleEnvironmentTiles_/);
      expect(ARENA_SETTING[k]).toBeDefined();
    }
    expect(ARENA_BACKGROUND.plain).toEqual({ tiles: 'gBattleEnvironmentTiles_Building',
      tilemap: 'gBattleEnvironmentTilemap_Building', palette: 'gBattleEnvironmentPalette_Plain' });
    expect(ARENA_BACKGROUND.cavePond).toEqual(ARENA_BACKGROUND.pond);
    expect(ARENA_BACKGROUND.champion.palette).toBe('gBattleEnvironmentPalette_StadiumWallace');
    expect(ARENA_BACKGROUND.kyogre.tiles).toBe('gBattleEnvironmentTiles_Water');
  });
});
