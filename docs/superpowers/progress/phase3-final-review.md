# Phase 3 (battles) — final whole-branch review

Three parallel area reviews at b8b384e (A: battle core/actors/harness; B: arena framework, outdoor/water/rock parts, kit; C: halls/stadiums/Sky Pillar, palette/look, docs), 0 critical findings. One fix wave in four parallel fixers (FW-1, FW-2, FW-3, 12-high), each with a scoped re-review (all addressed), then a final full regression gate (p3final @ f50992b, 16/16 pass). Rulings: phase3-sdd-ledger.md.

---

## Area A — ### Strengths

- **Retro identity is protected by construction, not only by the gates.**
  - `stage.ts` is a verbatim move of the reference projection, down to the zero additions.
  - Today's arena is built lazily, but with exactly today's calls at today's frames. `updateArena` keeps the env-change → `setEnvironment` → throttled `sampleTerrain` → `setColors` order of the base `sampleTerrain`.
  - The Retro branch of `BattleView.update` restores every value the Modern look touches: hemisphere colours, fog range, exposure, `uNight` and `uSky`.
  - `applyShadows('retro')` resolves to today's 2048 / radius 1 at every quality (`shadowSettings` returns that for Retro).
- **The precompile design is sound and well isolated.**
  - The battle catalogue has its own kit uniforms and pool, so builds never take its materials.
  - The legacy arena materials are deliberately not disposed, so their programs outlive the catalogue.
  - The shadow-depth stand-ins are compiled with `scene.fog` nulled. This matches the shadow pass, which draws with `_emptyScene`.
  - Screen programs are compiled twice over: in parallel at construction and drawn once as a backup.
  - The battle precompile frame is never drawn inside an overworld frame.
  - The drift guard covers 24 kinds × 3 qualities plus environments 0–9 of today's arena, in both directions.
- **b8b384e's root cause is right, and its fix closes the battle side completely.** I checked three r186's `setProgram`: for the GTAO normal material, the only unchecked geometry-dependent program parameter is `vertexNormals`. I then checked every geometry the battle scene can draw:
  - the kit families (trees, grass, flowers, soil, terrain, water, buildings, geom);
  - every arena part (ground, platforms, dunes, horizon, rock/rocks, rooms, stadium, sky pillar, water);
  - today's arena (built-in three geometries);
  - both skies and the inflated battlers.

  Every one carries a `normal` attribute. The cards were the only normal-less mesh. So no other draw-order-dependent override program remains in the battle scene. The overworld side is covered under Issues.
- **The battle field is its own instance (D4) and recomputes only when needed.**
  - Recompute is keyed on slot rects plus `battlerAlphaKey`, which hashes the full colour indices. The baked xBR follows `battlerPaletteKey`.
  - Context restore invalidates both the field and the bake, in live play and in the preview, with a test.
  - Nothing of the battle's field can reach the overworld's: two `SpriteField`s share only the atlas, and the overworld recomputes its field every sync.
- **The game-state reads are guarded, and the arena kind matches the GBA.**
  - The trainer index is bounds-checked against `SYM_SIZE.gTrainers / 0x28`. The monbg task id must be below 16 and its task's function must be `Task_UpdateMonBg`.
  - `battlerCopies` and the monbg history are cleared outside battles.
  - `arenaKind` matches `DrawMainBattleBackground` line by line. I checked it against `vendor/.../battle_bg.c` and `constants/battle.h` / `trainers.h`.
  - `CB2_InitBattleInternal` zeroes VRAM and loads BG3 and its palette before it sets `gMain.inBattle`. So the colour lock cannot freeze a stale picture from a previous battle.
- **The harness gates that matter are non-vacuous.**
  - `samePrograms` catches a compile caused by the switch in both start styles.
  - The first-world-build exemption covers exactly one frame, and only when no build happened before the walk.
  - The self-test tolerance comes from the result's own `inflateMax`, and a NaN fails.
  - `bakedVsLive` is gated at 0.
- **The tests are meaningful.**
  - `battleCamera.test` holds BattleView's camera to scatter's model through the intro, the yaw limits and the zoom limits.
  - `battleActors.test` covers routing, decals, doubles, zero scale, the monbg history against a real `GameState`, the fade overlay, the override-pass fix and the attribute fallback.

### Issues

#### Critical
None.

#### Important

**I-1. The `battle_enter` no-compile gate cannot see the transition into the battle.**

Where (all at b8b384e):
- `tools/regress-live.ts:205`: the entry.
- `:1016`: `settled` is taken after step 0.
- `:439`: `programs: [settled.programs, end.programs]`.
- `:462`: the gate.

What is wrong:
- A scene-change walk counts programs from the end of its ≥ 30-frame idle settle.
- For `battle_enter`, frames 1–30 of `wild_transition.state` are the overworld's first frame and the first third of the wild battle transition (frames 1–86). The transition effect first draws there.
- That compile is exactly the one Task 1's review flagged: "battle_enter's transition-FX compile happens inside the mandatory settle — Task 4's precompile must include it (or check it separately)".
- Task 4 added it to `compileScreensAsync` / `compileScreens`, but nothing checks it. If that precompile regressed, or the effect's drawn variant drifted from the compiled one (canvas vs target), the gate would still report "programs 97 → 97 (gated: passed)".
- The same blind spot hides any compile on the overworld's first frame after the eval.

Why it matters:
- "Entering a battle compiles nothing" is a Global Constraint, and the transition is part of the entry.
- The gate passes vacuously for the one compile Phase 3 already found there. Today nothing compiles there, as far as the runs show, so this is a gate gap rather than a live bug.

How to fix: for `sceneChange` entries, take a program snapshot right after `e.eval` (before step 0) and gate `programs[end] === programs[afterEval]`. Keep the settle only for the frame-time and first-build exemptions. The eval has already drawn both precompile frames and the screens, so the settle should compile 0.

