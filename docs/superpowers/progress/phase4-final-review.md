# Phase 4 (interiors) — final whole-branch review

Three parallel area reviews at 7f5e0b9 (A: integration/light/catalogue/HD legacy/harness; B: room layout/shell/floors/kit move; C: furniture/tables/docs), 0 critical, 6 important. One fix wave (floor-shader optimisation + floor-outside-room, FW-A light gates + the animation-phase colour bug, FW-B shared room helpers + ROM-tile colours, FW-C fitting smoke pin), a scoped re-review (all addressed), a crate-label fix and a perf follow-up (door-walk build frames). Rulings: phase4-sdd-ledger.md.

---

## Area A — # Phase 4 final review — Area A (integration, light, catalogue, legacy HD, harness) at 7f5e0b9

## Passes done
1. **Diff read** of every file in the area (`git diff b6e46c8..7f5e0b9`, `git show 7f5e0b9:`):
   - world, overworldView, timeOfDay, materials and analyze;
   - actorLayer;
   - kit materials, catalogue and glow;
   - interior index, cutaway, furniture and scope;
   - preview, regress-live, shot3d, gen-symbols and symbols;
   - the tests for these.
   Followed into floors.ts, shell.ts, billboards.ts, inflatedActors.ts, renderer.ts and three's WebGLRenderer
   where a concrete risk needed it.
2. **D8 light.**
   - Checked exactness at nightK 0 by reading the arithmetic.
   - Checked the Modern + in-scope gating, dusk/dawn continuity (ddf2577), battle and outdoor isolation, and per-frame cost.
3. **Cutaway.**
   - Checked per-frame cost and allocation.
   - Checked the yaw maths at 0, π/2, 3π/4, π and 15°, plus the pocket rule.
   - Read the tests.
   - Looked at i_pc_yaw and i_house_back.
4. **Scope gating.** Checked `interiorScope` (fails closed), the mapKey path in live play and the preview, and the rooftop.
5. **Catalogue and HD twins.**
   - Checked the HD twins' lifetime and disposal, and catalogue coverage (F7).
   - Ran `tests/smoke/catalogue.test.ts` and `tests/smoke/interiorWorld.test.ts`: 8/8 pass. These ran on the working tree,
     which already holds the floor-shader agent's uncommitted floors.ts / floorPatterns.ts changes.
6. **Harness gates.** Checked whether the nightLum, dusk, day-actor and control gates can pass vacuously.
7. **vigoroth_switch (samePx 200).**
   - Ran a CPU experiment: the same World built kit→kit, kit→off→kit and kit→retro→kit.
   - Analysed the pixels of the existing `out/regress-live/t13dbg` shots (switch, sw2, sw3, sw4) and their masks.
8. **quality=low door walks.**
   - Compared the logs of the existing qlow / qhigh / p4go / p4 runs.
   - Timed CPU builds of 1.2, 1.0 and 0.9 in node at low, medium and high.
9. **Looked at the p4 Modern PNGs**, day, dusk and night: i_house_1f / night / dusk / back, i_pc_1f / night / yaw,
   i_lab_night.
10. **Unit tests:** timeOfDay, interiorCutaway, kitInteriorTables and kitRun pass (32/32).

No GPU harness was run, as instructed. The scratch scripts were in %TEMP% and have been deleted.

### Strengths
- **D8 is exact by day.**
  - `indoorLight(0)` adds `(N − D) × 0`. Every channel and intensity comes out bit-identical to INDOOR_DAY.
  - The card floor is `max(x, 0.95·x) = x`, because `indoorCardLight(INDOOR_DAY)` repeats updateLighting's arithmetic
    operation for operation.
  - `actorFloorShare(0) = 0`, so `actorFloor = charLight`.
  - Retro, out-of-scope rooms, the kit-off A/B arm and outdoors all take `lit = false`. That gives today's constants,
    `uOutdoorNight` 0, and a light floor equal to charLight. Battles use their own `createKitUniforms()`, so
    `uOutdoorNight` stays 0 there (F38 holds).
  - The dusk fix (smoothstep floor share over nightK 0–0.2) is continuous at every hour. The cards are a `max` of two
    continuous terms.
  - Per frame it adds only a few scalar ops and one in-place `indoorLight`. The `.clone()` calls replace the
    `new THREE.Color` calls that were already there.
- **Scope gating is robust.**
  - `interiorScope(opts, mapKey | null)` fails closed.
  - World is the only consumer. It also requires Modern, not underground, and `interiorKit`.
  - Live play passes `${mapGroup}.${mapNum}` and the preview passes `${group}.${num}`.
  - `OUT_OF_SCOPE_MAPS` cannot be bypassed by leaving the key out.
- **Lifecycle is clean.**
  - The HD twins live for the view's lifetime, like today's legacy materials. They are never disposed by
    `World.dispose`, which disposes legacy geometry only, so no program is destroyed and recompiled.
  - The unused HD water material is disposed at creation.
  - The kit's per-build textures (floor cells, decals) go through `kit.disposables`.
  - The `cutaway` list is cleared by `dispose()` and by the semantic-layer catch.
  - The semantic-layer catch re-runs `analyze` so a fallback map keeps its own heights.
- **The cutaway costs nothing per frame.** It is a loop over at most a dozen meshes, with constant-table dot products
  and no allocation. It is called after `uCamBack` is set, in the same frame as the sync that built the meshes, so no
  wall flashes on a rebuild frame.
- **Catalogue (F7):**
  - The HD twins are added with the very objects World draws (`legacyHd`).
  - `INTERIOR_CATALOGUE` covers furniture, shell and floor.
  - The drift guard over 518 maps × low/medium/high + Retro passes.
  - Additive shafts stay one program: `blending` is reset in `configure()` and the shafts are transparent, so three's
    `opaque` parameter is unaffected.
