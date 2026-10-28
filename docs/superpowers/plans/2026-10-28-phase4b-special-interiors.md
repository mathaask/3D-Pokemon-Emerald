# Phase 4b — Gyms, League, Hall of Fame, Town Specials and the Trick House Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Modern style, the 45 interiors Phase 4 left out on the League path and in the towns — the 10 gym maps, the 5
Elite Four rooms and 5 halls, the Hall of Fame, 16 town special rooms and the 8 Trick House puzzle rooms — become
modelled rooms like Phase 4's, and every gym mechanic (thin ice, switches, electric barriers, arrow tiles, warp pads,
toggle walls, gym doors, hidden stairs, geyser holes, rotating gates, darkness) gets a modern 3D treatment that reads
exactly like the GBA: same cells, same visibility, same timing. A runtime metatile change no longer rebuilds the world.

**Architecture:** Two pieces carry the phase. (1) An **incremental world update** (`World.patch`): a same-map grid
change is applied in place — a cell a family registered as *live* (`LiveCells`) changes a per-cell state texel that the
puzzle shaders read; an unclaimed legacy cell whose legacy quads keep their shape gets its UVs rewritten — and only what
neither path accepts rebuilds the world as today. (2) **Per-map scope** (`PHASE4B_MAPS` with a `MapProfile`: shell
mode, band depth, theme, puzzle flag) over 23 new curated id tables, a `puzzle` family (state-free geometry + state
texture), room layout v2 (perimeter shells, maze masses, doors in any wall), gym/League props, special-room furniture,
new floor kinds and a rotating-gate actor model. Everything else (Phase 4's 137 rooms, outdoors, battles, Retro) renders
exactly as today.

**Tech Stack:** TypeScript (strict), Three.js 0.186 (WebGL2: MeshStandardMaterial + `onBeforeCompile` via `kitMaterial`,
`compileAsync`), Vite, Vitest, puppeteer-core (headless Chrome, ANGLE D3D11).

**Spec:** `docs/superpowers/specs/2026-10-19-modern-3d-models-design.md` (§8 Phase 4 extended to the rooms §8 leaves
unnamed; §3.2 live updates, §9 testing, §10 budgets, §11 error handling, §12 non-goals, §13 risks). Inputs:
`.superpowers/sdd/phase4b-survey.md` (maps, tilesets, mechanics, risks), `docs/superpowers/progress/modern-3d.md`
("Phase 4 result", known gaps, the Phase 4b user decisions), `docs/superpowers/progress/phase4-sdd-ledger.md` (rulings
that carry over), Phase 4's plan `docs/superpowers/plans/2026-10-27-phase4-interiors.md`.

**Branch:** `phase4b-special-interiors` from `main` (d3dc89e, the Phase 4 merge; F40). Do not rely on line numbers in `renderer.ts`,
`overworldView.ts`, `world.ts`, `room.ts` or the kit families: refer to functions by name.

**Out of scope (Phase 4c, a separate later plan):** the Battle Frontier (59 maps incl. Pyramid, Trainer Hill, tents),
contest lobby/halls, the S.S. Tidal and `InsideShip`, the General-primary Facility rooms (Space Center, harbors, cable
car, Shipyard), secret bases and their decorations. **Never in 4b or 4c:** Mt Pyre 1F–6F, the Aqua Hideout and the
Fossil Maniac's tunnel (dungeons: a cave pass), the link rooms (Trade Center, Record Corner, Colosseums, Union Room —
link-only, spec §12), templates/unused maps and the event islands (survey: 31 maps).

## Preflight rulings applied

From `.superpowers/sdd/2026-10-28-phase4b-special-interiors/preflight.md`; the controller accepted all 44. F3 has a
controller ruling: in Retro, collision-changing edits are refused and rebuild. That is a known gap, and the user has
been told.

- F1 Tier heights come from labels, not from elevation (every walkable cell on the 45 maps is elevation 0 or 3). The
  source is `prepareInterior` in `world.ts` (Task 7, Modern kit only): solver re-run with labelled stairs as
  `K.Stairs`, mechanic cells walkable and `tierFace` runs voting. `MapProfile.tiers` (D13).
- F2 One preparation everywhere. `prepareInterior` (Task 3 introduces it, Task 7 extends it) is used by `World.build`,
  the patch re-analysis and `tests/smoke/helpers/interiorMaps.ts`; smoke contexts pass `mapKey`.
- F3 Collision-changing edits refuse `'structure'` in Retro (and in Modern until the C join). `PuzzleGate.expect` lists
  them. Visual-only changes patch with 0 builds in both styles.