#### Minor

**M-1. The monbg copy history counts syncs, not emulated frames** (`src/game/state.ts:253-268`, with `renderer.ts:188` / `:407`).

- `battlerCopies` = "task lives at this sync and lived at the previous one". This assumes exactly one emulated frame per sync.
- When a render follows two or more emulated frames, the overlay already shows the copy while `battlerCopies` is still empty. This happens below 60 fps, in fast-forward (up to `FAST_FORWARD*2` frames per tick), and with the harness's multi-frame steps. The inflated battler and its flat copy then show together for one rendered frame.
- A `resync` (style switch, settings panel) runs `st.update()` twice on the same emulated frame. That can hide the battler one frame before the copy appears.
- Cosmetic and one frame long.
- Fix: carry the history in emulated-frame terms, e.g. key it on a frame counter (`gMain.vblankCounter1`) and treat "the task appeared ≥ 1 frame ago" as copied.

**M-2. The battle precompile's one-macrotask deferral is defeated in normal boot** (`src/render/renderer.ts:135` and `:296`; `src/main.ts:169` → `:254`).

- The constructor defers `battle.precompile` with `setTimeout(0)`, to split the boot long task (Task 4 ruling).
- But `main.ts` calls `renderer.precompiled()` synchronously after `new Renderer` whenever there is no `?state=`. `precompiled()` starts `battle.precompile` at once, so the ten legacy arenas and the parts' catalogue are built in the same task as the overworld's.
- Only manual and autostart runs (the harness) get the split. The measured "construction long task" is therefore not what players see behind the loader.
- Fix: have `precompiled()` await one macrotask before starting the battle's precompile, if it has not started.

**M-3. `BattleView.update` still allocates per frame** (`src/render/battle/battleView.ts:513`, `:522`, `:530`, `:543`).

- The allocations are `STAGE.at(...)` without `out`, plus `new THREE.Vector3` for the focus point, `dir` and the sun offset.
- This was a Task 4 minor deferred to "Task 12". It was not in the 12a brief, Task 12 did not take it, and it is not listed as a known gap: a dropped deferral.
- Fix: four module-level scratch vectors. This is pixel-neutral; it uses the same operations, as `stage.ts` did.

**M-4. Two helpers for one job, and the overworld keeps the at-risk one** (`src/render/battle/battleActors.ts:226` vs `src/render/actors/actorLayer.ts:147`).

- `skipOverridePassesOwnProgram` is a near-copy of Phase 2's `skipOverridePasses`. It detects the pass via `scene.overrideMaterial` and adds `allowOverride = false`. It lives in `battleActors.ts` rather than beside its sibling.
- The overworld's cards, blob shadows and contact shadows (normal-less) keep the draw-order-dependent override variant.
- Phase 3 makes that risk more reachable. PostFX's one GTAO normal material now carries its last program across scene switches and the boot battle precompile frame: `needsLights` is false for `MeshNormalMaterial`, so no light check resets it. The overworld's first override draw after a battle therefore starts from a battle-keyed program, in an order the overworld precompile never saw.
- Fix: one helper in `actorLayer.ts` (own program, override-scene detection), used by both views. Verification is 12-high's scope; see Declined.

**M-5. Today's battle light is spelled out three times with no shared source or drift test.**

- `battleView.ts:61-63` `TODAY_LIGHT` re-derives the Retro `charLight` formula (0.75/0.72/0.68) from literal intensities (1.15/2.4, 0.7/0.6, 1.6/1.6) copied from the Retro branch (`:549-559`).
- `FOG_NEAR` / `FOG_FAR` / `HEMI_SKY` / `HEMI_GROUND` (`:54-55`) are defined, but the constructor (`:79`, `:162`) repeats the literals.
- `stage.ts` `GROUND_Y` (= `BattleArena.group.position.y`) and `PLATFORM_FOOTPRINT` (radii 2.1 / 1.9, × 0.62) copy `arena.ts` literals without a test.
- The Modern battlers' exposure target (the actor-luminance gate's basis) silently drifts if Retro's light changes.
- Fix: one `TODAY_LIGHTS` table used by the constructor, the Retro branch and `TODAY_LIGHT` (same values, so Retro stays 0 px). Add a node test that `new BattleArena().group.position.y === GROUND_Y`, plus the platform radii.

**M-6. Dead exports left by later tasks.**

- `battleView.ts:37` re-exports `isBattleHudSprite`, but nothing imports it from there.
- `isEnemyShadow` and `PLATFORM_PLAYER_SCREEN` are exported but only used in their own module.
- Fix: drop the exports.

### Declined to judge

- High-quality GTAO print-through on the inflated battlers, the seeded GTAO noise and overworld walks at High: owned by the parallel fixer 12-high (and work in progress in the tree). M-4 records the shared-normal-material angle for them.
- GPU and CPU budgets, A/B readings and build times: not re-measurable here (GPU in use). I took them from task-12-report.md and the ledger's rulings.
- The arena parts' internals (`modernArena.ts`, `parts/*`, `look.ts`, `palette.ts`, the kit) and the look: reviewers B and C.
- Behaviours unchanged since before Phase 3:
  - the intro sweep replays only on an environment change, so a same-environment battle starts settled;
  - `BattleArena.setEnvironment` leaks old prop geometries and textures (`arena.ts` is frozen);
  - the battle scene is presented while `inBattle` with any CB2 (evolution, party menu).
- The actor-luminance check is report-only by Phase 2's design. `battle_intro` yields no value (< 200 px visible in both masks). I did not chase why without running the harness.

### Assessment