- **The night/dusk gate fails when it cannot measure.** A missing twin shot or an unmeasured actorLum fails the run
  (Task 1's fix holds). Selecting either twin runs both.

### Issues

#### Critical
None.

#### Important

**I1. The `vigoroth_switch` samePx 200 hides an unexplained state leak, and the comment's hypothesis is refuted.**
Location: `tools/regress-live.ts:197–204`.

The comment blames "the new materials' ids reorder the opaque draws". That is not what happens:

1. **The world is identical after the round trip.**
   - A CPU experiment built map 1.0 kit→kit, kit→off→kit and kit→retro→kit. All three give the same 17 meshes, in the
     same order, with the same material objects and ids, pool kinds, render orders, cast flags, blending, colours and
     geometry hashes.
   - The kit pool returns the oldest material of each kind first, so a rebuild gets the same materials back.
2. **The differing pixels are world pixels, not actor pixels.**
   - The existing t13dbg shots differ in 86 px, all off the actor mask: in the Vigoroth's arm loop, plus one at
     (360,203).
   - It is the world surface seen through a hole in the sprite: (125,121,106) becomes (137,133,123), lighter and bluer.
   - The mask frames differ in the same 86 px.
3. **A kit-off round trip leaves it too.**
   - sw3 (setInteriorKit off for 10 frames, then on) gives the same 86 px as the style round trip (switch, sw2).
   - sw4 (off and on in one sync, so no non-kit frame is ever rendered) gives 0 px. But its last frame reports 56 calls
     / 27,135 tris against 55 / 27,133: one extra 2-triangle draw on a rebuild frame, also unexplained.
   - So the state is latched while a non-kit frame is **rendered**. It is outside `World`: three's renderer/material
     state, or view/actor state.
4. **Leads ruled out by reading:**
   - floor heights: 1.0 is flat in both modes;
   - the camera target lerp: it would shift the whole image;
   - the NPC-fade pick: no memory;
   - shadow autoUpdate;
   - PostFX history: there is none;
   - shaft light: it is warm, but the change is bluish.
5. **Why it matters.**
   - A round trip leaving different pixels is a state leak with an unknown cause.
   - The 200-px tolerance (anywhere in the frame) also lets up to 200 px of a real regression through on this entry.
   - lr_truck_switch and battle_switch (outdoor/battle round trips) stay 0 px, so the leak is interior-specific.
   - Interior-only differences:
     - the HD legacy materials;
     - `base.renderOrder = 1`;
     - the additive shafts at `renderOrder 1`, the same bucket as BlobShadows;
     - `furnitureGlowLow`'s onBeforeRender/onAfterRender emissive;
     - the cutaway visibility.

**Fix:** bisect in the page with the sw3 recipe. Toggle `visible = false`, in both entries, on:
- the shafts;
- `furnitureGlowLow`;
- the HD legacy meshes;
- the contact shadows;
- the base `renderOrder` (forced to 0).

Then dump `renderer.renderLists.get(scene, camera)` opaque/transparent order and `renderer.info` per frame in vigoroth
vs sw3 at the same frame. Until the cause is found:
- correct the comment;
- pin the tolerance to the observed bbox (343,203 18×42) as well as the count, so a leak elsewhere fails.

**I2. The night and dusk gates cannot detect D8 switched off: the room bound is one-sided.**
Locations: `tools/regress-live.ts:395, 826`. Related: `overworldView.ts:548–551` has no unit test.

- `nightLum` gates room ≥ 0.45 and actors 0.9–1.15.
- If the room light stopped following the clock, the night and dusk twins would equal their day twins. They would read
  room 1.000 / actors 1.000 and pass. Ways this could happen:
  - `lit` mis-wired;
  - `interiorKitRan` false after a refactor;
  - `indoorLight` not applied.
- `--compare p4-base` would not flag it either: at p4-base every night shot equals its day twin.
- No unit test exercises `updateLighting`'s wiring. timeOfDay.test.ts tests the pure helpers only.
- So D8's core behaviour ("all indoor light follows the clock", a user ruling) has no automated guard. Only the look
  reviews would catch a regression.

**Fix:** add an upper bound for in-scope pairs. Today's readings are night 0.61–0.63 and dusk 0.83–0.84, so:
- `roomLuma ≤ 0.8` for the hour-21 twins;
- `≤ 0.95` for the dusk twins.

And/or add a node test of `OverworldView.updateLighting` on a stub world with `interiorKitRan` true/false at hours 11
and 21, asserting `hemi.intensity`, `uOutdoorNight` and `charLight`.

#### Minor

**M1. The card-light formula is duplicated, and the test restates it.**
Locations: `overworldView.ts:649–653` and `timeOfDay.ts:84–91`.
- The exactness at nightK 0 depends on `indoorCardLight` matching updateLighting's charLight term for term.
- The test pins `indoorCardLight` to a restated copy ("updateLighting's formula", timeOfDay.test.ts), not to
  updateLighting itself.
- If someone changes the 0.75 or the 1/π in one place, in-scope rooms drift by day: the 0.95 floor no longer equals
  the day light. Retro and outdoor would be unaffected.
- **Fix:** have updateLighting compute charLight through one shared helper.

**M2. The interior A/B `previewWhen` hard-codes map groups.**
Location: `tools/regress-live.ts:535`, regex `(1|2|11|12|13|15|16|29|32)`.
- This duplicates the scope by group number, with no drift check.
- A future in-scope `i_*` entry in another group would silently drop out of the +1.5 ms budget. Examples: a Dewford
  house (3.x) or a Mauville PC (10.x).
- **Fix:** select by entry, not by query: `isInteriorEntry(e) && !OUT_OF_SCOPE_INTERIOR.has(e.name)` (pass the entry
  to `previewWhen`).

**M3. The day actor-luminance gate passes silently when nothing is measurable.**
Location: `tools/regress-live.ts:1510–1519`.
- Unreliable and unmeasured entries are dropped.
- With `gated.length === 0` there is no failure and no line printed at all, not even the "not measured" list.
- That is the vacuity pattern Task 1 fixed for nightLum.
- **Fix:** fail when dayActorGated entries were selected but none measured. Optionally, also fail when an entry that
  measured in the `--compare` reference is unmeasured now.

**M4. The 0.00 % controls are read by eye.**
Location: `tools/regress-live.ts:1394–1405`.
- `--compare` diffs never set the exit code. This applies to Retro, outdoor, battles, `OUT_OF_SCOPE_INTERIOR` and
  `door_exit`.
- The Phase 4 identity rule ("Retro and out of scope pixel-identical") rests on someone reading a 248-line diff list.
- This is pre-existing. But Phase 4 now has the named sets (`OUT_OF_SCOPE_INTERIOR`, the style key) to gate on.
- **Fix:** add `--expect-same` (Retro keys + `OUT_OF_SCOPE_INTERIOR` + non-interior Modern entries) so any diff > 0
  fails the run.

**M5. `roomLayout` is computed four times per in-scope build.**
Locations: `furniture.ts:220`, `shell.ts:57`, `floors.ts:26`, `floors.ts:44` (shafts).
- `interiorIds` is memoised per analysis, but the layout is not.
- It is CPU only and within budget (worst rebuild 21.4 ms).
- **Fix:** memoise it per `(a, warps)` like `interiorIds` (a WeakMap on `a`), which also guarantees the three families
  see one layout.

**M6. `tests/smoke/interiors.test.ts` re-implements World's interior pipeline.**
Location: `loadInScope`.
- It reproduces `analyze` + `flattenFloors` + `extractAll(INTERIOR_FAMILIES)` instead of going through the World path.
  It shares `flattenFloors`, but a new step in `World.buildMeshes` would not reach the smoke checks.
- **Fix:** export a `prepareInterior(a)` from world.ts that both use, or note it as accepted.

### Declined to judge
- **quality=low door-walk builds (~3× medium).** No Phase 4 cause found:
  - In the same qlow run, the Retro builds also slowed. door_exit_retro read 53 ms against 33–36 ms, and door_enter_retro
    11.3 against 6.8–9. Retro runs no kit and does not depend on quality.
  - The outdoor door_exit build (no interior code) read 223 against 51–68 ms.
  - In node, CPU `World.build` of 1.2, 1.0 and 0.9 at low is ≤ medium.
  - That points at session noise. Re-run `--interiors --query quality=low` alone to confirm; I did not, because it is a
    GPU harness.
- **Context loss:** no Phase 4-specific handling, and none existed before.
- **The in-flight floor-shader split** (uncommitted in the working tree): not reviewed. Re-run the drift guard and
  nightLum after it lands. My catalogue run on the working tree passed with its `interiorFloor.*` kinds.
- **Room look / art direction** (boards' yellow, partition lids, Weather Institute pillars): covered by the known gaps.

### Assessment
**Ready to merge for Area A: With fixes.**

Nothing is broken, and Retro / out-of-scope / battle identity holds by construction and by the gates. But two things
should be fixed before merging:
- I1: correct the vigoroth_switch comment and bbox-pin the tolerance; the bisect can be logged as a follow-up if the
  controller rules so.
- I2: add an upper room bound so D8 being off fails a gate.

---

## Area B — # Final review B: room geometry and surfaces (Phase 4, at 7f5e0b9)

Area: `kit/interior/{room,colors,shell,floors,shafts,wallParts,floorGlsl}.ts`, `geom/{shellParts,floorPatterns}.ts`,
`kit/soup.ts`, `kit/terrain.ts` (exports), the battle shims `battle/parts/{soup,rooms,floor}.ts`, and their tests.
Everything was read at 7f5e0b9 (`git show` / `git diff b6e46c8..7f5e0b9`). The working tree's uncommitted floors.ts /
floorPatterns.ts edits (the optimiser's) were not looked at.

Passes done:
1. **Inputs.** Spec §8/§11/§12, the plan (D3–D9, Tasks 2, 5, 7, 8), the ledger, review-C1, and the task-13 report's 24
   known gaps.
2. **Code.** Every file in the area, plus `kit/materials.ts` (`patchKit`, the pool, `configure`), `cutaway.ts` and
   three's `WebGLRenderer` (the DoubleSide transparent path).
3. **Tests at 7f5e0b9.** I ran these in a `git archive` copy in %TEMP% (ROM copied in; deleted afterwards):
   - battlePins, kitWallParts, interiorRoom, interiorShell, interiorShellParts, interiorFloors, interiorFloorPatterns
     and interiorColors: 83/83;
   - smoke interiorRooms: 6/6;
   - smoke catalogue + interiors: 9/9.
4. **ROM sweeps over the 137 in-scope maps** (throw-away tests, deleted). Each map ran `roomLayout`, `shellRuns`,
   `buildShellSoups`, `featureRole`, `windowRect`, `shaftGeometry`, `floorCells` and `roomFloorHeights`. I then:
   - dumped the cells of 15.5, 29.2 and 13.9;
   - probed 11 odd synthetic rooms: a corner alcove, two adjacent alcoves, an L shape, a void hole, a corner door, a
     window beside an alcove, a 3-row band, a partition meeting the side wall, a corridor between two rooms, a window
     on a back-wall step, and side-wall art.
5. **Looks.** I viewed the p4 Modern PNGs and cropped some (a throw-away node PNG cropper): i_pc_yaw, i_house_back,
   i_house_1f, i_trickhouse, i_weather, i_flat and i_sootopolis_house.

### Strengths
- **The battle identity is real and holds.**
  - e02f396 touches only `battle-pins.json` and `battlePins.test.ts`, and it was recorded before the move.
  - The pins hash every mesh `HALL_PART`, `STADIUM_PART` and `SKY_PILLAR_PART` build per kind, `roomShell` per hall,
    and the hall floor text. They pass unregenerated.
  - `kit/soup.ts` is the battle file moved verbatim (only the import paths differ).
  - `roomShell` now delegates to `wallPath`. Its output is byte-identical: the pins pass, and for perpendicular normals
    `mitre`'s `k = 1` keeps the old arithmetic.
  - The shims are re-exports, and nothing under `src/render/kit` imports from `battle/`.
  - stadium.ts and skyPillar.ts are untouched.
- **The terrain text split is safe.** `TERRAIN_GRID_GLSL` / `TERRAIN_CELL_GLSL` recompose the old literals. They are
  pinned by length + sha256 for fragColor, fragHead and the battle's `terrainFragColor` composition
  (`interiorFloorPatterns.test.ts:128-137`).
- **The room layout is robust.**
  - Six switchable rules, five invariants in `checkRoomLayout`, 15 pinned real-map digests, and a mutation test that
    proves four of the rules are load-bearing on real maps.
  - The sweep found 0 findings and 0 shell `skipped` on all 137 maps.
  - My 11 synthetic odd rooms gave 0 findings, 0 throws and 0 skipped openings.
  - Alcoves (one per corner, two adjacent), back-wall steps, void holes, L shapes, partitions meeting a side wall, and
    real3ff (Sootopolis, 0x3FF) all close.
  - No in-scope map has two 4-connected rooms; the two-room case is only unit-tested, which is fine.
- **The windowRect fix (fb9aa83) is consistent.** The glass, the opening cut in the run, the casing and sill, and the
  shaft all take `windowRect(L, f)` by reference. `bandRect` (clocks, decals) uses the same top-down row orientation.
  - Sweep: every window feature on the 137 maps is glazed (featureRole 'window', none falls back to a decal), so every
    shaft has its glass.
  - Each shaft starts at the inner face, 0.012 behind the glass, at the glass's mid height and width.
  - Glass, fixtures and shafts are all tagged 'N', so they cut away together.
- **The floor shader is sound.**
  - Everything that takes a derivative (`fwidth(fp)`, the BOARDS/TILES blocks) runs in uniform control flow.
  - `pf` is clamped above 0, so every smoothstep has edge0 < edge1.
  - The `mat` / `edges` branches take no derivatives.
  - The tint comes from an RGBA8 texture with an explicit sRGB → linear conversion.
  - The pinned battle snippets are inlined unchanged in blocks with local `uFloor` / `uFloorAlt`.
  - The saturation knee is continuous at 0.35 (a hinge, not a cap). Its looseness in tests is known gap 21.
- **The shafts are correct.**
  - AdditiveBlending and depthWrite false.
  - Black and metallic (F0 = 0, no diffuse), so only the emissive daylight × alpha adds.
  - They are off at night through the same `uOutdoorNight` that turns the glass blue.
  - renderOrder 1 draws them after the other transparent draws, so a normal-blended transparent object behind them
    can't overwrite the light.
- **Lifecycle.**
  - The per-build floor and decal DataTextures go to `kit.disposables`.
  - The layout memo and `featureZ` are WeakMaps keyed per analysis / feature, so nothing leaks between maps.
  - The clock template cache is bounded (64).
  - Module load is pure: `SHELL_PROFILE`, and the catalogue options with their 1×1 placeholder.
- **Wall assembly.** `wallPath` with `ends` mitres alcove and step corners correctly, reflex corners included (checked
  by hand on 1.0's `N2.5:7-8` against `E7:1.5-2.5`). Opposite normals now throw (inside runKit's try/catch).

### Issues

#### Critical
None.

#### Important

**I1. The floor runs 1.2 cells past the back wall, outside the room; visible whenever the camera orbits.**
- **Where:**
  - `src/render/kit/interior/geom/floorPatterns.ts:136-137`: `candidate` takes every `L.band` cell.
  - `:278-297`: each cell gets a full 1×1 quad.
  - `tests/interiorFloorPatterns.test.ts:52` pins that behaviour ("floors the back-wall band").
- **What's wrong:**
  - The back wall's inner face stands at `backLine − RECESS`, and its outer face at `backLine − 0.8`.
  - Every band row gets floor up to the band's top. For the usual 2-row band that is 1.2 cells of patterned floor
    outside the wall's outer face, plus 0.2 of row `bl − 1` under the wall body.
  - Sweep: all 137 maps have such cells, 8–19 per map: 14 on every Pokémon Center, 11 on the Marts, 19 on the Weather
    Institute.
- **Why it matters:**
  - At yaw 0 the 2.6 m wall hides the strip.
  - Seen from the side, it shows as a tiled ledge sticking out behind the back wall into the void: `p4/i_pc_yaw_modern.png`,
    right edge, the strip outside the poster wall.
  - With N cut away, the floor runs past the side walls' ends: `p4/i_house_back_modern.png`, bottom of the frame.
  - Both are pinned review entries. C1, Task 12 and Task 13 did not catch it, and it is not among the 24 known gaps.
  - The recess is only `RECESS` deep: nothing ever stands farther north (D6, "never behind the wall plane").
- **Fix:**
  - Floor a non-partition band cell only in its column's row `backLine − 1`, and clip that quad's north edge to
    `backLine − RECESS` (or to the outer face, `− WALL_T`). `floorGeometry` needs the clip line per cell.
  - Rows farther north get no floor.
  - Update the test at `:52` and add one with a 2-row band ("no floor quad north of `backLine − RECESS − WALL_T`").
  - Re-shoot i_pc_yaw / i_house_back.

**I2. Room-material, walkability and the per-room floor height are copied, verbatim, across three modules; merge and
partition helpers are duplicated too.**
- **Where:**
  - `room.ts:72-81` `nonVoid` / `walkable` = `floorPatterns.ts:37-44` (the comment says "as room.ts reads it").
  - `walkable` a third time at `furniture.ts:127-129`.
  - The 4-connected room flood fill and the floor-height mode with its tie-break: `room.ts:159-177` + `:258-268`,
    re-derived as `roomFloorHeights` (`floorPatterns.ts:48-81`).
  - `mergeSpans` (`room.ts:127-138`) ≈ `mergeRuns` (`shellParts.ts:131-142`).
  - The partition half-cell solid grid is built twice in one file: `shellParts.ts:417-426` (`partitionLoops`) and
    `:629-636` (`addPartitionLids`).
- **Why it matters:**
  - The floor's height must equal the walls' `floorY`, and the floor's idea of "room material / walkable" must equal
    the layout's. Today they agree (sweep: one floorY per map, equal to the floor's on all 137).
  - Only by copy: no test ties them (every fixture is flat at 0).
  - A change to the real3ff rule or the height vote in room.ts leaves floors and walls at different heights, or floors
    under cells the layout calls void.
- **Fix:**
  - Export `roomMaterial` / `walkable` from room.ts.
  - Add `room: Int32Array` (per cell) and `floorY: number[]` (per room) to `RoomLayout`, and drop
    `roomFloorHeights`' own pass.
  - Export `mergeSpans` for the shell.
  - Factor `partitionSolid(a, L)` in shellParts.
  - At minimum, a test pinning `roomFloorHeights(a, L)[i] === run.floorY` on a fixture with a raised room.

#### Minor

**M1. Sootopolis' purple-grey floor patches: C1 M10 was never closed or logged.**
- **Where:** `floorPatterns.ts:147-171`: the one-tint-per-area pass runs before the pending pass, which is where
  real3ff cells get their kind.
- **Root cause (15.5):**
  - Cell (0,2) is metatile 0x2d5, `tiles`, tint (0.48, 0.48, 0.56): a darker tile variant by the cupboard.
  - Its tiles neighbours are real3ff blocks (kind −1 during the area pass), so it forms a 1-cell area that keeps its
    own tint.
  - The pending pass then votes it into the band cells (0,1) cabinet and (1,1) wall.
- **Where it shows:** `p4/i_sootopolis_house_modern.png`, the two purple cells left of the table. They will also appear
  on the other 15.x houses with a variant next to 0x3FF blocks.
- **Fix:** run the area unification after the pending pass, over the final kinds (real3ff included). Or log it as a
  known gap.

**M2. The shafts and the glass decide "is this a window" differently.**
- **Where:**
  - `shaftGeometry` (`floorPatterns.ts:398`) lays a shaft for every `kind === 'window'` feature.
  - The shell glazes only `featureRole(...) === 'window'` (`shellParts.ts:502-509`): a window on a partition, on no
    run, or overlapping a door opening (`:579-587`) becomes a decal.
- **Impact:** latent. The sweep finds no such window on the 137 maps. One would get a light beam from a decal or from
  thin air over a half-height partition.
- **Fix:** let the floor family take the glazed features from the same predicate (export `featureRole` use, or pass
  `buildShellSoups`' list).

**M3. The shaft mesh draws in two passes.**
- **Where:** `roomShaftMaterial` (`floorPatterns.ts:456-458`) is `side: DoubleSide` + `transparent`.
- **What happens:**
  - three r186 renders such a material BackSide then FrontSide (`WebGLRenderer.js:2165`), and `prepareMaterial`
    compiles both variants (`:1364`).
  - That is +1 draw call per windowed room and +1 program in the catalogue.
  - The strip is only ever seen from above, where its front face is: it faces up and south, and N cuts it away at yaw π.
- **Fix:** use `FrontSide`, or `forceSinglePass`.
- **Also:** at night the shafts still draw with zero contribution (alpha > 0, rgb 0). Hiding the mesh when nightK = 1
  would save the fill.

**M4. A stale comment.**
- **Where:** `floors.ts:50`: "after the room's other transparent surfaces (the glass)".
- **What's wrong:** `ROOM_GLASS` is opaque (`shellParts.ts:669-672`, no `transparent`; its fade is a dithered discard).
  It draws in the opaque pass whatever the shafts' renderOrder is. renderOrder 1 orders the shafts after the
  transparent draws (shadows, cards).
- **Fix:** correct the comment.

**M5. One mapping written twice, with no drift test.**
- **Where:**
  - `windowRect`'s rows → heights (`room.ts:449-456`, literals 0.2 and `WALL_H − 0.5`);
  - `WALL_SPAN` + `bandRect` (`shellParts.ts:50`, `:228-231`).
- **Why it matters:** they agree today. If either span is retuned, the windows and the clocks/decals on the same band
  desync.
- **Fix:** `windowRect` calls `bandRect(f, ...WALL_SPAN)` (both living in room.ts), or a test asserts equality on a
  3-row band.

**M6. The floor program fetches its cell texel twice.**
- **Where:** `floorPatterns.ts:333` `cd = texelFetch(...)`, after `TERRAIN_CELL_GLSL` has fetched the same texel for
  `mat`.
- **Note:** this is for the floor-shader optimiser, if its rewrite keeps the shared snippet.

**M7. A latent odd-room shape: a recess over the void.**
- **Where:** `room.ts:114`, `:121`. A room row whose northern neighbour is void (no band), but which is its segment's
  back line, still gets an N wall `RECESS` north of it.
- **What happens:**
  - A synthetic corridor between two rooms (`' WWW   WWW '` over `' ......... '`) gives `N3.5:4-7`.
  - There is a 0.5 strip with no floor under it (only band cells get floor).
  - Its square end sits inside the neighbouring room's `E4:2.5-4` body.
- **Impact:** 0 of the 137 maps (sweep: every non-partition N run has band above it).
- **Fix:** recess only under a band cell (`n >= 0 && band[n]`), else the line `y`.

### Declined to judge
- The floor-shader optimisation commits on top of 7f5e0b9 (re-reviewed separately).
- GPU cost of the floor and shafts, and the +1.5 ms A/B budget: no GPU runs allowed.
- The cutaway's per-frame update, the D8 light blend and `uOutdoorNight` plumbing in overworldView/world.ts (area A).
- Furniture standing on the floor cells and fitting in the recess (area C).
- The vigoroth_switch draw-order tolerance (area A).
- The Trick House corridor (known gap 8). The p4 shot matches the logged description: corridor E/W walls seen from
  outside hide a leg; not worse than logged.

### Assessment
**Ready to merge (area B): With fixes.**
- I1 is a cheap, local fix: band floor only in the recess.
- I2 can be a short refactor, or at least a drift test tying the floor heights / room material to room.ts.
- Battle identity, terrain identity, room-layout robustness and the glass/shaft consistency all hold at 7f5e0b9.

---

## Area C — # Phase 4 final review — Area C: furniture, tables, docs (at 7f5e0b9)

Passes done:
1. **Inputs.** Read the common brief; spec §8–§12; plan header, D1–D12, preflight rulings, Tasks 3/4/9/10/13 and the
   user answers; the ledger; the task-12 and task-13 reports (24 known gaps).
2. **Code.** Read at 7f5e0b9 (`git show`):
   - furnitureHome.ts, furnitureService.ts, geom/homeFurniture.ts, geom/serviceFurniture.ts;
   - furniture.ts (core, for context), colors.ts, kit/glow.ts, the kit material pool (materials.ts);
   - tables/building.ts and all five tables/interior/* files.
3. **Tests run** (read-only):
   - unit: interiorHome, interiorService, interiorHomeFurniture, interiorServiceFurniture, kitInteriorTables,
     interiorColors: 82/82 pass;
   - smoke: interiorTables + interiors 10/10, catalogue 1/1.
4. **Fitting sweep** (throw-away vitest script in %TEMP%, now deleted). It extracted every in-scope map as World.build
   does: 137 maps, 1272 pieces, each built at low, medium and high quality. Checks:
   - per piece, its height against `foot.height`;
   - its x/z extent against its footprint;
   - the sampled height of its triangles over each of its walkable cells (≤ 0.45, stairs aside);
   - any furniture triangle over a walkable cell that no piece owns.
5. **Tables.** Dumped label grids next to the collision grids and compared them with the `out/atlas` renders:
   - Rustboro: House1/2/3, Flat1 1F, Flat2 1F;
   - Slateport: House, Name Rater;
   - Lilycove: House1–4, Move Deleter;
   - Mossdeep House1/3, Mauville House1, Oldale House1, Fortree House1, Sootopolis House1;
   - the Weather Institute 1F, the League lobby 16.10.

   Also scripted pin coverage (labelled kinds against pinned kinds per table) and checked for duplicate ids.
6. **Duplication and dead code.** Grep sweeps over kit/interior, battle/parts (rooms.ts, stadium.ts) and kit/buildings.ts.
7. **Docs against code.** Every flag, entry name and API that README.md / CLAUDE.md name, checked against
   tools/regress-live.ts, preview.ts, overworldView.ts and scope.ts at 7f5e0b9; "137" vs "138" across the docs.
8. **Look.** Viewed p4 Modern shots:
   - i_pc_1f, i_pc_yaw, i_league, i_house_2f, i_house_night, i_dept_1f, i_flat (with its Retro twin), i_mart_night,
     i_weather, i_lab_night, i_oldale_house;
   - against the GBA atlas maps and the Retro twins.

## Strengths
- **Fitting holds on every real map, at every quality.**
  - 0 cases of geometry over 0.45 on a piece's walkable cell (stairs aside, as ruled).
  - 0 furniture triangles over a walkable cell outside every piece.
  - No NaN.
  - Every kind tops out at its FURNITURE_SPEC height: max sink 0.948, counters 0.88, healer 1.3, gondola 1.6,
    bookcase 2.1.
  - The only deviations are the ruled ones:
    - the stairwell rail (0.925) on its warp cell;
    - the flight up reaching into the recess;
    - counters whose bounding `foot` is narrower than their per-cell `counterRects` U/L arms. The arms read `cellFeet`
      by design, so this is not a defect.
- **The nurse and the clerks read from the chest up.** Seen on i_pc_1f, i_league, i_dept_1f and i_mart_night:
  - the bar is 0.72 deep and 0.88 high;
  - the U/ring arms reach the bar without covering the pocket;
  - tests pin the bar's z in front of the nurse.
- **Colour rules.**
  - The interior kit has one outline rule: `isOutline` at homeFurniture.ts:69, imported by serviceColors. The C2 I1 fix
    is in, and the tests use the real #52526b / #424a6b.
  - `partColors` is deterministic: it ranks by count and breaks ties by the BGR555 value.
  - Goods, plants and crates take seeded rngs from `hashCell`.
- **glowMesh single-user everywhere.**
  - Every caller passes its own soup: the furniture build (two calls, one per glow soup), rooms.ts:467 and
    stadium.ts:605.
  - Each `kitMaterial` call takes a separate pooled instance (`inUse`), so no material has a second user. The
    emissive is set in onBeforeRender and reset in onAfterRender.
  - `FURNITURE_EMISSIVE` is a read-only module constant read at draw time.
  - The four furniture variants are in FURNITURE_CATALOGUE, and the drift guard passes.
- **Tables.**
  - Labels matched the GBA on every spot-checked map (Rustboro, Slateport, Lilycove, League lobby, Weather Institute):
    four chairs where the GBA draws four, beds, sofas, TVs, kitchens.
  - Every labelled kind of every table has at least one pin: 193 pins on 33 maps.
  - No id is listed twice in a table source.
  - The strict-behaviour rule holds: 0 contradictions, and every TV / PC / bookshelf / shop-shelf behaviour cell is a
    piece of its kind (smoke).
- **Reuse.** The bookcase uses the battle hall's `addShelf` (moved into wallParts with `depth`, F4). The furniture geom
  builders are pure and are wired by thin adapters.
- **Docs.**
  - The README's Phase 4 section and its two limitation blocks match the visible known gaps (1–10, 14, 15).
  - Every CLAUDE.md flag, entry and API exists in code: `--interiors`, `NIGHT_TWINS`, `STATIC_INTERIOR` /
    `INTERIOR_LIVE`, `--ab-feature interior`, `_review_interior.png`, `&kitFail=`, `setInteriorKit`,
    `measureRebuild`, `OUT_OF_SCOPE_MAPS`, `p4-base` on disk.
  - The count of 137 maps is consistent across the README, CLAUDE.md, scope.ts and the smoke tests.
- **Look.**
  - Rooms read as their GBA maps in a clean, soft modern style.
  - Night rooms are warm and dim, with deep-blue windows.
  - Nothing is black or clipping, and nothing floats beyond the logged legacy art (bed brackets, WI pillars, lab book
    piles).

## Issues

### Critical
None.

### Important

**I1. No test pins the fitting rule on real maps.**

Where:
- the generators: geom/homeFurniture.ts:297-314 (table), :363-480 (tv, fridge, sink, cabinet, through `southRow`);
- geom/serviceFurniture.ts:217-276 (pc, healer), :288 (gondola);
- the smoke test that only covers bed heads: tests/smoke/interiorWorld.test.ts:80-90.

What's wrong:
- Only bed, chair and plant honour per-cell caps (`cellFeet[k].height`).
- Every other kind builds at the whole piece's `foot.height`. `foot` is capped only when *all* its cells are walkable
  (furniture.ts:295).
- The healer's console (0.85) and the PC desk (0.74) are fixed heights that ignore even `foot.height`.
- Today nothing breaks: my sweep found 0 violations on 137 maps. But the guarantee rests on the table curation rule
  "walkable feet are floor", and no test fails if that rule changes.
  - The unit tests check the bed / chair / plant caps.
  - The smoke tests check only `cellFeet` heights of beds, never the generated geometry.
  - C2's 0-triangle check was a one-off script.

Why it matters:
- Walkable ≤ 0.45 is a ruled invariant.
- A future table tweak, such as a curator keeping a TV stand's walkable foot as `tv`, would put a 1.1 m cabinet over a
  walkable cell, and nothing would fail.

How to fix: add a smoke test over INTERIOR_FAMILIES' furniture pieces on all 137 maps, built at medium:
- (a) the sampled triangle height over each walkable cell of a non-stairs piece is ≤ floorY + WALKABLE_SEAT;
- (b) no furniture triangle covers a walkable cell that no piece owns.

My throw-away version ran in about 15 s and passes today.

**I2. The progress log carries no Phase 4 results or known gaps, though the README points to it.**

Where:
- docs/superpowers/progress/modern-3d.md:399-412 (Phase 4 status);
- README.md:280 ("Code-level open items … are tracked in the progress log").

What's wrong:
- Task 13 handed over 24 known gaps "for the progress log". The log at 7f5e0b9 / 5590c52 has none of them.
- Of those 24, the README covers only the visible ones (1–10, 14, 15). The README sends readers to the progress log for
  the code-level and harness items, which are not there:
  - 11–13, 16: N-tagged decals, the one-build light lag, the floor program cost, the chair tie order;
  - 17: vigoroth_switch's `samePx: 200`;
  - 18–24: no `interiorIds` scope guard, worklist order, `ShellPlacement.decals`, loose softening tests, the HD-cutout
    shadow, missing rollback / cutaway unit tests, the coverage tie-break.
- Phases 1–3 each have a known-gaps block in the log.
- The ledger that holds the gaps is gitignored ("copied to the repo at merge").

Why it matters:
- CLAUDE.md names the progress log the source of truth after a context reset.
- The README's claim is false until this is written.

How to fix: before merging, add a "Phase 4 known gaps" block to the log (the 24 items, grouped as in task-13-report.md)
and a short results block:
- budgets: A/B, rebuild, calls/tris;
- gates: Retro 0.00 %, nightLum / dusk / day-actor numbers;
- the vigoroth_switch tolerance ruling once it is made.

### Minor

**M1. Neighbouring objects of one kind merge into one piece and lose their GBA shapes.**
- Where: furniture.ts:55-60 (`FURNITURE_SPLIT`: bookshelf / cabinet = `component`) and homeFurniture.ts:247-251
  (`southRow` spans the merged row).
- 16 L-shaped merges on real maps:
  - a 2×2 bookcase plus the small green PICTURE_BOOK_SHELF beside it becomes one 3-wide, 2.1 m bookcase: 3.0, 4.3,
    11.12, 11.15, 11.16, 13.9, 18.1;
  - a cabinet plus a small drawer cabinet becomes one 3-wide unit: 7.2, 7.4, 7.6, 13.0, 14.7, 17.0, 29.0;
  - plus Brendan's and May's PC.
- Rectangular merges exist too. Oldale House1 (i_oldale_house) turns its grey chest and its yellow glass-front sideboard
  into one uniform four-unit counter.
- The rooms stay recognisable, but the GBA's distinct low shelf disappears into a tall case.
- The same family of issue as logged gap 15 (the PC's magazine shelf drawn as a 2.1 m bookcase).
- Fix: for `component` kinds other than tables and counters, split an L into its rectangular core plus the rest (as
  `counterRects` already does). Or log it with gap 15.

**M2. No test says every FurnitureKind has a generator.**
- Where: index.ts composes `{ ...HOME_GENERATORS, ...SERVICE_GENERATORS }`.
- A kind dropped from either list would leave its cells legacy without a warning; only the coverage report would move.
- Fix: one assert that the composed keys equal FURNITURE_KINDS.

**M3. Constants are copied without a drift test.**
- `BED_H = 0.55` (homeFurniture.ts:51) copies FURNITURE_SPEC.bed.height. The bed's part levels scale by `H / BED_H`.
- `STAIRS_TOP = 1.6` (serviceFurniture.ts:47) copies FURNITURE_SPEC.stairsUp.height. The stairwell's depth uses it.
- tests/interiorHomeFurniture.test.ts:13 keeps its own `SPEC` table and its own `fit`, Phase-A copies of FURNITURE_SPEC
  and fitFurniture.
- Phase A's "no Task 6 types" reason is gone. Import FURNITURE_SPEC / fitFurniture, or add a one-line equality test.

**M4. Dead parameters and paths remain.**
- `buildStairsUp(…, railSide)` (serviceFurniture.ts:377-389) is always passed `null` (furnitureService.ts:49). Its rail
  path runs only in a unit test; no stair rail was the ruling.
- `buildStairsDown(…, railSides?)` (:398) is never passed.
- Many geom exports have no user outside their file:
  - from homeFurniture: `isWood`, `HOME_DETAIL`;
  - from serviceFurniture: `ALL_OPEN`, `LATHE_SIDES`, `SMALL_SIDES`, `CORNER_SEGS`, `BALL_WHITE`, `SCREEN_GLOW`,
    `STEP_RISE`, `RAIL`, `TOP_LIFT`, `TOP_TINT`, `OUTLINE_LIFT`, `roundedBlock`, `WELL_BOTTOM`, `GONDOLA`, `HEALER`.
- Fix: drop the rail parameter (or keep it with a "ruled off" note) and un-export the internals.

**M5. Small duplications.**
- Two rounded-box primitives with different conventions:
  - `roundBox` (homeFurniture.ts:175): absolute y, rounded top and vertical edges;
  - `roundedBlock` (serviceFurniture.ts:93): y relative to `r.y`, plan-rounded corners, per-side `open`.
  - Not a verbatim copy, but one primitive with an `open` mask would serve both.
- The direction tables are written twice each:
  - `DIR` (homeFurniture.ts:269) = `DIR_STEP` (furniture.ts:177);
  - `OPPOSITE` (furnitureService.ts:19) = `entry` (serviceFurniture.ts:414).
  - They belong beside `WallDir` in room.ts.
- `isOutline` lives in the home builder and the service builder imports it from there. colors.ts is its natural home.
- The battle rooms' `PANEL_GLOW` (a number) shares its name with serviceFurniture's `PANEL_GLOW` (an RGB).
- No battle helper was missed: the bookcase is already shared. rooms.ts' `pillarGeometry` could seed the modelled
  Weather Institute pillar later (known gap 5).

**M6. The Phase A and Phase B test files overlap.**
- interiorHome.test.ts and interiorHomeFurniture.test.ts both run the footprint / height test for all 12 kinds.
- interiorService.test.ts:34 and interiorServiceFurniture.test.ts both hold "follows an L-shaped counter cell by cell".
- interiorService.test.ts:26 asserts `BALL_RED` equals its own literal, which restates the constant.
- interiorHome.test.ts:20 "turns a chair" asserts only east ≠ west. The geom test checks the back properly.
- These are cheap to fold, and harmless.

**M7. Stale numbers and wording in the docs.**
- progress log:405 "186 pins" is the pre-fix count. Today: 193 (40 / 36 / 41 / 36 / 40).
- progress log:412 "Dept Store rooftop → Task 12": it has since been ruled out of scope.
- The "138 maps" mentions in the log's Task 3/5 lines are historical and fine. shellParts.ts:512 "never seen on the 138
  maps" is a stale comment (area B).
- CLAUDE.md:62 "Phase 4 gate … Modern 0.00 % except the in-scope interior entries" should say "and the in-scope live
  entries (item_indoor, vigoroth, vigoroth_v, door_enter)", as the task-13 report states.
- The README's look list omits gap 15c (the PC's low magazine shelf drawn as a full 2.1 m bookcase), the visible cousin
  of M1.

**M8. Curation rules differ between tables (note only).**
- GenericBuilding keeps a plant's walkable leaf cell as `plant` (header :15-17). Lab labels it `tiles` (lab.ts:9-10).
- The result looks the same either way: the crown overhangs, and `columns()` stands the plant on its pot cell's
  height. It is worth one sentence in building.ts so future curators pick one rule.

## Declined to judge
- The healer panel's and screens' emissive tone: one grey-blue `FURNITURE_EMISSIVE` adds over every glow's vertex colour.
  This is art direction.
- Whether `partColors` reads unfaded palettes during a live warp build. That is area A / Phase 1; the door walks show
  correct colours.
- The floor chequer of Rustboro's flats becoming plain tiles (i_flat). That is area B (floors).
- Program and lifecycle details outside the furniture build (cutaway, light blend, dispose). Those are areas A and B.

## Assessment
**Ready to merge (area C): With fixes.**
- Furniture fitting, colours, glow and tables are correct on all 137 maps, and the rooms read well.
- Before merge, write the Phase 4 results and the 24 known gaps into the progress log (I2), and pin the fitting rule
  with a smoke test (I1). The minors can follow or be logged.
