// Generates src/game/symbols.ts from the pokeemerald symbol table (vendor/pokeemerald-sym).
// Only allow-listed names are emitted so the bundle stays small; add names here as needed.
import fs from 'node:fs';
import path from 'node:path';

const WANTED = [
  // core
  'gMain', 'gSaveBlock1Ptr', 'gSaveBlock2Ptr', 'gPokemonStoragePtr', 'gTasks', 'gSprites',
  'gSpriteCoordOffsetX', 'gSpriteCoordOffsetY', 'gOamMatrices', 'gPlttBufferUnfaded', 'gPlttBufferFaded',
  'gPaletteFade', 'gScanlineEffect', 'gIntrTable', 'gSoundInfo', 'gReservedSpritePaletteCount',
  'gSpriteTileAllocBitmap', 'sSpriteTileRangeTags', 'sSpriteTileRanges', 'sSpritePaletteTags',
  // overworld
  'gMapHeader', 'gCamera', 'gObjectEvents', 'gPlayerAvatar', 'gBackupMapLayout', 'gBackupMapData',
  'gTotalCameraPixelOffsetX', 'gTotalCameraPixelOffsetY', 'sFieldCameraOffset', 'gFieldCamera',
  'gWeather', 'gWeatherPtr', 'gMapGroups', 'gMapLayouts', 'gObjectEventGraphicsInfoPointers',
  'gFieldEffectObjectTemplatePointers', 'sObjectEventSpritePalettes', 'gFieldEffectArguments',
  'gMapObjects', 'gSelectedObjectEvent', 'gGlobalFieldTintMode', 'sCurrentMapName',
  'gTilesetAnimTable', 'gTileset_General', 'gTileset_Petalburg', 'gTileset_Rustboro', 'gTileset_Lavaridge', 'gTileset_Sootopolis', 'gTileset_Mauville', 'gTileset_EverGrande',
  'gTileset_Slateport', 'gTileset_BattleFrontierOutsideWest', 'gTileset_BattleFrontierOutsideEast',
  // interiors (Phase 4): the Building primary and the five in-scope secondaries
  'gTileset_Building', 'gTileset_GenericBuilding', 'gTileset_PokemonCenter', 'gTileset_Shop', 'gTileset_Lab',
  'gTileset_BrendansMaysHouse',
  'sPrimaryTilesetAnimCounter',
  'gBGTilemapBuffers1', 'gBGTilemapBuffers2', 'gBGTilemapBuffers3', 'gFlashEffectActive',
  // code: a map connection being crossed (the game is inside CameraMove: map load in progress)
  'CameraMove',
  // callbacks used for scene detection
  'CB1_Overworld', 'CB2_Overworld', 'CB2_OverworldBasic', 'BattleMainCB2', 'BattleMainCB1',
  'CB2_InitBattle', 'CB2_HandleStartBattle', 'CB2_InitTitleScreen', 'MainCB2', 'CB2_MainMenu',
  'CB2_ReturnToField', 'CB2_LoadMap', 'CB2_DoChangeMap', 'CB2_ReturnToFieldContinueScript',
  'CB2_StartWallClock', 'CB2_WallClock', 'CB2_TitleScreenRun', 'CB2_InitCopyrightScreenAfterBootup',
  'CB2_NewGameBirchSpeech_FromNewMainMenu', 'CB2_NewGameBirchSpeech_ReturnFromNamingScreen',
  'CB2_ContinueSavedGame', 'CB2_WhiteOut', 'CB2_ReturnToFieldWithOpenMenu', 'CB2_EndWildBattle',
  'CB2_EndTrainerBattle', 'CB2_ReturnToFieldContinueScriptPlayMapMusic', 'CB2_ReturnToFieldFadeFromBlack',
  'CB2_ReturnToFieldFromMultiplayer', 'CB2_ReturnToFieldLink', 'CB2_ReturnToFieldLocal',
  'CB2_Credits', 'CB2_ContestMain', 'BattleIntroDrawTrainersOrMonsSprites',
  // battle
  'gBattleTypeFlags', 'gBattleTerrain', 'gBattleEnvironment', 'gBattleMons', 'gBattlerPositions',
  'gBattlersCount', 'gActiveBattler', 'gBattlerSpriteIds', 'gBattlerAttacker', 'gBattlerTarget',
  'gBattleSpritesDataPtr', 'gBattleStruct', 'gBattleOutcome', 'gCurrentMove', 'gBattleAnimAttacker',
  'gBattleAnimTarget', 'gAnimMoveIndex', 'gBattle_BG0_X', 'gBattle_BG0_Y', 'gBattle_BG1_X',
  'gBattle_BG1_Y', 'gBattle_BG2_X', 'gBattle_BG2_Y', 'gBattle_BG3_X', 'gBattle_BG3_Y',
  'gHealthboxSpriteIds', 'gBattlerPartyIndexes', 'gBattleControllerExecFlags', 'gBattleResults',
  'gBattleCommunication', 'gAnimScriptActive', 'gBattleScripting', 'gMoveSelectionCursor',
  'gPlayerParty', 'gEnemyParty', 'gPlayerPartyCount', 'gEnemyPartyCount', 'gTrainerBattleOpponent_A',
  'gBattleAnimBgCntSet', 'gBattleBgsHidden', 'gBattleMonForms', 'gMultiuseSpriteTemplate', 'gBattlerSpriteTemplates',
  // a battler copied onto a BG layer by a move animation (battle_anim.c Cmd_monbg: its update task, per flank)
  'sMonAnimTaskIdArray', 'Task_UpdateMonBg',
  // ROM data tables
  'gMonFrontPicTable', 'gMonBackPicTable', 'gMonPaletteTable', 'gMonShinyPaletteTable',
  'gSpeciesNames', 'gMoveNames', 'gSpeciesInfo', 'gBattleMoves', 'gTrainerFrontPicTable',
  'gTrainerFrontPicPaletteTable', 'gTrainerBackPicTable', 'gTrainerBackPicPaletteTable',
  'gMonIconTable', 'gMonIconPaletteIndices', 'gMonIconPaletteTable', 'gRegionMapEntries',
  'gTrainers', 'gItems', 'gBattleTerrainTable', 'gBattleEnvironmentInfo',
  // battle backgrounds (battle_bg.c DrawMainBattleBackground), battler placement and the enemy shadow
  ...['TallGrass', 'LongGrass', 'Sand', 'Underwater', 'Water', 'PondWater', 'Rock', 'Cave', 'Building', 'Stadium', 'Rayquaza']
    .flatMap((n) => [`gBattleEnvironmentTiles_${n}`, `gBattleEnvironmentTilemap_${n}`]),
  ...['TallGrass', 'LongGrass', 'Sand', 'Underwater', 'Water', 'PondWater', 'Rock', 'Cave', 'Building', 'Plain', 'Frontier',
    'BuildingGym', 'BuildingLeader', 'StadiumMagma', 'StadiumAqua', 'StadiumSidney', 'StadiumPhoebe', 'StadiumGlacia',
    'StadiumDrake', 'StadiumWallace', 'Groudon', 'Kyogre', 'Rayquaza'].map((n) => `gBattleEnvironmentPalette_${n}`),
  'gMonFrontPicCoords', 'gMonBackPicCoords', 'gEnemyMonElevation', 'gSpriteTemplate_EnemyShadow', 'gEnemyMonShadow_Gfx',
  'gBattleInterface_BallStatusBarPal',
  // misc
  'UpdateObjectReflectionSprite', 'sCloudSpriteTemplate', 'sRainSpriteTemplate', 'sSnowflakeSpriteTemplate',
  'sFogHorizontalSpriteTemplate', 'sAshSpriteTemplate', 'sFogDiagonalSpriteTemplate', 'sSandstormSpriteTemplate',
  'sBubbleSpriteTemplate', 'gFieldEffectObjectTemplatePointers',
  'sBackupMapData', 'sHorizontalCameraPan', 'sVerticalCameraPan', 'gOverworldTilemapBuffer_Bg1',
  'gOverworldTilemapBuffer_Bg2', 'gOverworldTilemapBuffer_Bg3', 'gMonIconTable', 'gBattlerSpriteIds',
  'gRngValue', 'gStringVar1', 'gStringVar4', 'gTextFlags', 'gWindows', 'gSpecialVar_Result',
  'gLocalTime', 'gRtcLocation', 'sRtc',
  // the warp the game is about to make (WarpData: s8 mapGroup, s8 mapNum, s8 warpId, s16 x, s16 y): Phase 4b's fixture tool
  // (tools/puzzle-states.ts) redirects a door warp through it — test fixtures only, the app never writes game memory
  'sWarpDestination',
];