**Ready to merge (area A): With fixes.**
- No crash, leak or Retro / overworld pixel risk found.
- The lifecycle, style and V switches, context restore, the catalogue (all qualities, and High's override passes on the battle side) and the game-state reads hold up.
- I-1 should be fixed before merge: a small harness change, so the entry gate actually covers the transition compile Task 1 found. The minors can ride along or go to the backlog.

### Passes done

1. **Inputs.** Common brief, ledger (all rulings and deferrals), plan header, Global Constraints and Review Focus, Tasks 1–5, task-12-report, spec §7 / §9–§12.
2. **Diff.** Every area-A file at b8b384e (`git diff 90d5e77..b8b384e` and `git show`), plus the base `battleView.ts`, for the Retro-identity comparison.
3. **Lifecycle.** Traced through `Renderer.syncFromEmulator` / `render`, `BattleView` state, `main.ts` boot and the V toggle: enter, exit, same-kind re-entry, style and filter switches, V, context loss and restore, precompile failure, quick start.
4. **Program catalogue.**
   - Drift-guard scope, colour and hour independence of part materials, legacy environments, actors and skies, stand-ins.
   - three r186 `compile` / `compileAsync` / `setProgram` / `getParameters` semantics.
   - A normal-attribute audit of every battle geometry for the override-pass question.
5. **Game-state reads.** Checked against the decomp: `CB2_InitBattleInternal` order, `DrawMainBattleBackground`, `struct Trainer` / `Task` / `MapHeader` / `PaletteFadeControl` offsets, battle-type and trainer-class constants.
6. **Harness vacuity.** Scene-change, crossing-style settle, `sameAs` / `samePrograms`, self-test and xBR gates, luminance, the A/B feature switches.
7. **Tests in area A.** For assertions that hold nothing, restated formulas, single camera states.

---

## Area B — # Phase 3 final review, area B: the arena framework and the outdoor, water and rock parts

Reviewer B. Commit b8b384e (range 90d5e77..b8b384e). Files: `src/render/battle/modernArena.ts`;
`parts/{ground,platforms,scatter,flora,horizon,dunes,rocks,water,rock}.ts`; the `src/render/kit/` diff (catalogue,
flowers, materials, terrain, trees); their tests.

Passes done:
1. **Inputs.** Spec §7 and §9–§12. The plan's header, Global Constraints, Review Focus, D1–D11 and the Task 6/7 interfaces. The whole ledger. The Task 12 report (gates, build timings).
2. **Framework.** `modernArena.ts` line by line: the lock, build, the identity fast path, the try/catch, clear/dispose, covers and withFailingPart. Also its call sites in `battleView.ts` (updateKind, modernColors, updateArena, arenaFailPart), and the decomp's battle init order (relevant to the lock).
3. **Parts.** Every file in the area, checked for:
   - lifecycle: build textures, pooled kit materials, shared kit geometry;
   - program coverage: each part's catalogue entries against what it builds, across quality, night, colours, Low culling and cast or no-cast;
   - per-frame hooks;
   - render order and depth interplay.
4. **kit identity.** The full kit diff. Checked:
   - how program keys and hooks are built, the depth twins and the pool keys;
   - GLSL control flow: uniform against non-uniform branches, derivatives, exactness of `mix(a, b, 0)`;
   - the session geometry caches shared with the overworld (clump, tree, flower);
   - whether the overworld drift guard covers every quality.
5. **Duplication.** `git grep` across the battle parts for index, GLSL, behind-battler, camera and night helpers.
6. **Tests.**
   - Read the nine area tests plus battleCatalogue, battleRenderOrder and battleCamera.
   - Ran 11 files: 73 tests, all pass.
   - Ran throw-away tsx probes in %TEMP% (deleted afterwards): kit geometry heights against the constants copied from them, flower tops against the sight lines, the grass sight cap at sway-extended yaws, and bare trunks at sway-extended yaws.

### Strengths
- **ModernArena's fallback is sound.**
  - One try/catch wraps the foundation and every part. The failing part is named in a single `console.warn` per kind.
  - The key is set before the build, so a failing (kind, quality, colours) is not retried every frame. The build's `failed` result sends the view to today's arena.
  - The identity fast path plus ArenaColorLock's fresh objects make the per-frame call allocation-free.
  - The lock cannot freeze stale VRAM at battle start. `CB2_InitBattleInternal` clears VRAM (battle_main.c:626) and loads the background (677) before it sets `gMain.inBattle` (703), and `sceneOf` waits for that flag.
- **Disposal on rebuild is complete.**
  - `clear()` hands every kit material back to the pool. A material shared by several meshes is released once (the `inUse` guard).
  - It disposes non-shared geometry and instance buffers, plus every build texture. All three DataTextures created in this area are pushed to `ctx.disposables`: ground cells, top cells and the water field.
  - Shared kit geometry (`clump`, `treeGeometry`, `flowerGeometry`) is flagged `userData.shared` and never disposed.
  - Pooled colours touched by night hooks are reset by `configure()`.
  - The glow parts reset `emissive` in `onAfterRender`.
- **The kit changes are identity-safe by construction**, beyond what the 0 px gates show:
  - `vertHead`/`vertWorld` join the program key only when present, so every overworld key is byte-identical.
  - The terrain soil branch is exact: `mix(col, soil, 0.0) == col`, with only arithmetic and `texelFetch` inside it.
  - The warp `if` is a uniform branch.
  - The trees and flowers changes are renames only. `treeCrownDetail` is the old closure.
  - The ShaderMaterial hash and the material-array signature only make the guards stricter.
  - The overworld drift guard covers low, medium and high (Modern) plus Retro. No kit change touches night.
- **Program coverage is complete in this area.** No part picks a program by colour, hour or doubles. Low culling, near and far trees, the pond rim and Groudon's pools are all held both ways by `battleCatalogue.test.ts` at every quality.
- **The flora placement cache (abf97d4) holds up.**
  - The key is complete: kind, seed, and quality for grass; the stage through a WeakMap. The trees' `where` reads dunes cached on the same seed.
  - It is bounded: five kinds × one seed × three qualities.
  - It is mutation-safe: the getters return `readonly Readonly<>`, every consumer copies through `filter`, `byCameraDistance` or a spread, and `sink` is written only inside `make*`. No code mutates `STAGE`'s vectors (grepped).
- **Render order and depth are right.**
  - The order is documented once (ground.ts:388–402) and held, group order included, by `battleRenderOrder.test.ts`.
  - The deep water is opaque and drawn first: seabed, basins, Kyogre's band foot, the lily pads' edge bands and the sunk water rocks are depth-rejected under it.
  - The pond rim (transparent, −1) blends before the ripple rings, decals and shafts.
  - The tops at 2.5 and the ground at 3 meet nothing at equal depth.
- **Several tests are strong**, being real oracles rather than restatements:
  - the shader-evaluating worn-ring test (`glslEval`);
  - the analytic pond shore with kink and crossing checks, plus the disc's own triangles;
  - real-camera oracles for the intro sweep and the zooms (bare trunks, grass against platform tops);
  - the raycast talus test.

### Issues

#### Critical
None.

#### Important

**I1. The "keep out of a battler's background" rule is copied four times, its constants twice.**
- **Where:**
  - water.ts:367–368 (`BEHIND_HALF = 3.5`), 381–384 (`behindBattler(stage, x, z, reach = Infinity)`), 386 (`BEHIND_REACH = 12`, private);
  - rock.ts:227–234 (`BEHIND_HALF = 3.5`, the same `behindBattler`, `export const BEHIND_REACH = 12`);
  - rocks.ts:83–84 and 99 (`BEHIND_HALF = 3.5`, an inline `behind` with no reach);
  - rock.ts:456–457 (the same predicate with `LAVA.behind {half: 2.2, reach: 8}`).

  The tests re-implement it again (arenaRock.test.ts:86–87, arenaWater.test.ts:222).
- **Why it matters:** this is a composition rule every scenery part must agree on. Tuning one copy, for example rock.ts's exported `BEHIND_REACH`, silently leaves the sea's rocks and islets, the kelp and the field rocks on the old value. The tests pin each copy with its own literal.
- **Fix:** one `behindBattler(stage, x, z, o?: { half?: number; reach?: number })` with exported `BEHIND` defaults in scatter.ts, next to `stageKeepOut`/`arenaClear`. Use it in water, rock, rocks and lavaPools, and import it in the tests.

**I2. The stage's platforms as a GLSL constant (and the nearer-platform elliptical distance) are copied three times, two copies frozen to the module `STAGE`.**
- **Where:**
  - ground.ts:201–207 (`stageGlsl(stage)` → `ARENA_PLATFORMS`) and 247 (`re = min(length(...), length(...))`);
  - platforms.ts:317–325 (`RIPPLE_PLATFORMS` from `STAGE` at module load, and the same `e = min(...)` line);
  - floor.ts:58–60 and 100–103 (`FLOOR_PLATFORMS` from `STAGE`).
- **Why it matters:**
  - Three hand-written copies of the platform layout baked into shader source must stay identical.
  - `ArenaContext.stage` becomes a half-truth. `PLATFORM_PART.build` places the ripple geometry at `ctx.stage.player/enemy` (platforms.ts:381), but its foam rings are computed round `STAGE`'s, so the arena is not actually parametrised by stage.
  - The worn-ring test (arenaGround.test.ts:183–190) pins only the ground's copy.
- **Fix:** add `platformsGlsl(name, stage)` (the `vec4[2]` constant plus a `float <name>E(vec2 p)` nearer-ellipse function) in stage.ts or ground.ts. Use it in all three shaders, and let RIPPLE/FLOOR take the stage like `arenaGroundMaterial` does. Program keys are unchanged as long as the emitted text is.

**I3. The polar (fan + bands) and ring-band mesh indexing is written out seven times; one general helper already exists.**
- **The fan + bands loop** (`vi(k, s) = base + 1 + (k − 1)·segments + s mod segments`; fan `0, vi(1, s+1), vi(1, s)`; bands `a, b, c / a, c, d`) appears verbatim in:
  - ground.ts:309–324 (`discIndex`);
  - platforms.ts:74–87 (`polarIndexed`);
  - dunes.ts:117–122;
  - water.ts:498–504 (islet);
  - rock.ts:510–513 (lava);
  - water.ts:238–265 (`sheet`), which already generalises it with a `fan` flag.
- **The ring-band variant** repeats in platforms.ts:102–107 (`band`) and 290–294 (`rippleRing`), and rock.ts:192–197 and 546–548.
- **Why it matters:** the winding decides which side faces up or out (back-face culling). Each copy carries its own "counter-clockwise from above" comment because each has to be got right separately.
- **Fix:** one `polarIndex(rings, segments, { fan, base })` (and `ringBands(rows, segments, base)`) in a small `parts/mesh.ts`. Keep `sheet` as its user. Geometry stays bit-identical when the index order is kept.

#### Minor

**M1. The sight cap and the frame-top fits sample yaws ±0.9, but the settled camera reaches ±0.94 (sway) and ±1.0 (sway plus the focus nudge).**
- **Where:** scatter.ts:119 (`SIGHT_YAWS`), 179–182 (`PASSING_VIEWS`) and frameTop's default views, against battleView.ts:524–525. `CAMERA_YAW = 1.0` (scatter.ts:67–71) already counts the sway and nudge for the tall rule.
- **Measured** with the test's own ray oracle (arenaScenery.test.ts:155–174 style). Two long-grass clumps, at (−0.71, −2.34) and (−3.45, 0.73), reach into a platform top's rim:
  - at yaw −0.94, zoom 1.6: e 0.977 (player) and 0.996 (enemy);
  - at yaw −1.0, zoom 1: e 0.988 for both;
  - at yaw −1.0, zoom 1.6: e 0.854–0.876.
- **Not affected:** trees showed no bare trunks at ±0.94/±1.0 in 16:9.
- **The tests miss it** because their oracles sample ±0.9 only (arenaScenery.test.ts:133, 159, 208).
- **Fix:** sample ±(`BATTLE_CAMERA.yaw + sway + focusYaw`) in `SIGHT_YAWS`/`PASSING_VIEWS` and in the oracles. The Drake ruling already treats the sway as in scope.

**M2. Kit geometry constants are copied without a drift test; one is already off.**
- `FLOWER_TOP = 0.36` (flora.ts:260) against the kit flower's real top of 0.3955 (`flowerGeometry` bounding box). The accept rule `FLOWER_TOP × size × 1.15` (flora.ts:251) is meant to cover the scale jitter up to × 1.15 (flora.ts:254). Because the top is understated by 10 %, it falls 0.029 short, and SIGHT_MARGIN absorbs that. No flower crosses today: the nearest is 0.33 under its sight line (measured).
- `CLUMP_TOP = 0.72` (flora.ts:224) against a measured maximum of 0.700 is right today. But every sight-cap assertion uses `CLUMP_TOP` on both sides (arenaScenery.test.ts:82, 150, 164; arenaWater.test.ts:218), so taller kit blades would pass every test.
- The flower half of the sight-cap test (arenaScenery.test.ts:85) asserts only `cap > ground`.
- **Fix:**
  - measure `CLUMP_TOP`/`FLOWER_TOP` (and `BOULDER_TOP`, `PALM_TOP`) from the kit geometry in a test, as arenaScenery.test.ts:179–188 does for the crown low edge;
  - set FLOWER_TOP ≈ 0.40;
  - assert the flower top against the cap.

**M3. Some tests restate the implementation or no longer test anything.**
- arenaFlora.test.ts:13: `expect(treePlacements('grass', STAGE, 1)).toEqual(t)` compares the cached object with itself since abf97d4. Nothing pins `make*` determinism, or that cached equals fresh. The ledger's "bit-identical" check was done once by hand. Expose an uncached `makeTrees` for the test.
- arenaGround.test.ts:123–127 restates `groundNightScale`'s JS formula. Its contract is to match GROUND_COLOR's night line (ground.ts:266–273), which can drift on its own: the warmth thresholds and the structure are duplicated. `glslEval` sits in the same file (line 151), so evaluate the GLSL line against `groundNightScale` the way the worn-ring test does.
- arenaScenery.test.ts:126 only pins a constant (`CLOUD_SHADOW <= 0.15`).

**M4. No test pins disposal on rebuild or after a failure.**
- modernArena.test.ts:16–35 checks only `group.children` counts. The code is right today (verified above), but this is a lifecycle point the review was asked to hold.
- **Fix:** build kind A then kind B and assert:
  - A's DataTextures fired `dispose`;
  - A's kit materials came back (`kitMaterialKind` and pool reuse: B's build gets the same material objects for the same kinds);
  - a throwing part leaves `ctx.disposables` empty.