- F4 Mechanic cells are found by position as well as by id (`InteriorTable.puzzleCells`, with `offId`). `accepts`
  ignores the variant, and the variant is written into the texel on every change (Mauville's `FloorTile` beams).
- F5 `DoorGap.kind: 'exit' | 'gymDoor' | 'passage'`. The shell draws no slab in gymDoor or passage gaps (Task 10).
  Task 9 draws the door leaves in gymDoor gaps.
- F6 Task 7 makes every `furniture.ts` and `tests/helpers/furniture.ts` change: `glass`/`glassLow` soups,
  `theme`/`artRows`, `piece()` defaults, `trianglesOf` over 6 soups. Tasks 11a and 11b own only their generators.
- F7 Task 7 updates the 137 pins in `interiors`, `interiorFitting` and `interiorRooms` (137 off / 182 on). `index.ts`
  exports `INTERIOR_GENERATORS`.
- F8 The puzzle meshes carry `userData.stateTexture`. `worldDigest` hashes it, the base-plane colour and kit uniform
  values (`kitMaterialSlots`). A negative test: a no-op `apply` makes the digests differ.
- F9 Hidden stairs are ramps between the tier heights in both states. The state changes only the surface: a smooth ice
  slope or steps.
- F10 One `artRows(a, ids, cells)` in `room.ts` (Task 5), used by Tasks 9, 10, 11a and 14.
- F11 `WallFeature.kind` gains `'painting' | 'blackboard'`. `featureKind` and `isArt` cover every `WALL_PARTS` member
  (Task 5).
- F12 Task 3's inertness check does not call `puzzleId`.
- F13 A cell is inert when `interiorId(old) === interiorId(new)` and its behaviour fallback is unchanged, or both ids
  are null/`legacy`.
- F14 Task 5 owns every new `fakeInterior` letter. `fakePuzzle` uses digits, with `FakeCell` entries that seed both
  the ids and the puzzle ids.
- F15 The vendor checkout has no `data/scripts/`. `i_pz_e4` uses explicit `cells:`. The live-id worklist adds the
  `*Door*`, `*Open*` and `*Closed*` labels as "suspected live".
- F16 `floorTile` counts every `FLOOR_KINDS` id and skips mechanic cells. Task 14 adds a real-map payload invariance
  check.
- F17 New wall part `tierFace`. Tier faces are risers (`RoomLayout.risers`), never masses.
- F18 On tier maps a run's `floorY` is its cell's height, `roomFloorHeights` is per cell, and the height votes skip
  mechanic cells. `floorAt` reads `prepareInterior`'s `groundH`.
- F19 Puzzle floor quads sit at `h(cell) + 0.002`, Z = y + h.
- F20 Task 12 builds the risers (`geom/tierRisers.ts`). Ledges keep the outdoor model: a lip, no step.
- F21 `RoomTheme`, `THEME_LIGHT` and `themeOf` live in `scope.ts` (Task 2); there is no `themes.ts`.
- F22 `ICE_SHEEN_GLSL` is exported by Task 8 and imported by Task 12.
- F23 `PUZZLE_RAISED_CATALOGUE` attributes include `aCell` and `aPart`; the catalogue binds a placeholder state
  texture.
- F24 Puzzle raised body and glass use `fade: false`; tall E4 door leaves (> 1.2) fade.
- F25 `i_pz_lily` Modern expects `'claimedNotLive'`. Task 14 allows claimed-decor refusals.
- F26 Rotating gates route at the sprite level (they are not object events). `gateArms` reads the sprite image or
  `rotating_gate.c`'s shape table. No `ObjectModelKind`.
- F27 Risers fade. New entries `i_g_sootopolis_back` and `i_g_sootopolis_side`. Task 14's visibility check runs at
  yaw 0 and π.
- F28 Task 1 commits `tests/decompEdits.test.ts`.
- F29 `PatchRefusal += 'error'`. The Retro outdoor cases assert `same`. `'retro'` is kept as an unused switch.
- F30 The patch check also compares tree cards and the Dry need, and refuses when `dominantFloor` changes.
- F31 The legacy check analyses the build grid plus the non-live changes only.
- F32 `checkRoomLayout` and `pocketDir` read `L.profile.bandMax`.
- F33 `gymDoor` has 6 states (closed plus Petalburg's 5 frames). Doors are tested on their end states and monotonic
  `open`; arrows get a real check; every look has a `tint`.
- F34 Task 7 defines `puzzleClaims`. `lanternFalloff` uses the 3D distance `hypot(d, 1.6)`.
- F35 Task 12 keeps one floor program (a branch per kind), not a draw per pattern.
- F36 The gate's yaw gets a unit test over rotations. Task 14 adds the live walk `pz_gate`. The Retro `routeSprite`
  test is dropped.
- F37 `puzzleRaisedGeometry(a, L, cells, rows)`.
- F38 Task 14's empty test body is written and its helpers defined. `PuzzleId.blocked` per state.
- F39 Task 15 does not edit `previewWhen`; it checks `OUT_OF_SCOPE_INTERIOR` holds the 4c controls.
- F40 The ledger and briefs name branch `phase4b-special-interiors` and base d3dc89e.
- F41 Every height bound is relative to the cell's own floor `h(cell)`.
- F42 `setCells` and `updateGrid` keep a copy of the previous grid.
- F43 The state texture is GW×GH×4 bytes (Petalburg 20.7 KB).
- F44 The Dewford dark entries are exempt from the day actor band as well as the room band.

## Lessons carried from Phase 4 (its preflight rulings and ledger) — where each applies here

- F5 fake ids reach the families only through the seed → `seedInteriorIds` / `seedPuzzleIds` in every fake test (Tasks 5, 6, 8–12).
- F6 a catalogue entry joins only when a family draws it → stubs export empty catalogues (Task 7); the controller joins them at the group-C join.
- F7 drift guard over 518 maps × qualities → every task touching materials runs `tests/smoke/catalogue.test.ts` (parallel: at the join).
- F13/F41 GLSL names and shared constants, never copies → `PUZZLE_STATE_GLSL` (Task 6) is the one state fetch; floors keep `TERRAIN_CELL_GLSL`.
- F16 doors in any wall → room layout v2 doors for door-behaviour and NORMAL warps (Task 5).
- F18 import cycles → generator maps and the puzzle builders are composed in `kit/interior/index.ts` / `puzzle/index.ts`, never imported by their cores.
- F22 shared checkout → Parallel execution rules (pathspec commits; looks and whole-world smoke only at joins).
- F23 low pieces never fade (glow/glass twins) → Tasks 9, 11a, 11b.
- F28 shared test helpers → `tests/helpers/furniture.ts` reused; `tests/helpers/puzzle.ts` (Task 6) shared by Tasks 8, 9.
- F29 `&kitFail` parsed before the first build → `&kitFail=puzzle` (Task 7).
- F33 sRGB vs linear in colour tests → helpers compare `lin(srgb)` (Tasks 8–12).
- F36 union order pinned → new kinds are appended at the end of each union; the order test updated once (Task 2).
- F37 `--interiors --static` = every entry → Global Constraints (looks use `--interiors` alone).
- F38 battles keep their hall light → D9 (unchanged: a battle in a gym or E4 room keeps Phase 3's light).
- F40 no edits to pinned battle files → Global Constraints.
- F42 gate lists named in the final run → Global Constraints, Task 15.
- Ledger: walkable cells carry nothing above 0.45 (`WALKABLE_SEAT`, relative to the cell's own floor, F41); one piece per
  cell for non-table kinds (`FURNITURE_SPLIT`); flat indoor floors (`flattenFloors`) **except the tier cells of
  `MapProfile.tiers` maps** (user answer 2, D13: `prepareInterior`); half-height partitions; colours from the tilesets' ROM tiles (`colorInfo`), never
  live VRAM (tile animations re-tint a rebuild — FW-A); the D8 light follows the clock, battles do not; two-sided night and
  dusk gates with the dusk actor floor; interior GPU budget **+2.0 ms** same-session A/B, never stored `gpuMs`; one GPU
  harness run at a time under the lock; group C in two phases (pure geometry in `geom/` in parallel with integration, wiring
  after); the decode of `analyzeMetatiles` in a build frame is a cost — the patch path never calls it.

## Global Constraints

- **No Nintendo assets in the repository and no downloads.** Tables map metatile ids to our labels; colours come from the
  ROM at runtime; decomp-derived edit lists are read at test/harness time from `vendor/pokeemerald-src` (gitignored, on the
  dev machine like the ROM) and never committed as data beyond ids and coordinates.
- World mapping unchanged: grid (x, y) at height h → world (X = x, Y = h, Z = y + h). Models stand on the cells the game
  blocks, anchored at the south edge of their cells.
- **Retro renders every entry exactly as today:** `npm run regress:live -- --label tN --static --compare p4b-base`
  reports **0.00 %** on every Retro shot after every task (puzzle walks included: a patch draws the same pixels as a
  rebuild). **Modern stays 0.00 %** on every outdoor, battle, transition, out-of-scope control (`i_secret`, `i_dept_roof`,
  `truck_inside`, `i_frontier`, `i_contest`, `i_mtpyre`, `i_link`) and **every Phase 4 interior entry** (the `i_*` entries of
  Phase 4 except `i_gym`, `i_gym_night`: `PHASE4_INTERIOR` in the harness). Only the 45 new maps' Modern entries change.
  A patched world equals the rebuilt world (`worldDigest`) in **both** styles (user answer 1).
- **Expected refusals (F3, controller ruling).** A decomp edit that changes a cell's collision (Mauville barriers,
  Mossdeep arrows/switches, Trick House 3/7 walls and levers, the E4/Champion doors) changes the analysis' `kind`. In
  Retro, and in Modern until the group-C join makes the mechanics live, it is refused `'structure'` and the world
  rebuilds: a known gap, logged. Each puzzle entry's `PuzzleGate.expect` lists those refusals per style. The gate then
  holds when the refusals are exactly the expected ones, each refused change rebuilds within the crossing frame budget,
  and `patches + refusals == gridChanges`. Visual-only changes (ice cracks, arrow tiles with unchanged collision, light
  floors, Petalburg's sliding doors, the Sootopolis stairs, the Lilycove paintings in Retro) patch with **0 builds in
  both styles**.
- **Night (D8 for the new rooms).** New night/dusk twins (`NIGHT_TWINS`, two-sided): room luma night/day 0.45–0.8, dusk
  0.7–0.95, actors 0.9–1.15. Dewford's dark entries are exempt from the room band and from the day actor band
  (`dayActorGated`): their light is the flash rule, D10 (F44).
- **Budgets (Medium, 1280×800).** ≤ 150 draw calls and ≤ 1.5 M triangles on every interior entry; warm rebuild
  (`preview.measureRebuild()`, median of 5) build ≤ 40 ms, build + first frame ≤ 100 ms on every new `i_*` entry;
  same-session A/B `--ab-feature interior` Δgpu ≤ **+2.0 ms** (Phase 4 ruling), Δcpu ≤ +0.5 ms; new GPU memory ≤ 4 MB per
  interior. **Patch budgets (proposed, ruled in Task 15):** a live-cell patch ≤ 1.0 ms CPU, a legacy-cell patch ≤ 12 ms
  (median ≤ 8 ms); no program compiled, no world build, no geometry/material/texture object created by a patch; every
  grid change applied in the sync of the frame that reads it (`patches + expected refusals == gridChanges` on a puzzle
  walk, F3); the state texture is GW×GH×4 bytes (≤ 21 KB, Petalburg; F43); the frame
  holding a patch ≤ the walk's median frame + 4 ms (live) / + 16 ms (legacy). Map loads into and out of gyms keep the
  crossing gate (one build, no compile, frame ≤ build + max(40, 0.5 × build)).
- **Coverage:** legacy share of in-map non-void cells on the 45 maps ≤ 10 % on average, no map > 25 % without a
  controller ruling; table coverage ≥ 97 % per tileset (on the tables' own maps).
- **Programs constant after boot.** Every new material is in `worldCatalogue` (via `INTERIOR_CATALOGUE`); the drift guard
  passes after every task that touches materials (parallel groups: at the join). No new `THREE` lights (Dewford's darkness
  reuses the existing lantern, D10).
- **Error handling (spec §11):** every family inside `runKit`'s try/catch; a failed family's `LiveCells` is dropped with
  it (its cells legacy, patched by the legacy path: their ids are state-free, so inert by D3's rule, F13); `World.patch`
  never throws (a caught exception is the refusal `'error'`, F29; a refusal rebuilds).
- `npx tsc --noEmit` and `npm test` pass at the end of every task (parallel groups: at the join); smoke tests a task adds or
  touches pass. Battle files pinned by `tests/battlePins.test.ts` are not edited.
- Every look task ends with a **visual review** (`npm run regress:live -- --label tN --interiors --review --review-before
  p4b-base`; `_review_interior.png`: GBA map | before | Modern | Retro); in a parallel group it runs after the join.
  `--interiors` alone = the interior entries; `--static` = every entry (the 0.00 % gate's job). Quality bar: modern
  stylised 3D (Let's Go / BDSP), the GBA's state readable at a glance.
- **GPU lock:** every `regress:live` run takes `mkdir .scratch/regress.lock` (wait while it exists; `rmdir` after); `--gpu`,
  `--ab` and `measureRebuild` timing never run alongside anything (Tasks 1 and 15 only, sequentially).
- The controller keeps `docs/superpowers/progress/modern-3d.md`; implementers report learnings and numbers. Only `opus`
  subagents. Bash heredocs with large content fail: write files with the editor tools; scratch in `.scratch/`.
  Implementers work in the main checkout (ROM, `out/*.state`, `vendor/` exist only there).

## Review Focus

1. **A puzzle cell showing the wrong state, or the right state late** — a patch followed later by a full rebuild (style
   switch, V and back, re-entry) must show the same state; Petalburg's door slides over several frames; Mauville flips a
   switch and 20+ barrier cells in one frame. Expected: the 3D state equals the grid's on every frame. Pinned: Task 3
   (patched world digest = rebuilt world digest), Task 6 (state texture round trip), Task 14 (every decomp edit on every
   map, both styles), harness `patches + expected refusals == gridChanges` (Tasks 1, 3, 14; F3). A patch that does
   nothing must fail the digest (F8's negative test).
2. **Visibility differing from the GBA** — a maze wall, statue, barrier or toggle wall hiding a walkable cell or a trainer
   the GBA shows; an invisible wall (blocked cell drawn as floor) getting a model; Dewford's lit circle bigger or smaller
   than the GBA's. Pinned: Task 10 / 11a `massHeight` and prop heights ≤ their art rows (`artRows`, F10); a riser hiding a lower-tier actor at yaw π (D13, F27); Task 14
   `interiorVisibility.test.ts`; Task 7 `flashLight` test.
3. **The patch path patching when it must not, or silently refusing** — a legacy cell whose new art switches cutout ↔
   opaque, a collision change that moves a legacy wall face, a family that reads a puzzle cell's state (the furniture
   cut, the floor vote, the room layout), the bike shop's General primary. Pinned: Task 3 refusal reasons + digest test;
   Task 6 state-invariance test; Task 14 digest over all edits; harness counts builds (0 on a puzzle walk).
4. **Multi-room gyms and doors** — Petalburg's nine stacked rooms with doors between them, Mossdeep's six rooms, E4 rooms
   whose south entrance is a NORMAL warp closed by script, no wall over a walkable or door cell. Pinned: Task 5 fake rooms
   + `checkRoomLayout` on the 45 maps (0 findings, Task 14).
5. **Darkness and the clock together** — Dewford at night with flash level 4, the radius growing as trainers fall (no
   rebuild), a battle started there keeping its hall light (F38), the D8 night blend under the flash. Pinned: Task 7
   `flashLight` + `updateLighting` wiring test (`tests/overworldLighting.test.ts`), entries `i_g_dewford_dark`,
   `i_g_dewford_night_dark` (Tasks 1, 7, 14).

## Key design decisions (deviations from the spec are marked ⚑)

- **D1 ⚑ Per-map scope.** `interiorScope` keeps Phase 4's rule (the five secondaries, 137 maps) and adds the 45 maps of
  `PHASE4B_MAPS` (key "group.num" → `MapProfile`), each on a tileset with a table. The survey's split: gyms 3.3, 4.1, 4.2,
  8.1, 10.0, 11.3, 12.1, 14.0, 15.0, 15.1; Elite Four 16.0–16.4 (rooms) and 16.5–16.9 (halls); Hall of Fame 16.11; town
  specials 9.6, 9.7, 9.8, 10.1, 10.3, 11.0, 11.2, 11.4, 13.2, 13.3, 14.11, 15.13, 15.14, 17.1, 22.0, 28.0; Trick House
  29.3–29.10. (13.9, 14.12, 16.14, 29.0–29.2 and 3.4 are on Phase 4 tilesets and already in scope.) The 4b scope stays
  off (`PHASE4B_DEFAULT = false`) until Task 7 switches it on: until then no pixel changes.
- **D2 23 curated tables, one more id kind.** New tables (`kit/tables/interior/<name>.ts`): PetalburgGym, RustboroGym,
  DewfordGym, MauvilleGym, LavaridgeGym, FortreeGym, MossdeepGym, SootopolisGym, EliteFour, CableClub (Hall of Fame only),
  TrickHousePuzzle, OceanicMuseum, LilycoveMuseum, Facility, MauvilleGameCorner, MossdeepGameCorner, BikeShop (General
  primary: it labels the General ids its map uses), PokemonFanClub, PokemonSchool, PokemonDayCare, SeashoreHouse,
  PrettyPetalFlowerShop, MysteryEventsHouse. `InteriorId` gains `PuzzleKind`; a table's `puzzle` map gives each mechanic id
  its `PuzzleId { kind, state, variant, blocked }`. **`interiorIds(a)` returns the puzzle kind for every state of a
  mechanic** (state-free), so no family but `puzzle` can see a cell's state. **Mechanic cells are found by position as
  well as by id (F4).** A table's `puzzleCells` lists, per map, the cells whose states include an id that is not a
  mechanic id. Mauville's vertical beams switch off into the plain `METATILE_MauvilleGym_FloorTile` (0x21A), and its
  pole/beam cells change variant between scripts. Those cells are mechanics whatever id they show; their `offId` is the
  plain id. New wall part `tierFace` (the art of a tier's face, D13).
- **D3 ⚑ Incremental world update (spec §3.2 rebuilds on every grid change).** A same-map, same-tileset grid change goes
  to `World.patch(grid, changed, ctx)`: (a) a changed cell some family registered as live (`LiveCells.accepts`) is applied
  by that family (`apply`: a state texel; never new geometry, material or texture); (b) an unclaimed cell is re-checked by
  re-running `analyze` (+ `prepareInterior` when the interior kit ran: the build's own preparation, F2) and `emitLegacy`
  with the build's claims. The re-analysis reads the **build-time grid with only the non-live changes applied**; live
  cells keep their build-time raw values, so a stored analysis never goes stale (F31). The cells are patched if the
  analysis' structural arrays (`kind`, `height`, `groundH`, `groundOf`, `building`, `roundTree`, `waterLevel`),
  `groundRefs`, `dominantFloor` and the Dry need are unchanged. The new quad list may differ from the old only in
  `metatile` / `variant` / `tu0`/`tu1`/`tv0`/`tv1` (same count, order, corners, normal, shade, `cutout`, `water`,
  `glow`), and the tree cards (`emitLegacy().trees`) only in `metatile` / `variant` (F30). Then the UVs of those quads
  and tree cards are rewritten in place (`addUpdateRange`). On an interior-kit map the cell must also be inert:
  `interiorId(old) === interiorId(new)` (state-free by D2) with the same `BEHAVIOR_IDS` fallback, or both ids null /
  `legacy` (F13; no `puzzleId` call, F12). All-or-nothing: every changed cell is checked before any is applied.
  Anything else returns a refusal and the world rebuilds as today: a claimed cell that is not live, more than
  `PATCH_MAX_CELLS` = 256 cells, a structural change (**a collision change always is**: `kind` Floor ↔ Block, F3), an
  outdoor Modern map (its families are not live yet), or a caught exception (`'error'`). Where it runs: Modern interiors
  (kit or no kit) and, by `PATCH_RETRO` (user answer 1: true; `'retro'` stays as the unused switch), Retro on every map; Modern
  outdoors only measures (Task 3 reports the per-step outdoor rebuilds — Fortree bridges, Route 113 ash, Pacifidlog logs —
  as a follow-up candidate; making outdoor families live is not in 4b).
- **D4 Puzzle geometry is state-free; the state is a texel.** The `puzzle` family (first in `INTERIOR_FAMILIES`) claims
  every mechanic cell `CLAIM_SURFACE | CLAIM_OBJECT | CLAIM_TOP` whatever its state, builds the geometry every state needs,
  and stores the states in one RGBA8 `DataTexture` (one texel per analysis cell: r = state, g = variant, b = kind + 1).
  Floors pick their look in the fragment shader, raised parts (barriers, toggle walls, doors, stairs) move in the vertex
  shader (`vertTransform`: shadows follow through its depth twin) — both through `PUZZLE_STATE_GLSL`. A patch writes a
  texel (state, and the variant the new id names, F4) and flags the texture: one upload of GW×GH×4 bytes, up to 21 KB
  on Petalburg (F43). **The texture lives on the meshes** (`mesh.userData.stateTexture`, set by the puzzle family on
  every mesh that samples it), because kit uniforms sit in the material pool's private slots. That is how
  `worldDigest` sees it (F8). The room layout, its height votes and `floorTile` read every mechanic cell as room floor
  (inside, walkable) whatever its collision, so walls, heights and floors never move with a state (F16, F18).
- **D5 Mechanics: GBA logic, modern look, state at a glance.** The game's cells, collision and timing are untouched (we only
  draw): every state the grid holds has its own look, and those looks differ by a readable amount (`PUZZLE_LOOK`, tested).

  | Mechanic (kind) | Maps | GBA logic (unchanged) | 3D treatment | State shown by |
  |---|---|---|---|---|
  | Thin ice (`thinIce`) | Sootopolis 1F/B1F | ice → cracked when stepped off → broken; fall to B1F | glossy pale-blue slab with soft depth tint; cracked: white fracture lines; broken: dark hole with a jagged rim | cracks / hole |
  | Hidden stairs (`hiddenStairs`) | Sootopolis 1F | appear when a tier's ice is cleared (0x20F → `…_Stairs` 0x207, walkable in both states) | a ramp between the two tier heights in **both** states (D13, F9): hidden = a smooth ice slope, risen = extruded stone steps | slope / steps |
  | Floor switch (`floorSwitch`) | Mauville, Mossdeep, Trick House 2 | step toggles | round pad: raised = dim with a rim, pressed = sunk with a glowing ring (the "light-up floors") | glow |
  | Electric barrier (`barrier`; variant pole / beam H / beam V) | Mauville | on/off by switch (the V beams' off state is the plain `FloorTile`; pole/beam cells change variant: by position, F4) | metal poles, glass tubes between them; on: bright core inside the glass; off: clear empty glass | core lit / clear |
  | Arrow tile (`arrowTile`; state = direction) | Mossdeep, Trick House 7 | forced move; switches turn it | inset tile with glowing chevrons | chevron direction |
  | Warp pad (`warpPad`) | Mossdeep, Trick House 7 | warp | glowing ring pad | always lit |
  | Toggle wall (`toggleWall`; variant red / blue) | Trick House 3 | a switch raises one colour, lowers the other | tinted translucent glass block; up: raised to its art height; down: flush floor plate | raised / flush |
  | Gym door (`gymDoor`; state = slide frame, 6 states: closed + Petalburg's `SlidingDoor_Frame0–4`, F33) | Petalburg, E4 entrances/exits (`EntryDoor_Closed*`, `OpenDoor*`: shared script, F15), Trick House doors | scripted closed / opening frames / open | framed sliding door panels in a `gymDoor` gap (no shell slab, F5) | slide position |
  | Geyser hole (`geyserHole`) | Lavaridge 1F/B1F | warp | sand crater with a warm glow | static |
  | Rotating gate (actor) | Fortree, Trick House 6 | sprite rotation (`rotating_gate.c`) | wooden turnstile at the pivot, yaw from the sprite's rotation (Task 13) | yaw |
  | Darkness | Dewford | `flashLevel` radius | the lantern's falloff matched to the GBA radius (D10) | lit circle |
  | Slide ice / ledges | Sootopolis, Trick House 8, HoF; Lavaridge, Fortree | floor behaviour | floor kinds `ice`, `ledge` (Task 12): sheen; a ledge is a bevelled lip with no step (the outdoor model: `K.Ledge` takes the floor south of it, F20) | static |
  | Tiers (**real raised platforms**, user answer 2) | Sootopolis 15.0/15.1 (and maps Task 5's measurement adds) | floor art + collision; the game's elevation is 0/3 everywhere and holds no tier | walkable `tier` tops at their real height from `prepareInterior` (D13), `tierFace` risers built by Task 12, hidden stairs as ramps; actors follow `heightAt` | static |
  | Invisible walls | any blocked cell drawn as floor | collision only | nothing: geometry follows the art labels, never collision alone | — |
- **D6 Visibility rule on puzzle maps** (`MapProfile.puzzle`: the 10 gyms and 8 Trick House rooms). A model standing on
  blocked cells is at most as tall as the rows its GBA art spans there (its cells plus the same-label art rows north of
  them, un-projected from the cell's own floor; one helper, `artRows` in `room.ts`, F10), so at the default camera it hides
  what the GBA art hides and nothing more. Nothing above `WALKABLE_SEAT` stands on a walkable or mechanic cell. Every
  bound is measured from the cell's own floor height `h(cell)` (F41). Maze masses with room on their north side are
  ≤ `MASS_H_MAX` = 1.0. **Tier risers are not masses** (D13): a riser is as tall as its face rows, which un-projected is
  the height difference. Phase 4's real-world heights still hold in the town specials (rooms, not puzzles).
- **D7 Room layout v2.** `MapProfile.shell`: `'band'` (Phase 4's back band in a recess, `bandMax` per map) or
  `'perimeter'` (no band: walls stand on the boundary between room material and void, no recess; wall-art cells under the
  void and blocked masses inside the room become **masses** built as solids with their art as decals on their faces).
  Masses (`RoomLayout.masses`): Phase 4 partitions keep their own path; `mazeWall` / `ridge` labels and perimeter wall art
  become `maze` / `ridge` / `perimeter` masses. Doors: arrow mats as today, plus warps whose cell behaviour is a door
  (`DOOR_BEHAVIORS`, `NON_ANIMATED_DOOR`) or a NORMAL warp on a room's boundary row with void beyond (Petalburg's inter-room
  doors, the E4 entrances) cut a gap in that wall. Each gap has a `kind` (F5): `'exit'` (mats, door behaviours that
  warp out), `'gymDoor'` (a `gymDoor` id: Task 9 draws the leaves, the shell keeps the casing and draws no slab),
  `'passage'` (NORMAL warps between rooms: no slab). Wall features add `painting` and `blackboard` (F11). `floorTile`
  counts every `FLOOR_KINDS` id and skips mechanic cells (F16). On a `tiers` map each run's `floorY` is its own cell's
  height, and `tierFace` cells become `RoomLayout.risers` (D13, F17, F18). `checkRoomLayout` and the cutaway's pockets
  read `L.profile.bandMax` (F32). The 137 Phase 4 layouts are pinned unchanged (15 digests).
- **D8 Initial profiles** (Task 2; Task 5 may propose changes with evidence, the controller edits `scope.ts`): perimeter
  shell for Dewford 3.3 (band fit 22 %), Sootopolis 15.0/15.1 (32 %), Fortree 12.1 (50 %) and Mossdeep Game Corner 14.11
  (33 %); band for the rest, `bandMax` 3. Themes: 16.0 `sidney`, 16.1 `phoebe`, 16.2 `glacia`, 16.3 `drake`, 16.4
  `champion`, 16.5–16.9 `hall`, 16.11 `hallOfFame`. Puzzle: the 10 gyms and 29.3–29.10. Tiers (`tiers: true`): 15.0 and
  15.1 to start; Task 5 measures every 4b map and proposes others with evidence (D13).
- **D9 Light.** All new rooms follow the clock (D8 of Phase 4: `interiorKitRan` → `indoorLight(nightFactor(hour))`, actor
  floor, `uOutdoorNight`); they have no windows, so no shafts. Themes add emissive accents (brazier flames, Phoebe's
  candles, the HoF dais glow: `THEME_LIGHT`), never new lights. Battles started in these rooms keep Phase 3's hall light
  (F38, unchanged).
- **D10 Darkness keeps its rule.** Dewford's `flashLevel` darkness stays (the game's radius 7 → 1 as trainers fall). On a
  room whose interior kit ran, `flashLight(level)` sets the existing lantern so the lit area matches the GBA circle
  (`FLASH_RADIUS_PX[level] / 16` cells: ≥ 50 % of the centre light inside it, ≤ 10 % one cell beyond), and the D8 room
  light underneath is scaled by its `ambient`. Every other map (caves, Retro) keeps today's lantern values exactly. A
  flash change is a light change, never a rebuild.
- **D11 Colours from the ROM tiles** (`colorInfo`) for every new part; states from the grid only, never from pixels or
  tile animation.
- **D12 Live fixtures for puzzle walks.** No save state stands in a gym. `tools/puzzle-states.ts` makes them: from
  `out/s22.state` it walks into May's house door and, once the game has set its warp destination, overwrites
  `sWarpDestination` (EWRAM, `{ group, num, warpId 0xFF, x, y }`) with the target cell, then saves `out/pz_<name>.state`
  (gitignored). A test-tool poke only (open question 3); the app never writes game memory. Static entries cover every
  mechanic too, by applying decomp edit lists through `preview.setCells`. The vendor checkout has no `data/scripts/`
  (shared scripts such as `elite_four.inc`), so the E4 door edits are explicit `cells:`, not `script:` (F15).
- **D13 Real raised platforms (user answer 2; F1, F9, F17–F20).** None of the 45 maps stores its tiers in elevation:
  every walkable cell is elevation 0 or 3 (Sootopolis 1F: the ice 0, the floors 3; Rustboro: all 3). The existing
  solver comes out flat indoors, because its `flanked` stairs rule is off there: Sootopolis' one-wide passages at x = 8
  join the tiers into one component. So the heights come from **labels**, through `prepareInterior(a, profile)` in
  `world.ts` (Task 3 introduces it as today's `flattenFloors`, Task 7 adds the tiers). It runs in the **Modern kit path
  only**; Retro's `analyze` is untouched (0.00 %). On a map without `tiers` it is `flattenFloors` exactly (Phase 4 maps
  byte-identical; the Phase 4 flat-floor ruling is scoped away from tier cells only). On a `tiers` map it re-runs the
  solver's component and vote pass: `hiddenStairs` cells as `K.Stairs` (ramped), mechanic cells walkable (state-free
  heights), `tierFace` runs as the voting blocked runs. Every non-tier cell is then flattened to its own tier's height,
  and blocked cells on a tier get their tier's `groundH` (searching north first next to a riser). `World.build`, the
  patch re-analysis and every smoke helper call this one function (`tests/smoke/helpers/interiorMaps.ts`, F2).
  Actors stand on `World.heightAt` → the analysis, so they follow the tiers. Risers are built by Task 12, use `fade: true`
  (they may hide lower-tier actors at other yaws, F27), and are checked at yaw 0 and π.

## Parallel execution

Tasks with the same group letter run as parallel subagents: they own disjoint files (listed per task) and share no
interface that is still changing. Rules (Phase 4's): (1) a parallel agent runs only its own tests; the controller runs
`npx tsc --noEmit && npm test` plus the smoke drift guards at the **join** and attributes failures by file ownership;
(2) each agent commits only its own files with a pathspec commit, one at a time (`git commit -m "…" -- <own files>`;
never `git add -A`, never a bare `git commit`); (3) the agents share one working tree, so a parallel agent runs **no**
whole-world smoke test (`catalogue`, `golden`, `semantics`, `interiorWorld`, `worldPatch`) and **no** `regress:live`
while its group runs — after the join the controller runs one `--interiors --review` look plus the `--static --compare
p4b-base` gate and hands each agent its rows (or resumes them one at a time, each look under the GPU lock); (4) `--gpu`,
`--ab` and `measureRebuild` timing run only in Tasks 1 and 15, alone.

| Order | Tasks | Mode |
|---|---|---|
| 1 | 1 harness, fixtures, `p4b-base` | sequential (GPU baseline) |
| 2 | **A:** 2 scope + tables scaffold ‖ 3 incremental world update | parallel |
| 3 | **B:** 4a ‖ 4b ‖ 4c ‖ 4d ‖ 4e tables ‖ 5 room layout v2 ‖ 6 puzzle state core ‖ 13 rotating gate | parallel (8 agents; the controller runs them in waves of ≤ 5) |
| 4 | 7 integration ‖ **C phase A** (8, 9, 10, 11a, 11b, 12: pure geometry/GLSL in `geom/` + node tests, no edits to Task 7's files) | parallel |
| 5 | **C phase B:** 8 ‖ 9 ‖ 10 ‖ 11a ‖ 11b ‖ 12 wire into their own family files; looks under the lock, one at a time | parallel (≤ 5 at once) |
| 6 | 14 smoke, coverage, visibility, digests, live check | sequential |
| 7 | 15 performance, robustness, docs | sequential (GPU A/B) |

---

## File Structure

Created:
- `tools/lib/decompEdits.ts` — metatile labels and `setmetatile` lists from `vendor/pokeemerald-src` (harness + smoke).
- `tools/lib/warp.ts`, `tools/puzzle-states.ts` — the warp fixture and the gym/Trick House save states (D12).
- `src/render/overworld/gridDiff.ts` — `changedCells`.
- `src/render/kit/tables/interior/{petalburgGym,rustboroGym,dewfordGym,mauvilleGym,lavaridgeGym,fortreeGym,mossdeepGym,
  sootopolisGym,eliteFour,cableClub,trickHousePuzzle,oceanicMuseum,lilycoveMuseum,facility,mauvilleGameCorner,
  mossdeepGameCorner,bikeShop,pokemonFanClub,pokemonSchool,pokemonDayCare,seashoreHouse,prettyPetalFlowerShop,
  mysteryEventsHouse}.ts` — one `InteriorTable` each.
- `src/render/kit/interior/puzzle/state.ts` — puzzle cells, state texture, `PUZZLE_STATE_GLSL`, `LiveCells` impl, looks.
- `src/render/kit/interior/puzzle/index.ts` — `puzzleFamily`, `PUZZLE_CATALOGUE` (composes floors + raised).
- `src/render/kit/interior/puzzle/floors.ts`, `puzzle/raised.ts` — the builders (stubs in Task 7, filled by Tasks 8, 9).
- `src/render/kit/interior/geom/{puzzleFloors,puzzleRaised,gymWalls,leagueProps,specialFurniture,tierRisers}.ts` — pure
  geometry (`tierRisers`: Task 12, D13).
- `src/render/kit/interior/furnitureLeague.ts`, `furnitureSpecial.ts` — generator maps (stubs in Task 7).
- (`themeOf`, `THEME_LIGHT`, `RoomTheme` live in `scope.ts`, Task 2 — no `themes.ts`, F21.)
- `src/render/actors/rotatingGate.ts` — the gate model.
- Tests: `tests/gridDiff.test.ts`, `tests/smoke/helpers/worldDigest.ts`, `tests/smoke/helpers/interiorMaps.ts` (Task 7,
  F2), `tests/smoke/worldPatch.test.ts`,
  `tests/kitPuzzleState.test.ts`, `tests/helpers/puzzle.ts`, `tests/interiorPuzzleFloors.test.ts`,
  `tests/interiorPuzzleRaised.test.ts`, `tests/interiorGymWalls.test.ts`, `tests/interiorLeague.test.ts`,
  `tests/interiorSpecial.test.ts`, `tests/rotatingGate.test.ts`, `tests/smoke/specialInteriors.test.ts`,
  `tests/smoke/interiorVisibility.test.ts`.

Modified:
- `tools/regress-live.ts`, `tools/gen-symbols.ts` + `src/game/symbols.ts`.
- `src/render/kit/semantics.ts` (`LiveCells`, `Family.live`, `runKit().live`), `src/render/overworld/world.ts` (`patch`,
  `prepareInterior`: Task 3 introduces it, Task 7 adds the tiers), `src/render/kit/materials.ts` (`kitMaterialSlots`,
  Task 3, F8), `src/render/overworld/overworldView.ts` (`updateGrid`, counters, flash light), `src/render/renderer.ts`
  (stats), `src/render/preview.ts` (`setCells`, stats).
- `src/render/kit/tables/building.ts`, `src/render/kit/interior/scope.ts`, `room.ts`, `shell.ts`, `geom/shellParts.ts`,
  `floors.ts`, `geom/floorPatterns.ts`, `furniture.ts` (spec/split entries for the new kinds: Task 2; glass soups,
  `theme`/`artRows`: Task 7, F6), `index.ts`.
- `src/render/overworld/timeOfDay.ts` (`flashLight`), `src/game/spriteKinds.ts`, `src/render/actors/actorLayer.ts` (the
  sprite-level gate route, F26).
- Tests: `tests/kitInteriorTables.test.ts`, `tests/smoke/interiorTables.test.ts`, `tests/interiorFurniture.test.ts` (kind
  lists), `tests/interiorRoom.test.ts`, `tests/smoke/interiorRooms.test.ts`, `tests/interiorFloors.test.ts`,
  `tests/timeOfDay.test.ts`, `tests/overworldLighting.test.ts`, `tests/smoke/interiorWorld.test.ts`,
  `tests/smoke/interiors.test.ts`, `tests/smoke/interiorFitting.test.ts` (Task 7, F7), `tests/helpers/furniture.ts`
  (Task 7, F6), `tests/helpers/fakeInterior.ts` (Task 5); `README.md`, `CLAUDE.md`.

---

### Task 1: Harness entries, puzzle fixtures, grid-change counters, `p4b-base`

Today the harness has no gym, League, special-room or Trick House puzzle entry (only `i_gym` = Petalburg 8.1 and
`i_trickhouse` = the corridor 29.2), no save state inside a gym, and no way to change a cell in a preview. This task adds
all of it, records what every runtime cell change costs today, and captures the Phase 4b baseline.

**Files:**
- Create: `tools/lib/decompEdits.ts`, `tools/lib/warp.ts`, `tools/puzzle-states.ts`, `tests/decompEdits.test.ts` (F28)
- Modify: `tools/regress-live.ts`, `tools/gen-symbols.ts` (WANTED += `sWarpDestination`; `npm run symbols`),
  `src/game/symbols.ts`, `src/render/overworld/overworldView.ts` (`gridChanges` counter only), `src/render/renderer.ts`
  (stats), `src/render/preview.ts` (`setCells`, stats)

**Interfaces:**
- Produces (`tools/lib/decompEdits.ts`, Node only, reads `vendor/pokeemerald-src`; throws a clear error when it is absent):
  ```ts
  export interface DecompEdit { x: number; y: number; metatile: number; blocked: boolean; label: string }
  /** METATILE_* → id, from include/constants/metatile_labels.h. */
  export function metatileLabels(): ReadonlyMap<string, number>;
  /** Every `setmetatile x, y, METATILE_…, TRUE|FALSE` of data/maps/<mapName>/scripts.inc, map-local; with `label`, only
   *  those under that script label (up to the next label). */
  export function scriptEdits(mapName: string, label?: string): DecompEdit[];
  /** The METATILE_* names a C file of src/ writes with MapGridSetMetatileIdAt (field_tasks.c, field_specials.c,
   *  rotating_tile_puzzle.c …), resolved to ids. */
  export function cMetatiles(file: string): ReadonlyMap<string, number>;
  /** The grid's u16 after the edit: elevation kept, collision 0x0C00 when blocked, else 0, metatile bits 0–9. */
  export function editRaw(old: number, e: Pick<DecompEdit, 'metatile' | 'blocked'>): number;
  ```
- Produces (`tools/lib/warp.ts`): `warpInto(gba: Gba, state: GameState, to: { group: number; num: number; x: number; y:
  number }): { frames: number }` — from `out/s22.state` (Littleroot, player 12,9): RIGHT 32 frames, UP held; each frame
  reads `sWarpDestination` (WarpData: s8 group @0, s8 num @1, s8 warpId @2, s16 x @4, s16 y @6); when it names 1.2 (May's
  1F) it writes `to` with warpId 0xFF; runs until `state.mapGroup/mapNum` equal the target and 60 frames after the fade-in.
- Produces (`tools/puzzle-states.ts`): `npx tsx tools/puzzle-states.ts [--only a,b]` → `out/pz_<name>.state` for
  `sootopolis` (15.0, next to the first thin-ice field), `mauville` (10.0, one cell from a switch, out of every trainer's
  sight), `mossdeep` (14.0, next to an arrow switch), `e4` (16.0 Sidney's room at the entrance before the door script),
  `th3` (29.5, next to a red/blue switch), `lavaridge` (4.1, next to a geyser hole); each probed and printed (map, cell,
  "free" = a held direction moves the player and no battle starts within 120 idle frames). Cells are found by the probe
  and recorded in the recipes' comments.
- Produces (counters, read-only, no behaviour change): `OverworldView.gridChanges` (syncs whose grid differs from the
  last one with the same map key and tilesets); `Renderer.stats()` and `PreviewApp.stats()` += `gridChanges` (Task 3 adds
  `patches`, `lastPatchMs`); `PreviewApp.setCells(edits: readonly (readonly [x: number, y: number, raw: number])[]):
  'patch' | 'build'` — writes a **copy** of the preview grid (the previous one kept for `changedCells`, F42) and rebuilds
  (today: always `'build'`; Task 3 routes it through `updateGrid`).
- Produces (harness):
  ```ts
  /** A puzzle walk / edit entry's gate. 'record': report only (today's rebuild ms + first frame per change). 'gate':
   *  after the settle, programs constant, refusals exactly `expect` (F3: the collision-changing edits, refused
   *  'structure' — or 'claimedNotLive' for claimed decor, F25 — each rebuilt within the crossing frame budget),
   *  patches + refusals == gridChanges ≥ 1, builds == refusals, every patch within its budget (path 'live' ≤ 1.0 ms,
   *  'legacy' ≤ 12 ms), the patch frame ≤ the walk's median frame + 4 / + 16 ms. Per style: `retro` / `modern` (a style
   *  without its own mode records). */
  interface PuzzleGate { retro: 'record' | 'gate'; modern: 'record' | 'gate'; path: 'live' | 'legacy';
    expect?: { retro?: Partial<Record<PatchRefusal, number>>; modern?: Partial<Record<PatchRefusal, number>> } }
  interface EditSpec { script?: [mapName: string, label?: string]; cells?: [x: number, y: number, metatileLabel: string, blocked: boolean][] }
  // LiveEntry += puzzle?: PuzzleGate;  StaticEntry += edits?: EditSpec; puzzle?: PuzzleGate (static: 30 frames, setCells, 30 frames, shot)
  ```
  New static entries (all `i_*`, so `--interiors` runs them; hour 11 unless set): gyms `i_g_petalburg_entry` (8.1, camera
  on the entrance room), `i_g_rustboro` 11.3, `i_g_dewford` 3.3, `i_g_dewford_dark` 3.3 `&flash=4`, `i_g_mauville` 10.0,
  `i_g_lavaridge` 4.1, `i_g_lavaridge_b1f` 4.2, `i_g_fortree` 12.1, `i_g_mossdeep` 14.0, `i_g_mossdeep_yaw` (yaw 1.5708),
  `i_g_sootopolis` 15.0, `i_g_sootopolis_b1f` 15.1, `i_g_mauville_fail` (`&kitFail=puzzle`); League `i_e4_sidney` 16.0,
  `i_e4_phoebe` 16.1, `i_e4_glacia` 16.2, `i_e4_drake` 16.3, `i_e4_champion` 16.4, `i_e4_hall` 16.5, `i_e4_hall5` 16.9,
  `i_e4_back` (16.0, yaw π), `i_hof` 16.11; specials `i_s_fanclub` 9.6, `i_s_ocean_1f` 9.7, `i_s_ocean_2f` 9.8,
  `i_s_bikeshop` 10.1, `i_s_corner` 10.3, `i_s_devon_1f` 11.0, `i_s_devon_3f` 11.2, `i_s_school` 11.4, `i_s_lily_1f` 13.2,
  `i_s_lily_2f` 13.3, `i_s_corner_mossdeep` 14.11, `i_s_mystery` 15.13, `i_s_mystery_b1f` 15.14, `i_s_flowers` 17.1,
  `i_s_daycare` 22.0, `i_s_seashore` 28.0; Trick House `i_th1` … `i_th8` (29.3–29.10); twins `i_g_mauville_night`,
  `i_e4_drake_night`, `i_s_ocean_night`, `i_th3_night` (hour 21), `i_g_sootopolis_dusk`, `i_e4_champion_dusk` (hour 19),
  `i_g_dewford_night_dark` (3.3, hour 21, `&flash=4`; room band exempt, D10); controls for 4c `i_frontier` 26.5,
  `i_contest` 13.4, `i_mtpyre` 24.15, `i_link` 25.25. Edit entries (`edits` from the decomp, `puzzle` record):
  `i_pz_th3` (29.5: one switch's door set), `i_pz_petalburg` (8.1: one room's doors through their slide frames, the last
  frame shot), `i_pz_sootopolis` (15.0: three cells `…Ice_Cracked`, one `…Ice_Broken`, then the stairs script),
  `i_pz_mauville` (10.0: the alt-barrier script + the pressed switches), `i_pz_mossdeep` (14.0: one switch's arrow set),
  `i_pz_e4` (16.0: the entrance closing as explicit `cells:` `EntryDoor_ClosedTop/Bottom` at the entrance; its script is
  in the shared `data/scripts/elite_four.inc`, absent from the vendor checkout, F15), `i_pz_lily` (13.3: the painting
  script; Retro legacy path, Modern `expect: { claimedNotLive }`, F25). Per edit entry and walk, Task 1 records how many
  of its changes alter collision: those become the `expect` counts of F3. Tier views (D13, F27):
  `i_g_sootopolis_back` (15.0, yaw π) and `i_g_sootopolis_side` (15.0, yaw π/2, `actors=1`, cropped on a trainer on a
  lower tier). Outdoor
  measurements (`o_*`, run with `--static` only, record, never gated): `o_fortree_bridge` (0.4: four
  `METATILE_Fortree_Bridge*_Lowered`), `o_ash` (0.28: four ash cells → grass), `o_pacifidlog` (0.15: a log bridge's
  sunk frame). Live walks (`puzzle` record, crossing-style frame recording): `pz_ice` (`out/pz_sootopolis.state`: three
  steps over thin ice), `pz_switch` (`pz_mauville`: onto the switch), `pz_arrows` (`pz_mossdeep`: onto the arrow switch),
  `pz_e4_door` (`pz_e4`: the door closes behind the player), `pz_th3` (`pz_th3`: onto the switch); map loads
  (`crossings: 1`): `gym_hole` (`pz_lavaridge`: into a geyser hole → B1F). `NIGHT_TWINS` += the seven new pairs
  (`i_g_dewford_night_dark ↔ i_g_dewford_dark`, room band exempt); `dayActorGated` leaves out the `_dark` entries (F44);
  `INTERIOR_LIVE` += the walks (their maps);
  `OUT_OF_SCOPE_INTERIOR` = `i_secret`, `i_dept_roof`, `truck_inside`, `i_frontier`, `i_contest`, `i_mtpyre`, `i_link`
  (`i_gym`, `i_gym_night` leave it: Petalburg comes into scope); `PHASE4_INTERIOR` = the Phase 4 `i_*` entries but `i_gym`,
  `i_gym_night` — `isSameControl` (`--expect-same`) adds them; the interior review's `interiorMap` reads `map=` as today.

- [ ] **Step 1: Fixtures.** Write `decompEdits.ts`, `warp.ts`, `puzzle-states.ts`; `npm run symbols`; run
  `npx tsx tools/puzzle-states.ts` and fix each recipe's cell until its probe says free (record the cells). A target that
  cannot be made free (a trainer sees every cell) is reported, not forced.
- [ ] **Step 2: Counters and `setCells`** (no behaviour change; `npx tsc --noEmit && npm test`).
- [ ] **Step 3: Entries.** Add every entry above, the gates (`PuzzleGate` in 'record' everywhere for now), the edit
  application, `PHASE4_INTERIOR`, the new twins and controls. Tune each live walk so its changes happen after the 30-frame
  settle and the shot is ≥ 30 frames after the last change (record the frames in the entries' comments).
- [ ] **Step 4: Determinism.** `npm run regress:live -- --label p4bdet1 --interiors --static` then `--label p4bdet2
  --interiors --static --compare p4bdet1` → 0.00 % on every entry, both styles.
- [ ] **Step 5: Baseline.** `npm run regress:live -- --label p4b-base --static --gpu` (every entry, both styles). Then
  `--label p4bchk --only <every Phase 4 entry> --compare p4-base` → 0.00 % (nothing changed since Phase 4; else report
  why). Report per new entry and style: calls, triangles, programs, buildMs; for every edit entry and walk: grid changes,
  builds, rebuild ms and first-frame ms per change (today's cost, the "before" of D3), and the count of changes that
  alter collision (F3's future `expect`); the outdoor `o_*` numbers.
- [ ] **Step 6: Commit** — `git add tools/lib/decompEdits.ts tools/lib/warp.ts tools/puzzle-states.ts tools/regress-live.ts
  tools/gen-symbols.ts src/game/symbols.ts src/render/overworld/overworldView.ts src/render/renderer.ts src/render/preview.ts
  tests/decompEdits.test.ts && git commit -m "tools: Phase 4b entries (gyms, League, specials, Trick House, twins, 4c controls), puzzle fixtures and
  edits, grid-change counters"`

**Gates:** no rendering change. **Acceptance:** deterministic; `p4b-base` captured; today's per-change rebuild costs in
the report; every fixture state probed free (or reported).

---

### Task 2 (group A): Per-map scope, the new id kinds, 23 table scaffolds, live-id worklist

**Files:**
- Create: the 23 `src/render/kit/tables/interior/<name>.ts` (empty: `ids` empty, `target: 0`, `pins: []`, `puzzle` empty;
  `maps` and `primary` filled — see D1/D2), `tests/smoke/helpers/liveIds.ts`
- Modify: `src/render/kit/tables/building.ts`, `src/render/kit/interior/scope.ts`, `tools/gen-symbols.ts` (WANTED += the 23
  `gTileset_*`), `src/game/symbols.ts`, `src/render/kit/interior/furniture.ts` (`FURNITURE_SPEC` / `FURNITURE_SPLIT`
  entries for the new kinds only), `src/render/kit/interior/geom/floorPatterns.ts` (`FLOOR_MAT` entries for the new floor
  kinds only), `tests/kitInteriorTables.test.ts`, `tests/smoke/interiorTables.test.ts`, `tests/interiorFurniture.test.ts`
  (the kind lists)

**Interfaces:**
- Produces (`building.ts`; new members appended at the end of each union and key list, F36):
  ```ts
  export type FloorKind = 'boards' | 'tiles' | 'carpet' | 'rug' | 'mat' | 'stone' | 'ice' | 'sand' | 'metal' | 'ledge' | 'tier';
  export type WallPart = 'wall' | 'window' | 'decor' | 'clock' | 'painting' | 'blackboard' | 'mazeWall' | 'ridge'
    | 'tierFace';                                  // a tier's face rows: a riser, never a mass (D13, F17)
  export type FurnitureKind = /* Phase 4's 19, then */ … | 'statue' | 'pillar' | 'brazier' | 'dais' | 'displayCase'
    | 'fishTank' | 'modelShip' | 'plinth' | 'slotMachine' | 'rouletteTable' | 'schoolDesk' | 'flowerBin' | 'bikeRack' | 'machine';
  export type PuzzleKind = 'thinIce' | 'floorSwitch' | 'barrier' | 'arrowTile' | 'warpPad' | 'gymDoor' | 'toggleWall'
    | 'hiddenStairs' | 'geyserHole';
  export const PUZZLE_KINDS: readonly PuzzleKind[];
  export type InteriorId = FloorKind | WallPart | FurnitureKind | PuzzleKind | 'legacy';
  /** A mechanic id's meaning: its kind, its state (0 … puzzleStateCount(kind) − 1) and a kind-specific variant
   *  (barrier: 0 pole, 1 beam H, 2 beam V; toggleWall: 0 red, 1 blue; arrowTile: state = direction 0 N, 1 E, 2 S, 3 W;
   *  gymDoor: state = slide frame, 0 closed … last open; thinIce: 0 intact, 1 cracked, 2 broken; floorSwitch: 0 raised,
   *  1 pressed; hiddenStairs: 0 hidden, 1 stairs; warpPad, geyserHole: state 0 only). `blocked`: the collision the game
   *  sets with this state (the decomp edit's TRUE/FALSE; F38). */
  export interface PuzzleId { kind: PuzzleKind; state: number; variant: number; blocked: boolean }
  export function puzzleStateCount(kind: PuzzleKind): number;   // thinIce 3, floorSwitch 2, barrier 2, arrowTile 4,
    // gymDoor 6 (closed + Petalburg's SlidingDoor_Frame0–4, F33), toggleWall 2, hiddenStairs 2, warpPad 1, geyserHole 1
  /** A mechanic cell found by position (F4): its kind and variant whatever id it shows, and `offId`, the plain
   *  (non-mechanic) id it shows in its off state (Mauville's V beams: METATILE_MauvilleGym_FloorTile), read as `state`. */
  export interface PuzzleCellPin { x: number; y: number; kind: PuzzleKind; variant: number; offId?: number; offState?: number }
  export interface InteriorTable {
    name: string; ids: ReadonlyMap<number, InteriorId>; target: number; pins: readonly TablePin[];
    /** The primary this table's ids < 512 belong to (default gTileset_Building, read from BUILDING_PRIMARY); another
     *  primary's ids the table uses are labelled in `ids` (BikeShop: gTileset_General). */
    primary?: number;
    /** The maps ("group.num") the table is in scope on (absent: every map of its tileset — Phase 4's five). */
    maps?: readonly string[];
    /** Mechanic ids → their meaning; every key is also in `ids`, labelled with its kind. */
    puzzle?: ReadonlyMap<number, PuzzleId>;
    /** Per map ("group.num"): mechanic cells by position whose states include a non-mechanic id, or whose variant
     *  changes (F4). `interiorIds` reads them as their kind whatever id they show. */
    puzzleCells?: Readonly<Record<string, readonly PuzzleCellPin[]>>;
  }
  /** As today, plus `primary` (default gTileset_Building): ids < 512 of another primary read the table's own `ids`. */
  export function interiorId(m: number, beh: number, secondary: number, tables?: ReadonlyMap<number, InteriorTable>,
    primary?: number): InteriorId | null;
  /** The mechanic meaning of metatile m on a map of `secondary` (null: none). */
  export function puzzleId(m: number, secondary: number, tables?: ReadonlyMap<number, InteriorTable>): PuzzleId | null;
  ```
  `interiorIds(a, mapKey?)` passes `a.opts.primaryTileset`, and labels the table's `puzzleCells[mapKey]` with their kind
  whatever id they show (the memo stays per analysis; callers pass `ctx.mapKey`). `INTERIOR_TABLES` gets the 23
  entries.
  Starting `FURNITURE_SPEC` (height, depth) / `FURNITURE_SPLIT`: statue 1.6/0.8 component, pillar 2.6/0.7 cell, brazier
  1.1/0.6 cell, dais 0.3/2.0 component, displayCase 1.1/0.8 rects, fishTank 1.5/0.8 rects, modelShip 1.0/1.2 component,
  plinth 0.9/0.7 cell, slotMachine 1.5/0.7 cell, rouletteTable 0.95/1.6 component, schoolDesk 0.75/0.7 cell, flowerBin
  0.7/0.8 cell, bikeRack 0.9/1.0 rects, machine 1.4/0.8 rects (Tasks 11a/11b report tuning; the controller edits).
  Starting `FLOOR_MAT`: stone/ice/metal/ledge/tier → Tiles, sand → Carpet (Task 12 gives them their own).
- Produces (`scope.ts`):
  ```ts
  export type ShellMode = 'band' | 'perimeter';
  export type RoomTheme = 'sidney' | 'phoebe' | 'glacia' | 'drake' | 'champion' | 'hall' | 'hallOfFame';
  /** `tiers`: the map has real raised platforms whose heights `prepareInterior` keeps (D13). */
  export interface MapProfile { shell: ShellMode; bandMax: number; theme: RoomTheme | null; puzzle: boolean; tiers: boolean }
  export const DEFAULT_PROFILE: MapProfile;  // { shell: 'band', bandMax: 3, theme: null, puzzle: false, tiers: false }
  /** (moved here from a themes.ts, F21: group C's Phase A reads them without waiting for Task 7) */
  export function themeOf(mapKey: string | null): RoomTheme | null;   // = mapProfile(mapKey).theme
  /** The emissive accent of flames, candles and glows (light colours, not surface colours, D9): sidney (1.0, 0.45, 0.25),
   *  phoebe (0.65, 0.45, 1.0), glacia (0.55, 0.85, 1.0), drake (1.0, 0.55, 0.2), champion (1.0, 0.85, 0.5), hall (1.0,
   *  0.8, 0.55), hallOfFame (1.0, 0.95, 0.75) (tuned in the looks). */
  export const THEME_LIGHT: Readonly<Record<RoomTheme, RGB>>;
  export const PHASE4B_MAPS: ReadonlyMap<string, MapProfile>; // the 45 maps of D1 with D8's profiles
  export const PHASE4B_DEFAULT = false;                       // Task 7 sets it true
  /** Test seam: the 4b scope on or off (default PHASE4B_DEFAULT). */
  export function setPhase4bScope(on: boolean): void;
  /** The profile of an in-scope map (DEFAULT_PROFILE for Phase 4's maps and for null). */
  export function mapProfile(mapKey: string | null): MapProfile;
  /** Phase 4's rule, or (4b on) a PHASE4B_MAPS map whose secondary has a table listing it and whose primary is the
   *  table's. Fails closed as today. */
  export function interiorScope(o: Pick<ClassifyOptions, 'indoor' | 'primaryTileset' | 'secondaryTileset'>, mapKey: string | null): boolean;
  ```
- Produces (smoke): `out/interior-ids-4b.txt` (per new tileset, per used id: hex, cells, maps, behaviour, layer type,
  blocked share, label) and `out/live-ids.txt` (per new tileset, every id a script `setmetatile` or a C file writes at
  runtime on its maps — `tests/smoke/helpers/liveIds.ts` over `tools/lib/decompEdits.ts` — with its source and whether it
  is labelled as a mechanic), copied to `out/interior-ids-4b.task2.txt` / `out/live-ids.task2.txt` (the curators' fixed
  worklists). The vendor checkout has no `data/scripts/` (shared scripts), so `live-ids.txt` also lists every
  `metatile_labels.h` id of the 23 tilesets named `*Door*`, `*Open*` or `*Closed*` as "suspected live (shared script)"
  (F15: the E4 `EntryDoor_Closed*`). Each id is listed with whether a script sets it blocked (for `PuzzleId.blocked`).

- [ ] **Step 1: Write the failing tests** (appended to `tests/kitInteriorTables.test.ts`):

```ts
it('lists the new kinds after Phase 4 ones, in union order', () => {
  expect(FURNITURE_KINDS.slice(0, 19)).toEqual(['bed', 'table', 'chair', 'tv', 'pc', 'bookshelf', 'plant', 'fridge', 'sink',
    'cabinet', 'crate', 'trashCan', 'vase', 'counter', 'healer', 'pcCounter', 'martShelf', 'stairsUp', 'stairsDown']);
  expect(FURNITURE_KINDS.slice(19)).toEqual(['statue', 'pillar', 'brazier', 'dais', 'displayCase', 'fishTank', 'modelShip',
    'plinth', 'slotMachine', 'rouletteTable', 'schoolDesk', 'flowerBin', 'bikeRack', 'machine']);
  expect(PUZZLE_KINDS).toEqual(['thinIce', 'floorSwitch', 'barrier', 'arrowTile', 'warpPad', 'gymDoor', 'toggleWall',
    'hiddenStairs', 'geyserHole']);
});
it('reads another primary through the table and mechanic ids state-free', () => {
  const t: InteriorTable = { name: 'fake', target: 0, pins: [], primary: SYM.gTileset_General,
    ids: new Map<number, InteriorId>([[0x0a0, 'boards'], [0x220, 'thinIce'], [0x221, 'thinIce']]),
    puzzle: new Map([[0x220, { kind: 'thinIce', state: 0, variant: 0, blocked: false }], [0x221, { kind: 'thinIce', state: 1, variant: 0, blocked: false }]]) };
  const tables = new Map([[0xdead, t]]);
  expect(interiorId(0x0a0, MB.NORMAL, 0xdead, tables, SYM.gTileset_General)).toBe('boards');
  expect(interiorId(0x0a0, MB.NORMAL, 0xdead, tables)).toBeNull();            // Building primary: not labelled
  expect(interiorId(0x221, MB.NORMAL, 0xdead, tables)).toBe('thinIce');
  expect(puzzleId(0x221, 0xdead, tables)).toEqual({ kind: 'thinIce', state: 1, variant: 0, blocked: false });
});
it('labels every mechanic id with its kind, within its state count', () => {
  for (const t of INTERIOR_TABLES.values()) for (const [m, p] of t.puzzle ?? []) {
    expect(t.ids.get(m)).toBe(p.kind);
    expect(p.state).toBeLessThan(puzzleStateCount(p.kind));
  }
});
it('scopes the 4b maps only when switched on, by profile', () => {
  const sootopolis = { indoor: true, primaryTileset: SYM.gTileset_Building, secondaryTileset: SYM.gTileset_SootopolisGym };
  setPhase4bScope(false); expect(interiorScope(sootopolis, '15.0')).toBe(false);
  setPhase4bScope(true);
  expect(interiorScope(sootopolis, '15.0')).toBe(true);
  expect(interiorScope(sootopolis, '15.2')).toBe(false);                      // not a listed map
  expect(interiorScope({ ...sootopolis, secondaryTileset: SYM.gTileset_CableClub }, '25.25')).toBe(false); // link room
  expect(mapProfile('15.0')).toMatchObject({ shell: 'perimeter', puzzle: true, tiers: true });
  expect(mapProfile('16.3')).toMatchObject({ shell: 'band', theme: 'drake', puzzle: false });
  expect(mapProfile('2.2')).toEqual(DEFAULT_PROFILE);
  expect(PHASE4B_MAPS.size).toBe(45);
  expect(themeOf('16.3')).toBe('drake'); expect(THEME_LIGHT.drake).toEqual([1.0, 0.55, 0.2]);   // F21
  setPhase4bScope(PHASE4B_DEFAULT);
});
it('labels position-listed mechanic cells with their kind whatever id they show (F4)', () => {
  // a fake table with a puzzleCells pin whose off state shows a plain floor id
  const { a } = fakeInterior(['     ', ' WWW ', ' ... ', '     ']);
  const t: InteriorTable = { name: 'fake', target: 0, pins: [], ids: new Map(), puzzle: new Map(),
    puzzleCells: { '9.9': [{ x: 2, y: 2, kind: 'barrier', variant: 2, offId: 0x205, offState: 0 }] } };
  expect(interiorIdsWith(a, new Map([[a.opts.secondaryTileset ?? 0, t]]), '9.9')[a.idx(2, 2)]).toBe('barrier');
});
```

  (`interiorIdsWith(a, tables, mapKey)` = the un-memoised core of `interiorIds`, exported for this test.)

  and in `tests/smoke/interiorTables.test.ts`: with the 4b scope off the in-scope maps number exactly **137** (as today);
  with it on, **182**, the 45 of D1 among them and none of 25.24–25.27, 25.60, 26.*, 13.4; the target / pin / behaviour
  checks run per table on its own maps; it writes both worklists. `tests/interiorFurniture.test.ts`'s `isLow` list gains
  the new low kinds (pillar, statue, fishTank, slotMachine, machine stay tall).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; `npm run symbols`.
- [ ] **Step 4: Run** the tests → PASS (after the group-A join: `golden`, `semantics`, `interiorRooms` unchanged). Report
  the used-id and live-id counts per tileset.
- [ ] **Step 5: Commit** — `git commit -m "feat(kit): per-map interior scope (Phase 4b, off), puzzle/League/special id
  kinds, 23 table scaffolds, live-id worklist" -- <the files above>` (pathspec)

**Gates (after the join):** `--static --compare p4b-base` 0.00 % everywhere (scope off). **Acceptance:** 137 / 182; both
worklists exist.

---

### Task 3 (group A): Incremental world update — live cells and legacy patches

**Files:**
- Create: `src/render/overworld/gridDiff.ts`, `tests/gridDiff.test.ts`, `tests/smoke/helpers/worldDigest.ts`,
  `tests/smoke/worldPatch.test.ts`
- Modify: `src/render/kit/semantics.ts`, `src/render/overworld/world.ts` (`patch`, `prepareInterior`),
  `src/render/kit/materials.ts` (`kitMaterialSlots` only, F8), `src/render/overworld/overworldView.ts`,
  `src/render/renderer.ts`, `src/render/preview.ts`, `tools/regress-live.ts` (gate switches and `expect` counts only)

**Interfaces:**
- Produces (`semantics.ts`):
  ```ts
  /** Cells a family drew whose metatile the game may change at run time, and how it follows such a change in place. */
  export interface LiveCells {
    readonly name: string;                     // the family's
    readonly cells: ReadonlySet<number>;       // analysis cells
    /** Cell i may become grid value `raw` (metatile bits 0–9, collision 10–11, elevation 12–15) without a rebuild. */
    accepts(i: number, raw: number): boolean;
    /** Applies it: state data only (a texel, an attribute value); never a new geometry, material or texture object. */
    apply(i: number, raw: number): void;
  }
  // Family<P> += live?(p: P, built: THREE.Object3D | null, ctx: SemanticContext): LiveCells | null;
  // runKit(...) returns { group, claims, report, live: LiveCells[] } — the live cells of every family whose extract and
  // build succeeded
  ```
- Produces (`gridDiff.ts`): `changedCells(prev: Uint16Array, next: Uint16Array): number[]` (grid indices whose u16
  differs, ascending; lengths must match, else throws).
- Produces (`world.ts`):
  ```ts
  export const PATCH_MAX_CELLS = 256;
  /** Retro patches its legacy cells too (user answer 1: true; `'retro'` is the unused switch's refusal, F29). */
  export const PATCH_RETRO = true;
  export type PatchRefusal = 'noWorld' | 'tooMany' | 'outdoorKit' | 'retro' | 'claimedNotLive' | 'notInert' | 'structure'
    | 'quads' | 'error';
  export type PatchResult = { ok: true; ms: number; live: number; legacy: number } | { ok: false; reason: PatchRefusal };
  // World += patch(grid: GridData, changed: readonly number[], ctx: WorldBuildContext): PatchResult;
  //          patches: number; lastPatchMs: number; lastPatch: PatchResult | null;
  /** The interior kit's preparation of an analysis, the one function used by buildMeshes, the patch re-analysis and the
   *  smoke helpers (F2). Today: flattenFloors(a). Task 7 adds the tiers of `profile.tiers` maps (D13). */
  export function prepareInterior(a: MapAnalysis, profile?: MapProfile): void;
  ```
  The build keeps what a patch needs: the analysis, claims, the legacy quad list with each quad's batch and first vertex,
  the tree cards' instance slots, the families' `LiveCells`, whether the kit ran and which, and a copy of the build-time
  grid (F31). `patch` follows D3. It maps `changed` (grid indices) to analysis cells. It refuses `'outdoorKit'` when
  outdoor families ran, `'retro'` in Retro without `PATCH_RETRO`, and `'tooMany'` over the cap. Each claimed cell must
  be accepted by a `LiveCells` (`'claimedNotLive'`). The unclaimed ones go through the re-analysis check (`'notInert'`
  by F13's rule, `'structure'` including `dominantFloor` and the Dry need, `'quads'` including the tree cards, F30).
  That check analyses the **build-time grid with only the non-live changes applied** (F31). Then it applies all: live
  `apply`, then the UV rewrite of quads and tree cards with the atlas' `uv()` exactly as `buildMeshes` writes them,
  `addUpdateRange`; the analysis and quad list are swapped for the new ones. It never calls `analyzeMetatiles` and never
  throws: an exception is the refusal `'error'`, warned once per map. `buildMeshes` calls `prepareInterior(a,
  mapProfile(ctx.mapKey))` where it called `flattenFloors(a)`, so Phase 4 is unchanged.
- Produces (`materials.ts`): `kitMaterialSlots(m: THREE.Material): Readonly<Record<string, { value: unknown }>> | null`:
  read-only access to a pooled kit material's uniform slots (for `worldDigest`; F8).
- Produces (`overworldView.ts`): `updateGrid(grid: GridData, build: () => void): 'patch' | 'build'` — the sync's
  same-map-key, same-tilesets grid change and the preview's `setCells` both call it: `changedCells` against a **copy** of
  the last grid (F42), `world.patch`, else `build()`; counters `gridChanges`, `patches`, `lastPatchMs`, `patchRefusals: Record<PatchRefusal,
  number>`. A map or tileset change still builds directly (as today). `wouldRebuild` is unchanged (the SyncGate defers map
  loads only).
- Produces (stats): `Renderer.stats()` / `PreviewApp.stats()` += `patches`, `lastPatchMs` (and `gridChanges`, Task 1).
- Produces (`tests/smoke/helpers/worldDigest.ts`): `worldDigest(w: World): string` — FNV-1a over every mesh under
  `w.group` in traversal order: its name, visibility, transform, material program key (`customProgramCacheKey`), the
  material's colour (the base plane's comes from `dominantFloor`), its kit uniform values (`kitMaterialSlots`: numbers,
  vectors, colours; textures by their data), every geometry attribute's bytes (index included), instance attributes,
  and the data of every texture in `mesh.userData.stateTexture` (F8: the puzzle state lives there, because kit uniforms
  sit in the pool's private slots).

- [ ] **Step 1: Write the failing tests.** `tests/gridDiff.test.ts`:

```ts
it('lists the changed grid cells in order', () => {
  expect(changedCells(Uint16Array.of(1, 2, 3, 4), Uint16Array.of(1, 9, 3, 0x0c04))).toEqual([1, 3]);
  expect(changedCells(Uint16Array.of(5), Uint16Array.of(5))).toEqual([]);
  expect(() => changedCells(Uint16Array.of(1), Uint16Array.of(1, 2))).toThrow();
});
```

  `tests/smoke/worldPatch.test.ts` (builds as `tests/smoke/interiorWorld.test.ts` does; `edited(s, edits)` = a copy of the
  map's grid with `editRaw` applied; `fresh()` = a new `World` on the same atlas and materials):

```ts
const patchVsBuild = (g: number, n: number, style: WorldStyle, edits: DecompEdit[]) => {
  const s = loadStaticMap(g, n), ctx = { style, events: gridEvents(s.map.events, 0), quality: 'medium' as const, mapKey: `${g}.${n}` };
  world.build(s.grid, s.opts, ctx);
  const next = edited(s, edits);
  const r = world.patch(next, changedCells(s.grid.cells, next.cells), ctx);
  const other = fresh(); other.build(next, s.opts, ctx);
  return { r, same: worldDigest(world) === worldDigest(other) };
};
it('patches legacy cells in place and draws exactly what a rebuild draws', () => {
  // Sootopolis Gym 1F (out of scope until Task 7: legacy in both styles): three cracked, one broken ice cell
  const ice = [...crack(15, 0, 3), ...broken(15, 0, 1)];                  // from METATILE_SootopolisGym_Ice_* (field_tasks.c)
  for (const style of ['modern', 'retro'] as const) {
    const { r, same } = patchVsBuild(15, 0, style, ice);
    expect(r).toMatchObject({ ok: true, live: 0, legacy: 4 }); expect(same).toBe(true);
  }
});
it('patches every script edit of the gyms and the Trick House that keeps its shape, and refuses the rest', () => {
  for (const [g, n, name] of PUZZLE_MAPS) for (const e of scriptEdits(name)) {
    const { r, same } = patchVsBuild(g, n, 'retro', [e]);
    if (r.ok) expect(same, `${name} ${e.label}`).toBe(true);
    else expect(['structure', 'quads']).toContain(r.reason);             // reported per map by the test
  }
});
it('refuses on an outdoor Modern map and over the cap', () => {
  expect(patchVsBuild(0, 4, 'modern', fortreeBridge(4)).r).toEqual({ ok: false, reason: 'outdoorKit' });
  for (const [g, n, edits] of [[0, 4, fortreeBridge(4)], [0, 28, ash(4)], [0, 15, logSunk()]] as const) {
    const { r, same } = patchVsBuild(g, n, 'retro', edits);                // Retro: legacy only (user answer 1)
    if (r.ok) expect(same, `${g}.${n}`).toBe(true);                       // F29: digests, not just ok
    else expect(['structure', 'quads']).toContain(r.reason);              // reported (o_* are record-only)
  }
  expect(patchVsBuild(29, 5, 'retro', manyEdits(29, 5, 300)).r).toEqual({ ok: false, reason: 'tooMany' });
});
it('refuses a collision change in Retro (F3)', () => {
  const e = scriptEdits('MauvilleCity_Gym').find((x) => x.blocked !== blockedAt(10, 0, x))!;
  expect(patchVsBuild(10, 0, 'retro', [e]).r).toEqual({ ok: false, reason: 'structure' });
});
it('refuses a claimed cell no family follows', () => {
  // an in-scope Phase 4 room: a furniture cell changed (no LiveCells there)
  expect(patchVsBuild(1, 0, 'modern', [{ ...cellOf(1, 0, 'table'), metatile: 0x201, blocked: true, label: 't' }]).r)
    .toEqual({ ok: false, reason: 'claimedNotLive' });
});
```

  (Helpers `crack`, `broken`, `fortreeBridge`, `ash`, `logSunk`, `manyEdits`, `cellOf`, `blockedAt`, `PUZZLE_MAPS` are
  declared in the file from `tools/lib/decompEdits.ts` and the maps' grids.) Plus live-cell cases with a fake family:
  - a `Family` whose `live` accepts one cell and writes the state into a `DataTexture` on its mesh's
    `userData.stateTexture` (counting `apply` calls). `world.patch` on that cell → `{ ok: true, live: 1 }`, one apply,
    builds unchanged, and the digest equals a rebuild's (whose build writes the same state).
  - **negative (F8):** the same family with a no-op `apply` → `ok: true`, but `worldDigest(world) !==
    worldDigest(rebuilt)`.
  - the same family made to fail in `build`: its claims roll back and its live cells are dropped, so the cell patches
    as legacy (`{ ok: true, live: 0, legacy: 1 }`; the cell's id is unchanged, so it is inert by F13).
  - **stale analysis (F31):** a live change then a legacy change in another cell → both patch (no `'structure'`).
  The legacy cases need the gyms out of scope — true by default until Task 7, which wraps them in
  `setPhase4bScope(false)`; Task 14 checks every edit with the full kit.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (semantics, world, view, renderer, preview `setCells` → `updateGrid`).
- [ ] **Step 4: Run** → PASS; `npx tsc --noEmit && npm test`; after the group-A join, `catalogue`, `golden`, `semantics`,
  `interiorWorld` unchanged.
- [ ] **Step 5: Gate (after the join).** Switch every puzzle walk and edit entry to `retro: 'gate'`, `modern: 'gate'`
  (path `legacy`: the gyms are out of scope, legacy in both styles), with `expect` in both styles = Task 1's
  collision-change counts as `'structure'` (F3). `npm run regress:live -- --label t3 --static --compare p4b-base` → 0.00 %
  in both styles on every entry. Every walk and edit entry: refusals exactly `expect`, each refused change rebuilt within
  the crossing frame budget, patches + refusals == gridChanges, patch ≤ 12 ms, no compile. The visual-only entries
  (`i_pz_sootopolis`, `i_pz_petalburg`, `i_pz_lily`, `pz_ice`) have 0 builds. `gym_hole` passes its crossing gate. Report per entry: patch ms (max / median), refusals, and the frame
  costs against Task 1's rebuild numbers; the `o_*` entries: Retro patched (ms), Modern `'outdoorKit'` (today's rebuild ms
  kept as the follow-up's evidence).
- [ ] **Step 6: Commit** — `git commit -m "feat(world): incremental world update — live cells and legacy UV patches
  instead of a rebuild per cell change" -- <the files above>` (pathspec)

**Gates:** as Step 5. **Acceptance:** patched = rebuilt digests (and a no-op patch fails them); walks gated, with builds
only for the expected collision refusals.

---

### Task 4 (group B, five parallel agents): Curate the 23 tables

- **4a** gyms I: `petalburgGym.ts`, `rustboroGym.ts`, `dewfordGym.ts`, `mauvilleGym.ts`. **4b** gyms II: `lavaridgeGym.ts`,
  `fortreeGym.ts`, `mossdeepGym.ts`, `sootopolisGym.ts`. **4c** League + Trick House: `eliteFour.ts`, `cableClub.ts`,
  `trickHousePuzzle.ts`. **4d** specials A: `oceanicMuseum.ts`, `lilycoveMuseum.ts`, `facility.ts`,
  `mauvilleGameCorner.ts`, `mossdeepGameCorner.ts`, `bikeShop.ts`. **4e** specials B: `pokemonFanClub.ts`,
  `pokemonSchool.ts`, `pokemonDayCare.ts`, `seashoreHouse.ts`, `prettyPetalFlowerShop.ts`, `mysteryEventsHouse.ts`.
  Each agent owns only its files.

**Interfaces:** Consumes `InteriorTable` (with `puzzle`, `primary`, `maps`), `InteriorId`, `PuzzleId`, `puzzleStateCount`
(Task 2). Produces filled tables: `target: 0.97`, ≥ 6 pins per tileset, at least one pin per kind the tileset draws and one
per mechanic state (e.g. Sootopolis: intact, cracked, broken ice; hidden stairs both states).

- [ ] **Step 1: Sheets and maps.** `npx tsx tools/map-atlas.ts --no-maps --sheet-only <Name> --sheet-scale 5
  --sheet-chunk 32`, the renders in `out/atlas/`, the worklists `out/interior-ids-4b.task2.txt` and
  `out/live-ids.task2.txt`, and the decomp (`data/maps/<Map>/scripts.inc`, `include/constants/metatile_labels.h`, the C
  files the live list names).
- [ ] **Step 2: Label** by Phase 4's rules (every used id; a multi-cell object labels all its cells; walkable cells carry
  an object kind only where the object stands; doubtful → `legacy`; TV/PC/bookshelf/shop-shelf behaviours exactly their
  kind or unlabelled) plus: **every live id** of the worklist is a mechanic (`puzzle` entry + its kind in `ids`) or inert
  (`legacy`/unlabelled with no interaction behaviour). Every state of one mechanic on a cell shares the kind; a cell whose
  states include a **non-mechanic id** (Mauville's V beams switch off into `METATILE_MauvilleGym_FloorTile`) or that
  **changes variant** (Mauville's pole/beam cells) goes into the table's `puzzleCells[map]` by position, with its
  `offId` / `offState` (F4: 4a reads every Mauville script's cells). Each `PuzzleId.blocked` is the TRUE/FALSE the decomp
  sets it with (F38). Blocked cells drawn as floor art are labelled their floor kind (invisible walls stay invisible,
  D5). Maze and rock masses `mazeWall` / `ridge`; **tier tops `tier`, tier face rows `tierFace`, the passages between
  tiers `hiddenStairs`** (D13, F17: a face is never `mazeWall` / `ridge`); ledges `ledge`; framed pictures `painting`,
  chalkboards `blackboard`. 4a: Petalburg's `SlidingDoor_Frame0–4` are `gymDoor` states 1–5 after the closed door 0
  (F33). 4c: the E4 entrance/exit door metatiles are `gymDoor` frames, read from the worklist's "suspected live" ids
  (their script is in the absent `data/scripts/elite_four.inc`, F15); if their open state shows a plain id, they go into
  `puzzleCells`. The HoF floor `ice` is cosmetic (floor kind, no mechanic). 4d: `bikeShop.ts` sets `primary:
  SYM.gTileset_General` and labels the General ids its map uses.
- [ ] **Step 3: Pins** read off the map renders, at least one per mechanic state (from the decomp's coordinates).
- [ ] **Step 4: Run** `npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/interiorTables.test.ts` →
  PASS for the agent's tilesets.
- [ ] **Step 5: Commit** — `git commit -m "data(kit): <tilesets> interior tables" -- src/render/kit/tables/interior/<own files>`

**Acceptance:** ≥ 97 % labelled per tileset; every live id a mechanic or inert; the report lists `legacy` ids and why.

---

### Task 5 (group B): Room layout v2 — profiles, perimeter shells, masses, doors in any wall (pure)

**Files:**
- Modify (own): `src/render/kit/interior/room.ts`, `src/render/kit/interior/cutaway.ts` (`POCKET_MAX` →
  `L.profile.bandMax`, F32), `src/render/overworld/analyze.ts` (the `indoorStairs?` option only, default off),
  `tests/interiorRoom.test.ts`, `tests/helpers/fakeInterior.ts` (legend and `heights` only),
  `tests/smoke/interiorRooms.test.ts` (not its 137 count line: Task 7, F7)

**Interfaces:**
- Consumes: `MapProfile`, `DEFAULT_PROFILE` (Task 2), the new ids and `PUZZLE_KINDS` (Task 2).
- Produces:
  ```ts
  export type MassKind = 'maze' | 'ridge' | 'perimeter';
  /** A solid block of blocked room cells the shell builds as a low solid (Task 10): `backed` = it touches the void on its
   *  north side (a perimeter wall's art, may stand to WALL_H); otherwise room lies north of it (≤ MASS_H_MAX, D6). */
  export interface Mass { id: number; kind: MassKind; cells: number[]; backed: boolean }
  /** A tier's face (D13, F17): `tierFace` cells between two tiers, an un-projected vertical face from y0 (lower tier)
   *  to y1 (upper tier) on `line` (grid units, as runs), facing `dir`. Built by Task 12. */
  export interface Riser { dir: WallDir; line: number; from: number; to: number; y0: number; y1: number }
  // RoomLayout += masses: Mass[]; mass: Int32Array (per cell: its mass id, −1); runs carry `mass: true` around masses
  //   (as `partition: true` today); risers: Riser[]; profile: MapProfile
  // DoorGap += kind: 'exit' | 'gymDoor' | 'passage' (F5)
  // WallFeature['kind'] += 'painting' | 'blackboard' (F11)
  export function roomLayout(a: MapAnalysis, ids: readonly (InteriorId | null)[], warps: readonly GridWarp[],
    profile?: MapProfile): RoomLayout;                      // memoised per analysis and profile; default DEFAULT_PROFILE
  export function checkRoomLayout(a: MapAnalysis, L: RoomLayout, warps?: readonly GridWarp[]): string[];
    // += a mass run crossing a walkable cell, a mass cell inside, a door gap not on a run of its own line; the band
    //    depth against L.profile.bandMax (F32)
  /** D6's art rows (F10): how tall the GBA art over `cells` stands, in world units from the cells' own floor — their
   *  rows plus the same-label art rows north of them, un-projected. The one helper of Tasks 9, 10, 11a and 14. */
  export function artRows(a: MapAnalysis, ids: readonly (InteriorId | null)[], cells: readonly number[]): number;
  ```
  Rules: **mechanic cells** (an id in `PUZZLE_KINDS`) are inside and walkable for the layout whatever their collision
  (D4). They do not vote room heights (F18) and do not count for `floorTile`. `floorTile` counts every `FLOOR_KINDS` id,
  not only boards/tiles/carpet (F16). **Band** profile: Phase 4's rules with `profile.bandMax` for `BAND_MAX`
  (`cutaway.pocketDir`'s `POCKET_MAX` too, F32); `mazeWall` / `ridge` cells in the room → masses of that kind.
  **Perimeter** profile: every in-map non-void cell is room material; N/E/S/W runs stand on its boundary with the void
  (no recess: N line = the top row y). Blocked cells with a wall-part id (`wall`, `window`, `clock`, `decor`,
  `painting`, `blackboard`, `mazeWall`) or `ridge`, 4-connected, are masses: `perimeter` when backed, else `maze` /
  `ridge` by label. No band and no features: their art becomes the masses' decals in Task 10. **Features** (both
  profiles): `featureKind` and `isArt` handle every `WALL_PARTS` member: `painting` and `blackboard` become features
  (F11); `mazeWall`, `ridge` and `tierFace` never do. **Tiers** (`profile.tiers`, D13): `tierFace` cells are neither
  inside nor masses. Each run of them between two inside tiers becomes a `Riser`, with y0/y1 from `a.height` on its two
  sides (filled by `prepareInterior`). Each wall edge's `floorY` is its own inside cell's height, not the room's mode
  (`mergeSpans` already splits on `floorY`; F18). **Doors** (both profiles): arrow mats as today (`kind: 'exit'`). A
  warp on a cell with a door behaviour (`DOOR_BEHAVIORS`, `NON_ANIMATED_DOOR`) cuts a gap with `kind: 'exit'`, or
  `'gymDoor'` when the cell's id is `gymDoor`. A NORMAL-behaviour warp on a room's boundary cell with void beyond cuts a
  `'passage'` gap. Each gap is in the run on that side (`dir` = the side the void lies on; adjacent cells of one kind
  merge). Phase 4 maps (DEFAULT_PROFILE, no new ids) give byte-identical layouts (the 15 pinned digests; `kind: 'exit'`
  is not part of `roomDigest`).
- Produces (`fakeInterior.ts` legend additions; Task 5 owns every new letter, F14): `Z` mazeWall (blocked), `R` ridge
  (blocked), `i` thinIce (walkable), `b` barrier (blocked), `G` gymDoor (beh `PETALBURG_GYM_DOOR`, walkable), `N` NORMAL
  warp floor (walkable), `P` painting (wall art), `K` blackboard (wall art), `X` tierFace (blocked), `U` tier (walkable),
  `H` hiddenStairs (walkable). Plus an optional `heights?: Record<string, number>` argument (per legend letter:
  the cell's `a.height`), for tier cases without `prepareInterior`. (Broken thin ice is set walkable by
  `field_tasks.c`, so there is no blocked thin-ice letter.)
- Produces (smoke, measurement for D13/F1): `out/tiers-4b.txt`, per 4b map. It lists the distinct elevations of the
  walkable cells, and the solver's heights with the indoor `flanked`-stairs rule switched on: the option
  `ClassifyOptions.indoorStairs?` in `analyze.ts`, off by default, so Retro and the app are unchanged. Task 7's
  `prepareInterior` reuses the same switch. Maps whose heights differ are proposed for
  `tiers: true` (controller ruling).

- [ ] **Step 1: Write the failing tests** (appended to `tests/interiorRoom.test.ts`):

```ts
const GYM: MapProfile = { shell: 'perimeter', bandMax: 3, theme: null, puzzle: true, tiers: false };
it('closes a perimeter room on the void edge, with masses instead of a band', () => {
  const { a, ids } = fakeInterior(['          ', ' WWWWWWWW ', ' WWWWWWWW ', ' ....ZZ.. ', ' ....ZZ.. ', ' ..ii.... ', ' ........ ', '          ']);
  const L = roomLayout(a, ids, [], GYM);
  expect(L.runs.filter((r) => r.dir === 'N' && !r.mass)).toEqual([{ dir: 'N', line: 1, from: 1, to: 9, floorY: 0 }]);
  expect(L.masses.map((m) => [m.kind, m.backed, m.cells.length])).toEqual([['perimeter', true, 16], ['maze', false, 4]]);
  expect(L.features).toEqual([]);
  expect(L.inside[a.idx(3, 5)]).toBe(1);                               // thin ice: room floor
  expect(checkRoomLayout(a, L)).toEqual([]);
});
it('reads a mechanic cell as floor whatever its collision', () => {
  const rows = (c: string) => ['        ', ' WWWWWW ', ` ..${c}... `, ' ...... ', '        '];
  const lb = roomLayout(...asArgs(fakeInterior(rows('b'))), GYM), li = roomLayout(...asArgs(fakeInterior(rows('i'))), GYM);
  expect(lb.runs).toEqual(li.runs); expect([...lb.inside]).toEqual([...li.inside]);
});
it('cuts gaps for gym doors and NORMAL warps between stacked rooms', () => {
  const { a, ids } = fakeInterior(['        ', ' WWWWWW ', ' ...... ', ' ..G... ', '        ', ' WWWWWW ', ' ...... ', ' ..N... ', '        ']);
  const L = roomLayout(a, ids, [{ x: 3, y: 3, dest: 'PETALBURG_GYM' }, { x: 3, y: 7, dest: 'PETALBURG_GYM' }]);
  expect(L.rooms).toBe(2);
  expect(L.doors).toEqual([{ dir: 'S', line: 4, from: 3, to: 4, kind: 'gymDoor' }, { dir: 'S', line: 8, from: 3, to: 4, kind: 'passage' }]);
  expect(checkRoomLayout(a, L)).toEqual([]);
});
it('takes a deeper band where the profile allows it, and checks it against that profile', () => {
  const deep = ['       ', ' WWWWW ', ' WWWWW ', ' WWWWW ', ' WWWWW ', ' ..... ', '       '];
  const f = fakeInterior(deep), L = roomLayout(...asArgs(f), { ...DEFAULT_PROFILE, bandMax: 4 });
  expect(L.runs.find((r) => r.dir === 'N')!.line).toBe(5 - RECESS);
  expect(checkRoomLayout(f.a, L)).toEqual([]);                          // F32: no "deeper than 3"
});
it('makes paintings and blackboards features, mechanics no floor tile (F11, F16)', () => {
  const { a, ids } = fakeInterior(['        ', ' WPPWKW ', ' WPPWKW ', ' ...... ', ' iiiii. ', '        ']);
  const L = roomLayout(a, ids, []);
  expect(L.features.map((f) => f.kind).sort()).toEqual(['blackboard', 'painting']);
  expect(L.floorTile).toBe(INTERIOR_LEGEND['.'].mt);                    // not the (more common) thin ice
});
it('turns tier faces into risers between tier heights, never masses (D13)', () => {
  const TIERS: MapProfile = { ...GYM, tiers: true };
  const { a, ids } = fakeInterior(['         ', ' WWWWWWW ', ' UUUUUUU ', ' XXXHXXX ', ' XXXHXXX ', ' ....... ', '         '],
    undefined, { U: 2, H: 1, '.': 0 });
  const L = roomLayout(a, ids, [], TIERS);
  expect(L.masses).toEqual([]);
  expect(L.risers.map((r) => [r.dir, r.y0, r.y1])).toContainEqual(['S', 0, 2]);
  expect(L.inside[a.idx(4, 3)]).toBe(1);                               // the stair passage is room
  expect(new Set(L.runs.filter((r) => r.dir === 'E').map((r) => r.floorY))).toEqual(new Set([0, 1, 2]));  // per-cell floorY (F18)
  expect(checkRoomLayout(a, L)).toEqual([]);
});
it('measures art rows from the cells\' own floor (F10)', () => {
  const { a, ids } = fakeInterior(['      ', ' WWWW ', ' .BB. ', ' .BB. ', ' .... ', '      ']);
  expect(artRows(a, ids, [a.idx(2, 3)])).toBe(2);                       // its cell + the same-label row north
});
```

  (`asArgs({ a, ids }) = [a, ids, []] as const`.) `tests/smoke/interiorRooms.test.ts`: the 15 pinned Phase 4 digests
  unchanged; for the 45 maps (`setPhase4bScope(true)`, each with `mapProfile`) the findings are written to
  `out/rooms-4b.txt` (pinned to zero in Task 14, not here: the tables may still be filling).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS (`npx vitest run tests/interiorRoom.test.ts`;
  the smoke after the group-B join). Report the findings per map and whether a map's D8 profile looks wrong (evidence:
  band fit, findings), plus `out/tiers-4b.txt`'s proposed `tiers` maps — the controller edits `scope.ts`.
- [ ] **Step 5: Commit** — `git commit -m "feat(kit): room layout v2 — perimeter shells, masses, doors in any wall,
  mechanic cells as floor" -- <the files above>` (pathspec)

**Acceptance:** tests pass; Phase 4 digests unchanged; findings reported.

---

### Task 6 (group B): Puzzle state core — cells, state texture, live cells, looks (pure + material plumbing)

**Files:**
- Create: `src/render/kit/interior/puzzle/state.ts`, `tests/kitPuzzleState.test.ts`, `tests/helpers/puzzle.ts`

**Interfaces:**
- Consumes: `PuzzleKind`, `PuzzleId`, `puzzleId`, `puzzleStateCount`, `interiorIds` (Task 2); `LiveCells` (Task 3).
- Produces:
  ```ts
  export interface PuzzleCell { i: number; x: number; y: number; kind: PuzzleKind; variant: number; state: number }
  /** Every analysis cell whose metatile is a mechanic id of the map's secondary (through puzzleId, or the seed), and
   *  every cell the table's `puzzleCells[mapKey]` lists by position, whatever id it shows (its `offId` read as
   *  `offState`; F4). */
  export function puzzleCells(a: MapAnalysis, mapKey?: string | null): PuzzleCell[];
  /** Test seam (as seedInteriorIds): makes puzzleCells read these ids (one per analysis cell, null = none). */
  export function seedPuzzleIds(a: MapAnalysis, ids: readonly (PuzzleId | null)[]): void;
  /** One RGBA8 texel per analysis cell (r state, g variant, b kind index + 1, 0 none), NearestFilter, no mipmaps:
   *  GW×GH×4 bytes (Petalburg 20.7 KB, F43). */
  export class PuzzleStateTexture {
    readonly texture: THREE.DataTexture;
    constructor(a: MapAnalysis, cells: readonly PuzzleCell[]);
    state(i: number): number;
    variant(i: number): number;
    /** Writes the texel (state, and the variant when given: Mauville's pole/beam cells, F4) and flags the texture once
     *  (needsUpdate); no allocation. */
    set(i: number, state: number, variant?: number): void;
    /** Sets `userData.stateTexture = this.texture` on every mesh under `root` that samples it (F8: kit uniforms sit in
     *  the pool's private slots, so this is where worldDigest finds the state). */
    attach(root: THREE.Object3D): void;
  }
  /** GLSL (vertex and fragment): uniforms uPuzzleState (sampler2D), uPuzzleGrid (vec4: minX, minY, GW, GH);
   *  `vec4 puzzleTexel(vec2 gridXY)`, `float puzzleStateAt(vec2 gridXY)` (texelFetch, no filtering). */
  export const PUZZLE_STATE_GLSL: string;
  export function puzzleUniforms(tex: PuzzleStateTexture, a: MapAnalysis): Record<string, { value: unknown }>;
  /** accepts: raw's metatile is a mechanic id of the same **kind** as the cell's, any variant, or the cell's listed
   *  `offId` (collision and elevation any; F4). apply: tex.set(i, its state, its variant). */
  export function puzzleLiveCells(name: string, a: MapAnalysis, cells: readonly PuzzleCell[], tex: PuzzleStateTexture): LiveCells;
  /** The look of each state, shared by the shaders (as GLSL constants via puzzleLookGlsl) and the tests. */
  export interface PuzzleStateLook { tint: RGB; glow: number; raise: number; steps: number; crack: number; open: number }
  export const PUZZLE_LOOK: Readonly<Record<PuzzleKind, readonly PuzzleStateLook[]>>;   // one entry per state
  export function puzzleLookGlsl(): string;   // `PuzzleStateLook puzzleLook(int kind, int state)` from PUZZLE_LOOK
  ```
  `PUZZLE_LOOK` starting values (tuned in Tasks 8/9's looks). Every look has a `tint` (default the kind's base tint,
  F33). thinIce: intact {tint (0.80, 0.92, 1.0), crack 0}, cracked {crack 1}, broken {open 1}. floorSwitch: raised
  {glow 0, raise 0.08}, pressed {glow 1, raise 0}. barrier: off {glow 0}, on {glow 1}. arrowTile: 4 × {glow 0.6}, the
  direction from the state. gymDoor: 6 states (closed + Petalburg's 5 slide frames) {open 0, 0.2, 0.4, 0.6, 0.8, 1}.
  toggleWall: down {raise 0}, up {raise 1}. hiddenStairs: hidden {steps 0}, stairs {steps 1}; the look field `raise` is
  renamed `steps` for this kind, because both states lie on the ramp between the tiers (D13, F9). warpPad {glow 0.8};
  geyserHole {glow 0.3}.
- Produces (`tests/helpers/puzzle.ts`): `fakePuzzle(rows, legend?, heights?)` → `fakeInterior` with the mechanic cells
  as `FakeCell`s (metatile, collision, the kind as id: both `seedInteriorIds` and `seedPuzzleIds` get them; F14), using
  **digits** so no letter of `fakeInterior` (Task 5 owns those) is shadowed: `0` thinIce intact, `1` thinIce cracked, `2`
  thinIce broken (walkable, as `field_tasks.c` sets it), `3` floorSwitch raised, `4` floorSwitch pressed, `5` barrier pole
  (blocked), `6` barrier beam H on (blocked), `7` barrier beam H off (walkable), `8` toggleWall red down (walkable), `9`
  toggleWall red up (blocked). Further mechanics (gymDoor, hiddenStairs, a position-listed cell) come through `legend`.

- [ ] **Step 1: Write the failing tests** `tests/kitPuzzleState.test.ts`:

```ts
it('finds the mechanic cells and writes their states into the texture', () => {
  const { a } = fakePuzzle(['       ', ' WWWWW ', ' .013. ', ' ..5.. ', '       ']);
  const cells = puzzleCells(a), tex = new PuzzleStateTexture(a, cells);
  expect(cells.map((c) => [c.kind, c.state])).toEqual([['thinIce', 0], ['thinIce', 1], ['floorSwitch', 0], ['barrier', 0]]);
  const c = cells[2]; tex.set(c.i, 1);
  expect(tex.state(c.i)).toBe(1); expect(tex.texture.needsUpdate).toBe(true);   // (version bumped)
  const root = new THREE.Group(); root.add(new THREE.Mesh()); tex.attach(root);
  expect((root.children[0] as THREE.Mesh).userData.stateTexture).toBe(tex.texture);   // F8
});
it('accepts a change to another state of the same mechanic only', () => {
  const { a } = fakePuzzle(['     ', ' WWW ', ' 0.3 ', '     ']), cells = puzzleCells(a);
  const live = puzzleLiveCells('puzzle', a, cells, new PuzzleStateTexture(a, cells));
  const ice = cells[0];
  expect(live.accepts(ice.i, rawOf('thinIce', 2))).toBe(true);          // broken, collision any
  expect(live.accepts(ice.i, rawOf('floorSwitch', 1))).toBe(false);
  expect(live.accepts(ice.i, 0x201)).toBe(false);                       // not a mechanic id
});
it('follows a position-listed cell through a plain off id and a variant change (F4)', () => {
  // Mauville: a V-beam cell whose off state is the plain floor id; a pole cell that becomes a beam
  const { a } = fakePuzzle(['     ', ' WWW ', ' .V. ', '     '], { V: { mt: 0x2a0, blocked: true, id: 'barrier',
    puzzle: { kind: 'barrier', state: 1, variant: 2, blocked: true }, offId: INTERIOR_LEGEND['.'].mt, offState: 0 } });
  const cells = puzzleCells(a), tex = new PuzzleStateTexture(a, cells), live = puzzleLiveCells('puzzle', a, cells, tex);
  const v = cells[0];
  expect(live.accepts(v.i, INTERIOR_LEGEND['.'].mt)).toBe(true);        // off = the plain floor id
  live.apply(v.i, INTERIOR_LEGEND['.'].mt); expect(tex.state(v.i)).toBe(0);
  live.apply(v.i, rawOf('barrier', 1, /* pole */ 0)); expect(tex.variant(v.i)).toBe(0);
});
it('makes every state of a mechanic readable at a glance', () => {
  for (const kind of PUZZLE_KINDS) {
    const looks = PUZZLE_LOOK[kind];
    expect(looks).toHaveLength(puzzleStateCount(kind));
    for (const l of looks) expect(l.tint).toHaveLength(3);
    if (kind === 'gymDoor') {                                           // F33: an animation; ends apart, monotonic
      expect(looks.at(-1)!.open - looks[0].open).toBeGreaterThanOrEqual(0.3);
      for (let s = 1; s < looks.length; s++) expect(looks[s].open).toBeGreaterThan(looks[s - 1].open);
      continue;
    }
    if (kind === 'arrowTile') {                                         // F33: four distinct directions in the GLSL
      expect(new Set([0, 1, 2, 3].map((s) => arrowRotation(s))).size).toBe(4);
      continue;
    }
    for (let s = 1; s < looks.length; s++) for (let t = 0; t < s; t++) {
      const d = Math.max(Math.abs(luma(looks[s].tint) - luma(looks[t].tint)), Math.abs(looks[s].glow - looks[t].glow),
        Math.abs(looks[s].raise - looks[t].raise), Math.abs(looks[s].steps - looks[t].steps),
        Math.abs(looks[s].crack - looks[t].crack), Math.abs(looks[s].open - looks[t].open));
      expect(d, `${kind} ${t}/${s}`).toBeGreaterThanOrEqual(0.3);
    }
  }
});
it('keeps every other family blind to a mechanic cell\'s state', () => {
  // the same map with each mechanic in each state: the room layout and the furniture/shell/floor extract agree
  for (const states of [['0', '1', '2'], ['6', '7'], ['8', '9']]) {      // ice; barrier on/off; toggle wall down/up
    const out = states.map((k) => fakePuzzle(['        ', ' WWWWWW ', ` .T${k}T. `, ' ...... ', '        ']))
      .map(({ a }) => extractAll({ a, events: NO_EVENTS, quality: 'medium' },
        [furnitureFamily, shellFamily, floorFamily].map(withoutPuzzleCells)));
    for (const o of out.slice(1)) expect(digestPayloads(o)).toBe(digestPayloads(out[0]));
  }
});
```

  (`rawOf(kind, state, variant?)` = the fake legend's metatile with no collision; `arrowRotation(s)` = the rotation
  `puzzleLookGlsl` gives state s, exported for the test; `withoutPuzzleCells(f)` = `f` after a stand-in puzzle family
  that claims the mechanic cells first, as Task 7's will; `digestPayloads` hashes the payloads as JSON with typed arrays
  as lists; `T` is `fakeInterior`'s table. The blocked-state cases need Task 5's "mechanic cells are floor" rule: run
  them after the group-B join. These fakes seed the ids, so they cannot catch a leak through `interiorIds` or the
  analysis on real maps. Task 14's real-map invariance check (F16) does that, and Task 2's test pins state-free labels.)
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(kit): puzzle state core — mechanic cells, state texture, live cells,
  state looks" -- src/render/kit/interior/puzzle/state.ts tests/kitPuzzleState.test.ts tests/helpers/puzzle.ts`

**Acceptance:** tests pass; the invariance test fails if a family reads a mechanic cell's collision (checked by the
reviewer by mutation: make `walkable()` ignore the mechanic rule).

---

### Task 13 (group B): Rotating gates as models

**Files:**
- Create: `src/render/actors/rotatingGate.ts`, `tests/rotatingGate.test.ts`
- Modify (own): `src/game/spriteKinds.ts`, `src/render/actors/actorLayer.ts` (the sprite-level gate route only),
  `tools/gen-symbols.ts` (WANTED += `SpriteCallback_RotatingGate`), `src/game/symbols.ts`

**Interfaces:**
- Consumes: `SpriteSnap` (`callback`, `rotation`, `worldX`, `worldY`, `width`, `height`), `SpritePixelSource`
  (spriteColors: OBJ VRAM, palette, mapping) for the image and its colours.
- Produces:
  ```ts
  /** A Fortree / Trick House 6 gate (rotating_gate.c): the sprite whose callback is SpriteCallback_RotatingGate (compared
   *  without the Thumb bit). */
  export function isRotatingGate(s: SpriteSnap): boolean;
  /** Arm lengths (cells, 0–2) towards N/E/S/W at rotation 0, read from the sprite's **unrotated image** (OBJ VRAM via
   *  `SpritePixelSource`; the opaque pixels along each axis from its centre, the pivot). A `SpriteSample` holds only
   *  colours, not pixels (F26). The alternative is `rotating_gate.c`'s shape table by the sprite's shape (ids only). */
  export interface GateArms { n: number; e: number; s: number; w: number }
  export function gateArms(image: { w: number; h: number; opaque(x: number, y: number): boolean }): GateArms;
  /** The gate model's yaw for a sprite rotation (F36). */
  export function gateYaw(rotation: number): number;   // = −rotation
  /** A wooden turnstile: a post at the pivot, one rail per arm (0.9 high, two bars), coloured from the sprite's main /
   *  dark colours; quality scales the post's sides (8/12/16). */
  export function gateGeometry(arms: GateArms, colors: { main: RGB; dark: RGB }, q: Quality): THREE.BufferGeometry;
  ```
  Gates are `CreateSprite` sprites, not object events (F26), so the object-event model route (`bySprite`, `ObjectModelRef`,
  `placeModel(…, o: ObjectEventSnap)`) never sees them. In Modern the actor layer checks `isRotatingGate(s)` **before**
  classification and draws the sprite from its own gate-model pool. Position: the pivot cell at `heightAt` of that cell
  (tiers included, D13). Yaw: `gateYaw(s.rotation)` every frame (the GBA's affine rotation, so it turns exactly as the
  game draws it). Retro keeps its card, as today. No `ObjectModelKind` entry.

- [ ] **Step 1: Write the failing tests:** `gateArms` on synthetic images (an L gate 2+1, a T gate) → the arms;
  `gateGeometry` bounding box = the arms' extent (± 0.05) and height 0.9; rails ≤ 0.9 (D6: they hide nothing the sprite
  does not); `isRotatingGate` by callback only (Thumb bit set and clear); the layer's gate instance over a sequence of
  snaps with rotation 0, π/2, π has yaw 0, −π/2, −π and stays on the pivot (F36: the rotation is tested, not only the
  first frame). No Retro `routeSprite` test (it would assert nothing gate-specific).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; `npm run symbols`. **Step 4: Run** → PASS.
- [ ] **Step 5: Look (after the group-B join).** `i_g_fortree` and `i_th6` with `actors=1` show the gates as turnstiles at
  the GBA's angles; Retro 0.00 %. (A pushed gate is checked live by Task 14's `pz_gate`.)
- [ ] **Step 6: Commit** — `git commit -m "feat(actors): rotating gates as turnstile models turning with the sprite" --
  <the files above>` (pathspec)

**Acceptance:** tests pass; the look's bullets.

**Join of group B (controller):** `npx tsc --noEmit && npm test`; smoke `interiorTables` (4b on), `interiorRooms`,
`catalogue`; `npm run regress:live -- --label tB --static --compare p4b-base` → 0.00 % except the Modern gate entries
(Task 13); the scope is still off. Apply Task 5's profile proposals to `scope.ts` (controller commit).

---

### Task 7: Integration — the 4b scope on, the puzzle family, tiers, furniture slots, darkness × clock

**Files:**
- Create: `src/render/kit/interior/puzzle/index.ts`, stubs `puzzle/floors.ts`, `puzzle/raised.ts`,
  `furnitureLeague.ts`, `furnitureSpecial.ts` (empty kind sets, `null` builders, empty catalogues, `{}` generator maps),
  `tests/smoke/helpers/interiorMaps.ts` (F2)
- Modify: `src/render/kit/interior/scope.ts` (`PHASE4B_DEFAULT = true`), `index.ts` (families, catalogue,
  `INTERIOR_GENERATORS`), `shell.ts`, `floors.ts` (pass `mapProfile(ctx.mapKey)` to `roomLayout`), `furniture.ts`
  (the profile; **F6:** `FurnitureOut += glass, glassLow`, their materials and build meshes, `FurniturePiece += theme,
  artRows`), `src/render/overworld/world.ts` (`prepareInterior`'s tier pass, D13), `src/render/overworld/timeOfDay.ts`,
  `src/render/overworld/overworldView.ts` (flash light), `tools/regress-live.ts` (the entries `i_g_sootopolis_back` /
  `_side` if Task 1 did not add them, F27; the Modern `expect` counts), `tests/timeOfDay.test.ts`,
  `tests/overworldLighting.test.ts`, `tests/smoke/interiorWorld.test.ts`, `tests/smoke/worldPatch.test.ts`
  (`setPhase4bScope(false)` around the legacy cases), `tests/smoke/interiors.test.ts`,
  `tests/smoke/interiorFitting.test.ts`, `tests/smoke/interiorRooms.test.ts` (count lines and preparation only: 137
  with the scope off, 182 on; preparation through `interiorMaps.ts`; generators from `INTERIOR_GENERATORS`; F7),
  `tests/helpers/furniture.ts` (`piece()` defaults for `theme`/`artRows`, `trianglesOf`-style helpers over six soups, F6)

**Interfaces:**
- Consumes: Tasks 2, 3, 5, 6.
- Produces (`puzzle/index.ts`):
  ```ts
  export interface PuzzlePlacement { cells: PuzzleCell[] }
  /** extract: the mechanic cells (`puzzleCells(a, ctx.mapKey)`: by id and by position, F4) whose kind a builder draws
   *  (PUZZLE_FLOOR_KINDS ∪ PUZZLE_RAISED_KINDS), claimed CLAIM_SURFACE | CLAIM_OBJECT | CLAIM_TOP (groundMt = the room's
   *  floorTile; no surfaceY: actors keep the analysis heights, D13); build: one PuzzleStateTexture (in kit.disposables),
   *  buildPuzzleFloors + buildPuzzleRaised, then `tex.attach(group)` (F8: every mesh carries userData.stateTexture);
   *  live: puzzleLiveCells over the claimed cells. */
  export const puzzleFamily: Family<PuzzlePlacement>;
  export const PUZZLE_CATALOGUE: readonly InteriorCatalogueEntry[];   // [...PUZZLE_FLOOR_CATALOGUE, ...PUZZLE_RAISED_CATALOGUE]
  // stubs, filled by Tasks 8 / 9:
  // floors.ts: PUZZLE_FLOOR_KINDS: ReadonlySet<PuzzleKind>; buildPuzzleFloors(cells: readonly PuzzleCell[], ctx:
  //   SemanticContext, kit: KitContext, tex: PuzzleStateTexture): THREE.Object3D | null; PUZZLE_FLOOR_CATALOGUE
  // raised.ts: PUZZLE_RAISED_KINDS, buildPuzzleRaised(… same …), PUZZLE_RAISED_CATALOGUE
  ```
  `INTERIOR_FAMILIES = [puzzleFamily, furnitureFamily, shellFamily, floorFamily]`; `furnitureFamily =
  furnitureFamilyWith({ ...HOME_GENERATORS, ...SERVICE_GENERATORS, ...LEAGUE_GENERATORS, ...SPECIAL_GENERATORS })`;
  `INTERIOR_CATALOGUE` += `PUZZLE_CATALOGUE` (empty until the group-C join adds the drawn entries, Phase 4's F6).
  `index.ts` exports `INTERIOR_GENERATORS` (the composed generator map); the smoke tests import it instead of copying
  it (F7).
- Produces (`world.ts`, D13, F1): `prepareInterior(a, profile)`. Without `profile.tiers` it is `flattenFloors(a)`
  exactly. With tiers it re-runs the solver's component and vote pass with `indoorStairs` (Task 5's switch).
  `hiddenStairs` cells (labels through `interiorIds(a, mapKey)`) become `K.Stairs` (ramped), and mechanic cells are read
  walkable (state-free heights). `tierFace` runs are the voting blocked runs. Then every walkable non-tier cell is
  flattened to its tier's height, and blocked cells on a tier get their tier's `groundH` (searching north first next to
  a riser). Modern kit path only: Retro and `analyze` are unchanged (0.00 %). `buildMeshes`, Task 3's patch
  re-analysis and `interiorMaps.ts` call it, so nothing re-implements it (F2). The kit's failure path re-analyses as
  today.
- Produces (`tests/smoke/helpers/interiorMaps.ts`, F2): `loadInteriors({ phase4b: boolean }): InteriorMap[]` with
  `{ key, name, a, ids, profile, warps, layout, extracted }`. It analyses with margin 14 and calls `prepareInterior(a,
  mapProfile(key))`. It extracts with `SemanticContext.mapKey = key`, so each map gets its own profile. Used by
  `interiors`, `interiorFitting`, `interiorRooms`, `specialInteriors`, `interiorVisibility` and `worldPatch`.
- Produces (`furniture.ts`, F6; Tasks 11a / 11b then edit only their generator files):
  `FurnitureOut = { tall, low, glow, glowLow, glass, glassLow }`; `FURNITURE_GLASS = { ...BUILDING_GLASS }`;
  `FURNITURE_GLASS_LOW = { ...BUILDING_GLASS, fade: false }`, each built as its own mesh (`furnitureGlass` /
  `furnitureGlassLow`, cast). Their catalogue entries are joined at the C join, when a generator draws them.
  `FurniturePiece += theme: RoomTheme | null` (= `themeOf(ctx.mapKey)`) and `artRows: number | null` (on puzzle maps:
  `artRows(a, ids, cells)` from `room.ts`, F10; null elsewhere). Generators clip their height to `artRows` when it is
  set. `interiorFitting`'s triangles read all six soups.
- Produces (`timeOfDay.ts`, pure, D10):
  ```ts
  /** Moved from updateLighting unchanged: the GBA's lit radius in px per flashLevel 0…8. */
  export const FLASH_RADIUS_PX: readonly number[];           // [200, 72, 64, 56, 48, 40, 32, 24, 0]
  export interface FlashLight { distance: number; decay: number; intensity: number; ambient: number }
  /** The lantern and room-light scale for a modelled dark room: the lit area matches the GBA circle. */
  export function flashLight(level: number): FlashLight;
  /** three's punctual-light attenuation for that lantern, at the 3D distance hypot(d, 1.6) from it (the lantern hangs 1.6
   *  above the target), d the floor distance in cells (F34); for the tests. */
  export function lanternFalloff(d: number, f: FlashLight): number;
  ```
  `updateLighting`: when `lit` (the interior kit ran) and `flashLevel > 0`, the lantern takes `flashLight(level)` and the
  D8 room light is multiplied by its `ambient`; otherwise today's lantern code runs unchanged (caves, Retro, out of scope).
- Produces (`preview.ts`, no edit needed): `&kitFail=puzzle` works through `setFailFamily` (the family's name is `puzzle`).

- [ ] **Step 1: Write the failing tests.** `tests/timeOfDay.test.ts`:

```ts
it('lights the GBA flash circle and little beyond it', () => {
  for (let level = 1; level <= 7; level++) {
    const f = flashLight(level), r = FLASH_RADIUS_PX[level] / 16, at = (d: number) => lanternFalloff(d, f) / lanternFalloff(0.5, f);
    expect(at(Math.max(0.5, r - 0.5)), `level ${level}`).toBeGreaterThanOrEqual(0.5);
    expect(at(r + 1), `level ${level}`).toBeLessThanOrEqual(0.1);
  }
  expect(FLASH_RADIUS_PX).toEqual([200, 72, 64, 56, 48, 40, 32, 24, 0]);
});
```

  `tests/overworldLighting.test.ts` (as Phase 4's wiring test): a kit-ran room at hour 21 with flash 4 → the lantern's
  distance/intensity = `flashLight(4)`'s and the hemisphere = D8's × `ambient`; a cave (out of scope) with flash 4 →
  today's values exactly; a battle scene untouched. `tests/smoke/interiorWorld.test.ts`:

```ts
it('runs the puzzle family first on the 4b maps, and nothing new on Phase 4 rooms', () => {
  expect(report(15, 0, 'modern')).toEqual(['puzzle:true', 'furniture:true', 'shell:true', 'floor:true']);
  expect(report(2, 2, 'modern')).toEqual(['puzzle:true', 'furniture:true', 'shell:true', 'floor:true']);
  expect(puzzleClaims(2, 2)).toBe(0);                                  // no mechanic on a Pokémon Center
  expect(report(25, 25, 'modern')).toEqual([]);                        // link room: out of scope
  expect(report(15, 0, 'retro')).toEqual([]);
  // (the existing "Petalburg Gym: out of scope" pins — report(8, 1) = [] and its base renderOrder 0 — now read 8.1 in
  //  scope: report(8, 1) has the four families and renderOrder 1; an out-of-scope control takes their place: 26.5)
});
it('keeps the tiers of a tier map and flattens everything else (D13)', () => {
  const levels = (g: number, n: number, style: WorldStyle) => {
    const s = build(g, n, style), hs = new Set<number>();
    for (let y = 0; y < s.grid.height; y++) for (let x = 0; x < s.grid.width; x++) hs.add(world.heightAt(x + 0.5, y + 0.5));
    return hs;
  };
  expect(levels(15, 0, 'modern').size).toBeGreaterThanOrEqual(3);      // the tiers, with ramps between them
  expect([...levels(2, 2, 'modern')]).toEqual([0]);                     // Phase 4 rooms stay flat
  expect([...levels(10, 0, 'modern')]).toEqual([0]);                    // a 4b map without tiers: flat
});
```

  where `puzzleClaims(g, n)` (defined in the test, F34) = the number of cells the last build's puzzle family claimed
  (`world.kitReport` plus the family's payload length through a test seam of `World`, `lastPayloads`). Plus
  `tests/interiorFurniture.test.ts`-style cases for F6: `newFurnitureOut()` has six soups; a piece drawing into
  `glassLow` builds a `furnitureGlassLow` mesh with `fade: false`.

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (stubs, families, scope on, `prepareInterior`'s tiers, the furniture
  slots, flash; callers pass the profile; the three smoke tests rewired to `interiorMaps.ts`).
- [ ] **Step 4: Run** the tests, `catalogue`, `golden`, `semantics`, `interiorRooms`, `interiors`, `interiorFitting`,
  `worldPatch` → PASS (137 with the scope off, 182 on); `npx tsc --noEmit && npm test`.
- [ ] **Step 5: Gate.** Set every puzzle walk and edit entry's `modern` to `'record'` until the group-C join: the
  mechanic cells are labelled, so a change on them is refused `'notInert'` / `'claimedNotLive'` and rebuilds. Retro
  stays `'gate'` with its `expect` (F3: the collision-changing edits refused `'structure'`; everything else 0 builds). `npm run regress:live -- --label t7 --static --compare p4b-base`: Retro 0.00 % everywhere; Modern 0.00 % on
  outdoor, battles, the 4c controls and every `PHASE4_INTERIOR` entry; the 45 maps' entries change (rooms with Phase 4's
  shell, floor and furniture; new kinds legacy); the new night/dusk twins pass `nightLum`; `gym_hole` and `door_*` pass the
  crossing gate.
- [ ] **Step 6: Look.** `npm run regress:live -- --label t7 --interiors --review --review-before p4b-base`: every new
  room closed and sound, no wall over a walkable cell, Dewford dark with a lit circle the size of the GBA's (`i_g_dewford_dark`,
  `i_g_dewford_night_dark`), the night twins lamp-lit, Sootopolis' actors standing on their tiers (`i_g_sootopolis`,
  `_back`, `_side`; risers still legacy until Task 12); report what reads poorly for group C.
- [ ] **Step 7: Commit** — `git commit -m "feat(kit): Phase 4b scope on — puzzle family, tiers, furniture slots,
  flash light under the clock" -- <the files above>` (pathspec)

**Gates:** Step 5. **Acceptance:** the plumbing is in; group C fills only its own modules.

---

**Group C runs in two phases (Phase 4's ledger ruling).** Phase A, in parallel with Task 7: each agent writes only its
`geom/` file and its node test (pure geometry, GLSL strings, material options; no harness, no edits to Task 7's files).
Phase B, after Task 7 is approved: each wires its builder or generators into its own family file, runs its look under
the GPU lock, and commits. Shared rules for every group-C piece: colours from `colorInfo(a)` (D11); low pieces (≤ 1.2)
never fade (`FURNITURE_LOW`, glow/glass low twins); on puzzle maps the D6 height rule through `artRows` (F10); heights from
the cell's own floor (`a.height` / `groundH` after `prepareInterior`, D13, F41), never 0; geometry follows labels, never
collision alone; quality scales sides 8 / 12 / 16. Group C edits no `furniture.ts` or `tests/helpers/furniture.ts`
(Task 7 made those changes, F6). Themes come from `scope.ts` (Task 2, F21).

### Task 8 (group C): Puzzle floors — thin ice, switches, arrow tiles, warp pads, geyser holes

**Files:**
- Create: `src/render/kit/interior/geom/puzzleFloors.ts`, `tests/interiorPuzzleFloors.test.ts`
- Modify (own, Phase B): `src/render/kit/interior/puzzle/floors.ts`

**Interfaces:**
- Consumes: `PuzzleCell`, `PuzzleStateTexture`, `PUZZLE_STATE_GLSL`, `puzzleUniforms`, `puzzleLookGlsl`, `PUZZLE_LOOK`
  (Task 6); `floorTint` (floorPatterns); the stub's signatures (Task 7).
- Produces: `PUZZLE_FLOOR_KINDS = new Set(['thinIce', 'floorSwitch', 'arrowTile', 'warpPad', 'geyserHole'])`;
  `puzzleFloorGeometry(a: MapAnalysis, cells: readonly PuzzleCell[], tint: (c: PuzzleCell) => RGB): THREE.BufferGeometry`
  — one quad per cell at the cell's own floor height + 0.002 (`h(cell)` from the prepared analysis, Z = y + h: thin ice
  lies on Sootopolis' tiers, F19), attributes position, normal, color (the cell's ROM
  tint), `aCell` (vec2: grid x, y; the state lookup), `aKind` (kind index); `puzzleFloorMaterial(uniforms):
  KitMaterialOptions` (hookKey `puzzleFloor`, roughness by kind: ice 0.12, others 0.5; `fragColor` + `fragEmissive` from
  `puzzleLook(kind, state)`: ice — a glossy slab with a soft inner tint, procedural fracture lines seeded per cell scaled
  by `crack`, a dark hole with a jagged rim by `open`; switch — a pad with a rim, a glowing ring by `glow`; arrow —
  inset chevrons rotated by the state's direction, glowing; warp pad — a ring with a slow pulse (`uTime`); geyser hole —
  a sand crater with a warm glow); the switch's `raise` is drawn as a shaded rim (the pad stays a flat quad).
  `ICE_SHEEN_GLSL` (exported; Task 12's `ice` floor pattern imports it, F22). `buildPuzzleFloors` (Phase B) builds one
  mesh (receive shadows, no cast) with `puzzleUniforms(tex, a)`; the family attaches the state texture (F8).
  `PUZZLE_FLOOR_CATALOGUE` one entry (PNC + `aCell`, `aKind`; no cast; a placeholder `DataTexture` bound to
  `uPuzzleState`, as `FLOOR_CATALOGUE` does for `tCells`).
- [ ] **Step 1: Write the failing test** (`fakePuzzle`, a fake `TileInfo`):

```ts
it('lays one quad per mechanic floor cell, at its own floor, with its cell and kind', () => {
  const { a } = fakePuzzle(['       ', ' WWWWW ', ' .013. ', ' .0... ', '       '], undefined, { '0': 2 });   // F19: a raised cell
  const cells = puzzleCells(a).filter((c) => PUZZLE_FLOOR_KINDS.has(c.kind));
  const g = puzzleFloorGeometry(a, cells, () => [0.5, 0.6, 0.8]);
  expect(g.getAttribute('position').count).toBe(4 * cells.length);
  const pos = g.getAttribute('position');
  cells.forEach((c, k) => {                                             // y = h + 0.002, z within [y + h, y + 1 + h]
    const h = a.height[c.i];
    for (let v = 0; v < 4; v++) {
      expect(pos.getY(4 * k + v)).toBeCloseTo(h + 0.002, 5);
      expect(pos.getZ(4 * k + v)).toBeGreaterThanOrEqual(c.y + h - 1e-6); expect(pos.getZ(4 * k + v)).toBeLessThanOrEqual(c.y + 1 + h + 1e-6);
    }
  });
  expect(g.getAttribute('aCell').getX(0)).toBe(cells[0].x);
});
it('reads the state texture in its shader, and only there', () => {
  const { a: a0 } = fakePuzzle(['     ', ' WWW ', ' .0. ', '     ']);
  const m = puzzleFloorMaterial(puzzleUniforms(new PuzzleStateTexture(a0, []), a0));
  const glsl = `${m.fragHead ?? ''}${m.fragColor ?? ''}${m.fragEmissive ?? ''}`;
  expect(glsl).toContain('puzzleStateAt'); expect(m.hookKey).toBe('puzzleFloor');
  expect(Object.keys(m.uniforms ?? {}).sort()).toEqual(['uPuzzleGrid', 'uPuzzleState']);
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (Phase A: geom + material; Phase B: `floors.ts`). **Step 4: Run** → PASS.
- [ ] **Step 5: Look (Phase B, after Task 7).** `i_g_sootopolis`, `i_g_sootopolis_b1f`, `i_pz_sootopolis` (cracked and
  broken cells read as such next to intact ones), `i_g_mauville`, `i_pz_mauville` (pressed switches lit), `i_g_mossdeep`,
  `i_pz_mossdeep` (arrows point as the GBA's), `i_th7`, `i_g_lavaridge`; each state readable without the GBA column;
  the Sootopolis ice lies on its tiers (`i_g_sootopolis_side`).
- [ ] **Step 6: Commit** — `git commit -m "feat(kit): puzzle floors — glossy cracking ice, lit switches, arrow tiles, warp
  pads, geyser holes" -- src/render/kit/interior/geom/puzzleFloors.ts src/render/kit/interior/puzzle/floors.ts
  tests/interiorPuzzleFloors.test.ts`

**Acceptance:** the Step 5 bullets.

---

### Task 9 (group C): Raised mechanics — barriers, toggle walls, gym doors, hidden stairs

**Files:**
- Create: `src/render/kit/interior/geom/puzzleRaised.ts`, `tests/interiorPuzzleRaised.test.ts`
- Modify (own, Phase B): `src/render/kit/interior/puzzle/raised.ts`

**Interfaces:**
- Consumes: as Task 8, plus `RoomLayout` (Task 5): the `'gymDoor'` gaps (`DoorGap.kind`, F5), `artRows` (F10); `PARTITION_H`;
  the tier heights of the prepared analysis (D13).
- Produces: `PUZZLE_RAISED_KINDS = new Set(['barrier', 'toggleWall', 'gymDoor', 'hiddenStairs'])`;
  `puzzleRaisedGeometry(a, L, cells, ids): { body: THREE.BufferGeometry; glass: THREE.BufferGeometry }` (F37). It holds
  barrier poles (metal, `artRows` high ≤ 1.0) and beams (a glass tube between poles, its core a strip inside), toggle-wall
  blocks (tinted glass, `artRows` high) and door leaves. **Hidden stairs are a ramp between the two tier heights in both
  states (D13, F9):** a smooth ice slope whose step nosings extrude by `steps` (0 slope → 1 stone steps), always on the
  ramp the actor walks. Door leaves sit only in `L.doors` gaps with `kind === 'gymDoor'`: two leaves sliding apart along
  the run. The shell keeps the casing and draws no slab there (Task 10, F5). Each vertex carries `aCell` and `aPart`
  (0 static, 1 moves with the state). `puzzleRaisedMaterial(uniforms, glass: boolean): KitMaterialOptions` has hookKey
  `puzzleRaised` / `puzzleRaisedGlass`. Its `vertTransform` reads `puzzleLook(kind, state)` and moves the `aPart`
  vertices: toggle walls scale their height by `raise` (0 → a flush 0.02 plate), stair nosings by `steps`, doors slide
  by `open`, and the beam core scales to 0 when off. `fragEmissive` lights the beam core and the toggle walls' edges by
  `glow`. Body and glass are **`fade: false`**: everything here is ≤ 1.0, and low pieces never fade (F24). Only E4 door
  leaves taller than 1.2 use a fading twin. `PUZZLE_RAISED_CATALOGUE`: body and glass on `{ position: 3, normal: 3,
  color: 3, aCell: 2, aPart: 1 }`, cast, with their depth twins through `vertTransform`, and a placeholder `DataTexture`
  for `uPuzzleState` (F23).
- [ ] **Step 1: Write the failing tests** (`fakePuzzle` digits, F14): a barrier row `' 5665 '` → poles at the `5` cells,
  one beam spanning the `6` cells, max height ≤ `artRows` (≤ 1.0); a toggle wall `9` → block height = its art rows,
  every moving vertex `aPart` 1; a gym door on a `'gymDoor'` `DoorGap` → two leaves inside the gap, none in an `'exit'`
  gap; hidden stairs between a tier at 2 and a floor at 0 → every vertex of the stair cells within 0.05 of the ramp's
  surface plus at most the nosing height (F9), and `heightAt` monotonic along it; `vertTransform` contains
  `puzzleStateAt`; a state change needs no geometry change (`puzzleRaisedGeometry` takes no state: its digest is the same
  for `8` and `9` maps with the same cells); the materials have `fade` false; `PUZZLE_RAISED_CATALOGUE`'s attrs equal the
  built geometry's attribute set (F23).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (Phase A / B). **Step 4: Run** → PASS.
- [ ] **Step 5: Look (Phase B).** `i_g_mauville`, `i_pz_mauville` (barriers on = lit core in glass; off = clear tube),
  `i_th3`, `i_pz_th3` (red/blue blocks raised / flush as the GBA's walls / floor), `i_gym`, `i_pz_petalburg` (doors closed /
  open, no Phase 4 slab in the gap), `i_e4_sidney`, `i_pz_e4` (entrance closed), `i_pz_sootopolis` (stairs risen on the
  ramp between the tiers; hidden: a smooth ice slope); nothing taller than its art.
- [ ] **Step 6: Commit** — `git commit -m "feat(kit): raised mechanics — glass barriers, toggle walls, sliding gym doors,
  rising stairs, moved by state" -- <own files>`

**Acceptance:** the Step 5 bullets.

---

### Task 10 (group C): Gym and League shell — perimeter walls, masses, paintings, blackboards

**Files:**
- Create: `src/render/kit/interior/geom/gymWalls.ts`, `tests/interiorGymWalls.test.ts`
- Modify (own, Phase B): `src/render/kit/interior/shell.ts`, `src/render/kit/interior/geom/shellParts.ts`

**Interfaces:**
- Consumes: `RoomLayout.masses` / `mass` / `profile`, the perimeter runs (per-cell `floorY` on tier maps), `DoorGap.kind`,
  the `painting` / `blackboard` features, `artRows` (Task 5); `wallPath`, `shellProfile`, `PARTITION_PROFILE`,
  `partitionLoops`, `packDecals`, `decalGeometry` (Phase 4); `colorInfo`. (Tier faces are Task 12's risers, never masses:
  D13, F17.)
- Produces (`gymWalls.ts`):
  ```ts
  export const MASS_H_MAX = 1.0;                 // a mass with room north of it (D6)
  /** A mass's height over its cells' own floor (`groundH` after prepareInterior): backed → min(artRows, WALL_H); else
   *  min(artRows, MASS_H_MAX); ridge ≤ 0.6. `artRows` is room.ts' helper (F10), not a copy. */
  export function massHeight(a: MapAnalysis, L: RoomLayout, ids: readonly (InteriorId | null)[], m: Mass): number;
  /** The outline loops of a mass (as partitionLoops), and its south faces' decal quads (its art, Scale4x as the shell's). */
  export function massLoops(a: MapAnalysis, L: RoomLayout, m: Mass): PartitionLoop[];
  export function massDecals(a: MapAnalysis, L: RoomLayout, m: Mass, h: number): Omit<DecalQuad, 'uv'>[];
  /** Framed painting / blackboard on a wall feature: frame body + inset (the art as the decal). */
  export function addPictureFrame(s: Soup, F: WallFrame, at: number, w: number, h: number, frame: RGB, board: boolean): void;
  ```
  The shell (Phase B): perimeter runs as walls (`WALL_H`, cutaway as Phase 4); masses as solids (`BUILDING_BODY`, a
  rounded top edge; `ridge` as rough rock with a bevel; `perimeter` masses as wall blocks with crown) with their decals;
  `painting` / `blackboard` features framed (`addPictureFrame`) where Phase 4 drew decals. **Doors (F5):** `addDoor`
  draws its closed slab only in `'exit'` gaps; a `'gymDoor'` gap keeps the casing and no slab (Task 9's leaves fill it);
  a `'passage'` gap gets neither. Walls on tier maps stand at their run's own `floorY`. No new program (existing
  shell materials). Band-profile maps without new ids build byte-identical shells (Phase 4 maps unchanged: every Phase 4
  gap is `'exit'`).
- [ ] **Step 1: Write the failing tests:** `massHeight` — a backed 3-row perimeter mass → 2.6 cap honoured (min(3, WALL_H)
  → 2.6), an inner 1-row maze → 1.0 at most and ≤ `artRows`, a ridge → ≤ 0.6, a mass on a tier (fake heights) based at
  that tier's floor; `massLoops` of an L mass closed and never over a walkable cell (`fakeInterior` with `Z`);
  `addPictureFrame` stays within its width and 0.06 off the wall; `buildShellSoups` on a fake room with one gap of each
  kind → a slab only in the `'exit'` gap (F5).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS (+ Phase 4's `tests/interiorShell.test.ts`
  unchanged).
- [ ] **Step 5: Look (Phase B).** `i_g_dewford`, `i_g_dewford_dark` (the maze walls low enough to read the maze as the GBA,
  dark beyond the lit circle), `i_g_sootopolis*`, `i_g_fortree`, `i_s_corner_mossdeep` (perimeter rooms closed), `i_g_rustboro`
  (rock ridges), `i_s_lily_1f`, `i_s_lily_2f`, `i_pz_lily` (framed paintings), `i_s_school` (blackboard), the E4 rooms
  (band rooms with their themed art as decals); Phase 4 entries 0.00 %.
- [ ] **Step 6: Commit** — `git commit -m "feat(kit): gym and League shell — perimeter walls, maze/ridge masses, framed
  paintings and blackboards" -- <own files>`

**Acceptance:** the Step 5 bullets.

---

### Task 11a (group C): League and gym props — statues, pillars, braziers, the Hall of Fame dais

**Files:**
- Create: `src/render/kit/interior/geom/leagueProps.ts`, `tests/interiorLeague.test.ts`
- Modify (own, Phase B): `src/render/kit/interior/furnitureLeague.ts`

**Interfaces:**
- Consumes: `FurnitureGenerator`, `FurniturePiece` (with `theme` and `artRows`, added by Task 7, F6), `FurnitureOut`
  (six soups, Task 7), `FURNITURE_SPEC`, `isLow` (Phase 4), `tests/helpers/furniture.ts` (as Task 7 left it),
  `THEME_LIGHT`, `themeOf` (`scope.ts`, Task 2, F21). This task edits no `furniture.ts` and no helper (F6). Generators
  clip their height to `artRows` when it is set.
- Produces: `LEAGUE_GENERATORS` for `statue` (gym-entrance statue: plinth + stylised Poké Ball figure in the tile colours;
  on puzzle maps ≤ its art rows), `pillar` (fluted column, base and capital), `brazier` (bowl on a stand, flame as glow in
  the theme's light colour — `glowLow`: it never fades), `dais` (the Hall of Fame platform: stepped round dais with a glow
  ring, low).
- [ ] **Step 1: Write the failing test** — the Phase 4 footprint/height/soup case for the four kinds, plus: a brazier's
  glow colour is `THEME_LIGHT[theme]` (linear) for `drake` and `phoebe`; a statue on a puzzle map is clipped to its art
  rows (`piece('statue', { artRows: 1.2 })` → max y ≤ 1.2).
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Look (Phase B)** on `i_e4_*`, `i_hof`, `i_g_*` entrances: themed rooms read as Sidney's dark, Phoebe's
  ghostly, Glacia's icy, Drake's fiery, the Champion's grand hall; nothing hides a walkable cell.
- [ ] **Step 6: Commit** — `git commit -m "feat(kit): League and gym props — statues, pillars, themed braziers, Hall of
  Fame dais" -- <own files>`

---

### Task 11b (group C): Special-room furniture

**Files:**
- Create: `src/render/kit/interior/geom/specialFurniture.ts`, `tests/interiorSpecial.test.ts`
- Modify (own, Phase B): `src/render/kit/interior/furnitureSpecial.ts`

**Interfaces:**
- Consumes: as Task 11a (no `theme`). The `glass` / `glassLow` soups and their materials are Task 7's (F6); this task
  edits only `furnitureSpecial.ts` and its geom file.
- Produces: `SPECIAL_GENERATORS` for `displayCase` (glass-topped case on a base, exhibits as rounded shapes in the art's
  accent; glass into `glassLow`), `fishTank` (glass tank into `glass`, water volume tinted from the art, rocks; tall: fades), `modelShip`
  (hull + masts on a stand), `plinth`, `slotMachine` (cabinet, screen in `glow`, lever), `rouletteTable` (felt, wheel
  lathe), `schoolDesk` (desk + attached seat), `flowerBin` (planter with blooms in the art's colours, per cell),
  `bikeRack` (rack with stylised bikes), `machine` (Devon/Hall of Fame consoles: body + lit panel).
- [ ] **Step 1: Write the failing test** — the footprint/height/soup case for the ten kinds; deterministic; quality scales;
  a flower bin per cell (`FURNITURE_SPLIT` 'cell'); a slot machine's screen in `glow` (tall) and a display case's glass
  in `glassLow` (low: never fades).
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Look (Phase B)** on `i_s_*`: museum cases and tanks, model ships, game-corner slots and roulette, school
  desks, flower bins, bike racks, Devon's machines read clearly in their colours; the nurse-style rule holds for clerks
  behind counters (chest up).
- [ ] **Step 6: Commit** — `git commit -m "feat(kit): special-room furniture — museum cases and tanks, model ships, slots,
  roulette, school desks, flower bins, bike racks, machines" -- <own files>`

---

### Task 12 (group C): Floors v2 — stone, ice, sand, metal, ledges, tiers and their risers, themed stone

**Files:**
- Create: `src/render/kit/interior/geom/tierRisers.ts` (Phase A, D13, F20), `tests/interiorTierRisers.test.ts`
- Modify (own): `src/render/kit/interior/geom/floorPatterns.ts`, `src/render/kit/interior/floors.ts`,
  `tests/interiorFloors.test.ts`

**Interfaces:**
- Consumes: Phase 4's floor family; `themeOf` (`scope.ts`, Task 2); `RoomLayout.risers` and the prepared analysis' heights
  (Tasks 5, 7); `ICE_SHEEN_GLSL` (Task 8, F22).
- Produces: `FloorMat` += `Stone = 5, Ice = 6, Sand = 7, Metal = 8, Ledge = 9, Tier = 10` (fits the 4-bit nibble);
  `FLOOR_MAT` maps the new kinds to them (replacing Task 2's stand-ins). Patterns:
  - stone: large flagstones with soft seams;
  - ice: polished sheen (`ICE_SHEEN_GLSL`; roughness through the pattern's tone), faint streaks;
  - sand: fine grain;
  - metal: plate seams and rivets;
  - ledge: a bevelled lip on the cell's south edge with a shadow line below, and **no step** (the outdoor model);
  - tier: the top of a real raised platform. Its cells are drawn at their own height (`roomFloorHeights` → per-cell
    heights on `profile.tiers` maps, F18; per room elsewhere, unchanged), with an edge lip on the sides where the
    neighbour is lower (the `edges` bits).

  **One program, as Phase 4 decided** (F35): a branch per kind on the fetched texel, with any new derivative taken
  before the branch in uniform control flow (as `BOARDS_FW_GLSL` / `TILES_FW_GLSL`). Not a draw per pattern: under MSAA
  a border pixel must shade as its own cell's kind. A per-build `uFloorTheme` (int from `themeOf`) varies stone's tone
  and veining per E4 room. Phase 4's five patterns are byte-identical.
  - `tierRisers.ts` (F20): `riserGeometry(a: MapAnalysis, L: RoomLayout, colors): THREE.BufferGeometry`. One vertical
    face per `Riser`, from y0 to y1 on its un-projected line (Z = line + y), coloured from the `tierFace` cells' ROM
    tiles, with a lip on the upper edge. It is built by the floor family with `fade: true` (it may hide lower-tier
    actors at other yaws, F27) and its own catalogue entry, joined at the C join.
- [ ] **Step 1: Write the failing tests:** `encodeFloor` packs `Tier` with its edges; `floorCells` gives a `ledge` cell its
  kind (its height = the floor south of it: no step) and a `tier` cell its own height and the edges towards lower
  neighbours; `roomFloorHeights` per cell on a tiers profile, per room otherwise; the material's GLSL for the Phase 4
  patterns unchanged (hash of their snippet strings, pinned before the edit) and one program for all kinds;
  `riserGeometry` on Task 5's fake two-tier room → a face spanning exactly [y0, y1] at Z = line + y, no triangle over a
  walkable cell (relative to its own floor, F41).
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Look (Phase B)** on `i_e4_*` (themed stone), `i_hof` (ice sheen), `i_g_lavaridge*` (sand, ledges),
  `i_g_sootopolis*` (raised tiers with risers, actors on them; `_back` / `_side`: risers dither in front of a lower-tier
  actor), `i_g_mauville` / `i_g_mossdeep` (metal), `i_th8` (ice); no moiré far away; Phase 4 entries 0.00 %.
- [ ] **Step 6: Commit** — `git commit -m "feat(kit): floors v2 — stone, ice, sand, metal, ledges, raised tiers with
  risers, themed stone" -- <own files>`

**Join of group C (controller):**
1. Add the drawn catalogue entries and apply the reported `FURNITURE_SPEC` tuning (commit alone). The entries:
   `PUZZLE_FLOOR_CATALOGUE` and `PUZZLE_RAISED_CATALOGUE` via `PUZZLE_CATALOGUE`, with their `aCell` / `aKind` /
   `aPart` attributes and placeholder textures (F23); the tier risers' entry; League/special furniture, glass and
   glassLow included, through `FURNITURE_CATALOGUE` as drawn.
2. Run `npx tsc --noEmit && npm test`, the drift guards, `interiorWorld`, `interiorFitting`, `interiors` and
   `worldPatch`.
3. Switch every puzzle walk and edit entry's `modern` back to `'gate'` with `path: 'live'` (the mechanics are live
   now). Modern `expect` becomes empty, except `i_pz_lily` (`claimedNotLive`: shell-claimed paintings, F25). Retro
   keeps its `'structure'` expectations (F3).
4. Run `npm run regress:live -- --label tC --interiors --review --review-before p4b-base` and hand each agent its rows.
5. Run `npm run regress:live -- --label tC-gate --static --compare p4b-base`. Retro 0.00 % everywhere; Modern outdoor,
   battles, 4c controls and `PHASE4_INTERIOR` 0.00 %; the twins pass `nightLum`. Every puzzle walk and edit entry
   passes its gate in both styles: Modern on the live path, ≤ 1.0 ms, 0 builds (Mauville included, F4); Retro with
   exactly its expected refusals, and 0 builds on the visual-only entries.

---

### Task 14: Smoke, coverage, visibility, patch digests, live check

**Files:**
- Create: `tests/smoke/specialInteriors.test.ts`, `tests/smoke/interiorVisibility.test.ts`
- Modify: `tests/smoke/worldPatch.test.ts` (the full-kit cases), `tools/regress-live.ts` + `tools/puzzle-states.ts` (the
  live walk `pz_gate` and its fixture `pz_fortree`: push one rotating gate, F36), whatever the findings require, kept
  small. Every map is loaded through `tests/smoke/helpers/interiorMaps.ts` (`prepareInterior`, `mapKey`; F2).

**Interfaces:** Consumes everything above. Produces `out/coverage-interiors-4b.txt` (per 4b map: legacy share, worst first;
average) and `out/patch-4b.txt` (per map and edit: path, ms, refusal).

- [ ] **Step 1: Write the tests.** `specialInteriors.test.ts` (the 45 maps, extracted as `World.build` runs them):

```ts
it('scopes exactly the 45 maps', () => expect(IN_4B.map((m) => m.key).sort()).toEqual([...PHASE4B_MAPS.keys()].sort()));
it('lays sound room layouts', () => { for (const m of IN_4B) expect(checkRoomLayout(m.a, m.layout, m.warps), m.name).toEqual([]); });
it('models every mechanic cell as its kind, and every live id of the decomp as a mechanic or inert', () => {
  for (const m of IN_4B) {
    for (const c of puzzleCells(m.a, m.key)) expect(m.puzzleClaimed.has(c.i), `${m.name} ${c.kind} ${c.x},${c.y}`).toBe(true);
    // live ids: scripts, C files, and the "suspected live" door ids of the absent shared scripts (F15)
    for (const id of liveIdsOf(m)) expect(isMechanic(m, id) || isInert(m, id), `${m.name} 0x${id.toString(16)}`).toBe(true);
  }
});
it('models every interaction-behaviour cell as its kind', () => {
  for (const m of IN_4B) for (let i = 0; i < m.a.N; i++) {        // Phase 4's rule (interiors.test.ts) over IN_4B
    const want = BEHAVIOR_IDS.get(m.a.beh[i]);
    if (want && want !== 'mat' && want !== 'decor' && m.layout.inside[i]) expect(pieceKindAt(m, i), `${m.name} ${m.a.cellX(i)},${m.a.cellY(i)}`).toBe(want);
  }
});
it('keeps every family but puzzle blind to mechanic states on the real maps (F16)', () => {
  for (const m of IN_4B.filter((x) => x.profile.puzzle)) for (const ch of stateChanges(m)) {
    expect(payloadDigest(m, ch, { except: 'puzzle' }), `${m.name} ${ch.label}`).toBe(payloadDigest(m, null, { except: 'puzzle' }));
  }
});
it('furnishes the rooms', () => {
  expect(kinds(at(16, 11))).toMatchObject({ dais: 1 });                // Hall of Fame
  expect(kinds(at(9, 7)).displayCase ?? 0).toBeGreaterThan(0);          // Oceanic Museum 1F
  expect(kinds(at(10, 3)).slotMachine ?? 0).toBeGreaterThanOrEqual(6); // Mauville Game Corner
});
it('holds coverage', () => { const c = coverageAll(IN_4B); expect(c.average).toBeLessThanOrEqual(0.10);
  expect(c.over25.map((m) => m.name)).toEqual(RULED_OVER_25); });
```

  The helpers `IN_4B` (from `loadInteriors({ phase4b: true })`), `liveIdsOf`, `isMechanic`, `isInert`, `pieceKindAt`,
  `kinds`, `at`, `stateChanges` (every decomp edit and every mechanic cell to each of its other states),
  `payloadDigest`, `coverageAll` and `RULED_OVER_25` (the controller's list) are defined in the file (F38).

  `interiorVisibility.test.ts` (D5, D6, D13) runs on the puzzle maps at **yaw 0 and π** (the walls and risers that
  `runVisible` shows at each; F27). Every bound is relative to the cell's own floor `h(cell)` from `prepareInterior`
  (F41). The checks:
  - No triangle of any kit mesh rises above `h + WALKABLE_SEAT` over a walkable or mechanic cell (Phase 4's
    `interiorFitting` method, which clips each cell at `y + h`). Raised mechanics count at their tallest state, and only
    over cells blocked in that state (`PuzzleId.blocked`, F38).
  - Every mass and prop is at most its `artRows` (one helper, F10).
  - Risers span exactly their two tier heights and stand only on `tierFace` cells.
  - Every blocked cell labelled with a floor kind (an invisible wall) carries no kit triangle above `h + 0.05`.
  - At yaw π and π/2 on 15.0, every trainer on a lower tier is either visible or behind a fading riser (`fade: true`).

  `worldPatch.test.ts` covers every 4b map, every script edit and every C-level mechanic state change (every cell of a
  mechanic to each of its other states), in Modern with the full kit and in Retro. `patch` is ok and the digest equals
  a rebuild's, except the refusals the test lists, each with its reason in `out/patch-4b.txt`:
  - Retro: `'structure'` exactly for the edits that change collision (F3);
  - Modern: none on a mechanic cell (Mauville's position-listed cells included, F4);
  - `'claimedNotLive'` for the claimed decor of `i_pz_lily`'s paintings (F25);
  - legacy-structural edits elsewhere.
- [ ] **Step 2: Run** → fix what fails in the owning modules (tables, layout rules, generators); repeat.
- [ ] **Step 3: Live check.** `npm run regress:live -- --label t14 --static --selftest --compare p4b-base --review
  --review-before p4b-base`: Global Constraints' gates — Retro 0.00 %; Modern outdoor, battles, 4c controls and
  `PHASE4_INTERIOR` 0.00 %; day actor luminance 0.9–1.15× Retro on the new day entries (median ≥ 0.95; the `_dark`
  entries exempt, F44); twins two-sided. Every puzzle walk: Modern 0 builds, `patches == gridChanges`, live patches
  ≤ 1.0 ms, no compile, the patch frame within margin. Retro: exactly its expected `'structure'` refusals (F3), 0 builds on
  the visual-only walks. `gym_hole` and the door walks crossing-gated. `pz_gate`: the turnstile's yaw follows the
  sprite's rotation on every frame (crop).
- [ ] **Step 4: Live by eye.** `npx tsx tools/shot3d.ts --state out/pz_sootopolis.state --wait 1000 --keys "<pz_ice's
  keys>"` and the Mauville switch, in **both styles** (`--query style=retro` too). Expect no stall, no console error,
  and each crack and barrier flip on the frame the GBA shows it (compare `--eval "emu.gbaPng()"` frames). In Retro the
  barrier flip is a rebuild frame (F3).
- [ ] **Step 5: Commit** — `git add tests/smoke/specialInteriors.test.ts tests/smoke/interiorVisibility.test.ts
  tests/smoke/worldPatch.test.ts tools/regress-live.ts tools/puzzle-states.ts <fixed files> && git commit -m "test(smoke): Phase 4b — layouts, mechanics, visibility,
  patch digests, coverage"`

**Gates:** Step 3. **Acceptance:** tests pass; coverage within budget; numbers in the report.

---

### Task 15: Performance, robustness, documentation

**Files:**
- Modify: small fixes the checks require, `README.md`, `CLAUDE.md`. `--ab-feature interior`'s `previewWhen` is an entry
  predicate (`isInteriorEntry(e) && !OUT_OF_SCOPE_INTERIOR.has(e.name)`): the new `i_*` entries are in already. Check
  only that `OUT_OF_SCOPE_INTERIOR` holds `i_frontier`, `i_contest`, `i_mtpyre`, `i_link` (F39).

- [ ] **Step 1: Full run.** `npm run regress:live -- --label p4b --static --gpu --selftest --compare p4b-base --review
  --review-before p4b-base --expect-same`: every Global Constraint with numbers (calls ≤ 150, triangles ≤ 1.5 M on every
  interior entry; controls pixel-identical; gates as Task 14).
- [ ] **Step 2: Rebuild cost.** `preview.measureRebuild()` × 5 (median) on every new `i_*` entry: build ≤ 40 ms, build +
  first frame ≤ 100 ms (Petalburg 9×112 and Mossdeep 26×36 are the largest). Over: profile and fix, or report.
- [ ] **Step 3: Patch cost.** Per walk and edit entry **and style**: patch ms (max, median) by path, Retro's rebuild frames
  on the collision-changing entries against Task 1's numbers (F3), the patch frame against the walk's
  median, `--dpr 2` and `--query quality=low|high` on `pz_ice` and `pz_switch`; propose the patch budgets' final values
  for the controller's ruling (they were proposed in Global Constraints).
- [ ] **Step 4: Interleaved A/B.** `--ab --ab-feature interior` (64 quads) on `i_g_mauville`, `i_g_sootopolis`,
  `i_g_petalburg_entry`, `i_e4_drake`, `i_hof`, `i_s_ocean_1f`, `i_s_corner`, `i_th3`, `pz_ice` (live), plus `--ab-aa` on
  two. Budget Δgpu ≤ +2.0 ms, Δcpu ≤ +0.5 ms; over: profile (puzzle floor fragment cost, glass overdraw, the state
  texture fetch in the vertex shader) and fix, or report for a ruling.
- [ ] **Step 5: Robustness.** `i_g_mauville_fail` (puzzle family rolled back: its cells legacy, one warning; their state
  changes patch by the legacy path where the shape holds, since the state-free ids are inert by F13, and collision
  changes rebuild as in Retro); a style switch mid-walk on `pz_ice` (`TOGGLE_STYLE` entry `pz_ice_switch`, `sameAs: 'pz_ice'`,
  `samePrograms`); V and back on `pz_switch` (`sameAs`); a patch then a rebuild (style switch) show the same state.
- [ ] **Step 6: Docs.** `README.md`: Phase 4b (the 45 rooms, the mechanics, the raised tiers, the incremental update and
  what Retro patches vs rebuilds). `CLAUDE.md`: the new entries, `p4b-base`, `tools/puzzle-states.ts`,
  `preview.setCells`, `stats().patches`, `&kitFail=puzzle`. Report every known gap for the progress log, at least:
  - outdoor families not live yet (the measured outdoor per-step rebuilds);
  - legacy-cell patches re-run the whole analysis;
  - **in Retro, collision-changing edits (barriers, toggle walls, arrows, doors) still rebuild (F3, controller
    ruling)**;
  - tier heights come from labels, because the game's elevation holds no tiers (D13);
  - the vendor checkout lacks `data/scripts/` (F15);
  - Phase 4c's scope.
- [ ] **Step 7: Commit** — `git add tools/regress-live.ts README.md CLAUDE.md <fixed files> && git commit -m "docs+perf:
  Phase 4b checks, patch budgets, interior A/B, docs"` (check `git status`: never `out/`, states or the ROM).

**Gates:** the final full run. **Acceptance:** every Global Constraint verified with numbers in the report.

---

## Self-review

**Survey must-haves:** (1) incremental path with budgets and gated walks — D3, D4, Tasks 3, 6, 8, 9, harness gates from
Task 3 (legacy) and the group-C join (live), outdoor measured not changed (Tasks 1, 3, 15); (2) new wall and room concepts
for weak band fits — D7, D8, Tasks 5, 10; (3) puzzle floors and fixtures as their own family and kinds — D4, D5, Tasks 2,
6, 8, 9, 13; (4) 23 tables in five parallel curators — Task 4 (worklists from Task 2, live ids from the decomp); (5)
`p4b-base` first with entries for every gym, the E4 rooms and halls, Hall of Fame, every special room, the Trick House
rooms, night/dusk twins and 4c controls — Task 1. **User decisions:** scope (D1, 4c listed out of scope); puzzles read
exactly like the GBA (D5, D6, Review Focus 1–2, Task 14 visibility and digests, harness "patch on the frame of the
change"); every mechanic its own treatment (D5 table → Tasks 8, 9, 13, 12, 7); all indoor light follows the clock and
Dewford keeps its darkness (D9, D10, Task 7); Retro patches too, with collision changes still rebuilding (D3, F3); real
raised tiers from labels (D13; Tasks 5, 7, 9, 12, 14). **Carried rulings:** walkable ≤ 0.45 (from the cell's own floor),
one piece per cell, flat floors except tier cells (D13),
half-height partitions (masses as low solids), D8, F38, the GPU lock, ROM-tile colours, +2.0 ms, two-sided night gates
(Lessons list, Global Constraints).

**Interfaces used across tasks:** `PuzzleKind`, `PUZZLE_KINDS`, `PuzzleId`, `puzzleId`, `puzzleStateCount`,
`InteriorTable.{primary, maps, puzzle, puzzleCells}`, `PuzzleCellPin`, `PuzzleId.blocked`, `interiorId(…, primary)`,
`interiorIds(a, mapKey)`, the new Floor/Wall/Furniture kinds (`tierFace` included), `MapProfile` (`tiers`), `ShellMode`,
`RoomTheme`, `themeOf`, `THEME_LIGHT`, `PHASE4B_MAPS`, `PHASE4B_DEFAULT`, `setPhase4bScope`, `mapProfile`,
`DEFAULT_PROFILE` (T2 → T4–T14); `LiveCells`, `Family.live`, `runKit().live`, `changedCells`, `World.patch`,
`PatchResult`, `PatchRefusal` (`'error'`), `PATCH_MAX_CELLS`, `PATCH_RETRO`, `prepareInterior` (T3, tiers T7),
`kitMaterialSlots`, `OverworldView.updateGrid`, stats `patches` / `lastPatchMs` / `gridChanges`, `PreviewApp.setCells`,
`worldDigest` (T1/T3 → T6–T15); `Mass`, `MassKind`, `Riser`, `DoorGap.kind`, `WallFeature` painting/blackboard,
`artRows`, `RoomLayout.{masses, mass, risers, profile}`, `roomLayout(…, profile)`, `ClassifyOptions.indoorStairs`
(T5 → T7, T9–T12, T14); `PuzzleCell`, `puzzleCells(a, mapKey)`, `seedPuzzleIds`, `PuzzleStateTexture` (`variant`,
`attach`), `PUZZLE_STATE_GLSL`, `puzzleUniforms`, `puzzleLiveCells`, `PUZZLE_LOOK` (`steps`), `puzzleLookGlsl`,
`fakePuzzle` (digits) (T6 → T7–T9, T14); `puzzleFamily`, `PUZZLE_CATALOGUE`, `PUZZLE_FLOOR_KINDS`, `buildPuzzleFloors`,
`PUZZLE_RAISED_KINDS`, `buildPuzzleRaised`, `INTERIOR_GENERATORS`, `FurnitureOut.{glass, glassLow}`,
`FurniturePiece.{theme, artRows}`, `loadInteriors`, `FLASH_RADIUS_PX`, `flashLight`, `lanternFalloff`,
`LEAGUE_GENERATORS`, `SPECIAL_GENERATORS` (T7 → T8–T12, T14); `ICE_SHEEN_GLSL` (T8 → T12); `riserGeometry` (T12);
`massHeight`, `MASS_H_MAX` (T10 → T14); `isRotatingGate`, `gateArms`, `gateYaw`, `gateGeometry` (T13);
`metatileLabels`, `scriptEdits`, `cMetatiles`, `editRaw`, `warpInto`, `PuzzleGate` (`expect`), `EditSpec`,
`PHASE4_INTERIOR` (T1 → T2, T3, T14).

**Placeholders left on purpose:** the fixture cells and walk frames (Task 1's probe, as Phase 4's Task 1 found its cells);
the tables' ids (Task 4, by the stated rules against generated worklists); the D8 profiles may move with Task 5's evidence
(controller); look constants (`PUZZLE_LOOK`, `THEME_LIGHT`, spec heights) are starting values tuned in the looks; the patch
budgets are proposed and ruled in Task 15 (as Phase 4's GPU budget was).

## Open questions for the user

1. **Retro gets the incremental update too?** A patch draws exactly the pixels a rebuild draws (the 0.00 % gate proves
   it), so Retro would lose today's stutter on ice, switches and doors (and outdoors on Fortree bridges, Route 113 ash,
   Pacifidlog logs) at no visual change. **Recommended: yes** (`PATCH_RETRO = true`; "no" keeps Retro rebuilding as today).
2. **Gym tiers and ledges flat?** Sootopolis' ice tiers, Rustboro's raised floor art and Lavaridge/Fortree ledges as flat
   floors with a modelled edge (bevelled lip, shadow line, material step) — Phase 4's flat-floor ruling, nothing raised
   that could hide a cell or lift the player off the grid — rather than raised platforms with ramps. **Recommended: flat.**
3. **Save states inside the gyms made by a test tool?** No existing state stands in a gym; `tools/puzzle-states.ts`
   redirects a door warp by writing the game's warp destination in RAM (test fixtures only, gitignored; the app never
   writes game memory). The alternative is save states you make by playing there. **Recommended: the test tool.**

**User answers (2026-10-28):** 1 — **yes**, Retro also gets the incremental cell-change update (same pixels as a full
rebuild; a deliberate change to the Retro code path, gated by "patched == rebuilt" digests and Retro 0.00 % vs
`p4b-base` on every static shot). 2 — **real raised platforms** (NOT the recommendation): gym tiers/ledges stand at their
real height from the game's per-cell elevation (the overworld's existing height model: grid (x, y) at height h →
world (X = x, Y = h, Z = y + h)); actors already follow cell height; the Phase 4 "flat indoor floors" ruling does not
apply to the tier cells of these maps. The preflight must carry this through the room layout (Task 5), floors (Task 12),
integration (Task 7), cutaway/camera checks and the fitting smoke (Task 14): actors on tiers, stairs/ramps between
tiers, no furniture or wall over a walkable tier cell, cutaway with height. 3 — yes, a test tool may write the game's
warp destination in RAM to create gym save-state fixtures (test fixtures only; the app never writes game memory).
Plan approved ("Godkjenn og kjør"), subagent-driven with parallel groups.

**Applied after the preflight (2026-10-28):**
- Answer 2's "per-cell elevation" cannot be the source: the 45 maps' walkable cells are elevation 0 or 3. The existing
  height model (the solver) gives the heights once labelled stairs and tier faces drive it, in the Modern kit only
  (D13).
- Answer 1 holds for every shape-keeping change. Collision changes still rebuild in Retro; the controller ruled this a
  known gap and the user has been told (F3).