const root = path.resolve(import.meta.dirname, '..');
const symPath = path.join(root, 'vendor/pokeemerald-sym/pokeemerald.sym');
const lines = fs.readFileSync(symPath, 'utf8').split(/\r?\n/);
const table = new Map<string, { addr: number; size: number }>();
for (const line of lines) {
  const m = /^([0-9a-f]{8}) [gl] ([0-9a-f]{8}) (\S+)$/.exec(line);
  if (m && !table.has(m[3])) table.set(m[3], { addr: parseInt(m[1], 16), size: parseInt(m[2], 16) });
}

const found: string[] = [];
const missing: string[] = [];
for (const name of new Set(WANTED)) {
  const s = table.get(name);
  if (!s) { missing.push(name); continue; }
  found.push(`  ${name}: 0x${s.addr.toString(16).padStart(8, '0')},`);
}
const sizes = [...new Set(WANTED)].filter((n) => table.has(n)).map((n) => `  ${n}: ${table.get(n)!.size},`);

const out = `// AUTO-GENERATED by tools/gen-symbols.ts from the pokeemerald symbol table (BPEE rev 0).
// Do not edit by hand — add names to the WANTED list and re-run \`npm run symbols\`.
export const SYM = {
${found.join('\n')}
} as const;

export const SYM_SIZE: Record<keyof typeof SYM, number> = {
${sizes.join('\n')}
};

export type SymName = keyof typeof SYM;
`;
fs.writeFileSync(path.join(root, 'src/game/symbols.ts'), out);
console.log(`wrote ${found.length} symbols; missing: ${missing.join(', ') || 'none'}`);