**M5. The ordering in ModernArena's catch is fragile.**
- At modernArena.ts:173–175, `this.clear()` runs before `this.failed = true` and the warning.
- If `clear()` throws (a part returning a malformed object), the exception escapes `build()`, `failed` stays false and nothing is logged. The next frame's key fast path then returns `true` with a half-cleared group.
- A part that throws after taking a pooled kit material also leaves it `inUse` for the session. This is bounded: one per failing key.
- **Fix:** set `failed` and warn first, then run `clear()` in its own try. Optionally track the materials taken during a build so a failure can release them.

**M6. A vestigial overworld shader change in kit/terrain.ts.**
- kit/terrain.ts:222–231: `TERRAIN_WARP`'s `if (uGridSize.x * uGridSize.y > 1.0)` and its comment ("the battle platform tops'") date from 09aea74.
- Since 229e30b the tops draw with `arenaGroundMaterial`, whose `WARP_GLSL` (ground.ts:212–220) has its own one-cell guard. The overworld never has a one-cell grid, so the guard is a dead uniform branch in the overworld's shader. Its comment is wrong, and `TERRAIN_WARP` is exported but used only in its own file.
- Identity-safe (ledger ruling stands).
- **Fix:** restore the overworld warp text (keep the `terrainFragColor` split), fix the comment, un-export.

