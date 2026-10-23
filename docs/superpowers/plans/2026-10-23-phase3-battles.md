# Phase 3 — Battles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Modern style, battles take place in a modelled arena rebuilt from the kit per battle background the GBA draws (grass, long grass, plain, sand, sea, pond, underwater, mountain, cave, indoor halls, gyms, Frontier, team hideouts, the Elite Four rooms, the Champion's room, the legendaries' arenas), with platforms modelled per terrain, colours sampled from the live battle background, and the battlers drawn as Phase 2 inflated sprites — while Retro renders every battle exactly as today and entering a battle compiles no shader program in either style.

**Architecture:** `BattleView` splits by world style. Retro keeps today's `BattleArena` and cards untouched. Modern builds a `ModernArena` from *arena parts* (ground, platforms, flora, horizon, water, rock, rooms…) that reuse the kit's material definitions (`terrainMaterial`, `waterMaterial`, `treeMaterial`, `GRASS_MATERIAL`, `CLIFF_MATERIAL`, `SOIL_MATERIAL`, `BUILDING_*`, `PROP_*`) on new arena-specific geometry; colours come from the BG3 picture the game loaded (`decodeBg3` → `sampleArenaColors` → `arenaPalette`). Battle sprites are routed per frame (`BattleActors`): battlers → `InflatedActors` (battle variant, own `SpriteField`), move effects → today's cards, HUD → the screen-space HUD. Every program the battle scene can draw is compiled at boot from a battle catalogue (parts' declared entries + today's arena variants + the actors), held to what the arenas really build by a node drift-guard test. Verification first: battle save-state entries, a static battle preview of every arena kind from ROM data with the GBA's own picture beside it.

**Tech Stack:** TypeScript (strict), Three.js 0.186 (WebGL2: MeshStandardMaterial + `onBeforeCompile` via `kitMaterial`, InstancedMesh, `compileAsync`), Vite, Vitest, puppeteer-core (headless Chrome, ANGLE D3D11).

**Spec:** `docs/superpowers/specs/2026-10-19-modern-3d-models-design.md` (§7 Phase 3; §1–3 intent/architecture; §9 testing; §10 budgets; §11 error handling; §12 non-goals; §13 risks). Progress log: `docs/superpowers/progress/modern-3d.md`. Phase 2 rulings that carry over: `docs/superpowers/progress/phase2-sdd-ledger.md`.

**Branch:** `phase3-battles`, from `main` after the hitch fix (`hitch-fix`: boot-time program catalogue, `Renderer.precompiled()` / `finishPrecompile()`, one build per crossing, crossing entries in `regress-live`) is merged. Do not rely on line numbers in `renderer.ts`, `overworldView.ts` or the kit families: refer to functions by name.

## Global Constraints