**M7. The night hooks are near-duplicates.**
- `groundNightScale` (ground.ts:57–62) is kit `nightSoilScale` (palette.ts:120–125) with a warmth factor.
- The platform bodies' hook (platforms.ts:413–419) is `moonlitAsGround`'s closure (ground.ts:67–74) with `nightSoilScale` swapped in.
- `smooth` is defined twice (ground.ts:46, rock.ts:51).
- **Fix:** `moonlit(mesh, material, rgb, night, scale = groundNightScale)`, and one `nightScale(rgb, lift, t, out)` shared with kit/palette.

**M8. The frame-camera construction is duplicated.**
- scatter.ts:215–221 (`frameProjector`: PerspectiveCamera at `BATTLE_CAMERA.fov`, positioned by `battleCamera`, lookAt, updates) is repeated in skyPillar.ts:249–256 (which adds `ease`) and in the tests (arenaScenery.test.ts:210–217, 289–296).
- **Fix:** export `battleFrameCamera(stage, view: CameraView, aspect)` and build `frameProjector` and `cloudShown` on it.

**M9. Some functions are exported but used only in their own module** (nit): water.ts `isletGeometry`, `seaFloorRocks`, `shaftMaterial`; rock.ts `wetBand`, `wallFoot`; ground.ts `groundRadius`, `DISC_SEGMENTS`.

### Declined to judge
- **Visual look, GPU and CPU budgets:** no GPU runs were allowed. The Task 12 report numbers were taken as given.
- **GTAO override-pass programs for arena meshes at High:** the 12-high fixer is working on this in parallel.
- **BattleView/battlePreview teardown:** they have no dispose path because they live as long as the app or page. That is area A.
- **floor.ts, rooms, stadium and skyPillar internals:** area C. I touched them only for the duplicated helpers in I2 and M8, and to confirm the emissive reset.
- **bgSample validity and the lock's reuse across same-kind battles:** this is by design (a kind's picture is fixed ROM data), and the battle init order rules out stale VRAM (see Strengths). `sampleArenaColors` itself is outside this area.
- **The ledger's known gaps:** lava at intermediate yaws, islet palms at zoom 0.6, beyond 21:9, the cold first build per kind, and the night look items. Not re-judged; none is worse than logged.

### Assessment
**Ready to merge (area B): With fixes.**

Nothing is broken, and no Retro or overworld pixel can change:
- the kit changes are identity-safe by construction;
- fallback, disposal, program coverage and the placement cache are sound.

The three Important items are refactors with no behaviour change, merging copied logic blocks that must stay in step. They and M1–M2 can go in a short follow-up; none blocks the merge on correctness.

---

## Area C — # Phase 3 final review, area C: indoor and special arenas, colour and look, docs (at b8b384e)

Reviewer C. Scope: `src/render/battle/parts/{rooms,floor,stadium,skyPillar}.ts`, `src/render/battle/{palette,look}.ts`,
tests `arenaRooms` / `arenaLook` / `arenaPalette`, `README.md`, `CLAUDE.md`, `docs/superpowers/progress/modern-3d.md`.
Cross-cutting reads where a concrete risk needed them: `kit/materials.ts` (the pool), three r186
`WebGLRenderer.setProgram` (when uniforms are uploaded), `battleView.ts` (applyLook), `sky.ts`, `battleActors.ts`
(setExposure), `rock.ts` (the lava factory, the battler box), `kit/geom.ts` (QuadWriter), `tools/regress-live.ts`,
`tools/shot3d.ts`, `src/main.ts`, `battlePreview.ts`. I reviewed b8b384e as extracted with `git archive`. HEAD was
still b8b384e and these files were clean, so the tsx probes imported from the checkout.

Passes done:
1. **Palette and look.** Read the code and tests. Dumped `arenaPalette` for all 24 kinds and `arenaLook` at 12 h and
   22 h with a throw-away tsx script. Every value is finite, fogNear < fogFar everywhere, and `null` equals the defaults
   for 24/24 kinds.
2. **Halls and floor.** rooms.ts and floor.ts against the plan's Task 10 interface, the catalogue entries and the
   tests.
3. **Stadiums and the Sky Pillar.** Geometry, failure paths (mergeGeometries, non-null assertions), caches (SEAS,
   PUFFS), the lava factory, the catalogue entries.
4. **Per-draw emissive lifecycle.** The pool semantics, three's refresh rule, rebuild, style switch, High's override
   passes, the shadow pass, context loss.
5. **Duplication** across rooms, stadium, skyPillar and rock.
6. **Frame placement under the idle sway.** A tsx probe projected every hall, stadium and stump prop against the
   battlers' 2×2 boxes at yaw −0.04, 0 and +0.04.
7. **Docs against code at b8b384e.**
   - Every `regress:live` flag, preview query parameter and page API the docs name.
   - The render orders.
   - The README limitations against the ledger's known gaps.
8. **Tests.** `npx vitest run tests/arenaRooms.test.ts tests/arenaLook.test.ts tests/arenaPalette.test.ts
   tests/battleRenderOrder.test.ts`: 4 files, 35 tests pass.

### Strengths
- **Per-draw emissive is correct as built** (the hallLights hook, Phoebe's candles).
  - Each `kitMaterial()` call hands out a distinct pooled material: `free.pop()`, and in-use materials are never in
    the free list. So each hooked mesh is the only user of its material within a build.
  - three r186 sets `refreshMaterial` on a program or material-id change and resets `_currentMaterialId` at each
    `render()`. Setting emissive in `onBeforeRender` (which runs before `setProgram`) is therefore uploaded every draw,
    including GTAO's override passes at High: the hook sets and resets the mesh's own material, and the override draws
    with its own.
  - Neither mesh casts a shadow, so the shadow pass never calls them.
  - A rebuild, a style switch (the group is hidden, not drawn), `arenaFailPart` and context restore all find emissive
    black, because it is only non-black inside a draw.
  - Phoebe's test pins the single user and the reset (arenaRooms.test.ts:631-648).
- **MAGMA_LAVA comes from `lavaMaterial(glow, hookKey)`** (rock.ts:589). No shader-text surgery, nothing can throw at
  module load. The factory is pinned against Groudon's material and its own program key (arenaRooms.test.ts:594-629).
  The catalogue has the `lavaDim` program.
- **Robust stadium and Sky Pillar builds.**
  - Every kind's draw, material kind, attribute set and shadow flag is pinned (arenaRooms.test.ts:412-431, 752-769).
  - Module-level caches are keyed and bounded: PUFFS has 6 × 3 × 2 templates, SEAS has one entry per seed and stage.
  - The fountain field texture is registered in `ctx.disposables`.
  - The Sky Pillar's edge provably covers the disc's rim (≥ 335/360 rays).
- **The look has no per-frame allocation.**
  - `arenaLook` writes into `out` and caches the palette's linear colours in a WeakMap.
  - `applyLook` reuses `_sunDir`.
  - `setExposure(1)` and `uNight = 0` are restored on today's path.
- **The fog/exposure interplay is sound for 23 of 24 kinds.**
  - Exposure scales only the battlers' lit colour: ≈ 1.02 indoors, 1.18 underwater, 1.34 for Kyogre, ≈ 2.2 at outdoor
    night.
  - Fog starts beyond the battlers everywhere except underwater (enemy ≈ 12 %, as ruled).
  - The emissive props are fogged like everything else.
- **Halls are well tested.**
  - Geometry is checked against the tall rule and the camera side.
  - The bookcase relief test has been mutation-checked.
  - Court-line triangles are checked for count and winding.
  - The floor program is shared across styles, and the court uniforms are pinned.
- **The docs are largely accurate.**
  - Every `regress:live` flag CLAUDE.md and README name exists and behaves as described: `--battles`, `--review`,
    `--review-before`, `--ab-feature battle|battlers`, `gba_`/`ref_` pictures diffed by `--compare`.
  - Every preview parameter exists: `battle`, `player`, `enemy`, `double`, `player2`, `enemy2`, `hour`, `style`,
    `quality`, `yaw`, `spriteFilter`, `actorUniforms`, `arenaFail`, `manual`.
  - So does every page API: `measureArenaBuild`, `setStyle`, `selfTest`, `referencePng`.
  - `shot3d --query "battle=…"` reaches the battle branch of main.ts.
  - The render orders in CLAUDE.md match the constants and `battleRenderOrder.test.ts` (−1 / ≤ 2 / 2.5 / 3 / 3.5 / 10).
  - Every limitation the plan's Step 6 requires is in the README.

### Issues

#### Critical
None.

#### Important

**I1. The Sky Pillar's fog at night is about 8× too bright, and its far clouds glow.** `look.ts:86-90`, `sky.ts:98`
- **What's wrong:**
  - For the `sky` setting (rayquaza), `arenaLook` lerps the hour's fog 0.5 towards the backdrop at every hour, and the
    backdrop is the pale day colour (linear ≈ 0.77, 0.91, 0.97).
  - Measured at 22 h: rayquaza's fog is (0.413, 0.487, 0.567). Every other open-sky kind (grass, sand, water, pond,
    mountain) has (0.050, 0.070, 0.160).
  - BattleSky's horizon takes the same colour (`uHorizon = look.fog`).