- **No Nintendo assets in the repository and no third-party downloads.** Battle backgrounds, Pokémon pictures and palettes are decoded at runtime from the user's ROM (`vendor/pokeemerald-src` is a read-only, gitignored reference for layouts and constants). Default colours in code are hand-picked approximations, never copied ROM data.
- The overworld mapping is unchanged (grid (x, y) at height h → world (X = x, Y = h, Z = y + h)). The battle world keeps today's frame: GBA screen pixels are un-projected through the reference camera (`PX = 32` GBA px per unit, pitch 24°), platform tops at y = 0, today's ground at y = −0.28 (`GROUND_Y`). **The reference-camera choreography is unchanged**: where every battle sprite lands (lunges, x2/y2 offsets, affine size, double-size offset, depth interpolation of effects) and the 3D battle camera (framing, intro sweep, focus push-in, sway, ±0.9 yaw) stay exactly today's in both styles.
- **Retro renders every battle exactly as today.** Gate after every task: `npm run regress:live -- --label tN --static --compare p3-base` reports **0.00 %** on every Retro entry (live and static, overworld and battle). Phase 3 also leaves the overworld alone: every Modern overworld entry and `transition` stay 0.00 % in Modern too. (Retro at High quality may lose the bogus GTAO origin quad of the battle cards — Phase 2's ruling: the gate is Medium.)
- Phase 3 features are Modern-only: the Modern arena, inflated battlers, the flat enemy shadow, the Modern sky. Move-effect sprites stay today's alpha-tested cards in both styles; HUD sprites and the BG0–BG2 overlay (text, menus, full-screen BG move effects) stay the screen-space HUD.
- **Budgets (Medium, 1280×800):** ≤ 150 draw calls and ≤ 1.5 M triangles on every Modern battle entry (today's Retro arena is exempt: it must stay pixel-identical; Task 1 records its numbers). GPU and CPU are judged **only** by the harness's same-session interleaved A/B (`--ab`, frame method, 64 ABBA quads), never by stored `gpuMs` (the dev iGPU drifts 6–14 ms between sessions): `--ab-feature battlers` (inflated vs cards) Δgpu ≤ +1.0 ms, Δcpu ≤ +0.5 ms (Phase 2's actor budget); `--ab-feature battle` (Modern vs Retro battle) Δgpu ≤ +3.0 ms, Δcpu ≤ +0.5 ms (proposed, see the report).
- **Programs:** entering, playing and leaving a battle compiles nothing, in either style. The battle scene's programs are compiled at boot (`BattleView.precompile`, joined to the hitch fix's `Renderer.precompiled()` / `finishPrecompile()`); `tests/battleCatalogue.test.ts` (node, no ROM) holds the battle catalogue to exactly what every arena kind builds at every quality; the hitch fix's overworld guard (`tests/smoke/catalogue.test.ts`) still passes. The battle scene's light set is fixed (today's sun with shadow + hemisphere light, `THREE.Fog`): arenas change light and fog values, never add or remove lights.
- Arena build (`ModernArena.build`) ≤ 60 ms warm (median of 5, `preview.measureArenaBuild()`); no frame of a battle entry or exit walk slower than 150 ms with the GPU drained (spec §10 rebuild budget).
- **Error handling (spec §11):** each arena part builds inside try/catch; a failure logs once per arena kind and the battle draws today's arena (Modern battlers kept); a failing inflated-actor program falls back to the attribute path or cards; V (classic 2D) stays the universal fallback.
- Battlers use Phase 2's `InflatedActors` + `SpriteField` with `instanceUniformsFit(renderer.capabilities.maxVertexUniforms, ?actorUniforms)` passed by every caller; the **Sprite edges** setting (HD smooth / Pixel) applies to battlers.
- `npx tsc --noEmit` and `npm test` pass at the end of every task; smoke tests a task adds or touches pass (`npx vitest run --config tests/smoke/vitest.smoke.config.ts <file>`).
- Every arena task ends with a **visual review**: `npm run regress:live -- --label tN --battles --review --review-before p3-base` and the implementer reads `_review_battle.png` (columns GBA | before | Modern | Retro, one row per battle entry) against the task's look checklist, and says in the report what they saw. The quality bar is "modern stylized 3D" (Let's Go / BDSP feel): soft rounded shapes, clean bright colours, painterly surfaces, readable silhouettes, no pixel-textured boxes.
- The controller keeps `docs/superpowers/progress/modern-3d.md` up to date; implementers put learnings and measured numbers in their task report. Only `opus` subagents work on this deployment.
- Bash heredocs with large content fail in this harness: write files with the editor tools; scratch scripts go in `.scratch/` (gitignored). Implementers work in the main checkout (the ROM, `out/*.state`, `vendor/` and `.scratch/` exist only there).

## Review Focus

1. **Battle → overworld and back, and style switches mid-battle.** The two inflation fields share one sprite atlas; nothing of the battle may leak into the overworld (stale field, a lingering arena, a compile on return), and a Modern ↔ Retro or HD ↔ Pixel switch inside a battle applies at once and returns to the identical frame. Pinned: Task 1/4 `battle_exit` (first battle played to Route 101, gated no-compile from Task 4, overworld field self-test at its end from Task 5) and Task 5 `battle_switch` (`sameAs: 'battle'`).
2. **Double battles and arena kinds no save state reaches** (gyms, Elite Four, Frontier, hideouts, legendaries, cave ponds): four battlers on two platforms, the background chosen by battle type → trainer class → map battle scene → environment. Pinned: Task 2 `arenaKind` precedence tests, Task 3 static `b_double` and one static entry per kind, Task 5 four-battler `BattleActors` test.
3. **The background is not loaded yet, or mid-load, when the battle starts.** Colours sampled from an empty BG3 must not freeze into the arena, and the arena must not rebuild every frame. Pinned: Task 2 (`sampleArenaColors` → null on black / one-colour pictures) and Task 6 (`ArenaColorLock`: defaults first, exactly one switch to the first valid sample, none after).
4. **GBA sprite effects the cards ignore**: OBJ-window clones (masks the GBA never shows), affine growth from nothing at send-out, tile rows cleared during a faint, palette blends and shiny palettes, Substitute / Transform tile swaps. No duplicate battler, no NaN geometry. Pinned: Task 5 `battleRoute` tests (OBJ window skipped in Modern), the zero-width instance test, live `battle_intro`, `battle_move`, `battle_exit` (a faint) looked at frame by frame.
5. **Dark and unusual light** (outdoor night, caves, underwater, Phoebe's and Sidney's dark rooms): inflated battlers are never black and stay within 0.9–1.15× Retro's actor luminance. Pinned: Task 5 static `b_grass_night`, `b_cave`, `b_underwater` actor-luminance gate; re-checked by Tasks 9 and 11 when those arenas' looks land.

## Key design decisions (deviations from spec §7 are marked ⚑)

- **D1 ⚑ The sky dome is built but the battle camera never frames the horizon.** The camera looks 16.55° down with a 24° vertical field of view: its top edge points 4.55° below the horizon and meets the ground ≈ 42 units away. Moving the camera would push battlers out from under the GBA's HUD (healthboxes, text box), so it stays. The Modern `BattleSky` (gradient + procedural soft clouds, stars at night) therefore shows through the water's reflections (Task 8: clouds in the arena water) and as slow soft **cloud shadows** drifting over outdoor arena ground (Task 7); it sets the fog/horizon colour everywhere. It draws after the opaque arena (`renderOrder` 10, depth test at the far plane) so its hidden pixels cost nothing.
- **D2 Arena kind = the background the GBA draws**, not `gBattleEnvironment` alone: 24 kinds mirroring `DrawMainBattleBackground` (battle type flags → Leader/Champion trainer class → map battle scene → environment), plus `cavePond` (a POND environment inside an underground map: the GBA reuses the pond picture; the 3D arena is a cave).
- **D3 Arena parts reuse the kit's materials** (one definition each, as Phase 1) on new arena geometry generators placed in battle units. Procedural shader frequencies stay per world unit; kit objects sized in cells (trees, grass clumps) are instance-scaled (tuned at review).
- **D4 The battle inflation field is its own `SpriteField` instance** with battle parameters (`BATTLE_INFLATE`: 64-px Pokémon need a 4× larger distance window than 16-px characters): +8 MB GPU memory, no cross-scene staleness. (Alternative kept in reserve: share the overworld's targets; rejected for the deferred-sync edge case.)
- **D5 ⚑ Move-effect sprites stay today's alpha-tested cards.** The spec says "additive/alpha billboards"; today's cards ignore the GBA's blend registers (BLDALPHA semi-transparency, BLDY brightness) in both styles and Phase 3 does not emulate them (open question for the user).
- **D6 OBJ-window sprites are skipped in Modern.** They are window masks the GBA never displays (e.g. battler clones made by `battle_anim_mons.c`); Retro keeps drawing them as cards (today's behaviour), Modern would otherwise inflate a duplicate battler.
- **D7 The enemy-shadow sprite (floating Pokémon) lies flat on the platform in Modern**, a decal like the overworld's shadows; Retro keeps today's upright card.
- **D8 ⚑ Affine rotation and OBJ mosaic stay unreproduced** (parity with today's cards in both styles; known gap). Palette blends, fades, shiny palettes, Substitute and Transform need nothing: the atlas samples the live tiles and the hardware palette, the field follows the live alpha.
- **D9 Static battle preview from ROM data** (`?battle=<kind>`): the arena's BG3 picture and the battlers' front/back pictures are decoded into scratch VRAM/PRAM and driven through the live `BattleView` path; the harness saves the GBA's own composite beside each shot.
- **D10 Today's arena is the Retro look and the failure fallback**; in Modern it is built only when shown (a Retro switch or a part failure), so a Modern battle does not pay for it.
- **D11 Outdoor Modern battles share the overworld's time of day** (its keyframes extracted unchanged into `overworld/timeOfDay.ts`): a battle at dusk is lit like the route it started on.

---

## File Structure

Created:
- `src/render/battle/arenaKind.ts` — `ArenaKind`, `arenaKind()`, its inverse for the preview, background symbol names, setting per kind.
- `src/render/battle/bgSample.ts` — `decodeBg3` (the BG3 picture as the GBA shows it), `sampleArenaColors`, `defaultArenaColors`, `colorsKey`.
- `src/game/rom/battleGraphics.ts` — ROM decode of battle backgrounds, Pokémon pictures/palettes/offsets/elevation, the enemy shadow, battler screen positions.
- `src/render/battlePreview.ts` — `BattlePreviewApp` (`?battle=`), `previewBattleSprites`, the GBA reference composite.
- `src/render/battle/stage.ts` — the reference projection (extracted from `BattleView`): `Stage`, `STAGE`, `PX`, `REF_PITCH`, platform footprints, `GROUND_Y`, `WATER_Y`.
- `src/render/battle/battleActors.ts` — per-frame routing of battle sprites (HUD / card / inflated / decal / skip) and their specs.
- `src/render/battle/modernArena.ts` — `ArenaPart`, `ArenaContext`, `ARENA_PARTS`, `ModernArena` (build per kind/colours/quality, try/catch fallback), `ArenaColorLock`.
- `src/render/battle/catalogue.ts` — `CatalogueEntry`, `battleCatalogue()`, `legacyArenaMeshes()`.
- `src/render/battle/palette.ts` — `ArenaPalette`, `arenaPalette()`.
- `src/render/battle/look.ts` — `ArenaLook`, `arenaLook()` (lights, fog, night per kind and hour).
- `src/render/overworld/timeOfDay.ts` — the overworld's outdoor keyframes (`timeOfDay`, `nightFactor`), extracted.
- `src/render/battle/clouds.glsl.ts` — `CLOUD_GLSL` (soft cloud field shared by the sky, the ground's cloud shadows and the water's reflection).
- `src/render/battle/sky.ts` — `BattleSky` (Modern).
- `src/render/battle/parts/ground.ts` — `groundCells`, `groundHeight`, `ARENA_GROUND_MATERIAL`, `GROUND_PART`.
- `src/render/battle/parts/platforms.ts` — `PlatformStyle`, `PLATFORM_STYLE`, `platformMeshes`, `RIPPLE_MATERIAL`, `PLATFORM_PART`.
- `src/render/battle/parts/scatter.ts` — `scatter` (seeded placements with keep-outs), `KEEP_OUT`.
- `src/render/battle/parts/flora.ts`, `parts/horizon.ts`, `parts/dunes.ts`, `parts/rocks.ts`, `parts/water.ts`, `parts/rock.ts`, `parts/rooms.ts`, `parts/stadium.ts`, `parts/skyPillar.ts` — the arena parts (Tasks 7–11).
- Tests: `tests/arenaKind.test.ts`, `tests/bgSample.test.ts`, `tests/battlePreview.test.ts`, `tests/battleStage.test.ts`, `tests/battleActors.test.ts`, `tests/modernArena.test.ts`, `tests/battleCatalogue.test.ts`, `tests/timeOfDay.test.ts`, `tests/arenaPalette.test.ts`, `tests/arenaLook.test.ts`, `tests/arenaGround.test.ts`, `tests/arenaPlatforms.test.ts`, `tests/arenaScatter.test.ts`, `tests/arenaFlora.test.ts`, `tests/battleSky.test.ts`, `tests/arenaWater.test.ts`, `tests/arenaRock.test.ts`, `tests/arenaRooms.test.ts`, `tests/smoke/battleGraphics.test.ts`.

Modified:
- `src/render/battle/battleView.ts` — style split, stage/actors/arenas delegated, Modern look and sky, precompile, field, mask, sprite filter.
- `src/render/battle/arena.ts` — **untouched** (today's arena: Retro and fallback).
- `src/render/renderer.ts` — battle precompile joined to `precompiled()` / `finishPrecompile()`, battle field update, style / sprite filter / mask / self-test routed to the battle view.
- `src/render/actors/inflateMath.ts` (`BATTLE_INFLATE`), `src/render/actors/inflatedActors.ts` (`InflatedVariant`), `src/render/actors/selfTest.ts` (`inflateMax` in the result).
- `src/render/kit/catalogue.ts` (export `catalogueTriangle`), `src/render/kit/trees.ts` (export `treeGeometry`, `TREE_VARIANTS`, the crown detail per quality), `src/render/kit/flowers.ts` (export `flowerGeometry`) — exports only, no behaviour change. (The arena's ground and water compose `terrainMaterial(...)` / `waterMaterial(...)`'s returned options, which carry their hooks: those modules are not touched.)
- `src/render/overworld/overworldView.ts` — uses `timeOfDay()` (output identical).
- `src/game/state.ts` — `trainerClass`, `mapBattleScene`, `mapType` read in battle.
- `tools/gen-symbols.ts` (+ regenerated `src/game/symbols.ts`), `src/main.ts` (`?battle=`, `emu.gbaPng()`), `tools/regress-live.ts`, `README.md`, `CLAUDE.md`.

---

### Task 1: Battle entries in the live harness + `p3-base` baseline

Today the harness has one battle shot. This task adds battle save-state entries covering the intro, a move animation, a grass battle, entering a battle from the overworld and playing the first battle back to Route 101, records what today's battle costs (draw calls, programs compiled on entry, slowest frames), and captures the Phase 3 baseline in both styles.

Save states in `out/` (probed): `battle1.state` (battle, environment 9 PLAIN, first battle Torchic vs Zigzagoon, move menu), `s28.state` (same battle, intro: battlers sliding in, BLDALPHA blend on), `fuzz.state` (environment 0 GRASS, wild Wurmple), `wild_transition.state` (overworld battle transition into PLAIN). No state reaches any other environment: Task 3's static preview covers them.

**Files:**
- Modify: `tools/regress-live.ts`, `src/main.ts`

**Interfaces:**
- Produces (page, manual mode): `emu.gbaPng(): string` — PNG data URL of the PPU's current frame (`gba.ppu.framebuffer`, 240×160 RGBA8 as bytes — the words ScreenView uploads), upscaled 2× nearest on a canvas.
- Produces (harness): `LiveEntry.sceneChange?: 'record' | 'gate'` — a walk between scenes (battle entry/exit): its steps after the first (an idle settle of ≥ 30 frames) run drained frame by frame exactly like the hitch fix's `crossings` entries and record, into stats `sceneChange`, `{ frames: { max, at, median, slowest: number[] }, programs: [afterSettle, end] }`; with `'gate'` the entry fails when a program compiles during the walk or a frame exceeds `SCENE_CHANGE_MS = 150`.
- Produces (harness): `--battles` = the live entries whose name starts with `battle` plus (from Task 3) the static battle entries; every live battle entry also saves `gba_<entry>.png` (`emu.gbaPng()` after the steps).
- Produces (harness): `const repeat = (n: number, steps: [string, number][]): [string, number][] => Array.from({ length: n }, () => steps).flat();`

- [ ] **Step 1: Add the entries.** Frame counts are starting values: tune them so each scene matches its comment and record the final numbers in the file.

```ts
  { name: 'battle', state: 'out/battle1.state', steps: [['', 30]] },        // (existing) PLAIN: Torchic vs Zigzagoon, move menu
  { name: 'battle_intro', state: 'out/s28.state', steps: [['', 40]] },      // first battle's intro: both battlers sliding in
  { name: 'battle_grass', state: 'out/fuzz.state', steps: [['', 30]] },     // GRASS: wild Wurmple
  // Scratch: Torchic's lunge and the claw effect sprite on Zigzagoon at the shot (animActive)
  { name: 'battle_move', state: 'out/battle1.state', steps: [['', 20], ['A', 2], ['', 70]] },
  // overworld transition → the battle's first 60 frames (record today's entry cost; gated from Task 4)
  { name: 'battle_enter', state: 'out/wild_transition.state', steps: [['', 30], ['', 330]], sceneChange: 'record' },
  // the first battle played to its end (Zigzagoon faints) and back on Route 101 (≥ 30 overworld frames at the shot)
  { name: 'battle_exit', state: 'out/battle1.state', steps: [['', 20], ...repeat(45, [['A', 2], ['', 38]])], sceneChange: 'record' },
```

- [ ] **Step 2: Implement** `sceneChange` by sharing the crossing entries' drained loop and stats code (one helper for both; a sceneChange walk checks programs and frame times, not world builds), `--battles`, `gba_<entry>.png`, and `emu.gbaPng()` in `exposeManual` (`new ImageData(new Uint8ClampedArray(gba.ppu.framebuffer.buffer.slice(0)), 240, 160)` → canvas → 2× canvas with `imageSmoothingEnabled = false` → `toDataURL()`).
- [ ] **Step 3: Tune the steps** with a probe script `.scratch/p3_battle_probe.ts` (load a state with `Gba.loadState`, step frames with `keyMask`, print per frame `GameState.scene`, `animActive`, and the sprites' templates/screen positions — as `tests/smoke/state.test.ts` does): `battle_move` ends with `animActive` true and a sprite that is neither a battler (`template === SYM.gMultiuseSpriteTemplate`) nor a HUD sprite on screen; `battle_enter` ends ≥ 60 frames after its first `battle` frame; `battle_exit` ends ≥ 30 frames after its first `overworld` frame. Record the frames that matter in the entry comments.
- [ ] **Step 4: Determinism.** `npm run regress:live -- --label p3det1 --battles` then `--label p3det2 --battles --compare p3det1` → 0.00 % on every battle entry, both styles.
- [ ] **Step 5: Baseline.** `npm run regress:live -- --label p3-base --gpu` (every live entry, both styles), then `npm run regress:live -- --label p3chk --only battle,transition --compare p2-base` → Retro 0.00 % (if not, find why and report it: the hitch fix must not have changed battles). Report per battle entry and style: calls, triangles, programs; for `battle_enter` / `battle_exit`: programs compiled during the walk and the five slowest drained frames — today's battle costs, which later tasks improve on.
- [ ] **Step 6: Typecheck, test, commit.** `npx tsc --noEmit && npm test`; `git add tools/regress-live.ts src/main.ts && git commit -m "tools: battle save-state entries (intro, move, grass, entry, exit), GBA frame dumps, scene-change walks"`

**Gates:** Retro — `battle`/`transition` 0.00 % vs `p2-base` (no renderer code changed). Programs — none new; `battle_enter`/`battle_exit` *record* today's compiles (gated from Task 4).

**Acceptance:** six battle entries deterministic in both styles; `p3-base` captured; today's battle numbers in the report.

---

### Task 2: Arena kinds, battle graphics from the ROM, background colours

Pure logic and ROM decoding, no rendering yet: which background the GBA draws (`arenaKind`), the BG3 picture as the GBA shows it, the colours an arena takes from it, and the ROM data the static preview needs (backgrounds, Pokémon pictures, positions).

Measured on the ROM's backgrounds (BG3: 64×32 tilemap at screen base 26, tiles at char base 2, palettes 2–4, `BG3CNT = 0x5a0b`): every background is a pale striped backdrop with a darker hue in rows 0–5 and the enemy platform as an ellipse centred (176, 64), radii ≈ 62 × 15, a fill colour, a rim ring and a few detail pixels; the player platform is cut by the text box. Emerald's E4 rooms share one backdrop and differ by platform colour; `pond`'s rim is the lily-pad green; `rayquaza`'s platform is a pale cloud blue.

**Files:**
- Create: `src/render/battle/arenaKind.ts`, `src/render/battle/bgSample.ts`, `src/game/rom/battleGraphics.ts`, `tests/arenaKind.test.ts`, `tests/bgSample.test.ts`, `tests/smoke/battleGraphics.test.ts`
- Modify: `tools/gen-symbols.ts` (WANTED += `gBattleEnvironmentTiles_{TallGrass,LongGrass,Sand,Underwater,Water,PondWater,Rock,Cave,Building,Stadium,Rayquaza}`, `gBattleEnvironmentTilemap_{same}`, `gBattleEnvironmentPalette_{TallGrass,LongGrass,Sand,Underwater,Water,PondWater,Rock,Cave,Building,Plain,Frontier,BuildingGym,BuildingLeader,StadiumMagma,StadiumAqua,StadiumSidney,StadiumPhoebe,StadiumGlacia,StadiumDrake,StadiumWallace,Groudon,Kyogre,Rayquaza}`, `gMonFrontPicCoords`, `gMonBackPicCoords`, `gEnemyMonElevation`, `gSpriteTemplate_EnemyShadow`, `gEnemyMonShadow_Gfx`, `gBattleInterface_BallStatusBarPal`; then `npm run symbols`), `src/game/state.ts`

**Interfaces:**
- Produces (`arenaKind.ts`; constants from `include/constants/battle.h`, `trainers.h`, `map_types.h`):
  ```ts
  export type ArenaKind = 'grass' | 'longGrass' | 'sand' | 'underwater' | 'water' | 'pond' | 'mountain' | 'cave' | 'building'
    | 'plain' | 'cavePond' | 'gym' | 'leader' | 'frontier' | 'magma' | 'aqua' | 'sidney' | 'phoebe' | 'glacia' | 'drake'
    | 'champion' | 'groudon' | 'kyogre' | 'rayquaza';
  export const ARENA_KINDS: readonly ArenaKind[];                  // all 24, in this order
  export const ENVIRONMENT_KINDS: readonly ArenaKind[];            // index = BATTLE_ENVIRONMENT_* (0..9)
  export const BATTLE_TYPE = { LINK: 1 << 1, TRAINER: 1 << 3, EREADER_TRAINER: 1 << 11, RECORDED_LINK: 1 << 25,
    FRONTIER: (1 << 8) | (1 << 16) | (1 << 17) | (1 << 18) | (1 << 19) | (1 << 20) | (1 << 21),
    GROUDON: 1 << 28, KYOGRE: 1 << 29, RAYQUAZA: 1 << 30 } as const;
  export const TRAINER_CLASS = { LEADER: 0x20, CHAMPION: 0x26 } as const;
  export const MAP_BATTLE_SCENE = { NORMAL: 0, GYM: 1, MAGMA: 2, AQUA: 3, SIDNEY: 4, PHOEBE: 5, GLACIA: 6, DRAKE: 7, FRONTIER: 8 } as const;
  export const MAP_TYPE_UNDERGROUND = 4;
  export interface ArenaInputs { environment: number; battleType: number; trainerClass: number; mapBattleScene: number; mapType: number }
  /** battle_bg.c DrawMainBattleBackground: link/frontier/e-reader/recorded-link → frontier; Groudon; Kyogre; Rayquaza;
   *  a trainer battle against a Leader / the Champion; the map's battle scene; the environment (out of range: plain);
   *  a pond in an underground map → cavePond. */
  export function arenaKind(i: ArenaInputs): ArenaKind;
  /** Inputs that make arenaKind return `kind` (the static preview's). */
  export function arenaInputsFor(kind: ArenaKind): ArenaInputs;
  export interface ArenaBackground { tiles: string; tilemap: string; palette: string }   // SYM names
  export const ARENA_BACKGROUND: Readonly<Record<ArenaKind, ArenaBackground>>;
  export type ArenaSetting = 'outdoor' | 'water' | 'underwater' | 'cave' | 'indoor' | 'sky';
  /** outdoor: grass, longGrass, plain, sand, mountain; water: water, pond; underwater; cave: cave, cavePond, groudon,
   *  kyogre (Marine Cave); indoor: building, gym, leader, frontier, magma, aqua, sidney, phoebe, glacia, drake, champion;
   *  sky: rayquaza (Sky Pillar). */
  export const ARENA_SETTING: Readonly<Record<ArenaKind, ArenaSetting>>;
  ```
- Produces (`bgSample.ts`; `RGB` = sRGB triple from `kit/palette.ts`):
  ```ts
  export const BG_W = 240, BG_H = 160;
  export const ENEMY_PLATFORM = { cx: 176, cy: 64, rx: 62, ry: 15 };
  /** BG3 as the GBA shows it at scroll 0: BGR555 per pixel, transparent pixels the backdrop colour pal[0]. `vram`: bus VRAM
   *  bytes; `pal`: ≥ 256 BG colours; `bgcnt`: BG3CNT (char base, screen base, screen size 1 = 64×32: tiles x ≥ 32 in the
   *  second 2 KB block). */
  export function decodeBg3(vram: Uint8Array, pal: Uint16Array, bgcnt: number, out?: Uint16Array): Uint16Array;
  export interface ArenaColors { backdrop: RGB; stripe: RGB; top: RGB; platform: RGB; platformDetail: RGB; rim: RGB }
  /** Most frequent colours of: rows 0–5 (top), rows 10–44 (backdrop, second = stripe), the enemy ellipse's inner half
   *  (e ≤ 0.5: platform, second = detail) and its ring (0.7 ≤ e ≤ 1: rim; its second colour when the first is the fill).
   *  null when it is no battle background yet: platform and backdrop within 0.03 of each other (one colour, black). */
  export function sampleArenaColors(img: Uint16Array): ArenaColors | null;
  /** Hand-picked fallbacks per kind (used until the live background is valid, and by the drift guard). */
  export function defaultArenaColors(kind: ArenaKind): ArenaColors;
  export function colorsKey(c: ArenaColors): string;   // the six colours, 3 decimals
  ```
- Produces (`battleGraphics.ts`):
  ```ts
  export interface BattleBackgroundGfx { tiles: Uint8Array; tilemap: Uint8Array; palette: Uint16Array /* 48: BG palettes 2–4 */ }
  export function readBattleBackground(rom: RomReader, kind: ArenaKind): BattleBackgroundGfx;   // LZ77 ×3, via ARENA_BACKGROUND
  export const BG3CNT_BATTLE = 0x5a0b;
  /** Lays it out as LoadBattleTextboxAndBackground does: tiles at 0x8000, tilemap at 0xD000, palettes into pal[32..79];
   *  returns the BG3CNT to decode it with. */
  export function installBattleBackground(gfx: BattleBackgroundGfx, vram: Uint8Array, pal: Uint16Array): number;
  export interface MonPic { tiles: Uint8Array /* 2048: 64×64 4bpp, frame 0 */; palette: Uint16Array /* 16 */; yOffset: number; elevation: number }
  /** gMonFrontPicTable / gMonBackPicTable[species] (CompressedSpriteSheet, 8 bytes: data, size, tag; front pics hold two
   *  frames — frame 0 = first 2048 bytes), gMonPaletteTable (CompressedSpritePalette, 8 bytes), gMon{Front,Back}PicCoords
   *  (MonCoords padded to 4 bytes: size u8, y_offset u8), gEnemyMonElevation (u8 per species; back pics: 0). */
  export function readMonPic(rom: RomReader, species: number, side: 'front' | 'back'): MonPic;
  /** Sprite top-left as the game creates a battler: sBattlerCoords[double][position] (singles {72,80},{176,40},{48,40},
   *  {112,80}; doubles {32,80},{200,40},{90,88},{152,32}) − 32, y + yOffset − elevation on the enemy side (odd positions). */
  export function battlerScreenPos(pic: MonPic, position: number, double: boolean): { x: number; y: number };
  /** The floating enemy's shadow: gEnemyMonShadow_Gfx (LZ77, 32×8 4bpp) and its palette (gBattleInterface_BallStatusBarPal,
   *  the healthbox palette its tag 0xD6FF names). */
  export function readEnemyShadow(rom: RomReader): { tiles: Uint8Array; palette: Uint16Array };
  ```
- Produces (`state.ts`, read in `readBattle`): `trainerClass` (when `battleType & 8` and `gTrainerBattleOpponent_A < SYM_SIZE.gTrainers / 0x28`: `u8 @ gTrainers + opp*0x28 + 1`, else 0), `mapBattleScene` (`u8 @ gMapHeader + 0x1b`), `mapType` (`u8 @ gMapHeader + 0x17`).

- [ ] **Step 1: Write the failing tests** `tests/arenaKind.test.ts`

```ts
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
```

  and `tests/bgSample.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { decodeBg3, sampleArenaColors, colorsKey, defaultArenaColors, BG_W, BG_H, ENEMY_PLATFORM } from '../src/render/battle/bgSample';
import { bgr555ToSrgb } from '../src/render/kit/palette';
import { ARENA_KINDS } from '../src/render/battle/arenaKind';

const bgr = (r: number, g: number, b: number) => r | (g << 5) | (b << 10);
const BACK = bgr(26, 30, 26), LINE = bgr(28, 31, 26), TOP = bgr(22, 28, 18), FILL = bgr(15, 26, 16), RIM = bgr(21, 30, 14), DOT = bgr(17, 28, 16);
/** A synthetic battle background: top band, striped backdrop, the enemy platform (fill with dots, rim ring). */
function picture(): Uint16Array {
  const img = new Uint16Array(BG_W * BG_H);
  for (let y = 0; y < BG_H; y++) for (let x = 0; x < BG_W; x++) {
    const e = ((x - ENEMY_PLATFORM.cx) / ENEMY_PLATFORM.rx) ** 2 + ((y - ENEMY_PLATFORM.cy) / ENEMY_PLATFORM.ry) ** 2;
    img[y * BG_W + x] = y < 6 ? TOP : e <= 0.75 ? ((x * 7 + y * 3) % 23 === 0 ? DOT : FILL) : e <= 1 ? RIM : y % 4 === 0 ? LINE : BACK;
  }
  return img;
}

describe('sampleArenaColors', () => {
  it('finds the backdrop, its stripes, the top band and the platform colours', () => {
    const c = sampleArenaColors(picture())!;
    expect(c.backdrop).toEqual(bgr555ToSrgb(BACK));
    expect(c.stripe).toEqual(bgr555ToSrgb(LINE));
    expect(c.top).toEqual(bgr555ToSrgb(TOP));
    expect(c.platform).toEqual(bgr555ToSrgb(FILL));
    expect(c.platformDetail).toEqual(bgr555ToSrgb(DOT));
    expect(c.rim).toEqual(bgr555ToSrgb(RIM));
  });
  it('rejects a picture that is no battle background yet', () => {
    expect(sampleArenaColors(new Uint16Array(BG_W * BG_H))).toBeNull();            // black: BG3 not loaded
    expect(sampleArenaColors(new Uint16Array(BG_W * BG_H).fill(BACK))).toBeNull();   // one colour
  });
  it('keys colours by value and has a fallback for every kind', () => {
    expect(colorsKey(sampleArenaColors(picture())!)).toBe(colorsKey(sampleArenaColors(picture())!));
    expect(colorsKey(defaultArenaColors('grass'))).not.toBe(colorsKey(defaultArenaColors('sand')));
    for (const k of ARENA_KINDS) expect(defaultArenaColors(k).platform).toHaveLength(3);
  });
});

describe('decodeBg3', () => {
  it('decodes 4bpp tiles through the 64x32 tilemap with flips, palettes and the backdrop colour', () => {
    const vram = new Uint8Array(0x18000), pal = new Uint16Array(256);
    pal[0] = bgr(0, 0, 31); pal[2 * 16 + 1] = bgr(31, 0, 0);
    vram[0x8000 + 3 * 32] = 0x01;                       // tile 3 (char base 2): pixel (0,0) = colour 1
    vram[0xd000] = 3; vram[0xd001] = 0x20;              // entry (0,0): tile 3, palette 2
    vram[0xd002] = 3; vram[0xd003] = 0x24;              // entry (1,0): tile 3, h-flipped
    const img = decodeBg3(vram, pal, 0x5a0b);
    expect(img[0]).toBe(bgr(31, 0, 0));
    expect(img[1]).toBe(bgr(0, 0, 31));                 // transparent → backdrop
    expect(img[15]).toBe(bgr(31, 0, 0));                // flipped: its pixel 7
  });
});
```

  and `tests/smoke/battleGraphics.test.ts` (writes `out/battle-bg/<kind>.png` with `tools/lib/png.ts` `encodePng` and `out/battle-colors.txt`, one line per kind, for the report):

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { RomReader } from '../../src/game/rom/reader';
import { loadRom } from './helpers/staticMap';
import { ARENA_KINDS, arenaKind, type ArenaKind } from '../../src/render/battle/arenaKind';
import { decodeBg3, sampleArenaColors, type ArenaColors } from '../../src/render/battle/bgSample';
import { readBattleBackground, installBattleBackground, readMonPic, battlerScreenPos, readEnemyShadow } from '../../src/game/rom/battleGraphics';
import { Gba } from '../../src/gba/gba';
import { GameState } from '../../src/game/state';

const root = path.resolve(import.meta.dirname, '../..');
describe('battle graphics from the ROM', () => {
  const rom = new RomReader(loadRom());
  const colors = new Map<ArenaKind, ArenaColors>();
  it('decodes every arena kind\'s background into a valid colour set', () => {
    for (const kind of ARENA_KINDS) {
      const gfx = readBattleBackground(rom, kind);
      expect(gfx.tiles.length, kind).toBeGreaterThanOrEqual(0x1000);
      const vram = new Uint8Array(0x18000), pal = new Uint16Array(512);
      const c = sampleArenaColors(decodeBg3(vram, pal, installBattleBackground(gfx, vram, pal)));
      expect(c, kind).not.toBeNull();
      colors.set(kind, c!);
    }
    // (also: out/battle-bg/<kind>.png at 2x and out/battle-colors.txt)
  });
  it('samples the colours each kind is known for', () => {
    const green = (c: number[]) => c[1] > c[0] && c[1] > c[2];
    const blue = (c: number[]) => c[2] > c[0] + 0.2;
    expect(green(colors.get('grass')!.platform) && green(colors.get('longGrass')!.platform)).toBe(true);
    for (const k of ['water', 'pond', 'kyogre'] as const) expect(blue(colors.get(k)!.platform), k).toBe(true);
    expect(green(colors.get('pond')!.rim)).toBe(true);                                        // lily pads
    expect(colors.get('magma')!.platform[0]).toBeGreaterThan(colors.get('magma')!.platform[2] + 0.4); // orange
  });
  it('places battlers where the game does', () => {
    expect(battlerScreenPos(readMonPic(rom, 280, 'back'), 0, false)).toEqual({ x: 40, y: 53 });   // Torchic (battle1.state)
    expect(battlerScreenPos(readMonPic(rom, 288, 'front'), 1, false)).toEqual({ x: 144, y: 23 }); // Zigzagoon
    expect(battlerScreenPos(readMonPic(rom, 290, 'front'), 1, false)).toEqual({ x: 144, y: 22 }); // Wurmple (fuzz.state)
    expect(readMonPic(rom, 41, 'front').elevation).toBe(8);                                      // Zubat floats
    expect(readMonPic(rom, 280, 'back').tiles).toHaveLength(2048);
    expect(readEnemyShadow(rom).tiles).toHaveLength(128);
  });
  it('reads the arena inputs of a live battle', () => {
    const gba = new Gba(new Uint8Array(loadRom()));
    gba.loadState(new Uint8Array(fs.readFileSync(path.join(root, 'out/battle1.state'))));
    for (let i = 0; i < 2; i++) gba.runFrame();
    const st = new GameState(gba.bus);
    st.update();
    expect([st.battleEnvironment, st.trainerClass, st.mapBattleScene]).toEqual([9, 0, 0]);
    expect(arenaKind({ environment: st.battleEnvironment, battleType: st.battleType, trainerClass: st.trainerClass,
      mapBattleScene: st.mapBattleScene, mapType: st.mapType })).toBe('plain');
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/arenaKind.test.ts tests/bgSample.test.ts` and the smoke file → FAIL (modules missing).
- [ ] **Step 3: Implement.** `arenaKind` exactly as the C (precedence in the docstring); `arenaInputsFor`: environment kinds → `{ environment: index }`, `cavePond` → `{ environment: 5, mapType: 4 }`, `gym` → `{ environment: 8, battleType: TRAINER, mapBattleScene: GYM }`, `leader` → `{ …, trainerClass: LEADER }`, `champion` → `{ environment: 8, battleType: TRAINER, trainerClass: CHAMPION }`, `frontier` → `{ environment: 8, battleType: 1 << 8 }`, `magma`…`drake` → their map scene with environment 8, `groudon`/`kyogre`/`rayquaza` → their battle type flag (others 0, mapType 3). `sampleArenaColors`:

```ts
const ellipse = (x: number, y: number) =>
  ((x - ENEMY_PLATFORM.cx) / ENEMY_PLATFORM.rx) ** 2 + ((y - ENEMY_PLATFORM.cy) / ENEMY_PLATFORM.ry) ** 2;
/** Colours of the pixels `inside` selects, most frequent first. */
function ranked(img: Uint16Array, inside: (x: number, y: number) => boolean): number[] {
  const counts = new Map<number, number>();
  for (let y = 0; y < BG_H; y++) for (let x = 0; x < BG_W; x++) {
    if (!inside(x, y)) continue;
    const c = img[y * BG_W + x];
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([c]) => c);
}
export function sampleArenaColors(img: Uint16Array): ArenaColors | null {
  const top = ranked(img, (_x, y) => y < 6), back = ranked(img, (_x, y) => y >= 10 && y < 45);
  const plat = ranked(img, (x, y) => ellipse(x, y) <= 0.5);
  const ring = ranked(img, (x, y) => { const e = ellipse(x, y); return e >= 0.7 && e <= 1; });
  const c = bgr555ToSrgb;
  const near = (a: number, b: number) => Math.max(...c(a).map((v, i) => Math.abs(v - c(b)[i]))) < 0.03;
  if (!top.length || !back.length || !plat.length || !ring.length || near(plat[0], back[0])) return null;
  const rim = ring[0] === plat[0] ? (ring[1] ?? ring[0]) : ring[0];
  return { backdrop: c(back[0]), stripe: c(back[1] ?? back[0]), top: c(top[0]), platform: c(plat[0]),
    platformDetail: c(plat[1] ?? plat[0]), rim: c(rim) };
}
```

  `defaultArenaColors` (hand-picked sRGB hex: backdrop / top / platform / rim; stripe = backdrop, detail = platform): grass `e0f4dc b8e098 78cc80 a8e870`, longGrass `b0e0b4 88c858 50a860 70d080`, sand `f4f0c8 e8e080 d0cc60 e8e890`, underwater `c8dcf8 98a8e8 8088c0 98c0f0`, water `f4f4fc d0dcf0 5890d8 98d0ec`, pond and cavePond `f4f4fc dce4e4 60a0e0 a0f060`, mountain `f4f4fc dce4e4 b8a888 d0d0a8`, cave `c4a878 a88850 c8c060 a08858`, building `f4f4f4 f0f0a0 d8c4a0 e8d8b0`, plain `e4f8d0 a8d8f0 98e098 e0e090`, gym and leader `f4f4f4 d0bc94 ccbc94 dcd4a8`, frontier `f4f4fc dce4e4 bcbc9c d4d4c4`, magma `ccc4d4 8c8c8c dc6c08 9c949c`, aqua `cceef4 44a4d4 4484d4 84c4fc`, sidney `c4ece4 44ac9c dcc494 f4dcac`, phoebe `c4ece4 44ac9c c49ccc e4ccec`, glacia `c4ece4 44ac9c 8cacec b4d4fc`, drake `c4ece4 44ac9c f49c5c c4c4c4`, champion `cceef4 44a4d4 44acac 84ecd4`, groudon `ece4b4 d47420 dcd46c b49c6c`, kyogre `ece4b4 ac8c54 5c94dc 94d4ec`, rayquaza `e4f4fc a4d4fc dce4fc 94ccfc`. `decodeBg3`: as the GBA (4bpp; tile = entry & 0x3ff; flips 0x400/0x800; palette entry >> 12; colour 0 transparent → pal[0]). ROM readers via `SYM` + `RomReader.lz77`. `state.ts` fields as in Interfaces.
- [ ] **Step 4: Run** the unit and smoke tests → PASS; `npx tsc --noEmit && npm test` → PASS. Look at `out/battle-bg/*.png`: 24 pictures, each a striped backdrop with two platform ellipses.
- [ ] **Step 5: Gates and commit.** `npm run regress:live -- --label t2 --battles --compare p3-base` → 0.00 % on every entry in both styles. `git add src/render/battle/arenaKind.ts src/render/battle/bgSample.ts src/game/rom/battleGraphics.ts tests/arenaKind.test.ts tests/bgSample.test.ts tests/smoke/battleGraphics.test.ts tools/gen-symbols.ts src/game/symbols.ts src/game/state.ts && git commit -m "feat(battle): arena kinds as the GBA picks its background; BG3 decode and colour sampling; battle graphics from the ROM"`

**Gates:** Retro — 0.00 % on every battle entry (only new `GameState` fields read). Programs — unchanged (no rendering code).

**Acceptance:** tests pass; 24 backgrounds decoded and sampled; battler positions match the live states.

---
### Task 3: Static battle preview, GBA references, review sheet

No save state reaches 21 of the 24 arena kinds, double battles or floating Pokémon. The battle preview (`/?battle=<kind>`) lays the kind's BG3 picture and the battlers' ROM pictures into scratch "hardware" exactly as the game does and drives today's `BattleView` through the live path, so every kind renders deterministically in both styles; the harness saves the GBA's own composite beside each shot and builds the review sheet every later task reads.

**Files:**
- Create: `src/render/battlePreview.ts`, `tests/battlePreview.test.ts`
- Modify: `src/main.ts` (`?battle=` dispatch next to `?map=`), `tools/regress-live.ts` (`STATIC_BATTLE`, `ref_<entry>.png`, `--review`, `--review-before <label>`)

**Interfaces:**
- Consumes: `arenaInputsFor`, `ARENA_KINDS` (Task 2); `readBattleBackground`, `installBattleBackground`, `readMonPic`, `battlerScreenPos`, `readEnemyShadow` (Task 2); `blankSprite` (`previewActors.ts`).
- Produces (`battlePreview.ts`):
  ```ts
  export interface PreviewBattler { pic: MonPic; position: number }   // B_POSITION_* 0..3 (even: player side)
  /** The battlers' sprites as the game creates them (gMultiuseSpriteTemplate, 64×64 affine OAM, 4bpp, 1D tiles: battler i
   *  at tile 64·i, OBJ palette slot = its position) and, under a floating enemy at position 1 (elevation > 0), the shadow
   *  sprite (gSpriteTemplate_EnemyShadow, 32×8, top-left (160, 65) in singles, tiles after the battlers, palette slot 4). */
  export function previewBattleSprites(battlers: readonly PreviewBattler[], double: boolean): SpriteSnap[];
  export class BattlePreviewApp {
    constructor(canvas: HTMLCanvasElement, rom: Uint8Array, kind: ArenaKind, params: URLSearchParams);
    frames(n: number): void;            // n frames at 1/60 s
    renderStill(): void;                // one frame, no time step (the mask shot)
    gpuFrames(n: number): Promise<GpuTiming>;
    stats(): { calls: number; triangles: number; programs: number; buildMs: number };
    /** The GBA's own picture: BG3 + the battler sprites at their screen positions (CPU composite), 2× PNG data URL. */
    referencePng(): string;
    setStyle(s: WorldStyle): void;      // the battle's world style (harness --ab-feature battle, Task 4)
  }
  ```
  URL: `/?battle=<kind>&player=<species>&enemy=<species>[&double=1&player2=<species>&enemy2=<species>][&hour=11][&style=modern|retro][&quality=…][&spriteFilter=…][&manual=1][&yaw=<rad>]`. Scratch hardware: `new Bus(rom)`; `installBattleBackground` into `bus.vram` and BG palettes; `bus.io16[0x0e >> 1] = BG3CNT_BATTLE`, `bus.io16[0] = 0xbf40` (OBJ 1D mapping, as live battles); battler tiles at `0x10000 + tile * 32`, palettes into OBJ palette slots (`pram16[256 + slot * 16]`); every palette written also into the EWRAM unfaded buffer at `(SYM.gPlttBufferUnfaded & 0x3ffff) >> 1` (BattleView samples the background there); fake `GameState`: `{ mem: new Mem(bus), sprites, battleEnvironment, battleType, trainerClass, mapBattleScene, mapType, hours, minutes, animActive: false, target: 0, battlers: [] }` from `arenaInputsFor(kind)` and `&hour`. Frame: `spriteAtlas.update(webgl, sprites, false)` → `battle.update(state, dt, { yaw, pitch: 0, zoom }, [])` → `post.render(dt)` (PostFX on the battle scene).
- Produces (harness), run with `--static` or `--battles`; each: `/?battle=…&manual=1&<q>&style=…`, `preview.frames(150)` (the battle camera's 2.2 s intro sweep has ended), screenshot, `preview.stats()`, `ref_<entry>.png` from `preview.referencePng()`:
  ```ts
  const STATIC_BATTLE: StaticEntry[] = [   // species: internal ids (include/constants/species.h)
    { name: 'b_grass', q: 'battle=grass&player=280&enemy=288' },          // Torchic vs Zigzagoon
    { name: 'b_grass_night', q: 'battle=grass&player=280&enemy=288&hour=21' },
    { name: 'b_double', q: 'battle=grass&double=1&player=280&player2=277&enemy=288&enemy2=286' },
    { name: 'b_longgrass', q: 'battle=longGrass&player=277&enemy=286' },  // Treecko vs Poochyena
    { name: 'b_plain', q: 'battle=plain&player=280&enemy=288' },
    { name: 'b_sand', q: 'battle=sand&player=283&enemy=332' },            // Mudkip vs Trapinch
    { name: 'b_water', q: 'battle=water&player=283&enemy=72' },           // vs Tentacool
    { name: 'b_water_night', q: 'battle=water&player=283&enemy=309&hour=21' }, // vs Wingull
    { name: 'b_pond', q: 'battle=pond&player=277&enemy=311' },            // vs Surskit
    { name: 'b_underwater', q: 'battle=underwater&player=283&enemy=330' }, // vs Carvanha
    { name: 'b_mountain', q: 'battle=mountain&player=280&enemy=74' },     // vs Geodude
    { name: 'b_cave', q: 'battle=cave&player=280&enemy=41' },             // vs Zubat (floating: shadow sprite)
    { name: 'b_cavepond', q: 'battle=cavePond&player=283&enemy=129' },    // vs Magikarp
    { name: 'b_building', q: 'battle=building&player=277&enemy=337' },    // vs Electrike
    { name: 'b_gym', q: 'battle=gym&player=281&enemy=74' },
    { name: 'b_leader', q: 'battle=leader&player=281&enemy=320' },        // vs Nosepass
    { name: 'b_frontier', q: 'battle=frontier&player=400&enemy=397' },    // Metagross vs Salamence
    { name: 'b_magma', q: 'battle=magma&player=284&enemy=340' },          // vs Camerupt
    { name: 'b_aqua', q: 'battle=aqua&player=281&enemy=331' },            // vs Sharpedo
    { name: 'b_sidney', q: 'battle=sidney&player=281&enemy=287' },        // vs Mightyena
    { name: 'b_phoebe', q: 'battle=phoebe&player=281&enemy=361' },        // vs Duskull
    { name: 'b_glacia', q: 'battle=glacia&player=281&enemy=341' },        // vs Spheal
    { name: 'b_drake', q: 'battle=drake&player=281&enemy=397' },          // vs Salamence
    { name: 'b_champion', q: 'battle=champion&player=281&enemy=329' },    // vs Milotic
    { name: 'b_groudon', q: 'battle=groudon&player=284&enemy=405' },
    { name: 'b_kyogre', q: 'battle=kyogre&player=284&enemy=404' },
    { name: 'b_rayquaza', q: 'battle=rayquaza&player=284&enemy=406' },
  ];
  ```
- Produces (harness): `--review` writes `_review_battle.png`: one row per battle entry in the run (live `battle*`, static `b_*`), columns **GBA** (static: `ref_<entry>.png`; live: `gba_<entry>.png`) | **before** (`out/regress-live/<--review-before>/<entry>_modern.png`, blank without the flag) | **Modern** | **Retro** (this run), each cell 480×300 letterboxed, entry name and column labels drawn in, built in-page like the existing sheets.

- [ ] **Step 1: Write the failing test** `tests/battlePreview.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { previewBattleSprites } from '../src/render/battlePreview';
import { SYM } from '../src/game/symbols';
import type { MonPic } from '../src/game/rom/battleGraphics';

const pic = (yOffset: number, elevation = 0): MonPic => ({ tiles: new Uint8Array(2048), palette: new Uint16Array(16), yOffset, elevation });

describe('previewBattleSprites', () => {
  it('places single battlers as the game does, with their tiles and palettes', () => {
    const s = previewBattleSprites([{ pic: pic(5), position: 0 }, { pic: pic(15), position: 1 }], false);
    expect(s.map((x) => [x.screenX, x.screenY, x.tileNum, x.palette, x.width, x.height])).toEqual(
      [[40, 53, 0, 0, 64, 64], [144, 23, 64, 1, 64, 64]]);
    expect(s.every((x) => x.template === SYM.gMultiuseSpriteTemplate && x.affine && !x.coordOffset)).toBe(true);
  });
  it('adds the shadow sprite under a floating enemy', () => {
    const s = previewBattleSprites([{ pic: pic(5), position: 0 }, { pic: pic(6, 8), position: 1 }], false);
    expect(s[1].screenY).toBe(40 + 6 - 8 - 32);
    expect(s[2]).toMatchObject({ template: SYM.gSpriteTemplate_EnemyShadow, width: 32, height: 8, screenX: 160, screenY: 65, palette: 4, tileNum: 128 });
  });
  it('places four battlers in a double battle', () => {
    const s = previewBattleSprites([0, 1, 2, 3].map((position) => ({ pic: pic(0), position })), true);
    expect(s.map((x) => [x.screenX, x.screenY])).toEqual([[0, 48], [168, 8], [58, 56], [120, 0]]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/battlePreview.test.ts` → FAIL.
- [ ] **Step 3: Implement** `previewBattleSprites` (each sprite from `blankSprite({ index, template, width, height, tileNum, palette, affine: true, coordOffset: false, screenX, screenY })`, `index` = its order), `BattlePreviewApp` (as Interfaces; `referencePng` decodes BG3 with `decodeBg3` and draws each sprite's 4bpp tiles with its palette, index 0 transparent), the `?battle=` dispatch, the harness additions.
- [ ] **Step 4: Run** `npx tsc --noEmit && npm test` → PASS.
- [ ] **Step 5: Look.** `npm run regress:live -- --label t3 --battles --review` and read `_review_battle.png`: every static entry's Modern and Retro shots show today's battle look (no arena change yet) with the battlers where the GBA column draws them (platform side, height, the Zubat shadow under the floating enemy); `b_double` shows four battlers; live entries unchanged (`--compare p3-base`: 0.00 %). Then add the static baseline without touching the live one: `npm run regress:live -- --label p3-base --only <every b_* entry> --gpu` (both styles).
- [ ] **Step 6: Commit** — `git add src/render/battlePreview.ts tests/battlePreview.test.ts src/main.ts tools/regress-live.ts && git commit -m "preview: static battles of every arena kind from ROM data, GBA reference pictures, battle review sheet"`

**Gates:** Retro — live entries 0.00 % vs `p3-base`; static battle entries captured into `p3-base` (Retro = today's look). Programs — none new (today's battle path only).

**Acceptance:** 27 static battle entries render deterministically in both styles beside their GBA pictures; the review sheet works.

---

### Task 4: `BattleView` split by style, battle actors extracted, boot-time battle precompile, drift guard

Restructures the battle without changing a pixel: the reference projection moves to `stage.ts`, sprite routing and card placement to `battleActors.ts`, a `ModernArena` (no parts yet: every kind still draws today's arena) and the style switch arrive, today's arena is built only when shown, and every program the battle scene draws is compiled at boot from a battle catalogue held to the arenas by a node drift guard. After this task, entering a battle compiles nothing in either style.

**Files:**
- Create: `src/render/battle/stage.ts`, `src/render/battle/battleActors.ts`, `src/render/battle/modernArena.ts`, `src/render/battle/catalogue.ts`, `tests/battleStage.test.ts`, `tests/battleActors.test.ts`, `tests/modernArena.test.ts`, `tests/battleCatalogue.test.ts`
- Modify: `src/render/battle/battleView.ts`, `src/render/renderer.ts`, `src/render/battlePreview.ts`, `src/render/kit/catalogue.ts` (export the private `triangle` as `catalogueTriangle`), `tools/regress-live.ts` (`--ab-feature battle`; `battle_enter` / `battle_exit` → `sceneChange: 'gate'`; a static entry `b_grass_fail` = `b_grass` + `&arenaFail=ground`)

**Interfaces:**
- Produces (`stage.ts`) — moved verbatim from `BattleView.setupReference` / `rayOrigin` / `groundHit` / `depthOf` / `at` (same operations in the same order: bit-identical):
  ```ts
  export const PX = 32;
  export const REF_PITCH = THREE.MathUtils.degToRad(24);
  export const PLATFORM_PLAYER_SCREEN = { x: 64, y: 117 }, PLATFORM_ENEMY_SCREEN = { x: 176, y: 64 };
  export const GROUND_Y = -0.28;   // today's arena ground (BattleArena.group.position.y)
  export const WATER_Y = -0.06;    // Modern water surface (Task 8)
  export interface Footprint { rx: number; rz: number }
  export const PLATFORM_FOOTPRINT: { player: Footprint; enemy: Footprint } =
    { player: { rx: 2.1, rz: 2.1 * 0.62 }, enemy: { rx: 1.9, rz: 1.9 * 0.62 } };   // today's platforms
  export class Stage {
    readonly right: THREE.Vector3; readonly fwd: THREE.Vector3; readonly up: THREE.Vector3; readonly origin: THREE.Vector3;
    readonly player: THREE.Vector3; readonly enemy: THREE.Vector3; readonly centre: THREE.Vector3;  // centre: their midpoint
    readonly playerDepth: number; readonly enemyDepth: number;
    rayOrigin(sx: number, sy: number, out?: THREE.Vector3): THREE.Vector3;
    groundHit(sx: number, sy: number, out?: THREE.Vector3): THREE.Vector3;
    at(sx: number, sy: number, depth: number, out?: THREE.Vector3): THREE.Vector3;
    depthOf(p: THREE.Vector3): number;
  }
  export const STAGE: Stage;
  ```
- Produces (`battleActors.ts`):
  ```ts
  export type BattleRoute = 'skip' | 'hud' | 'card' | 'inflated' | 'decal';
  /** Today's isActor: a battler or trainer picture (gMultiuseSpriteTemplate, gBattlerSpriteTemplates[4]). */
  export function isBattler(s: SpriteSnap): boolean;
  export function isEnemyShadow(s: SpriteSnap): boolean;          // template === SYM.gSpriteTemplate_EnemyShadow
  /** invisible → skip; HUD template → hud; Retro or !inflation → card; Modern: objMode 2 (OBJ window) → skip, battler →
   *  inflated, enemy shadow → decal, else card. (Task 4 draws 'inflated' and 'decal' as cards.) */
  export function battleRoute(s: SpriteSnap, style: WorldStyle, inflation: boolean): BattleRoute;
  /** Today's card (BattleView.buildBillboards' maths, moved verbatim): visible rectangle (double-size offset, 512/256
   *  wrap), depth = player/enemy depth for battlers (cx < 120), else interpolated across xP 72 .. xE 176; height stretched
   *  by 1 / cos(REF_PITCH). */
  export function battleCardSpec(s: SpriteSnap, slot: SlotUv, stage: Stage, out?: BillboardSpec): BillboardSpec;
  export interface BattleActorsOptions { field?: { texture: THREE.Texture }; rim?: { value: THREE.Color }; instanceUniforms?: boolean }
  export class BattleActors {
    readonly group: THREE.Group;                 // cards (+ inflated actors, Task 5)
    inflation: boolean;                          // Modern battlers inflated (Task 5; the --ab-feature battlers switch)
    constructor(atlas: ActorAtlas, opts?: BattleActorsOptions);
    /** This frame's sprites, in sprite order (no allocation once warm); HUD sprites appended to `hud`. */
    update(sprites: readonly SpriteSnap[], style: WorldStyle, cameraRight: THREE.Vector3, eye: THREE.Vector3,
      charLight: THREE.Color, hud: SpriteSnap[]): void;
    counts(): { cards: number; inflated: number; decals: number };
    setSpriteFilter(f: SpriteFilter): void; setMask(on: boolean): void; showAll(): () => void;
    checkInstanceUniforms(programs: readonly ProgramInfo[]): boolean;   // Task 5
  }
  ```
- Produces (`modernArena.ts`):
  ```ts
  /** A build's context (the kit's KitContext: disposeKit frees what it lists) — Task 6 adds `palette` and `ground`. */
  export interface ArenaContext extends KitContext { kind: ArenaKind; colors: ArenaColors; stage: Stage }
  export interface CatalogueEntry { material: KitMaterialOptions; mesh: 'mesh' | 'instanced' | 'instancedColors';
    attrs: Record<string, number>; castShadow: boolean }
  export interface ArenaPart {
    name: string;
    kinds: readonly ArenaKind[] | 'all';
    /** Every program variant it can build (the battle catalogue precompiles exactly these; `placeholder` makes textures). */
    catalogue(placeholder: () => THREE.Texture): readonly CatalogueEntry[];
    build(ctx: ArenaContext): THREE.Object3D | null;
  }
  export const ARENA_PARTS: ArenaPart[];   // [] in this task; Tasks 6–11 append
  export class ModernArena {
    readonly group: THREE.Group;
    failed: boolean;
    constructor(uniforms: KitUniforms, parts?: readonly ArenaPart[]);
    /** A part named 'ground' covers the kind: the Modern arena draws it (else the view draws today's arena). */
    covers(kind: ArenaKind): boolean;
    /** Builds the covering parts for (kind, colours, quality); a no-op when unchanged. A part that throws empties the
     *  arena, sets `failed`, warns once per kind ("[battle] arena part '<name>' failed for <kind>: the battle uses today's
     *  arena") and returns false. */
    build(kind: ArenaKind, colors: ArenaColors, quality: Quality): boolean;
    readonly lastBuildMs: number;
    dispose(): void;
  }
  ```
- Produces (`catalogue.ts`):
  ```ts
  export interface BattleCatalogue { root: THREE.Group; dispose(): void }
  /** One tiny mesh per program variant of the parts' catalogue entries (kit materials from `uniforms`' pool, deduped by
   *  programSignature) plus legacyArenaMeshes(). */
  export function battleCatalogue(src: { uniforms: KitUniforms; parts: readonly ArenaPart[] }): BattleCatalogue;
  /** Today's arena (BattleArena) built for environments 0..9 at the stage's platforms: one detached mesh per program signature. */
  export function legacyArenaMeshes(): THREE.Mesh[];
  ```
- Produces (`BattleView`): constructor `(spriteAtlas: SpriteAtlas, opts?: { instanceUniforms?: boolean })`; `quality: Quality`; `get worldStyle(): WorldStyle`; `setWorldStyle(s)`; `precompile(renderer): Promise<void>`; `get precompileReady(): boolean`; `finishPrecompile(renderer): void`; `precompileFrame: (() => void) | null`; `arenaFailPart: string | null` (the preview's `&arenaFail=<name>`: the part of that name throws; with no such part — before Task 6 — a throwing part of that name covering every kind is added, so the fallback path is exercised from this task on). Rule: the Modern arena is drawn when `worldStyle === 'modern' && modern.covers(kind) && build succeeded`; otherwise today's arena — built (`setEnvironment`, `setColors`) lazily, only while shown, with exactly today's calls and timing in Retro (the intro reset on an environment change happens in both styles).
- Produces (`Renderer`): `precompiled()` awaits the overworld's and the battle's; `finishPrecompile()` draws both frames; `render()` draws the battle precompile frame when ready while the battle is not presented, and at the first battle sync at the latest; `setWorldStyle(s)` also sets the battle's; `this.battle.quality = this.quality`; `battle.precompileFrame = () => { post.setCamera(battle.scene, battle.camera); post.render(0); }`.

- [ ] **Step 1: Write the failing tests.** `tests/battleStage.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { STAGE, PX, REF_PITCH } from '../src/render/battle/stage';

describe('the battle stage (reference projection)', () => {
  it('puts the player platform at the origin and the enemy one 1/sin(pitch) per screen unit behind', () => {
    expect(STAGE.player.length()).toBeCloseTo(0, 6);
    expect(STAGE.enemy.x).toBeCloseTo((176 - 64) / PX, 6);
    expect(STAGE.enemy.y).toBeCloseTo(0, 6);
    expect(STAGE.enemy.z).toBeCloseTo(-((117 - 64) / PX) / Math.sin(REF_PITCH), 4);   // −4.072
    expect(STAGE.centre.x).toBeCloseTo(STAGE.enemy.x / 2, 6);
  });
  it('un-projects a screen point at a depth onto its reference ray', () => {
    const p = STAGE.at(120, 80, STAGE.playerDepth);
    expect(STAGE.depthOf(p)).toBeCloseTo(STAGE.playerDepth, 6);
    expect(STAGE.groundHit(64, 117).length()).toBeCloseTo(0, 6);
  });
});
```

  `tests/battleActors.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { battleRoute, battleCardSpec, isBattler, BattleActors } from '../src/render/battle/battleActors';
import { STAGE, REF_PITCH } from '../src/render/battle/stage';
import { blankSprite } from '../src/render/previewActors';
import { SYM } from '../src/game/symbols';

const slot = { u0: 0, v0: 0.125, u1: 0.0625, v1: 0 };
const battler = (index: number, screenX: number, screenY: number) => blankSprite({ index, template: SYM.gMultiuseSpriteTemplate,
  width: 64, height: 64, affine: true, coordOffset: false, screenX, screenY });
const effect = (index: number, screenX: number) => blankSprite({ index, template: 0x08590000, width: 32, height: 32, coordOffset: false, screenX, screenY: 40 });

describe('battleCardSpec (today\'s placement)', () => {
  it('stands a battler on its side\'s depth plane, stretched by 1/cos(pitch)', () => {
    const s = battleCardSpec(battler(0, 40, 53), slot, STAGE);
    const centre = STAGE.at(72, 85, STAGE.playerDepth);
    const h = 2 / Math.cos(REF_PITCH);
    expect(s).toMatchObject({ width: 2, lift: 0, flat: false });
    expect(s.height).toBeCloseTo(h, 6);
    expect(s.footX).toBeCloseTo(centre.x, 6); expect(s.footY).toBeCloseTo(centre.y - h / 2, 6); expect(s.footZ).toBeCloseTo(centre.z, 6);
  });
  it('interpolates an effect\'s depth between the platforms and wraps screen x like the GBA', () => {
    const mid = (STAGE.playerDepth + STAGE.enemyDepth) / 2;
    expect(battleCardSpec(effect(1, 108), slot, STAGE).footZ).toBeCloseTo(STAGE.at(124, 56, mid).z, 6);
    expect(battleCardSpec(effect(1, 500), slot, STAGE).footX).toBeCloseTo(STAGE.at(-12 + 16, 56, STAGE.playerDepth).x, 6);
  });
});

describe('battleRoute', () => {
  it('Task 4: Retro and Modern both draw every visible non-HUD sprite as a card until Task 5 routes it', () => {
    expect(isBattler(battler(0, 40, 53))).toBe(true);
    expect(battleRoute(battler(0, 40, 53), 'retro', true)).toBe('card');
    expect(battleRoute(blankSprite({ invisible: true }), 'retro', true)).toBe('skip');
    expect(battleRoute(blankSprite({ template: 0x0832c140 }), 'modern', true)).toBe('hud');   // a healthbox
  });
});

describe('BattleActors', () => {
  it('draws today\'s cards in sprite order and hands HUD sprites back', () => {
    const atlas = { slots: new Map([[0, slot], [1, slot], [2, slot]]), target: { texture: new THREE.Texture() } };
    const a = new BattleActors(atlas);
    const hud: ReturnType<typeof blankSprite>[] = [];
    const hb = blankSprite({ index: 2, template: 0x0832c140 });
    a.update([battler(0, 40, 53), effect(1, 108), hb], 'retro', new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 3, 11), new THREE.Color(1, 1, 1), hud);
    expect(a.counts()).toEqual({ cards: 2, inflated: 0, decals: 0 });
    expect(hud).toEqual([hb]);
  });
});
```

  (the effect at screenX 108, 32 wide: cx = 124 → t = (124 − 72) / 104 = 0.5; at screenX 500: x = 500 − 512 = −12, cx = 4 → t = 0 → the player depth.)

  `tests/modernArena.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { ModernArena, type ArenaPart } from '../src/render/battle/modernArena';
import { createKitUniforms } from '../src/render/kit/materials';
import { defaultArenaColors } from '../src/render/battle/bgSample';

const part = (name: string, kinds: ArenaPart['kinds'], build: ArenaPart['build']): ArenaPart => ({ name, kinds, catalogue: () => [], build });

describe('ModernArena', () => {
  it('covers a kind only where a ground part does', () => {
    expect(new ModernArena(createKitUniforms(), []).covers('grass')).toBe(false);
    const a = new ModernArena(createKitUniforms(), [part('ground', ['grass'], () => new THREE.Group())]);
    expect(a.covers('grass')).toBe(true); expect(a.covers('cave')).toBe(false);
  });
  it('builds once per kind, colours and quality, and replaces the previous build', () => {
    let n = 0;
    const a = new ModernArena(createKitUniforms(), [part('ground', 'all', () => { n++; return new THREE.Group(); })]);
    expect(a.build('grass', defaultArenaColors('grass'), 'medium')).toBe(true);
    a.build('grass', defaultArenaColors('grass'), 'medium');
    expect(n).toBe(1);
    a.build('sand', defaultArenaColors('sand'), 'medium');
    expect(n).toBe(2);
    expect(a.group.children).toHaveLength(1);
  });
  it('empties itself when a part throws and warns once per kind', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = new ModernArena(createKitUniforms(), [part('ground', 'all', () => new THREE.Group()), part('trees', 'all', () => { throw new Error('boom'); })]);
    expect(a.build('grass', defaultArenaColors('grass'), 'medium')).toBe(false);
    expect(a.failed).toBe(true);
    expect(a.group.children).toHaveLength(0);
    a.build('grass', defaultArenaColors('grass'), 'high');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
```

  `tests/battleCatalogue.test.ts` (the drift guard; node, no ROM; today's arena paints its speckle textures on a canvas, stubbed here):

```ts
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { ModernArena, ARENA_PARTS } from '../src/render/battle/modernArena';
import { battleCatalogue } from '../src/render/battle/catalogue';
import { BattleArena } from '../src/render/battle/arena';
import { STAGE } from '../src/render/battle/stage';
import { ARENA_KINDS } from '../src/render/battle/arenaKind';
import { defaultArenaColors } from '../src/render/battle/bgSample';
import { createKitUniforms } from '../src/render/kit/materials';
import { meshesOf, programSignature } from '../src/render/kit/catalogue';
import type { Quality } from '../src/render/post';

function stubCanvas(): void {
  const ctx = { createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), putImageData: () => {} };
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
}

describe('battle program catalogue (drift guard)', () => {
  it('holds exactly the program variants every arena kind builds, at every quality, and today\'s arenas', () => {
    stubCanvas();
    const used = new Map<string, string>();
    const collect = (root: THREE.Object3D, at: string) => {
      for (const m of meshesOf(root)) { const s = programSignature(m); if (!used.has(s)) used.set(s, `${at}: ${m.name || m.parent?.name || '-'}`); }
    };
    const u = createKitUniforms();
    for (const quality of ['low', 'medium', 'high'] as Quality[]) for (const kind of ARENA_KINDS) {
      const arena = new ModernArena(u);
      if (!arena.covers(kind)) continue;
      expect(arena.build(kind, defaultArenaColors(kind), quality), `${kind} ${quality}`).toBe(true);
      collect(arena.group, `${kind} ${quality}`);
      arena.dispose();
    }
    for (let env = 0; env <= 9; env++) {
      const legacy = new BattleArena();
      legacy.setPlatforms(STAGE.player, STAGE.enemy);
      legacy.setEnvironment(env);
      collect(legacy.group, `today's arena, environment ${env}`);
    }
    const cat = battleCatalogue({ uniforms: createKitUniforms(), parts: ARENA_PARTS });
    const meshes = meshesOf(cat.root);
    const have = new Set(meshes.map(programSignature));
    cat.dispose();
    vi.unstubAllGlobals();
    expect([...used].filter(([s]) => !have.has(s)).map(([s, at]) => `${s}  (first on ${at})`), 'built, missing from the catalogue').toEqual([]);
    expect([...have].filter((s) => !used.has(s)), 'in the catalogue, built by no arena').toEqual([]);
    expect(meshes).toHaveLength(have.size);
    expect(meshes.every((m) => !m.frustumCulled)).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/battleStage.test.ts tests/battleActors.test.ts tests/modernArena.test.ts tests/battleCatalogue.test.ts` → FAIL.
- [ ] **Step 3: Implement** in this order, re-running the harness subset (`--only battle,battle_move --compare p3-base`) after each move so a pixel slip is caught where it happens:
  1. `stage.ts` (moved maths) and `BattleView` using `STAGE` (`arena.setPlatforms(STAGE.player, STAGE.enemy)` in the constructor as today).
  2. `battleActors.ts`: `battleCardSpec` = `buildBillboards`' body for one sprite; `BattleActors` owns today's `Billboards` (same constructor argument, added to the scene as before) and builds the list in sprite order into a reused spec pool; `BattleView.update` calls it with today's `cameraRight` / `charLight`.
  3. `modernArena.ts` (`build` loops the covering parts in `ARENA_PARTS` order inside try/catch; `dispose`/rebuild via the kit's `disposeKit(group, ctx)`; `arenaFailPart` wraps the part of that name in a throwing one), the style switch and the lazy today's-arena rule in `BattleView` (Retro: the same `setEnvironment` / `setColors` calls at the same frames as today).
  4. `catalogue.ts`: per entry `new THREE.Mesh | InstancedMesh(catalogueTriangle(e.attrs), km.material, 1)` + `applyKitMaterial`, `setColorAt(0, white)` for `instancedColors`, `castShadow` / `receiveShadow`, `frustumCulled = false`, dedupe by `programSignature`; `legacyArenaMeshes()` builds ten `BattleArena`s and keeps one detached mesh per signature.
  5. `BattleView.precompile` mirrors `OverworldView.precompile`: the catalogue root added to the battle scene with `actors.showAll()`, `compileAsync(this.scene, this.camera)` into a 1×1 target, scene restored; `finishPrecompile` draws one frame (`precompileFrame`, else a 1×1 render) with them shown, then `actors.checkInstanceUniforms(renderer.info.programs)`, restores, disposes the catalogue; a failure logs once ("[battle] precompile failed (programs compile on first use instead)").
  6. `Renderer` wiring (Interfaces), preview `setStyle` / `&arenaFail=` / precompile before its first frame, harness: `--ab-feature battle` (`live: on => emu.renderer.battle.setWorldStyle(on ? 'modern' : 'retro')`, `preview: on => preview.setStyle(on ? 'modern' : 'retro')`, `previewWhen: q => q.startsWith('battle=')`, budgets 3.0 / 0.5), `battle_enter` and `battle_exit` switched to `sceneChange: 'gate'` with `eval: 'emu.renderer.precompiled().then(() => emu.renderer.finishPrecompile())'` (in manual mode nothing waits for the boot compile: the gate measures play, not boot).
- [ ] **Step 4: Run** `npx tsc --noEmit && npm test` → PASS (the drift guard compares today's arenas only: `ARENA_PARTS` is empty).
- [ ] **Step 5: Verify.** `npm run regress:live -- --label t4 --static --battles --compare p3-base` → **0.00 % on every entry in both styles** (Modern still draws today's arena); `battle_enter` and `battle_exit` pass the scene-change gate in both styles (0 programs compiled, slowest frame ≤ 150 ms; report the numbers against Task 1's); `b_grass_fail` Modern looks like `b_grass` Modern and the page logged the part warning once; the A/B runs (`--ab --ab-feature battle --only battle,b_grass`: both arms are today's arena, Δ within the A/A floor ±0.3 ms — a sanity run of the switch). The overworld guard `npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/catalogue.test.ts` passes.
- [ ] **Step 6: Commit** — `git add src/render/battle/stage.ts src/render/battle/battleActors.ts src/render/battle/modernArena.ts src/render/battle/catalogue.ts src/render/battle/battleView.ts src/render/renderer.ts src/render/battlePreview.ts src/render/kit/catalogue.ts tools/regress-live.ts tests/battleStage.test.ts tests/battleActors.test.ts tests/modernArena.test.ts tests/battleCatalogue.test.ts && git commit -m "refactor(battle): stage, actors and arenas split by world style; every battle program compiled at boot (catalogue + drift guard)"`

**Gates:** Retro — 0.00 % everywhere, and Modern 0.00 % everywhere (nothing Modern-specific is drawn yet). Programs — drift guard passes; `battle_enter` / `battle_exit` compile 0 programs in both styles; overworld guard passes.

**Acceptance:** pixel-identical restructure; entering and leaving a battle compiles nothing.

---

### Task 5: Inflated battlers

Battlers (and trainer pictures) become Phase 2 inflated sprites in Modern: a battle `SpriteField` with parameters for 64-px pictures, a battle variant of `InflatedActors` (own program keys, relief down to the feet), silhouette sun shadows on the platforms, HD sprite edges and the Sprite edges setting. Effects stay cards; the enemy shadow lies flat on its platform; OBJ-window masks are skipped. Arenas are still today's.

**Files:**
- Modify: `src/render/actors/inflateMath.ts` (`BATTLE_INFLATE`), `src/render/actors/inflatedActors.ts` (`InflatedVariant`; `instanceUniformsFailed(programs, tag?)`), `src/render/actors/selfTest.ts` (`FieldSelfTest.inflateMax`), `src/render/battle/battleActors.ts`, `src/render/battle/battleView.ts` (owns the battle `SpriteField`, `updateField(renderer)`, `setSpriteFilter`, `setActorMask`, `inflation`), `src/render/renderer.ts` (battle branch: `battle.updateField(webgl)` after the atlas update; `setSpriteFilter` and a new `setActorMask(on)` reach both views; `actorSelfTest` / `actorFieldDump` use the presented view's field), `src/render/battlePreview.ts` (same; `selfTest`, `fieldDump`, `setActorMask`, `setInflation`), `tools/regress-live.ts` (masks through `emu.renderer.setActorMask` / `preview.setActorMask` for every entry; self-test tolerance from the result's `inflateMax`; `selftest` on `battle` and `b_grass`; `--ab-feature battlers`; live `battle_switch`; `battle_exit` gains `selftest: true`)
- Test: `tests/inflatedActors.test.ts`, `tests/inflateMath.test.ts`, `tests/battleActors.test.ts`

**Interfaces:**
- Consumes: `SpriteField`, `InflatedActors`, `instanceUniformsFit`, `skipOverridePasses` (Phase 2); `BattleActors`, `battleRoute`, `battleCardSpec` (Task 4).
- Produces:
  ```ts
  // inflateMath.ts
  export const BATTLE_INFLATE: InflateParams = { amp: 2.0, cap: 30, window: 32, sigma: 3.0 };   // starting values, tuned in Step 5
  // inflatedActors.ts
  export interface InflatedVariant {
    tag: string;                                     // '' = the overworld's: its program keys stay 'actor:inflated:1:…'
    params: InflateParams;                           // the field's (the shading slope's normaliser uses params.amp)
    reliefFade: { from: number; to: number } | null; // null: full relief down to the feet
  }
  export const OVERWORLD_VARIANT: InflatedVariant;   // { tag: '', params: INFLATE, reliefFade: RELIEF_FADE }
  export const BATTLE_VARIANT: InflatedVariant;      // { tag: 'battle', params: BATTLE_INFLATE, reliefFade: null }
  // constructor gains a 6th parameter: variant: InflatedVariant = OVERWORLD_VARIANT
  // program keys: `actor:inflated${tag ? '-' + tag : ''}${twin ? '-depth' : ''}:1:${uniforms ? 'uniforms' : 'attributes'}`
  export function instanceUniformsFailed(programs: readonly ProgramInfo[], tag?: string): boolean;
  // selfTest.ts: FieldSelfTest gains `inflateMax: number` (inflateMax(field.params)); the harness gates
  // maxErr / fixtureMaxErr ≤ max(0.02, 0.003 · inflateMax) per result.
  ```
  `BattleActors` (Modern, `inflation` on): `'inflated'` → `InflatedActors.set(list, cameraRight, eye)` with `BATTLE_VARIANT`, the battle field, `rim` = the battle's `uSky` colour object, `setLightFloor(charLight)`; `'decal'` → a flat card (`flat: true`) whose rectangle lies on the platform top (y = 0) under the sprite's screen rectangle: `footX` = the ground hit of its centre, footZ / height spanning the ground hits of its top and bottom edges, `width` = its screen width / `PX`; `'skip'` → nothing. `skipOverridePasses` on the cards and the inflated mesh (GTAO). No contact shadows (the sun silhouette lands on the platform). Retro: unchanged cards; the inflated mesh hidden with an empty list.

- [ ] **Step 1: Write the failing tests** — in `tests/inflatedActors.test.ts` (with `patched(a)` = the material's `onBeforeCompile` applied to `THREE.ShaderLib.standard`, as the existing chunk test does):

```ts
it('a battle variant has its own program keys and full relief to the feet', () => {
  const a = new InflatedActors(new THREE.Texture(), new THREE.Texture(), { value: new THREE.Color() }, undefined, true, BATTLE_VARIANT);
  expect((a.mesh.material as THREE.Material).customProgramCacheKey()).toBe('actor:inflated-battle:1:uniforms');
  expect((a.mesh.customDepthMaterial as THREE.Material).customProgramCacheKey()).toBe('actor:inflated-battle-depth:1:uniforms');
  expect(patched(a).vertexShader).toContain('float relief = 1.0;');
});
it('the overworld variant keeps its keys and its relief fade', () => {
  const a = make();
  expect((a.mesh.material as THREE.Material).customProgramCacheKey()).toBe('actor:inflated:1:uniforms');
  expect(patched(a).vertexShader).toContain('smoothstep(0.15, 0.55, local.y)');
});
it('checks the uniform-array programs of the variant it is asked about', () => {
  const failed = [{ cacheKey: 'x,actor:inflated-battle:1:uniforms', diagnostics: { runnable: false } }];
  expect(instanceUniformsFailed(failed)).toBe(false);
  expect(instanceUniformsFailed(failed, 'battle')).toBe(true);
});
it('keeps a zero-width actor finite (a battler growing from nothing at send-out)', () => {
  const a = make();
  a.set([{ footX: 1, footY: 0, footZ: 3, width: 0, height: 0, lift: 0, flat: false, slot: { u0: 0, v0: 0.125, u1: 0, v1: 0 } }], new THREE.Vector3(1, 0, 0));
  expect([...a.instances.subarray(0, 12)].every(Number.isFinite)).toBe(true);
});
```

  in `tests/inflateMath.test.ts`:

```ts
it('battle parameters inflate a 64-px Pokémon in proportion to a 16-px character', () => {
  expect(BATTLE_INFLATE.window).toBeGreaterThanOrEqual(BATTLE_INFLATE.cap);
  const battle = inflateMax(BATTLE_INFLATE) / 64, overworld = inflateMax(INFLATE) / 16;
  expect(battle).toBeGreaterThan(0.5 * overworld);
  expect(battle).toBeLessThan(1.5 * overworld);
});
```

  in `tests/battleActors.test.ts` (replace the Task 4 route test; extend the import from `battleActors` with `battleDecalSpec`; `shadow = blankSprite({ index: 2, template: SYM.gSpriteTemplate_EnemyShadow, width: 32, height: 8, coordOffset: false, screenX: 160, screenY: 65 })`):

```ts
it('Modern inflates battlers, lays the enemy shadow flat, skips OBJ-window masks; Retro draws cards', () => {
  const b = battler(0, 40, 53);
  expect(battleRoute(b, 'modern', true)).toBe('inflated');
  expect(battleRoute(b, 'modern', false)).toBe('card');
  expect(battleRoute(b, 'retro', true)).toBe('card');
  expect(battleRoute({ ...b, objMode: 2 }, 'modern', true)).toBe('skip');
  expect(battleRoute({ ...b, objMode: 2 }, 'retro', true)).toBe('card');     // today's (the GBA never shows it)
  expect(battleRoute(shadow, 'modern', true)).toBe('decal');
  expect(battleRoute(shadow, 'retro', true)).toBe('card');
  expect(battleRoute(effect(1, 108), 'modern', true)).toBe('card');
});
it('routes a battle frame per style, four battlers in a double battle', () => {
  const atlas = { slots: new Map([0, 1, 2, 3, 4, 5].map((i) => [i, slot])), target: { texture: new THREE.Texture() } };
  const a = new BattleActors(atlas, { field: { texture: new THREE.Texture() } });
  const args = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 3, 11), new THREE.Color(1, 1, 1), []] as const;
  const single = [battler(0, 40, 53), battler(1, 144, 23), shadow, effect(3, 108)];
  a.update(single, 'modern', ...args); expect(a.counts()).toEqual({ cards: 1, inflated: 2, decals: 1 });
  a.update(single, 'retro', ...args);  expect(a.counts()).toEqual({ cards: 4, inflated: 0, decals: 0 });
  const double = [battler(0, 0, 48), battler(1, 168, 8), battler(2, 58, 56), battler(3, 120, 0)];
  a.update(double, 'modern', ...args); expect(a.counts().inflated).toBe(4);
  const decal = battleDecalSpec(shadow, slot, STAGE);
  expect(decal.flat).toBe(true); expect(decal.footY).toBeCloseTo(0, 6);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/inflatedActors.test.ts tests/inflateMath.test.ts tests/battleActors.test.ts` → FAIL.
- [ ] **Step 3: Implement.** `InflatedVariant` threads through `vertPrelude`/`FIELD_GLSL` (`shadeSlope`'s constant from `variant.params.amp`; `VERT_POSITION` emits `float relief = 1.0;` for a null fade, else today's line — the overworld's generated GLSL stays byte-identical) and `programKey`; `battleActors` routes and the decal spec (`battleDecalSpec(s, slot, stage, out?)`, exported); `BattleView` owns `new SpriteField(undefined, undefined, BATTLE_INFLATE)`, updates it after the atlas in Modern with inflation on, compiles it in `precompile` (`field.compile(renderer)`), and passes `instanceUniforms` from the renderer (`instanceUniformsFit(...)`); renderer/preview/harness wiring as listed. Live `battle_switch`: `{ name: 'battle_switch', state: 'out/battle1.state', sameAs: 'battle', steps: [['', 6], ['', 6, TOGGLE_STYLE], ['', 6, TOGGLE_STYLE], ['', 6, "emu.renderer.setSpriteFilter('pixel')"], ['', 6, "emu.renderer.setSpriteFilter('smooth')"]] }` (`TOGGLE_STYLE` switches `emu.renderer`'s world style, which now reaches the battle).
- [ ] **Step 4: Run** `npx tsc --noEmit && npm test` → PASS.
- [ ] **Step 5: Look and tune.** `npm run regress:live -- --label t5 --static --battles --selftest --gpu --compare p3-base --review --review-before p3-base`; tune `BATTLE_INFLATE` (amp, cap, sigma), keeping `RIM`, `LIGHT_FLOOR`, `SHOULDER` as Phase 2's, until on the review sheet and the Modern shots:
  - battlers read as soft rounded volumes (Torchic's head and body, Zigzagoon's back) with the GBA silhouette and every animation frame unchanged; their silhouette shadow falls on the platforms; no acne stripes; HD edges smooth at the battle's ≈ 5× magnification (`b_*` with `&spriteFilter=pixel` equals the card's texels);
  - `battle_intro` (sliding in, BLDALPHA on), `battle_move` (lunge, claw card in front), `battle_exit` (Zigzagoon's faint: rows cleared, nothing left floating; back on Route 101 the overworld field self-test passes), `b_double`, `b_cave` (Zubat's shadow flat on the platform under it) look right frame by frame;
  - actor luminance Modern/Retro (`actorLum`, battle entries now masked): median ≥ 0.95, every entry within 0.9–1.15, including `b_grass_night`, `b_cave`, `b_underwater`;
  - field self-test on `battle` and `b_grass` within `max(0.02, 0.003·inflateMax(BATTLE_INFLATE))`;
  - `battle_switch` ends 0 px from `battle` in both styles;
  - budgets: `--ab --ab-feature battlers --only battle,battle_grass,b_grass,b_double` Δgpu ≤ +1.0 ms, Δcpu ≤ +0.5 ms; calls ≤ 150 on every Modern battle entry.
  Record the constants and the measured numbers in the report.
- [ ] **Step 6: Commit** — `git add src/render/actors/inflateMath.ts src/render/actors/inflatedActors.ts src/render/actors/selfTest.ts src/render/battle/battleActors.ts src/render/battle/battleView.ts src/render/renderer.ts src/render/battlePreview.ts tools/regress-live.ts tests/inflatedActors.test.ts tests/inflateMath.test.ts tests/battleActors.test.ts && git commit -m "feat(battle): inflated battlers with silhouette shadows and HD edges; enemy shadow on the platform; OBJ-window masks skipped (Modern)"`

**Gates:** Retro — 0.00 % on every Retro entry; Modern overworld and `transition` 0.00 % (the default variant's GLSL is unchanged). Programs — drift guard passes; `battle_enter` / `battle_exit` / `battle_switch` compile nothing (the battle's inflated main + depth programs and field passes are precompiled; a Retro session switching to Modern in a battle compiles nothing either — `battle_switch` in the Retro run).

**Acceptance:** the Step 5 bullets.

---
### Task 6: Arena foundation — palette, look, ground, platforms

Everything every Modern arena stands on: the arena palette derived from the sampled background, lights and fog per kind (outdoor ones on the overworld's time of day), the painterly arena ground (the kit's terrain shader on synthetic cells, with optional cloud shadows and caustics), the platforms modelled per terrain, and the colour lock that keeps an unloaded background out. From this task on the Modern arena covers all 24 kinds (ground + platforms; scenery arrives in Tasks 7–11).

**Files:**
- Create: `src/render/overworld/timeOfDay.ts`, `src/render/battle/palette.ts`, `src/render/battle/look.ts`, `src/render/battle/clouds.glsl.ts`, `src/render/battle/parts/ground.ts`, `src/render/battle/parts/platforms.ts`, `tests/timeOfDay.test.ts`, `tests/arenaPalette.test.ts`, `tests/arenaLook.test.ts`, `tests/arenaGround.test.ts`, `tests/arenaPlatforms.test.ts`
- Modify: `src/render/overworld/overworldView.ts` (the outdoor keyframe blend and the window-glow ramp call `timeOfDay` / `nightFactor`; output identical), `src/render/battle/modernArena.ts` (`ArenaContext.palette` / `.ground`, `ArenaColorLock`, `ARENA_PARTS = [GROUND_PART, PLATFORM_PART]`), `src/render/battle/battleView.ts` (Modern: own `KitUniforms`, sampling every 0.5 s through `decodeBg3` + `sampleArenaColors` + the lock, `arenaLook` applied to sun / hemisphere / fog / `uSky` / `uNight`, Modern shadows `shadowSettings(quality, 'modern')`, `charLight` by the overworld formula; Retro untouched), `tests/modernArena.test.ts`, `tests/smoke/battleGraphics.test.ts` (palette of every ROM background)

**Interfaces:**
- Produces (`timeOfDay.ts`, the overworld's code moved unchanged):
  ```ts
  export interface DayLight { sunColor: THREE.Color; sunI: number; sky: THREE.Color; hemiI: number; fog: THREE.Color }
  /** The outdoor keyframe blend (hour, sun colour, sun intensity, sky, hemisphere intensity, fog) at time of day `tod` (0..24). */
  export function timeOfDay(tod: number, out?: DayLight): DayLight;
  /** Window glow / night factor: clamp(max((tod − 18.3) / 1.5, (6.2 − tod) / 1.2), 0, 1). */
  export function nightFactor(tod: number): number;
  ```
- Produces (`palette.ts`; `RGB` sRGB; `soften`, `lush`, `earthTone`, `scale`, `mix` from `kit/palette.ts`; `GroundMat` from `kit/terrain.ts`):
  ```ts
  export interface ArenaPalette {
    groundMat: GroundMat; ground: RGB;           // the field
    pathMat: GroundMat; path: RGB;               // the worn ring around the platforms (outdoor kinds)
    platformMat: GroundMat; platformTop: RGB;    // painted by the ground material on the platform tops
    platformSide: RGB; skirt: RGB;               // platform body; the grass skirt
    leaf: RGB; trunk: RGB; blade: RGB; rock: RGB; water: RGB; wall: RGB; accent: RGB;
  }
  export function arenaPalette(kind: ArenaKind, c: ArenaColors | null): ArenaPalette;   // null → defaultArenaColors(kind)
  ```
  Rules (`c` = the colours; constants are sRGB): **grass/longGrass/plain**: ground Grass `soften(scale(c.platform, longGrass 0.78 / grass 0.9 / plain 1.0))`, path Path `earthTone(c.rim)`, platform Grass `lush(c.platform)`, side `earthTone(mix(c.rim, [0.5, 0.36, 0.22], 0.7))`, skirt `lush(c.rim)`, leaf `lush(scale(c.platform, 0.7))`, blade `lush(c.platform)`; **sand**: ground Sand `soften(c.platform)`, path Sand `soften(c.rim)`, platform Sand `soften(c.rim)`, side `scale(soften(c.platform), 0.8)`, leaf `[0.35, 0.62, 0.3]`, blade `mix(c.platform, [0.5, 0.55, 0.3], 0.5)`, rock `mix(c.platform, [0.6, 0.58, 0.55], 0.6)`; **water/kyogre**: ground Sand `mix(c.platform, [0.74, 0.66, 0.47], 0.5)` (seabed), water `c.platform`, platformTop `c.rim` (the ripple's foam tint); **pond**: ground Grass `scale(lush(c.rim), 0.85)`, water `c.platform`, platformTop / skirt `lush(c.rim)` (lily pads), leaf `lush(scale(c.rim, 0.6))`; **cavePond**: ground Rock `scale(soften(c.backdrop), 0.5)`, water `c.platform`, platformTop `c.rim`; **underwater**: ground Sand `mix(c.platform, [0.74, 0.66, 0.47], 0.45)`, blade (kelp) `mix(lush(c.rim), [0.35, 0.4, 0.2], 0.5)`, rock `scale(c.platform, 0.8)`, water `c.backdrop`; **mountain**: ground Gravel `soften(c.platform)`, path Rock `soften(c.rim)`, platform Rock `soften(c.rim)`, side / rock `scale(soften(c.platform), 0.8)`; **cave/groudon**: ground Rock `scale(soften(c.backdrop), 0.55)`, platform Rock `soften(c.platform)`, side / rock `scale(soften(c.backdrop), 0.7)`, accent `c.top` (Groudon's lava); **building**: ground Deck `soften(c.platform)`, platform Paving `soften(c.rim)`, wall `soften(c.backdrop)`; **gym, leader, frontier, magma, aqua, sidney, phoebe, glacia, drake, champion**: ground Paving `soften(mix(c.platform, c.backdrop, 0.3))`, platform Paving `soften(c.platform)`, side `scale(soften(c.rim), 0.8)`, wall `soften(c.backdrop)` (the seven stadium kinds: `scale(soften(c.top), 0.6)`), accent `c.top`; **rayquaza**: ground / platform Paving `soften(c.platform)`, rock `soften(c.rim)`, wall `c.backdrop`. Unlisted fields: path = ground, skirt = blade, trunk `[0.42, 0.3, 0.2]`, rock `[0.58, 0.56, 0.52]`, water `[0.32, 0.42, 0.84]`, wall `c.backdrop`, accent `c.top`, leaf `lush(scale(c.platform, 0.7))`, blade `lush(c.platform)`.
- Produces (`look.ts`):
  ```ts
  export interface ArenaLook {
    sunColor: THREE.Color; sunI: number; sky: THREE.Color; hemiI: number; hemiGround: THREE.Color;
    fog: THREE.Color; fogNear: number; fogFar: number;
    night: number;      // kit uNight
    clouds: number;     // cloud-shadow / reflection strength (0..1)
    caustics: number;   // seabed caustics (0..1)
  }
  /** outdoor and water settings: timeOfDay(hour), night = nightFactor(hour), fog 30..80, clouds 1; sky (rayquaza): the
   *  same with the fog lerped 0.5 towards the backdrop, fog 25..90; underwater: sun (0.55, 0.8, 1.0) × 1.2, sky (0.3, 0.6,
   *  0.9), hemi 1.2, fog (0.05, 0.22, 0.42) 10..38, caustics 1; cave: sun (1.0, 0.85, 0.7) × 0.9, sky (0.55, 0.5, 0.6),
   *  hemi 1.2, fog = linear(palette.wall) × 0.12, 14..40 (groudon: fog (0.18, 0.07, 0.04), sun (1.0, 0.6, 0.35)); indoor:
   *  today's indoor battle light (sun 1.6, hemi 1.6) in warm white, fog = linear(palette.wall) × 0.6, 22..60, night 0.
   *  hemiGround = linear(palette.ground) × 0.6. */
  export function arenaLook(kind: ArenaKind, palette: ArenaPalette, hour: number, out?: ArenaLook): ArenaLook;
  ```
- Produces (`clouds.glsl.ts`): `export const CLOUD_GLSL` — `float arenaClouds(vec2 p)` (domain-warped `kitFbm2` coverage, `smoothstep(0.5, 0.75, …)`) and `vec2 skyCloudUv(vec3 dir, float time)` (`dir.xz / (dir.y + 0.15) * 0.54 + time * vec2(0.004, 0.002)`), shared by the sky (Task 7), the ground's cloud shadows and the water's reflection (Task 8). Needs `KIT_NOISE_GLSL` before it (every kit material's fragment prelude has it).
- Produces (`modernArena.ts`): `ArenaContext` gains `palette: ArenaPalette` and `ground: { tex: THREE.DataTexture; min: THREE.Vector2; size: THREE.Vector2 }` (computed by `ModernArena.build` before the parts run, freed with the build) and `look: ArenaLook` (at hour 12; parts read only its static fields `clouds`, `caustics`);
  ```ts
  /** The colours a battle's arena is built with: the kind's defaults until the first valid sample, then that sample for
   *  the rest of the battle (a new kind starts over). At most two builds per battle; later samples never rebuild. */
  export class ArenaColorLock { observe(kind: ArenaKind, sample: ArenaColors | null): ArenaColors }
  ```
- Produces (`parts/ground.ts`):
  ```ts
  export const GROUND_GRID = 72;   // cells (1 unit each) around stage.centre
  /** Per cell rgb = sRGB tint, a = mat << 4 | 8 (the terrain family's layout): platform footprints × 1.1 → platformMat /
   *  platformTop; outdoor kinds a worn ring (1.1..1.7 × footprint) → pathMat / path; else groundMat / ground; tints ±6 %
   *  by noise2. Pond kinds: the pond ellipse → Sand (its bed). */
  export function groundCells(kind: ArenaKind, p: ArenaPalette, stage: Stage): { data: Uint8Array; w: number; h: number; min: [number, number] };
  /** Ground height at world (x, z): GROUND_Y within 9 units of the centre; outdoor kinds roll beyond (smoothstep(9, 22, r) ×
   *  (0.9 · noise2(x·0.07, z·0.07) − 0.25), sand ×2); cave/indoor flat; water/kyogre the seabed −1.2; pond/cavePond a basin
   *  (POND / CAVE_POND ellipse around the centre) at −0.9 sloping up to GROUND_Y over its last 2 units. */
  export function groundHeight(kind: ArenaKind, x: number, z: number, stage: Stage): number;
  export const POND = { dz: -1, rx: 15, rz: 10 }, CAVE_POND = { dz: -1, rx: 18, rz: 12 };
  /** terrainMaterial + cloud shadows (uClouds) and seabed caustics (uCaustics), both build-time values; hookKey 'arenaGround'. */
  export function arenaGroundMaterial(tex: THREE.Texture, min: THREE.Vector2, size: THREE.Vector2, clouds: number, caustics: number): KitMaterialOptions;
  export const GROUND_PART: ArenaPart;   // 'ground', all kinds: a polar disc (radius 64, 96 segments, rings densest near the stage), position + normal only
  ```
- Produces (`parts/platforms.ts`):
  ```ts
  export type PlatformStyle = 'earthGrass' | 'sandMound' | 'stoneSlab' | 'lilyPad' | 'rippleRing' | 'caveRock' | 'seabedRock';
  /** grass, longGrass, plain → earthGrass; sand → sandMound; water, kyogre, cavePond → rippleRing; pond → lilyPad;
   *  underwater → seabedRock; cave, groudon → caveRock; mountain and every indoor kind, rayquaza → stoneSlab. */
  export const PLATFORM_STYLE: Readonly<Record<ArenaKind, PlatformStyle>>;
  export interface PlatformMeshes {
    body: THREE.BufferGeometry | null;   // position, normal, color(3): SOIL_MATERIAL (smooth) or CLIFF_MATERIAL (stoneSlab, caveRock, seabedRock: faceted)
    top: THREE.BufferGeometry | null;    // position, normal: drawn with the arena ground's material (its cells paint it)
    skirt: Float32Array | null;          // earthGrass: x, z, scale, yaw per grass clump on the rim
    ripple: THREE.BufferGeometry | null; // rippleRing: position, normal (RIPPLE_MATERIAL)
  }
  /** Centred on the origin (the part places it at STAGE.player / STAGE.enemy); the top at y ≈ 0 over the footprint. */
  export function platformMeshes(style: PlatformStyle, f: Footprint, seed: number, p: ArenaPalette, kind: ArenaKind): PlatformMeshes;
  export const RIPPLE_MATERIAL: KitMaterialOptions;   // transparent, depthWrite false: foam rings expanding from the battler (uTime), soft edges
  export const PLATFORM_PART: ArenaPart;
  ```
  Shapes (starting values, tuned at review): **earthGrass** — top: elliptical dome (6 rings × 48 segments, +0.03 at the centre); body: a 0.1 rounded rim, then a soil band down to `GROUND_Y − 0.05` flaring 8 % with ±0.04 noise, `platformSide` darkening to ×0.7 at the bottom; skirt: 48 clumps (longGrass 64 at scale 1.3) on the rim at radius ×(1.0–1.08). **sandMound** — top only: flat at 0 for elliptical radius e ≤ 0.55, easing down to `GROUND_Y` at e = 1.35 (10 rings × 64). **stoneSlab** — top: flat disc at 0; body: a 0.06 chamfer, a vertical side to `GROUND_Y + 0.1`, a plinth step (× 1.1 footprint) down to `GROUND_Y − 0.05`, faceted, ±5 % per-face shade. **caveRock / seabedRock** — top: a disc with ±0.02 noise; body: a lumpy band (64 segments × 4 rows, outward noise 0.15, flare 15 %) down to `GROUND_Y − 0.1`. **lilyPad** — body only: a flat pad at `WATER_Y + 0.03` (footprint × 1.05) with an 18° notch facing away from the camera, a 0.02 raised rim, radial veins in the vertex colours (`platformTop`), and three small pads around it. **rippleRing** — ripple only: an annulus 0.6–1.25 × footprint at `WATER_Y + 0.01`.

- [ ] **Step 1: Write the failing tests.** `tests/timeOfDay.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { timeOfDay, nightFactor } from '../src/render/overworld/timeOfDay';

describe('timeOfDay (the overworld keyframes)', () => {
  it('blends the keyframes', () => {
    expect(timeOfDay(9).sunI).toBeCloseTo(2.4);
    expect(timeOfDay(12).sunI).toBeCloseTo(2.4 + (2.3 - 2.4) * (3 / 7), 6);
    expect(timeOfDay(22).fog.getHex()).toBe(timeOfDay(23).fog.getHex());
    expect(timeOfDay(18).sunColor.r).toBeCloseTo(1.0);
  });
  it('ramps the night in after sunset and out after sunrise', () => {
    expect(nightFactor(12)).toBe(0);
    expect(nightFactor(22)).toBe(1);
    expect(nightFactor(19)).toBeCloseTo((19 - 18.3) / 1.5, 6);
    expect(nightFactor(5.6)).toBeCloseTo(0.5, 6);
  });
});
```

  `tests/arenaPalette.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { arenaPalette } from '../src/render/battle/palette';
import { defaultArenaColors } from '../src/render/battle/bgSample';
import { ARENA_KINDS } from '../src/render/battle/arenaKind';
import { GroundMat } from '../src/render/kit/terrain';
import { luma, saturation } from '../src/render/kit/palette';

describe('arenaPalette', () => {
  it('takes the grass from the platform, leaves lush but never neon', () => {
    const p = arenaPalette('grass', defaultArenaColors('grass'));
    expect(p.groundMat).toBe(GroundMat.Grass);
    expect(saturation(p.leaf)).toBeLessThanOrEqual(0.42 + 1e-6);
    expect(luma(p.ground)).toBeGreaterThan(0.25); expect(luma(p.ground)).toBeLessThan(0.7);
    expect(luma(arenaPalette('longGrass', null).ground)).toBeLessThan(luma(arenaPalette('grass', null).ground));
  });
  it('gives each kind its ground material', () => {
    const mat = (k: Parameters<typeof arenaPalette>[0]) => arenaPalette(k, null).groundMat;
    expect([mat('sand'), mat('cave'), mat('mountain'), mat('building'), mat('gym'), mat('water')])
      .toEqual([GroundMat.Sand, GroundMat.Rock, GroundMat.Gravel, GroundMat.Deck, GroundMat.Paving, GroundMat.Sand]);
  });
  it('uses the defaults without colours and stays in gamut for every kind', () => {
    expect(arenaPalette('grass', null)).toEqual(arenaPalette('grass', defaultArenaColors('grass')));
    for (const k of ARENA_KINDS) for (const v of Object.values(arenaPalette(k, null))) {
      if (Array.isArray(v)) for (const x of v) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); }
    }
  });
});
```

  `tests/arenaLook.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { arenaLook } from '../src/render/battle/look';
import { arenaPalette } from '../src/render/battle/palette';
import { timeOfDay } from '../src/render/overworld/timeOfDay';

const look = (k: Parameters<typeof arenaPalette>[0], hour: number) => arenaLook(k, arenaPalette(k, null), hour);
describe('arenaLook', () => {
  it('lights outdoor arenas by the hour as the overworld', () => {
    expect(look('grass', 12).sunI).toBeCloseTo(timeOfDay(12).sunI, 6);
    expect(look('grass', 12).night).toBe(0);
    expect(look('grass', 22).night).toBe(1);
    expect(look('grass', 12).clouds).toBe(1);
  });
  it('keeps indoor arenas at the same light whatever the hour', () => {
    expect(look('gym', 23).night).toBe(0);
    expect(look('gym', 23).sunI).toBe(look('gym', 12).sunI);
    expect(look('gym', 12).clouds).toBe(0);
  });
  it('closes the fog in caves and underwater, blue under the sea', () => {
    expect(look('cave', 12).fogFar).toBeLessThan(look('grass', 12).fogFar);
    const u = look('underwater', 12);
    expect(u.fog.b).toBeGreaterThan(u.fog.r); expect(u.caustics).toBe(1);
  });
});
```

  `tests/arenaGround.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { groundCells, groundHeight, POND, GROUND_GRID } from '../src/render/battle/parts/ground';
import { arenaPalette } from '../src/render/battle/palette';
import { STAGE, GROUND_Y, WATER_Y } from '../src/render/battle/stage';
import { GroundMat } from '../src/render/kit/terrain';

const matAt = (g: ReturnType<typeof groundCells>, x: number, z: number) =>
  g.data[((Math.floor(z - g.min[1])) * g.w + Math.floor(x - g.min[0])) * 4 + 3] >> 4;
describe('arena ground', () => {
  it('paints the field, the worn ring and the platform tops', () => {
    const p = arenaPalette('grass', null), g = groundCells('grass', p, STAGE);
    expect(g.w).toBe(GROUND_GRID);
    expect(matAt(g, STAGE.centre.x + 25, STAGE.centre.z - 20)).toBe(GroundMat.Grass);
    expect(matAt(g, STAGE.player.x, STAGE.player.z)).toBe(p.platformMat);
    expect(matAt(g, STAGE.player.x + 2.1 * 1.4, STAGE.player.z)).toBe(p.pathMat);
  });
  it('keeps the stage flat, rolls outdoor fields, lays indoor floors level', () => {
    for (const [dx, dz] of [[0, 0], [5, -3], [-6, 2]]) expect(groundHeight('grass', STAGE.centre.x + dx, STAGE.centre.z + dz, STAGE)).toBe(GROUND_Y);
    const far = [...Array(40)].map((_, i) => groundHeight('grass', STAGE.centre.x + 30 * Math.cos(i), STAGE.centre.z + 30 * Math.sin(i), STAGE));
    expect(Math.max(...far) - Math.min(...far)).toBeGreaterThan(0.3);
    expect(groundHeight('gym', STAGE.centre.x + 30, STAGE.centre.z - 20, STAGE)).toBe(GROUND_Y);
  });
  it('digs the pond under the water', () => {
    expect(groundHeight('pond', STAGE.centre.x, STAGE.centre.z + POND.dz - 6, STAGE)).toBeLessThan(WATER_Y - 0.3);
  });
});
```

  `tests/arenaPlatforms.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { platformMeshes, PLATFORM_STYLE, type PlatformStyle } from '../src/render/battle/parts/platforms';
import { arenaPalette } from '../src/render/battle/palette';
import { PLATFORM_FOOTPRINT, GROUND_Y, WATER_Y } from '../src/render/battle/stage';
import { ARENA_KINDS } from '../src/render/battle/arenaKind';

const f = PLATFORM_FOOTPRINT.player;
const box = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); return g.boundingBox!; };
const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
const KIND: Record<PlatformStyle, Parameters<typeof arenaPalette>[0]> = { earthGrass: 'grass', sandMound: 'sand', stoneSlab: 'gym',
  lilyPad: 'pond', rippleRing: 'water', caveRock: 'cave', seabedRock: 'underwater' };

describe('platforms', () => {
  it('give every kind a style', () => { for (const k of ARENA_KINDS) expect(PLATFORM_STYLE[k]).toBeDefined(); });
  for (const style of Object.keys(KIND) as PlatformStyle[]) {
    it(`${style}: the battler stands at y ≈ 0 on a footprint-sized top, within budget`, () => {
      const m = platformMeshes(style, f, 1, arenaPalette(KIND[style], null), KIND[style]);
      const surface = m.top ?? m.body ?? m.ripple!;
      const b = box(surface);
      expect(b.max.y).toBeGreaterThan(style === 'rippleRing' || style === 'lilyPad' ? WATER_Y - 0.01 : -0.02);
      expect(b.max.y).toBeLessThan(0.05);
      expect(b.max.x).toBeGreaterThanOrEqual(0.95 * f.rx); expect(b.max.x).toBeLessThanOrEqual(1.45 * f.rx);
      for (const g of [m.top, m.body, m.ripple]) if (g) expect(tris(g)).toBeLessThanOrEqual(6000);
      if (m.body && style !== 'lilyPad') expect(box(m.body).min.y).toBeLessThanOrEqual(GROUND_Y);
      expect(m.skirt === null).toBe(style !== 'earthGrass');
      expect(m.ripple === null).toBe(style !== 'rippleRing');
    });
  }
  it('cuts the lily pad\'s notch', () => {
    const g = platformMeshes('lilyPad', f, 1, arenaPalette('pond', null), 'pond').body!;
    const p = g.getAttribute('position');
    let inNotch = 0;
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getX(i) / f.rx, -p.getZ(i) / f.rz), r = Math.hypot(p.getX(i) / f.rx, p.getZ(i) / f.rz);
      if (r > 0.3 && r < 0.95 && Math.abs(a) < THREE.MathUtils.degToRad(6)) inNotch++;
    }
    expect(inNotch).toBe(0);
  });
});
```

  and in `tests/modernArena.test.ts` (Review Focus #3):

```ts
it('locks the colours: defaults until the first valid sample, then that sample for the battle', () => {
  const lock = new ArenaColorLock();
  const a = { ...defaultArenaColors('grass'), platform: [0.1, 0.8, 0.2] as [number, number, number] };
  const b = { ...defaultArenaColors('grass'), platform: [0.9, 0.1, 0.1] as [number, number, number] };
  expect(lock.observe('grass', null)).toEqual(defaultArenaColors('grass'));
  expect(lock.observe('grass', a)).toEqual(a);
  expect(lock.observe('grass', b)).toEqual(a);
  expect(lock.observe('grass', null)).toEqual(a);
  expect(lock.observe('sand', null)).toEqual(defaultArenaColors('sand'));
});
it('builds every kind with the foundation parts', () => {
  const a = new ModernArena(createKitUniforms());
  for (const k of ARENA_KINDS) { expect(a.covers(k)).toBe(true); expect(a.build(k, defaultArenaColors(k), 'medium'), k).toBe(true); }
  a.dispose();
});
```

- [ ] **Step 2: Run** `npx vitest run tests/timeOfDay.test.ts tests/arenaPalette.test.ts tests/arenaLook.test.ts tests/arenaGround.test.ts tests/arenaPlatforms.test.ts tests/modernArena.test.ts` → FAIL.
- [ ] **Step 3: Implement.** First the extraction (`timeOfDay.ts` = the overworld's keyframe table and blend, moved; `OverworldView` calls it) and check it right away: `npm run regress:live -- --label t6ow --static --compare p3-base --styles modern` → 0.00 % on every overworld entry. Then `palette.ts`, `look.ts`, `clouds.glsl.ts`, `ground.ts` (`arenaGroundMaterial` = `terrainMaterial(...)` options with `fragHead += CLOUD_GLSL + uniforms`, `fragColor += ` the cloud-shadow (`diffuseColor.rgb *= 1.0 - uClouds * 0.18 * arenaClouds((vKitWorld.xz + uTime * vec2(0.6, 0.25)) / 40.0)`) and caustics (the seabed's two-voronoi term from `kit/water.ts`, × uCaustics) lines, `hookKey: 'arenaGround'`; the disc's geometry carries exactly position + normal), `platforms.ts` (three's primitives lose `uv`; bodies get 3-component vertex colours), the parts' `catalogue` entries (`{ material: arenaGroundMaterial(ph(), v2, v2, 0, 0), mesh: 'mesh', attrs: PN, castShadow: false }`; platforms: SOIL and CLIFF `mesh`/PNC/cast, `GRASS_MATERIAL` `instancedColors`/PNC/no cast, `RIPPLE_MATERIAL` `mesh`/PN/no cast), `ArenaColorLock`, and the `BattleView` Modern path (sampling with `decodeBg3(bus.vram, unfaded BG palette, bgcnt)`; `modern.build(kind, lock.observe(kind, sample), quality)`; `arenaLook(kind, palette, hours + minutes / 60)` applied each frame). Battle grass needs no actor bend: `uActors` stay far.
- [ ] **Step 4: Run** the tests → PASS; `npx tsc --noEmit && npm test` → PASS (the drift guard now compares the foundation parts too).
- [ ] **Step 5: Look.** `npm run regress:live -- --label t6 --static --battles --gpu --compare p3-base --review --review-before p3-base`; on `_review_battle.png` for all 27 static and 6 live battle entries:
  - the ground is painterly, not pixel speckle: soft two-tone grass in broad patches, warm worn earth around the platforms, sand ripples, paving stones, cave rock; colours recognisably those of the GBA column (grass green from the GBA's platform, Magma orange, the E4 rooms' platform colours, pale Sky Pillar stone);
  - platforms sit where today's stand, each reads as its terrain (earth disc with grass skirt, sand mound, stone slab with plinth, lily pad with notch, ripple rings animating on water, rough cave rock), with battler silhouettes' shadows on them;
  - outdoor light follows the hour (`b_grass` vs `b_grass_night` lit like the overworld's 11 h / 21 h), caves and underwater close their fog, indoor kinds are evenly lit;
  - no Modern battle entry draws today's arena any more (no trees yet: Tasks 7–11);
  - `battle_enter`: the first battle frames show a default-coloured arena at most until the background loads, then the sampled one (two builds), and the walk passes its gate.
- [ ] **Step 6: Commit** — `git add src/render/overworld/timeOfDay.ts src/render/overworld/overworldView.ts src/render/battle/palette.ts src/render/battle/look.ts src/render/battle/clouds.glsl.ts src/render/battle/parts/ground.ts src/render/battle/parts/platforms.ts src/render/battle/modernArena.ts src/render/battle/battleView.ts tests/timeOfDay.test.ts tests/arenaPalette.test.ts tests/arenaLook.test.ts tests/arenaGround.test.ts tests/arenaPlatforms.test.ts tests/modernArena.test.ts tests/smoke/battleGraphics.test.ts && git commit -m "feat(battle): Modern arena foundation — sampled palette, look per kind and hour, painterly ground, platforms per terrain"`

**Gates:** Retro — 0.00 % on every Retro entry; Modern overworld and `transition` 0.00 % (time-of-day extraction). Programs — drift guard passes with the ground and platform entries; `battle_enter` / `battle_exit` / `battle_switch` compile nothing in either style; `ModernArena.build` ≤ 60 ms warm (`preview.measureArenaBuild()`, median of 5, added here to `BattlePreviewApp`: rebuild with a fresh colour key, timed).

**Acceptance:** the Step 5 bullets.

---

### Task 7: Outdoor arenas — sky, clouds, horizon, trees, grass, flowers, dunes, rocks (grass, long grass, plain, sand)

The four outdoor ground kinds get their scenery, shaped for what the battle camera actually frames: the ground band up to ≈ 42 units behind the stage and a top band where tall things rise. The Modern `BattleSky` replaces today's sky in Modern (see D1).

**Files:**
- Create: `src/render/battle/sky.ts`, `src/render/battle/parts/scatter.ts`, `src/render/battle/parts/flora.ts`, `src/render/battle/parts/horizon.ts`, `src/render/battle/parts/dunes.ts`, `src/render/battle/parts/rocks.ts`, `tests/battleSky.test.ts`, `tests/arenaScatter.test.ts`, `tests/arenaFlora.test.ts`
- Modify: `src/render/kit/trees.ts` (export `treeGeometry(style, variant, detail)` — today's private `treeGeo` — `TREE_VARIANTS` and the per-quality crown detail it uses), `src/render/kit/flowers.ts` (export `flowerGeometry()` — today's private `flower()`), `src/render/battle/modernArena.ts` (`ARENA_PARTS` += `HORIZON_PART`, `FLORA_PART`, `DUNES_PART`, `ROCKS_PART`), `src/render/battle/battleView.ts` (Modern draws `BattleSky`; both skies shown during the precompile), `src/render/battle/catalogue.ts` (the `BattleSky` mesh in the catalogue root)

**Interfaces:**
- Produces (`scatter.ts`):
  ```ts
  export interface Ellipse { x: number; z: number; rx: number; rz: number }
  export interface ScatterOptions { centre: { x: number; z: number }; r0: number; r1: number; count: number; minGap: number;
    keepOut?: readonly Ellipse[]; accept?: (x: number, z: number) => boolean }
  /** Seeded dart throwing (≤ 30 tries per point) in the annulus r0..r1 around `centre`, ≥ minGap apart, outside every keep-out; deterministic. */
  export function scatter(seed: number, o: ScatterOptions): { x: number; z: number }[];
  /** Both platform footprints × 1.25 (ellipses) and the tall rule: a tall thing (> 1 unit) stands at r ≥ 10 from the
   *  centre and z ≤ centre.z + 4, never between the camera (any yaw in ±0.9) and the stage. */
  export function stageKeepOut(stage: Stage): { ellipses: Ellipse[]; tallOk(x: number, z: number): boolean };
  ```
- Produces (`flora.ts`):
  ```ts
  export interface ArenaTree { style: TreeStyle; variant: number; x: number; z: number; scale: number; yaw: number; shade: number }
  /** grass: 80 (60 % round, 40 % bushy), r 11–32, gap 2.4, scale 1.8–2.4; longGrass: 100 (60 % bushy), r 10–30, gap 2.2;
   *  plain: 50 round, r 13–34, gap 3; sand: 8 palms, r 12–26, |x − centre.x| ≥ 9; pond: 60 round/bushy beyond its shore
   *  (r ≥ 17); all on the tall rule. */
  export function treePlacements(kind: ArenaKind, stage: Stage, seed: number): ArenaTree[];
  export interface ArenaClump { x: number; z: number; scale: number; yaw: number; shade: number }
  /** grass 900 (r 2.3–15, scale 0.85–1.1), longGrass 1500 (r 2–16; scale LONG_SCALE × 1.0–1.25 within r < 9, × 0.85–1.0
   *  beyond), plain 260 in 6–10 patches
   *  (r 5–16), sand 60 dry tufts, pond 300 on its shore band; outside the platforms × 1.15 and the 1.2-unit strip in front of
   *  the player platform; × 0.6 at low quality. */
  export function grassPlacements(kind: ArenaKind, stage: Stage, seed: number, quality: Quality): ArenaClump[];
  export function flowerPlacements(kind: ArenaKind, stage: Stage, seed: number): ArenaClump[];   // grass / plain: 120, r 3–14
  export const FLORA_PART: ArenaPart;   // grass, longGrass, plain, sand, pond
  ```
  Build: trees grouped by (style, variant) → `InstancedMesh(treeGeometry(style, variant, detail(quality)), kitMaterial(u, treeMaterial(style, linear(palette.trunk))))`, leaf colour × shade through instance colours (as the tree family), yaw, scale, `castShadow`; grass → `InstancedMesh(clump(BLADES[quality], v), GRASS_MATERIAL)`, colours `palette.blade × shade`; flowers → `InstancedMesh(flowerGeometry(), flowerMaterial(centre, leaf))`, petal colours from `[palette.accent, white, soft yellow, soft pink]`.
- Produces (`horizon.ts`): `ridgeGeometry(seed, stage, o: { r: number; height: [number, number]; arc: number; color: RGB }): THREE.BufferGeometry` (a band of rolling hills around the back and sides — angles ±`arc` from straight behind — profile from `noise2`, crest lighter; position, normal, color(3)); `HORIZON_PART` (grass, longGrass, plain, sand, pond, mountain): a near ring r 34 (height 2–5) and a far ring r 44 (height 4–9), `SOIL_MATERIAL`, no shadows, coloured from `palette.leaf` darkened (sand / mountain: their ground) — fog carries them into the distance.
- Produces (`dunes.ts`): `duneGeometry(seed, stage, color: RGB): THREE.BufferGeometry` — 12 soft mounds (half-ellipsoids rx 6–12, rz 3–6, height 1.2–3.5, noise, lighter crests) on the tall rule; `DUNES_PART` (sand), `SOIL_MATERIAL`, receive shadows.
- Produces (`rocks.ts`): `boulderGeometry(seed: number, size: number, color: RGB): THREE.BufferGeometry` (icosphere detail 1 displaced ±25 % by `noise3`, flat bottom at y = 0, flat normals, lighter top), `rockCluster(seeds…)` merging several; `ROCKS_PART`: plain 5 mossy (r 9–20), sand 9 desert rocks, grass 4, longGrass 3 — `CLIFF_MATERIAL`, cast + receive shadows.
- Produces (`sky.ts`):
  ```ts
  export class BattleSky {
    readonly mesh: THREE.Mesh;   // SphereGeometry(300) BackSide, renderOrder 10 (after the opaque arena), depthTest on at the
                                 // far plane (gl_Position = xyww), depthWrite off, fog off: hidden pixels are never shaded
    /** Gradient from look.fog (horizon) to a deeper look.sky (zenith); soft clouds (CLOUD_GLSL along skyCloudUv) for the
     *  outdoor, water and sky settings, lit by the sun side, dimmed at night; stars at night; flat colour for the others. */
    setLook(look: ArenaLook, setting: ArenaSetting, time: number): void;
  }
  ```

- [ ] **Step 1: Write the failing tests.** `tests/arenaScatter.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { scatter, stageKeepOut } from '../src/render/battle/parts/scatter';
import { STAGE } from '../src/render/battle/stage';

describe('scatter', () => {
  const ko = stageKeepOut(STAGE);
  const o = { centre: { x: STAGE.centre.x, z: STAGE.centre.z }, r0: 3, r1: 20, count: 200, minGap: 1, keepOut: ko.ellipses };
  it('is deterministic, inside its annulus, spaced, and outside the keep-outs', () => {
    const a = scatter(7, o), b = scatter(7, o);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(100);
    for (const p of a) {
      const r = Math.hypot(p.x - o.centre.x, p.z - o.centre.z);
      expect(r).toBeGreaterThanOrEqual(3); expect(r).toBeLessThanOrEqual(20);
      for (const e of ko.ellipses) expect(((p.x - e.x) / e.rx) ** 2 + ((p.z - e.z) / e.rz) ** 2).toBeGreaterThanOrEqual(1);
    }
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++)
      expect(Math.hypot(a[i].x - a[j].x, a[i].z - a[j].z)).toBeGreaterThanOrEqual(1 - 1e-9);
  });
  it('keeps tall things off the camera\'s side of the stage', () => {
    expect(ko.tallOk(STAGE.centre.x, STAGE.centre.z - 15)).toBe(true);
    expect(ko.tallOk(STAGE.centre.x + 2, STAGE.centre.z - 5)).toBe(false);   // too near
    expect(ko.tallOk(STAGE.centre.x + 8, STAGE.centre.z + 7)).toBe(false);   // where the camera swings at yaw 0.9
  });
});
```

  `tests/arenaFlora.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { treePlacements, grassPlacements, flowerPlacements } from '../src/render/battle/parts/flora';
import { stageKeepOut } from '../src/render/battle/parts/scatter';
import { STAGE } from '../src/render/battle/stage';

describe('arena flora', () => {
  const ko = stageKeepOut(STAGE);
  it('rings grass arenas with trees, all on the tall rule', () => {
    const t = treePlacements('grass', STAGE, 1);
    expect(t.length).toBeGreaterThanOrEqual(50);
    expect(t.every((x) => ko.tallOk(x.x, x.z))).toBe(true);
    expect(new Set(t.map((x) => x.style))).toEqual(new Set(['round', 'bushy']));
    expect(treePlacements('grass', STAGE, 1)).toEqual(t);
  });
  it('gives sand a few palms and long grass the densest, tallest grass', () => {
    const palms = treePlacements('sand', STAGE, 1);
    expect(palms.length).toBeLessThanOrEqual(10);
    expect(palms.every((x) => x.style === 'palm')).toBe(true);
    const g = grassPlacements('grass', STAGE, 1, 'medium'), lg = grassPlacements('longGrass', STAGE, 1, 'medium');
    expect(lg.length).toBeGreaterThan(g.length);
    const mean = (l: { scale: number }[]) => l.reduce((s, c) => s + c.scale, 0) / l.length;
    expect(mean(lg)).toBeGreaterThan(1.2 * mean(g));
    expect(grassPlacements('grass', STAGE, 1, 'low').length).toBeLessThan(g.length);
  });
  it('keeps grass off the platforms and flowers to grass and plain', () => {
    for (const c of grassPlacements('longGrass', STAGE, 2, 'high'))
      for (const e of ko.ellipses) expect(((c.x - e.x) / (e.rx / 1.25 * 1.15)) ** 2 + ((c.z - e.z) / (e.rz / 1.25 * 1.15)) ** 2).toBeGreaterThanOrEqual(1);
    expect(flowerPlacements('sand', STAGE, 1)).toHaveLength(0);
    expect(flowerPlacements('plain', STAGE, 1).length).toBeGreaterThan(50);
  });
});
```

  `tests/battleSky.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BattleSky } from '../src/render/battle/sky';
import { arenaLook } from '../src/render/battle/look';
import { arenaPalette } from '../src/render/battle/palette';

describe('BattleSky', () => {
  it('draws after the arena at the far plane, never writing depth', () => {
    const s = new BattleSky();
    const m = s.mesh.material as THREE.ShaderMaterial;
    expect(s.mesh.renderOrder).toBe(10);
    expect(m.depthWrite).toBe(false); expect(m.depthTest).toBe(true); expect(m.side).toBe(THREE.BackSide);
    expect(m.vertexShader).toContain('xyww');
    expect(m.fragmentShader).toContain('arenaClouds');
  });
  it('has clouds and night stars outdoors, a plain gradient indoors', () => {
    const s = new BattleSky(), u = (s.mesh.material as THREE.ShaderMaterial).uniforms;
    s.setLook(arenaLook('grass', arenaPalette('grass', null), 22), 'outdoor', 0);
    expect(u.uClouds.value).toBe(1); expect(u.uNight.value).toBe(1);
    s.setLook(arenaLook('gym', arenaPalette('gym', null), 22), 'indoor', 0);
    expect(u.uClouds.value).toBe(0); expect(u.uNight.value).toBe(0);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/arenaScatter.test.ts tests/arenaFlora.test.ts tests/battleSky.test.ts` → FAIL.
- [ ] **Step 3: Implement** the modules, the kit exports (exports only: the overworld's trees and flowers are built exactly as before), the parts' `catalogue` entries (trees: one `instancedColors` entry per `TREE_STYLES` style with `treeMaterial(style, …)`, PNC4, cast; grass: `GRASS_MATERIAL` `instancedColors` PNC; flowers: `flowerMaterial(...)` `instancedColors` PNC4; horizon / dunes: `SOIL_MATERIAL` `mesh` PNC (horizon no cast, dunes cast); rocks: `CLIFF_MATERIAL` `mesh` PNC cast), and `BattleSky` (shader includes `KIT_NOISE_GLSL` + `CLOUD_GLSL`).
- [ ] **Step 4: Run** `npx tsc --noEmit && npm test` → PASS.
- [ ] **Step 5: Look.** `npm run regress:live -- --label t7 --static --battles --gpu --compare p3-base --review --review-before p3-base`; on the review sheet for `b_grass`, `b_grass_night`, `b_double`, `b_longgrass`, `b_plain`, `b_sand`, `battle`, `battle_grass`, `battle_move`, `battle_intro`:
  - the top band of every outdoor shot is filled by a soft treeline (crowns merge into a canopy, no lollipop trees) with hills fading into the haze behind; sand shows dunes and a few palms instead;
  - grass reads lush and alive around the platforms (swaying, varied, flowers as small colour accents on grass/plain), long grass visibly taller and denser, nothing hides a battler or covers a platform top;
  - soft cloud shadows drift slowly over the ground (≤ 15 % darker, no hard edges);
  - night (`b_grass_night`): moonlit, readable, battlers lit (actor luminance gate as Task 5);
  - Modern beats "before" (today's cone grass and icosahedron trees) on every outdoor row; Retro 0.00 %.
  - budgets: calls ≤ 150, triangles ≤ 1.5 M on every Modern battle entry; `--ab --ab-feature battle --only battle,battle_grass,b_grass,b_longgrass,b_sand` Δgpu ≤ +3.0 ms, Δcpu ≤ +0.5 ms; `ModernArena.build` ≤ 60 ms warm.
- [ ] **Step 6: Commit** — `git add src/render/battle/sky.ts src/render/battle/parts/scatter.ts src/render/battle/parts/flora.ts src/render/battle/parts/horizon.ts src/render/battle/parts/dunes.ts src/render/battle/parts/rocks.ts src/render/battle/modernArena.ts src/render/battle/battleView.ts src/render/battle/catalogue.ts src/render/kit/trees.ts src/render/kit/flowers.ts tests/battleSky.test.ts tests/arenaScatter.test.ts tests/arenaFlora.test.ts && git commit -m "feat(battle): outdoor arenas — treelines, grass, flowers, dunes, rocks, horizon hills, sky with soft clouds and cloud shadows"`

**Gates:** Retro — 0.00 % everywhere; Modern overworld 0.00 % (the kit exports change nothing). Programs — drift guard passes (flora, horizon, dunes, rocks entries; `BattleSky` in the catalogue root); battle walks compile nothing.

**Acceptance:** the Step 5 bullets.

---

### Task 8: Water arenas — sea, pond, underwater (water, pond, underwater; water surfaces of cavePond and kyogre)

**Files:**
- Create: `src/render/battle/parts/water.ts`, `tests/arenaWater.test.ts`
- Modify: `src/render/battle/modernArena.ts` (`ARENA_PARTS` += `WATER_PART`), `src/render/battle/parts/flora.ts` (pond reeds use `grassPlacements('pond', …)` with tall, narrow scales), `src/render/battle/look.ts` (only if the review asks)

**Interfaces:**
- Consumes: `waterMaterial`, `SEABED_MATERIAL` (kit/water.ts; their returned option objects carry the hooks — no export needed), `boulderGeometry` (Task 7), `POND`, `CAVE_POND`, `groundHeight` (Task 6), `CLOUD_GLSL`.
- Produces:
  ```ts
  export interface WaterField { data: Uint8Array; w: number; h: number; min: [number, number] }
  /** The kit water shader's cells (1 unit, cell = (x, z − WATER_Y)): r = shore distance / 15 × 255 (BFS from land; sea
   *  kinds: 15 everywhere; ponds: a cell is water when its centre lies inside the POND / CAVE_POND ellipse), a = 255 on a sea
   *  rock's cell (the cell whose corner is the rock's integer (x, z): the shader's foam collar). 96 × 96 cells, min =
   *  [floor(centre.x) − 48, floor(centre.z − WATER_Y) − 48] (integer-aligned: the shader's rock lookup assumes it). */
  export function waterField(kind: ArenaKind, stage: Stage, rocks: readonly { x: number; z: number }[]): WaterField;
  /** waterMaterial(...) + cloud reflections: fragHead += CLOUD_GLSL, fragEmissive += the clouds seen along the reflected
   *  ray (skyCloudUv, as the sky), × fresnel × uSky × (1 − foam); hookKey 'arenaWater'. */
  export function arenaWaterMaterial(tex: THREE.Texture, min: THREE.Vector2, size: THREE.Vector2, tint: RGB): KitMaterialOptions;
  export function lilyPadGeometry(seed: number, radius: number, color: RGB): THREE.BufferGeometry;   // flat pad + notch + veins
  export function kelpGeometry(seed: number, color: RGB): THREE.BufferGeometry;   // 4 ribbons 2.5–5 tall, root at y = 0
  export const WATER_PART: ArenaPart;   // water, pond, cavePond, kyogre, underwater
  ```
  Content: **water** — a sheet disc (radius 60) at `WATER_Y` (renderOrder −1, receive shadows), 6–9 sea rocks at integer corners (r 9–30, tall rule) with foam collars, two low islets (rock mound + 2–3 palms) at r 26–36; **kyogre / cavePond** — the sheet over the pond ellipse (`CAVE_POND`; kyogre the whole disc), dark water from the palette, a few rocks (walls come in Task 9); **pond** — the sheet over `POND` + 1, 8–14 small lily pads on it (r 4–13, keep-outs), reeds along the shore (tall clumps, `palette.leaf` → reed green-brown), the shallows showing the sandy basin; **underwater** — no sheet: kelp forests (30–50, r 6–24, `GRASS_MATERIAL`'s sway, `palette.blade`), 8 rocks, the ground's caustics (`look.caustics`), blue fog.

- [ ] **Step 1: Write the failing test** `tests/arenaWater.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { waterField, lilyPadGeometry, kelpGeometry } from '../src/render/battle/parts/water';
import { POND } from '../src/render/battle/parts/ground';
import { STAGE, WATER_Y } from '../src/render/battle/stage';

const at = (f: ReturnType<typeof waterField>, x: number, z: number, ch: number) =>
  f.data[((Math.floor(z - WATER_Y - f.min[1])) * f.w + Math.floor(x - f.min[0])) * 4 + ch];
describe('arena water', () => {
  it('is deep everywhere on the sea and flags its rocks', () => {
    const rock = { x: Math.round(STAGE.centre.x + 5), z: Math.round(STAGE.centre.z - 20) };
    const f = waterField('water', STAGE, [rock]);
    expect(at(f, STAGE.centre.x, STAGE.centre.z, 0)).toBe(255);
    expect(at(f, STAGE.centre.x + 20, STAGE.centre.z - 30, 0)).toBe(255);
    expect(at(f, rock.x + 0.5, rock.z + 0.5, 3)).toBe(255);
  });
  it('measures the pond\'s shore distance from its banks', () => {
    const f = waterField('pond', STAGE, []);
    const cz = STAGE.centre.z + POND.dz;
    expect(at(f, STAGE.centre.x, cz, 0)).toBeGreaterThanOrEqual(Math.round((5 / 15) * 255));
    expect(at(f, STAGE.centre.x + POND.rx - 0.5, cz, 0)).toBe(Math.round((1 / 15) * 255));
    expect(at(f, STAGE.centre.x + POND.rx + 3, cz, 0)).toBe(0);
  });
  it('builds pads that float and kelp that stands tall', () => {
    const pad = lilyPadGeometry(1, 0.6, [0.4, 0.7, 0.3]); pad.computeBoundingBox();
    expect(pad.boundingBox!.max.y).toBeLessThan(0.08);
    const kelp = kelpGeometry(1, [0.3, 0.45, 0.2]); kelp.computeBoundingBox();
    expect(kelp.boundingBox!.min.y).toBeCloseTo(0, 2); expect(kelp.boundingBox!.max.y).toBeGreaterThan(2.4);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/arenaWater.test.ts` → FAIL.
- [ ] **Step 3: Implement** `water.ts` (the BFS is a local 4-neighbour flood from land cells, capped at 15, as `shoreDistance` does on a map — kept local so the overworld's water code is untouched), the part's catalogue entries (`arenaWaterMaterial` `mesh` PN no cast; `SOIL_MATERIAL` lily pads `mesh` PNC no cast; `GRASS_MATERIAL` reeds / kelp `instancedColors` PNC; rocks `CLIFF_MATERIAL` as Task 7; palms as Task 7's tree entry).
- [ ] **Step 4: Run** `npx tsc --noEmit && npm test` → PASS.
- [ ] **Step 5: Look.** `npm run regress:live -- --label t8 --static --battles --gpu --compare p3-base --review --review-before p3-base`; on `b_water`, `b_water_night`, `b_pond`, `b_underwater`, `b_cavepond`, `b_kyogre`:
  - the sea is the overworld's stylised water (shallow-deep tint, moving normals, sun glints) with soft clouds reflected near the top band and foam collars around the rocks; the ripple rings under the battlers animate; islets fill the top band;
  - the pond reads as a pond: lily pads, reeds, a visible sandy shallow edge, trees beyond the bank;
  - underwater: sandy seabed with drifting caustics, swaying kelp, blue haze, battlers lit (luminance gate);
  - night water keeps only a faint sheen and dark reflections; budgets as Task 7; Retro 0.00 %.
- [ ] **Step 6: Commit** — `git add src/render/battle/parts/water.ts src/render/battle/parts/flora.ts src/render/battle/modernArena.ts tests/arenaWater.test.ts && git commit -m "feat(battle): water arenas — sea with reflected clouds and rocks, pond with lily pads and reeds, kelp seabed"`

**Gates:** Retro — 0.00 % everywhere; Modern overworld 0.00 %. Programs — drift guard passes (`arenaWater` entry); battle walks compile nothing.

**Acceptance:** the Step 5 bullets.

---
### Task 9: Rock arenas — mountain, cave, cave pond, Groudon, Kyogre's cave

**Files:**
- Create: `src/render/battle/parts/rock.ts`, `tests/arenaRock.test.ts`
- Modify: `src/render/battle/modernArena.ts` (`ARENA_PARTS` += `ROCK_PART`)

**Interfaces:**
- Consumes: `boulderGeometry`, `stageKeepOut`, `scatter` (Task 7), `CLIFF_MATERIAL` (kit/cliffs.ts), `WATER_PART` (Task 8: cavePond and kyogre water).
- Produces:
  ```ts
  export interface WallBand { r: number; arc: number; height: [number, number] }
  /** An irregular cliff band facing the stage: columns every ≈ 1.2 units along the arc (± `arc` rad from straight behind),
   *  each a strip from GROUND_Y − 0.3 up to a noise height, 4 rows per unit displaced by noise3 (±0.35), strata in the vertex
   *  colours (darker at the foot, lighter bands), a rounded lip on top; normals towards the stage; position, normal, color(3). */
  export function rockWallGeometry(seed: number, stage: Stage, band: WallBand, color: RGB): THREE.BufferGeometry;
  export function stalagmiteGeometry(seed: number, height: number, color: RGB): THREE.BufferGeometry;   // displaced cone, faceted
  /** Irregular flat lava pools at GROUND_Y + 0.02 (position, normal), outside the keep-outs. */
  export function lavaGeometry(seed: number, stage: Stage): THREE.BufferGeometry;
  /** Emissive flowing lava: kitFbm2 crust over a hot core, slow flow with uTime; hookKey 'lava'. */
  export const LAVA_MATERIAL: KitMaterialOptions;
  export const ROCK_PART: ArenaPart;   // mountain, cave, cavePond, groudon, kyogre
  ```
  Content: **mountain** — a back band r 22 (arc 1.7, height 7–13), boulder clusters at the sides, scree (small boulders r 6–16; anything over 1 unit on the tall rule), gravel ground (Task 6); **cave** — a band r 17 (arc 1.75, height 10–16) closing the back and sides, 15–25 stalagmites (r 6–14, height 1.5–4, tall rule), dark fog; **cavePond** — the band r 21 behind the pond, stalagmites on its bank; **groudon** — the cave in volcanic rock (`palette.rock` towards dark red-brown), 3–5 lava pools (r 7–14) glowing in `palette.accent`; **kyogre** — the band r 24 in wet dark blue-grey rock around the dark water (Marine Cave).

- [ ] **Step 1: Write the failing test** `tests/arenaRock.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { rockWallGeometry, stalagmiteGeometry, lavaGeometry } from '../src/render/battle/parts/rock';
import { stageKeepOut } from '../src/render/battle/parts/scatter';
import { STAGE, GROUND_Y } from '../src/render/battle/stage';

describe('rock arenas', () => {
  const ko = stageKeepOut(STAGE);
  it('stands a wall band on the ground, facing the stage, tall enough to fill the top band', () => {
    const g = rockWallGeometry(1, STAGE, { r: 20, arc: 1.7, height: [8, 12] }, [0.5, 0.45, 0.4]);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeLessThanOrEqual(GROUND_Y);
    expect(g.boundingBox!.max.y).toBeGreaterThanOrEqual(7);
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    let facing = 0, ok = 0;
    for (let i = 0; i < p.count; i++) {
      if ((STAGE.centre.x - p.getX(i)) * n.getX(i) + (STAGE.centre.z - p.getZ(i)) * n.getZ(i) > 0) facing++;
      if (p.getY(i) < 1 || ko.tallOk(p.getX(i), p.getZ(i))) ok++;
    }
    expect(facing / p.count).toBeGreaterThan(0.7);
    expect(ok).toBe(p.count);
  });
  it('builds stalagmites of the asked height and lava pools that stay off the platforms', () => {
    const s = stalagmiteGeometry(2, 3, [0.4, 0.35, 0.3]); s.computeBoundingBox();
    expect(s.boundingBox!.max.y).toBeCloseTo(3, 0);
    const l = lavaGeometry(3, STAGE), p = l.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      expect(p.getY(i)).toBeCloseTo(GROUND_Y + 0.02, 5);
      for (const e of ko.ellipses) expect(((p.getX(i) - e.x) / e.rx) ** 2 + ((p.getZ(i) - e.z) / e.rz) ** 2).toBeGreaterThanOrEqual(1);
    }
    expect(l).toBeInstanceOf(THREE.BufferGeometry);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/arenaRock.test.ts` → FAIL.
- [ ] **Step 3: Implement** `rock.ts` (typed-array writers as the kit's cliffs do — `noise3` per vertex is ≈ 0.6 µs, keep the vertex count of a band ≤ 20 k; flat-shaded by `CLIFF_MATERIAL`), its catalogue entries (`CLIFF_MATERIAL` `mesh` PNC cast; `LAVA_MATERIAL` `mesh` PN no cast).
- [ ] **Step 4: Run** `npx tsc --noEmit && npm test` → PASS.
- [ ] **Step 5: Look.** `npm run regress:live -- --label t9 --static --battles --gpu --compare p3-base --review --review-before p3-base`; on `b_mountain`, `b_cave`, `b_cavepond`, `b_groudon`, `b_kyogre`: layered rock walls with strata close the top band (no flat cylinder pillars), stalagmites and boulders frame the stage without touching it, caves feel enclosed and dim yet the battlers stay lit (luminance gate), Groudon's lava glows (bloom, no blown-out battlers), Kyogre's dark water sits in its cave; budgets as Task 7; Retro 0.00 %.
- [ ] **Step 6: Commit** — `git add src/render/battle/parts/rock.ts src/render/battle/modernArena.ts tests/arenaRock.test.ts && git commit -m "feat(battle): rock arenas — cliff bands, stalagmites, boulders, lava (mountain, caves, Groudon, Kyogre)"`

**Gates:** Retro — 0.00 % everywhere; Modern overworld 0.00 %. Programs — drift guard passes (`lava` entry); battle walks compile nothing.

**Acceptance:** the Step 5 bullets.

---

### Task 10: Indoor halls — building, gym, Leader, Battle Frontier

**Files:**
- Create: `src/render/battle/parts/rooms.ts`, `tests/arenaRooms.test.ts`
- Modify: `src/render/battle/modernArena.ts` (`ARENA_PARTS` += `HALL_PART`)

**Interfaces:**
- Consumes: `BUILDING_BODY`, `BUILDING_GLASS` (kit/buildings.ts), `PROP_GLOW` (kit/props.ts), `SOIL_MATERIAL`, `stageKeepOut`.
- Produces:
  ```ts
  export interface RoomSpec { back: number; halfWidth: number; height: number; front: number }   // back / front: z from stage.centre
  export const HALLS: Readonly<Record<'building' | 'gym' | 'leader' | 'frontier',
    RoomSpec & { pillars: number; windows: number; banners: number; seats: boolean; lights: number }>>;
  /** Walls 0.4 thick across the back (z = centre.z + back) and down both sides to z = centre.z + front (≤ 4: the tall rule),
   *  a darker 0.35 baseboard, a lighter wainscot to 1.8 with a trim line, a crown trim; position, normal, color(3). */
  export function roomShell(spec: RoomSpec, stage: Stage, p: ArenaPalette): THREE.BufferGeometry;
  export function pillarGeometry(radius: number, height: number, color: RGB): THREE.BufferGeometry;   // base, shaft, capital
  /** Painted floor markings at GROUND_Y + 0.005 (a ring 1.15–1.25 × each footprint, a centre line, a ball circle at the centre). */
  export function courtLines(stage: Stage, color: RGB): THREE.BufferGeometry;
  export function bannerGeometry(width: number, height: number, color: RGB, stripe: RGB): THREE.BufferGeometry;
  export function seatTiers(stage: Stage, rows: number, color: RGB): THREE.BufferGeometry;   // stepped rows behind the back wall's arc
  export const HALL_PART: ArenaPart;   // building, gym, leader, frontier
  ```
  `HALLS`: building `{ back: −15, halfWidth: 20, height: 8, front: 4, pillars: 0, windows: 4, banners: 0, seats: false, lights: 0 }` (wooden floor, shelves as boxes along the back wall, windows of `BUILDING_GLASS`); gym `{ back: −17, halfWidth: 22, height: 10, front: 4, pillars: 6, windows: 0, banners: 3, seats: false, lights: 0 }` (court lines, banners in `palette.accent`); leader as gym with darker walls and 5 banners; frontier `{ back: −18, halfWidth: 24, height: 11, front: 4, pillars: 8, windows: 0, banners: 0, seats: true, lights: 6 }` (tiers of seats, light panels of `PROP_GLOW` high on the walls).

- [ ] **Step 1: Write the failing test** `tests/arenaRooms.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { roomShell, courtLines, pillarGeometry, HALLS } from '../src/render/battle/parts/rooms';
import { stageKeepOut } from '../src/render/battle/parts/scatter';
import { arenaPalette } from '../src/render/battle/palette';
import { STAGE, GROUND_Y } from '../src/render/battle/stage';

describe('indoor halls', () => {
  const ko = stageKeepOut(STAGE);
  it('closes the back and sides at the hall\'s size, never on the camera\'s side', () => {
    const s = HALLS.gym, g = roomShell(s, STAGE, arenaPalette('gym', null));
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.min.z).toBeCloseTo(STAGE.centre.z + s.back - 0.4, 1);
    expect(b.max.y).toBeCloseTo(GROUND_Y + s.height, 1);
    expect(b.max.x - b.min.x).toBeCloseTo(2 * s.halfWidth + 0.8, 1);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 1) expect(ko.tallOk(p.getX(i), p.getZ(i))).toBe(true);
  });
  it('paints court lines on the floor, around the platforms, not on them', () => {
    const g = courtLines(STAGE, [0.95, 0.95, 0.9]), p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      expect(p.getY(i)).toBeGreaterThanOrEqual(GROUND_Y); expect(p.getY(i)).toBeLessThanOrEqual(GROUND_Y + 0.01);
    }
    const pl = pillarGeometry(0.5, 9, [0.8, 0.8, 0.8]); pl.computeBoundingBox();
    expect(pl.boundingBox!.max.y).toBeCloseTo(9, 1);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/arenaRooms.test.ts` → FAIL.
- [ ] **Step 3: Implement** `rooms.ts` and its catalogue entries — each entry declares exactly the attribute set the part's geometry carries (position, normal, color(3): no `uv`): `BUILDING_BODY` `mesh` PNC cast (shell, pillars, banners, seats, shelves); `BUILDING_GLASS` `mesh` PNC cast (windows); `PROP_GLOW` `mesh` PNC no cast (light panels); `SOIL_MATERIAL` `mesh` PNC no cast (court lines).
- [ ] **Step 4: Run** `npx tsc --noEmit && npm test` → PASS.
- [ ] **Step 5: Look.** `npm run regress:live -- --label t10 --static --battles --gpu --compare p3-base --review --review-before p3-base`; on `b_building`, `b_gym`, `b_leader`, `b_frontier`: a real room (walls with thickness, trims, pillars) in the GBA's colours closes the top band, gym floors carry court lines around the platforms, banners in the arena's accent colour, the Frontier hall reads as a stadium (seat tiers, light panels glowing softly, no bloom blow-out); even indoor light, battlers lit (luminance gate); budgets as Task 7; Retro 0.00 %.
- [ ] **Step 6: Commit** — `git add src/render/battle/parts/rooms.ts src/render/battle/modernArena.ts tests/arenaRooms.test.ts && git commit -m "feat(battle): indoor halls — rooms, gym courts and banners, the Frontier stadium"`

**Gates:** Retro — 0.00 % everywhere; Modern overworld 0.00 %. Programs — drift guard passes; battle walks compile nothing.

**Acceptance:** the Step 5 bullets.

---

### Task 11: Stadium rooms and the Sky Pillar — Magma, Aqua, Sidney, Phoebe, Glacia, Drake, Champion, Rayquaza

**Files:**
- Create: `src/render/battle/parts/stadium.ts`, `src/render/battle/parts/skyPillar.ts`
- Modify: `src/render/battle/parts/ground.ts` (`GROUND_RADIUS`: 64, `rayquaza` 14 — the floor ends at the pillar's broken edge), `src/render/battle/modernArena.ts` (`ARENA_PARTS` += `STADIUM_PART`, `SKY_PILLAR_PART`), `tests/arenaRooms.test.ts`, `tests/arenaGround.test.ts`

**Interfaces:**
- Consumes: `rockWallGeometry`, `stalagmiteGeometry`, `lavaGeometry`, `LAVA_MATERIAL` (Task 9), `pillarGeometry`, `roomShell` (Task 10), `arenaWaterMaterial` (Task 8), `blobCrown` (kit/trees.ts).
- Produces:
  ```ts
  export type StadiumKind = 'magma' | 'aqua' | 'sidney' | 'phoebe' | 'glacia' | 'drake' | 'champion';
  export type StadiumProp = 'lava' | 'pipes' | 'candles' | 'crystals' | 'pillars' | 'fountains' | 'spikes';
  export interface StadiumTheme { walls: 'rock' | 'metal' | 'ice' | 'marble'; props: readonly StadiumProp[] }
  export const STADIUM_THEME: Readonly<Record<StadiumKind, StadiumTheme>> = {
    magma: { walls: 'rock', props: ['lava', 'pipes'] },          aqua: { walls: 'metal', props: ['pipes', 'fountains'] },
    sidney: { walls: 'rock', props: ['spikes'] },                phoebe: { walls: 'marble', props: ['candles', 'pillars'] },
    glacia: { walls: 'ice', props: ['crystals'] },               drake: { walls: 'rock', props: ['pillars', 'spikes'] },
    champion: { walls: 'marble', props: ['pillars', 'fountains'] },
  };
  /** Elongated octahedra in a cluster (faceted ice), position, normal, color(3). */
  export function crystalGeometry(seed: number, height: number, color: RGB): THREE.BufferGeometry;
  /** A raised ring step around the stage (the arena's rim): inner radius 6.0 around the centre (both platforms reach ≈ 4.4
   *  from it), 0.25 high. */
  export function arenaRimGeometry(stage: Stage, color: RGB): THREE.BufferGeometry;
  export const STADIUM_PART: ArenaPart;      // the seven stadium kinds
  /** The floor's jagged broken rim at r 14, dropping 3 units (faceted stone). */
  export function brokenEdgeGeometry(seed: number, stage: Stage, color: RGB): THREE.BufferGeometry;
  /** Soft cloud puffs (blobCrown blobs ≤ 1.5 radius, white with a cool underside) centred 4–7 units below the floor, r 16–40. */
  export function cloudSeaGeometry(seed: number, stage: Stage): THREE.BufferGeometry;
  export const SKY_PILLAR_PART: ArenaPart;   // rayquaza: the edge, pillar stumps, the cloud sea
  ```
  Walls by theme: rock → `rockWallGeometry` (r 18, arc 1.75); metal → a 16-sided panelled ring (`BUILDING_BODY`, `palette.wall` with darker seams); marble → `roomShell`-style polygon in pale stone with pillars; ice → `crystalGeometry` clusters forming the ring. Props in the theme's colours (`palette.accent`, `platformTop`, `rim`): lava pools (Magma), pipes (cylinders, metal), candles (`PROP_GLOW` flames on `PROP_BODY` stands, Phoebe's dim purple room), crystals (Glacia), pillars, fountains (small basins with `arenaWaterMaterial`), spikes (dark stalagmites: Sidney, Drake). Looks (Task 6 `arenaLook`, indoor) take each stadium's fog from its wall colour.

- [ ] **Step 1: Write the failing tests** — add to `tests/arenaRooms.test.ts`:

```ts
import { STADIUM_THEME, crystalGeometry, arenaRimGeometry } from '../src/render/battle/parts/stadium';
import { brokenEdgeGeometry, cloudSeaGeometry } from '../src/render/battle/parts/skyPillar';

describe('stadiums and the Sky Pillar', () => {
  it('themes every stadium kind', () => {
    expect(Object.keys(STADIUM_THEME).sort()).toEqual(['aqua', 'champion', 'drake', 'glacia', 'magma', 'phoebe', 'sidney']);
  });
  it('rings the stage with a low rim outside both platforms', () => {
    const g = arenaRimGeometry(STAGE, [0.8, 0.8, 0.8]), p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) expect(Math.hypot(p.getX(i) - STAGE.centre.x, p.getZ(i) - STAGE.centre.z)).toBeGreaterThanOrEqual(6.0 - 1e-6);
    g.computeBoundingBox(); expect(g.boundingBox!.max.y).toBeLessThanOrEqual(GROUND_Y + 0.26);
  });
  it('drops the Sky Pillar\'s floor at its broken edge into a sea of clouds', () => {
    const e = brokenEdgeGeometry(1, STAGE, [0.7, 0.7, 0.75]); e.computeBoundingBox();
    expect(e.boundingBox!.min.y).toBeLessThanOrEqual(GROUND_Y - 2.5);
    const c = cloudSeaGeometry(1, STAGE); c.computeBoundingBox();
    expect(c.boundingBox!.max.y).toBeLessThan(GROUND_Y - 2);
    const x = crystalGeometry(1, 3, [0.7, 0.85, 1]); x.computeBoundingBox();
    expect(x.boundingBox!.max.y).toBeCloseTo(3, 0);
  });
});
```

  and to `tests/arenaGround.test.ts`: `expect(groundHeight('rayquaza', STAGE.centre.x, STAGE.centre.z - 13, STAGE)).toBe(GROUND_Y)` and that the `rayquaza` ground mesh's bounding radius around the centre is ≤ 14.5 (build it through `GROUND_PART.build`).
- [ ] **Step 2: Run** `npx vitest run tests/arenaRooms.test.ts tests/arenaGround.test.ts` → FAIL.
- [ ] **Step 3: Implement** both parts and `GROUND_RADIUS`, their catalogue entries (only materials already defined elsewhere: `CLIFF_MATERIAL`, `BUILDING_BODY`, `PROP_BODY`, `PROP_GLOW`, `LAVA_MATERIAL`, `arenaWaterMaterial`, `SOIL_MATERIAL` for the clouds — with the attribute sets these parts build).
- [ ] **Step 4: Run** `npx tsc --noEmit && npm test` → PASS.
- [ ] **Step 5: Look.** `npm run regress:live -- --label t11 --static --battles --gpu --compare p3-base --review --review-before p3-base`; on `b_magma`, `b_aqua`, `b_sidney`, `b_phoebe`, `b_glacia`, `b_drake`, `b_champion`, `b_rayquaza`: each room is recognisable from its GBA colours and its theme (Magma's lava and pipes, Aqua's blue metal and water, Sidney's dark spikes, Phoebe's candle-lit purple gloom, Glacia's ice crystals, Drake's rock and pillars, the Champion's marble and fountains), the Sky Pillar's broken floor hangs over a sea of clouds; battlers lit in every room (luminance gate, Phoebe and Sidney included); budgets as Task 7; Retro 0.00 %.
- [ ] **Step 6: Commit** — `git add src/render/battle/parts/stadium.ts src/render/battle/parts/skyPillar.ts src/render/battle/parts/ground.ts src/render/battle/modernArena.ts tests/arenaRooms.test.ts tests/arenaGround.test.ts && git commit -m "feat(battle): stadium rooms (hideouts, Elite Four, Champion) and the Sky Pillar"`

**Gates:** Retro — 0.00 % everywhere; Modern overworld 0.00 %. Programs — drift guard passes; battle walks compile nothing.

**Acceptance:** the Step 5 bullets.

---

### Task 12: Performance, robustness and documentation

**Files:**
- Modify: whatever the checks below require (keep fixes small; anything larger goes back to the controller), `README.md`, `CLAUDE.md`

- [ ] **Step 1: Full run.** `npm run regress:live -- --label p3 --static --gpu --selftest --compare p3-base --review --review-before p3-base` (both styles). Check every Global Constraint with numbers: Retro 0.00 % on every entry; Modern overworld and `transition` 0.00 %; calls ≤ 150 and triangles ≤ 1.5 M on every Modern battle entry; battle self-tests within tolerance; actor luminance 0.9–1.15 (median ≥ 0.95) on battle entries; `battle_enter` / `battle_exit` / `battle_switch` gates; arena builds ≤ 60 ms warm on every kind (`preview.measureArenaBuild()`).
- [ ] **Step 2: Interleaved A/B.** `--ab --ab-feature battle` and `--ab --ab-feature battlers` (64 quads) on every live battle entry and `b_grass`, `b_longgrass`, `b_water`, `b_cave`, `b_gym`, `b_frontier`, `b_champion`; one `--ab-aa` run on two of them for the noise floor. Budgets: battle Δgpu ≤ +3.0 ms / Δcpu ≤ +0.5 ms; battlers ≤ +1.0 / +0.5 ms. Over budget: profile (sky overdraw, terrain fragment cost, shadow casters beyond the shadow camera, tree crown detail) and fix, or report with numbers for a controller ruling.
- [ ] **Step 3: Quality levels and DPR.** `--query quality=high --only battle,battle_move,b_grass,b_water,b_cave,b_gym` (GTAO: no dark quads at the arena origin — the battle cards and inflated mesh skip GTAO's prepass —, programs stable through the walks) and `--query quality=low` (fewer clumps, no tilt-shift, still a full arena); `--dpr 2 --styles modern --only battle,b_grass,b_water` (no page errors, crisp HD edges).
- [ ] **Step 4: Robustness.** `b_grass_fail` (Modern: today's arena with inflated battlers, one warning); every battle entry with `--query actorUniforms=0` equals the uniform path (0 px, Modern); V during a battle (`emu.renderer.mode = 'classic'` as an entry step) shows the GBA screen and back; a style switch inside each arena kind's preview (`preview.setStyle` twice) returns 0 px from its own shot.
- [ ] **Step 5: Live sanity by eye.** `npx tsx tools/shot3d.ts --state out/fuzz.state --wait 3000` and `--state out/battle1.state --keys "A:100"` (a move animation), then from `out/r101.state` walk into tall grass until a wild battle starts (`--keys "LEFT:1800,DOWN:300,UP:4000"`, or hold the keys of `battle_enter`'s state): the battle starts without a stall, the Modern arena matches its GBA background, battle → Route 101 returns cleanly, no console errors.
- [ ] **Step 6: Docs.** `README.md`: Phase 3 (Modern battle arenas per GBA background, inflated battlers, what stays: effect cards, HUD, BG layers as 2D overlay). `CLAUDE.md`: `npm run regress:live -- --battles [--review --review-before <label>]`, the `?battle=<kind>&player=&enemy=` preview, `p3-base`, `--ab-feature battle|battlers`. In the report, every known gap for the controller's progress log, at least: affine rotation and OBJ mosaic not reproduced (both styles); GBA blend registers (semi-transparent / brightened effects) not emulated; the sky dome shows only through water reflections and cloud shadows (the camera never frames the horizon); double battles share the two platforms; the Frontier facilities share one hall; trainer intro pictures inflate like battlers; full-screen BG move effects stay the 2D overlay; today's (Retro) arena still exceeds 150 draw calls on outdoor kinds.
- [ ] **Step 7: Commit** — `git add -A src tools tests README.md CLAUDE.md && git commit -m "docs+polish: Phase 3 performance checks, battle harness docs"` (check `git status` first: never `out/`, states or the ROM).

**Gates:** Retro — 0.00 % on every entry (the final full run). Programs — drift guards (battle, overworld) pass; every battle walk compiles nothing at Medium and High.

**Acceptance:** every Global Constraint verified with numbers in the report.

---

## Self-review

**Spec §7 coverage:** arena rebuilt from kit generators per battle environment as today, colours sampled from the battle terrain background — Tasks 2 (`arenaKind`, `sampleArenaColors`), 6 (palette, ground on `terrainMaterial`), 7 (trees from `treeGeometry`/`treeMaterial`, grass `clump`/`GRASS_MATERIAL`, flowers, dunes, rocks), 8 (`waterMaterial` water shader, seabed caustics), 9 (rocks/cliffs from `CLIFF_MATERIAL`, cave walls), 10 (indoor room from `BUILDING_*`); special arenas (gyms, the Elite Four, the Frontier, hideouts, legendaries) — Tasks 2 (D2), 10, 11. Modelled platforms per terrain (earth disc with grass skirt, sand mound, stone slab, lily pad / ripple ring, cave rock) — Task 6. Battlers use Phase 2 inflation with silhouette shadows, xBR and the Sprite edges setting — Task 5; move-effect sprites stay billboards, reference-camera choreography unchanged — Tasks 4 (verbatim `battleCardSpec`, `Stage`), 5 (D5, D6, D8). Sky: gradient dome with procedural soft clouds for outdoor environments — Task 7 (D1 ⚑: visible through reflections and cloud shadows, Task 8). §9: unit tests for the pure parts (kinds, sampling, palette, look, placements, geometry), ROM smoke tests (`battleGraphics`), save-state and static visual regression with GBA references (Tasks 1, 3, every arena task's review). §10: calls / triangles / interleaved GPU and CPU budgets, arena build ≤ 60 ms, battle walks ≤ 150 ms frames, quality scaling (blades per clump, clump counts, crown detail, shadow map size) — Global Constraints, Tasks 5–12. §11: per-part try/catch → today's arena, logged once per kind (Task 4), inflated fallbacks (Task 5), V (Task 12). §12: no hand-modelled characters, no game-logic change, no downloads. Phase 2 carry-overs: `instanceUniformsFit` passed by the battle caller (Tasks 4–5), `BATTLE_INFLATE` instead of a smaller `MAX_ACTORS` (the battle scene's vertex uniforms fit), Phase 2's luminance band and A/B method (Tasks 5, 12). Hitch-fix carry-over: battle programs compiled at boot with their own catalogue and drift guard (Task 4), extended by every arena task.

**Placeholder scan:** every step names its files, functions and commands; frame counts and tuning constants are given as starting values with the rule that ends their tuning (as Phase 2).

**Interfaces used across tasks:** `ArenaKind`, `ARENA_KINDS`, `arenaKind`, `arenaInputsFor`, `ARENA_SETTING` (T2 → T3–T12); `decodeBg3`, `sampleArenaColors`, `defaultArenaColors`, `colorsKey` (T2 → T3, T4, T6); `readBattleBackground`, `installBattleBackground`, `readMonPic`, `battlerScreenPos`, `readEnemyShadow` (T2 → T3); `previewBattleSprites`, `BattlePreviewApp.setStyle` / `measureArenaBuild` (T3 → T4, T6, T12); `STAGE`, `GROUND_Y`, `WATER_Y`, `PLATFORM_FOOTPRINT`, `Footprint` (T4 → T5–T11); `battleRoute`, `battleCardSpec`, `battleDecalSpec`, `BattleActors` (T4 → T5); `ArenaPart`, `CatalogueEntry`, `ArenaContext` (+ `palette`, `ground`, `look` from T6), `ARENA_PARTS`, `ModernArena`, `ArenaColorLock` (T4/T6 → T7–T11); `battleCatalogue`, `legacyArenaMeshes` (T4 → T7); `BATTLE_INFLATE`, `BATTLE_VARIANT`, `instanceUniformsFailed(programs, tag)` (T5); `arenaPalette`, `arenaLook`, `timeOfDay`, `nightFactor`, `CLOUD_GLSL`, `arenaGroundMaterial`, `groundHeight`, `POND`, `CAVE_POND`, `PLATFORM_STYLE` (T6 → T7–T11); `scatter`, `stageKeepOut`, `boulderGeometry`, `treeGeometry`, `flowerGeometry`, `BattleSky` (T7 → T8–T11); `arenaWaterMaterial` (T8 → T11); `rockWallGeometry`, `stalagmiteGeometry`, `lavaGeometry`, `LAVA_MATERIAL` (T9 → T11); `roomShell`, `pillarGeometry` (T10 → T11).