- **Why it matters:** this part of the frame is on screen.
  - The cloud sea fills the band above the edge in the idle frame: > 60 % of those rays hit clouds
    (arenaRooms.test.ts:695-722).
  - The puffs stand 42–88 units from the camera, under the 25..90 fog, so 26–97 % fogged.
  - At night that band becomes a pale grey-blue glow above a moonlit floor. The perspective is inverted: the far clouds
    are brighter than the near ones and the floor.
- **Why the gates missed it:** no static night entry covers the Sky Pillar (`b_rayquaza` only, hour 11), and
  `arenaLook.test.ts` has no `sky` case and no night case beyond grass.
- **How to fix:**
  - Fade the pull with the daylight, e.g. `o.fog.lerp(lin.wall, 0.5 * (1 - o.night))`, or lerp towards
    `lin.wall × (d.fog / day fog)`.
  - Add an `arenaLook` test over every `outdoor` / `water` / `sky` kind: at 22 h the fog's luma stays near grass's, and
    is below its own 12 h value.
  - Optionally add `b_rayquaza_night`.

**I2. Logic blocks are duplicated across the parts, with constants copied and no drift test.**
- **(a) The marble rooms copy the gym's pillars.**
  - `stadium.ts:56` `MARBLE_ROOM` is HALLS.gym's RoomSpec retyped as literals.
  - `stadium.ts:547` `WALL_PILLAR` is `hallLayout('gym').pillars` written out (back ±7.5/±16, left 8, right −8), with
    `r 0.5 / off 0.62` copying `PILLAR_R` / `PILLAR_OFF` (`rooms.ts:580`).
  - `stadium.ts:597-602` repeats the hall's pillar loop (`rooms.ts:609-612`).
  - A change to the gym's room or pillars silently stops reaching Phoebe's and the Champion's rooms.
- **(b) The battlers' projected box is computed twice.**
  - `rock.ts:405-418` (`BATTLER_BOX` + `lavaFrame`) and `stadium.ts:308-325` (`battlerOverlap`, the same 2 × 0.6 × 2 box
    as literals) compute the same thing.
  - The block is pasted four more times in arenaRooms.test.ts (182-195, 469-480, 725-735, and inside 541-574).
- **(c) Geometry helpers are not shared.**
  - `pillarGeometry`'s profile loop (`rooms.ts:245-258`) is `lathe()` (`stadium.ts:71-89`) inlined: same normals,
    winding and colour pairs.
  - `lin` (clamp + toLinear) appears verbatim in `rooms.ts:116`, `stadium.ts:66` and `skyPillar.ts:26`.
  - `Soup`, the general writer the stadium and the Sky Pillar import from the halls' file, repeats kit/geom.ts
    QuadWriter's winding rule (`rooms.ts:76-77` vs `geom.ts:152-154`).
- **Why it matters:** these are verbatim logic blocks that will drift, the very kind of copied constant without a
  drift test the brief asks about.
- **How to fix:**
  - Set `MARBLE_ROOM = HALLS.gym` and share one `wallPillars(spec, placements, stage, color)` helper from rooms.ts.
  - Export one `battlerBoxes(stage, yaw)` from scatter.ts beside `frameProjector`, used by rock.ts, stadium.ts and the
    tests.
  - Move `Soup`, `lathe`, `tube` and `lin` into one geometry module (`parts/soup.ts`, or kit/geom.ts next to
    QuadWriter), and build `pillarGeometry` with `lathe`.

**I3. The docs fall short of the ledger at b8b384e, and the progress log is stale.**
- **(a) README.md:107-108 claims "a battle starts without a stall".** The Task 12 ruling ("battle_enter cold") logs
  this known gap:
  - The first battle of each kind per session pays one 90–120 ms frame for the cold arena build.
  - Live play measured 90 ms, "visible as a 5-frame hitch".
  - The gap is not among the README limitations.
- **(b) A ruled known gap appears nowhere in README or the progress log.** The 12-docs ruling: BG-palette full fades
  dim the whole 3D frame, so the battlers darken twice.
- **(c) README.md:221-223 points at the progress log, which does not have the items.**
  - The README says the code-level items (sprite tie-break, decal height, wall height) "are tracked in the progress
    log", but `modern-3d.md` has no Phase 3 result or known-gaps section.
  - Its Phase 3 checklist still has Task 12 unchecked (:364) and "Next: Task 12a …" (:365).
  - No `phase3-sdd-ledger.md` copy exists. Phases 1 and 2 kept theirs, and the plan's Task 7b text already cites
    `docs/superpowers/progress/phase3-sdd-ledger.md`.
- **Why it matters:**
  - The ledger and task-12-report are gitignored, so merging as-is drops Phase 3's numbers and its dev-level gaps from
    the repo:
    - the cold first build;
    - High's non-determinism across page loads;
    - the latent order-dependent override-program risk in the overworld's `skipOverridePasses`;
    - the battle clock pausing under V.
  - CLAUDE.md names the progress log as the source of truth.
- **How to fix:**
  - Add a "Phase 3 result" section to the progress log: Task 12's gate table numbers and the full gap list.
  - Copy the ledger to `docs/superpowers/progress/phase3-sdd-ledger.md`.
  - Tick Task 12 and rewrite "Next".
  - README: reword "without a stall" (no shader compile; the first battle of a kind pays one cold-build frame) and add
    the two gaps.
  - Update CLAUDE.md "Active work" at merge.

#### Minor

**M1. Prop placement is tested at yaw 0 only, but the idle camera sways ±0.04.**
- I measured with the tests' own 2×2 battler boxes at 1280×800:
  - At sway −0.04, the Sky Pillar's stump #0 (`skyPillar.ts:109`: −0.06 rad, r 10.6) enters the player's box by
    30 × 17 px. Its gap is +20 px at 0.
  - At sway −0.04, Glacia's crystals #1 and #6 (`stadium.ts:284-285`) enter by 33 × 3 and 5 × 61 px.
  - At sway +0.04, the Frontier's light panel at −0.72 rad touches by 2 px.
- Only Drake got the sway test (arenaRooms.test.ts:541), after the same class of finding.
- These are corner overlaps of a conservative box, so the visible effect is likely small.
- **How to fix:** run the hall, stadium and stump overlap tests at −0.04 / 0 / +0.04, and nudge stump #0 (≈ 0.0 rad) and
  crystal #1.

**M2. The stump's broken top has slits.** `skyPillar.ts:142`
- `mid`, the break fan's apex, is re-rolled for each triangle inside the `for q` loop. Neighbouring fan triangles
  therefore meet the axis at heights up to 0.175 apart, leaving open slits from the rim to the axis.
- The material is FrontSide, so these see-through slits show what lies behind the stump.
- **How to fix:** roll `mid` once per stump, before the loop.

**M3. The emissive hook is duplicated, and its invariant lives only in comments.**
- The two copies are `rooms.ts:640-652` and `stadium.ts:664-674`.
- The Frontier test (arenaRooms.test.ts:313-326) does not assert that hallLights is its material's only user; the
  candle test does.
- **How to fix:** add one helper that creates the material and mesh together, so a single user is structural. Or reset
  `emissive` in kit `configure()`; no other kit material sets emissive (grep), so it is identity-safe.

**M4. Exports used only inside their own file.**
- stadium.ts: `ROCK_BAND`, `METAL_RING`, `MARBLE_ROOM`, `ICE_RING`, `metalRingGeometry`, `battlerOverlap`,
  `StadiumItem`.
- skyPillar.ts: `CLOUD_SEA`, `Stump`.
- floor.ts: `FLOOR_PATTERN`, `FloorPattern`.
- rooms.ts: `shellColors`, `Hall`, `WallFrame`.
- 12a un-exported `fitToFrame` for the same reason.

**M5. A CLAUDE.md command now fails as written.** `CLAUDE.md:33-38`
- The line was not edited by Phase 3, but Phase 3 made it stale: `regress:live … --static … --compare p2-base` now
  exits non-zero.
- p2-base has only `battle_*` among the battle entries: no `b_*`, no `battle_grass` / `enter` / `exit` / `move` /
  `lunge` / `hit` / `switch`, no `gba_` / `ref_`. A missing reference fails the run (regress-live.ts:25, :81).
- **How to fix:** say that p2-base compares need `--only` of the pre-Phase-3 entries, or name p3-base there as the
  current gate.

**M6. The README's platform list is incomplete.** README.md:97-98 omits the ripple rings on open water (sea, Kyogre,
cave pond) and the sea-floor rock. `PLATFORM_STYLE` has seven styles.

### Declined to judge
- **The look of the halls, stadiums and Sky Pillar:** no GPU runs were allowed, so I relied on the ledger's visual
  reviews.
- **GPU/CPU budgets and the bloom-cost figures:** they come from Task 12's same-session A/B, which I cannot reproduce.
- **High-quality GTAO print-through on the battlers:** the 12-high fixer is on it in parallel.
- **The internals of the ground, platforms and water:** reviewer B's area. I only checked the floor and water entries
  these parts consume.
- **Battle-view camera and actor routing beyond applyLook and setExposure:** reviewer A's area.

### Assessment
**Ready to merge for area C: with fixes.**
- I1 is a small look fix plus a test that should land before merge.
- I2 is a refactor with no pixel change expected, and Retro is untouched by these files.
- I3 is documentation work the merge step needs anyway.
- The per-draw emissive, the lava factory and the stadium and Sky Pillar parts hold up.
