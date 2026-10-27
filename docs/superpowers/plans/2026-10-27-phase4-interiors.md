# Phase 4 — Interiors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Modern style, the houses, Pokémon Centers, Marts, labs and other rooms built from `gTileset_Building` plus the
`GenericBuilding`, `PokemonCenter`, `Shop`, `Lab` and `BrendansMaysHouse` secondaries become modelled rooms — walls with
thickness, baseboards and wainscot, framed windows with soft light shafts, patterned floors (boards, tiles, carpet, rugs,
mats) and procedural furniture coloured from the tiles — while every cell the tables do not know keeps its legacy box (with
HD-smoothed pixels), every other interior and Retro 3D render exactly as today, and entering a building compiles nothing.

**Architecture:** Phase 1's semantic layer runs a second family list, `INTERIOR_FAMILIES` (furniture → shell → floor),
on in-scope interior maps (`interiorScope`: map type INDOOR, Building primary, one of the five secondaries). Cell
identity comes from curated id tables (`kit/tables/building.ts` + one file per secondary) with an interaction-behaviour
fallback; geometry is placed by a pure room analysis (`kit/interior/room.ts`: wall-art band, back line, wall runs, windows,
doors) and a furniture fitting rule, coloured by `kit/interior/colors.ts`. The geometry writers Phase 3 built for battle halls
(`Soup`, `lathe`, the wall profile, windows, bookcases, `glowMesh`, the hall floor's antialiased patterns) move into the kit
first, byte-identical for battles. Walls the camera looks at from outside are hidden per direction (cutaway). Every new
material joins the boot-time world catalogue and its drift guard.

**Tech Stack:** TypeScript (strict), Three.js 0.186 (WebGL2: MeshStandardMaterial + `onBeforeCompile` via `kitMaterial`,
`compileAsync`), Vite, Vitest, puppeteer-core (headless Chrome, ANGLE D3D11).

**Spec:** `docs/superpowers/specs/2026-10-19-modern-3d-models-design.md` (§8 Phase 4 binding; §3 architecture, §4 semantic
layer, §9 testing, §10 budgets, §11 error handling, §12 non-goals, §13 risks). Progress log:
`docs/superpowers/progress/modern-3d.md`. Rulings that carry over: `phase1-sdd-ledger.md`, `phase2-sdd-ledger.md`,
`phase3-sdd-ledger.md`.

**Branch:** `phase4-interiors` from `main` (after `battle-feet` is merged or abandoned — the controller decides; Task 2's
pins are written against whatever battle code is on the branch base). Do not rely on line numbers in `renderer.ts`,
`overworldView.ts`, `world.ts` or the kit families: refer to functions by name.

## Preflight rulings applied (2026-10-27)

The pre-flight scan (`.superpowers/sdd/2026-10-27-phase4-interiors/preflight.md`) found 42 issues; the controller accepted
every ruling. Each finding → where its ruling now lives in this plan:

- F1 night/day-twin metrics (`NIGHT_TWINS`, `nightLum`) → Task 1 (being built by the Task 1 implementer), Global Constraints, Tasks 6, 12, 13.
- F2 Task 6 gate vs D8 → Task 6 Step 5 (night entries exempt, judged by `nightLum`) + Task 6 Step 6 look on the twins.
- F3 actor luminance vs Retro at night → Task 12 Step 3 (day entries vs Retro, night entries vs their day twin).
- F4 bookshelf depth → Task 2 `addShelf(…, depth?)`, Task 9.
- F5 fake ids never reach the families → Task 3 `seedInteriorIds`, Task 5 `fakeInterior` seeds them.
- F6 unused furniture catalogue entries → Task 6 (`INTERIOR_CATALOGUE` without `FURNITURE_CATALOGUE`), group C join adds it.
- F7 HD materials vs the drift guard → Task 11 (`WorldMaterials.hd`, `legacyHd` required, `tests/smoke/catalogue.test.ts`).
- F8 band rule vs bookshelf test → Task 5 rules + test.
- F9 shell test bounds (crown 0.16, window bodies) → Task 7 test + Build.
- F10 harness entry list, in-game hours of indoor states → Task 1 (being built by the Task 1 implementer), Global Constraints.
- F11 wall thickness → Task 2 `shellProfile(H, W, thick)`, Task 7.
- F12 wall corners of one-segment runs → Task 2 `wallPath(…, ends?)`, Task 7.
- F13 floor GLSL uniform names → Task 2 (`floorGlsl.ts` header), Task 8 (locals).
- F14 behaviour cells vs table labels → Task 3 smoke check, Task 4 rule.
- F15 window rectangle shared → Task 5 `windowRect`, Tasks 7 and 8.
- F16 doors in any wall → D12, Task 5 `DoorGap { dir, line, from, to }`, Task 7.
- F17 furniture pieces need cells / facing → Task 6 `FurniturePiece`, Tasks 9 and 10.
- F18 import cycle → Task 6 (`furnitureFamily` composed in `index.ts`).
- F19 "interior kit ran" flag, A/B meaning → Task 6 `World.interiorKitRan`, D8, Tasks 11 and 13.
- F20 glass vs shafts ownership → D8, Task 7 (glass + its night check), Task 8 (shafts).
- F21 stairwell floor → Task 8 (`floorCells` skips `stairsDown`), Task 10.
- F22 shared checkout in parallel groups → Parallel execution rules (pathspec commits, looks and whole-world smoke at the joins).
- F23 low furniture's glow / glass fading → D7, Task 6 (`glowLow`, `glassLow`, no-fade twins, `glowMesh` options), Tasks 9, 10.
- F24 D8 underspecified → D8, Task 6 (`indoorLight` + test, actor light floor, no exposure, no new lights).
- F25 weak closed-path test → Task 2 (closed-path rule + vertex assertions).
- F26 glow mesh shadow → Task 6 (glow casts none).
- F27 furniture vs wall relief → Task 6 (`WALL_BACK`, test 2.59).
- F28 duplicated furniture test helpers → Task 6 `tests/helpers/furniture.ts`, Tasks 9, 10.
- F29 `&kitFail` reach → Task 6 (`OverworldView.setFailFamily`, parsed before the first build).
- F30 additive shafts → Task 6 (`KitMaterialOptions.blending`), Task 8.
- F31 table coverage definition → Task 3 smoke (table labels only; fallback share reported apart).
- F32 undefined test identifiers → Tasks 7, 8, 12 (fixtures declared; `PC_1F` / `MARTS` by name).
- F33 sRGB vs linear in `countClusters` → Task 6 helper, Task 10.
- F34 HD test vacuity, duplicated glow injection → Task 11.
- F35 stale "indoor = legacy" test wording → Task 6 (`semantics.test.ts`, `kitRun.test.ts`).
- F36 `FURNITURE_KINDS` order → Task 3.
- F37 `--interiors --static` = every entry → Global Constraints (looks use `--interiors` alone).
- F38 D8 scope (battles, `uNight`, `uOutdoorNight`) → D8, Open question 4.
- F39 group B shared worklist / moving tables → Tasks 3, 4, 5.
- F40 needless edits to pinned battle files → Task 2 (`stadium.ts`, `skyPillar.ts` untouched).
- F41 floor cell fetch duplicating the terrain's → Task 8 (shared GLSL constant, `terrain.ts` text unchanged).
- F42 gate lists and night rule in the final run → Global Constraints, Task 7, group C join, Task 13.

## Global Constraints

- **No Nintendo assets in the repository and no third-party downloads.** Tables map metatile ids to our own labels (as
  Phase 1's `tables/general.ts`); colours and pixels are decoded at runtime from the user's ROM / live VRAM.
- World mapping unchanged: grid (x, y) at height h → world (X = x, Y = h, Z = y + h). Interior models stand on the cells
  the game blocks, anchored at the south edge of their cells (spec §13: "models are built in un-projected space so they
  meet the ground where the game's collision is"); their heights are real-world (D6).
- **Retro renders every map exactly as today.** Gate after every task: `npm run regress:live -- --label tN --static
  --compare p4-base` reports **0.00 %** on every Retro entry (live, static map, static battle). Phase 4 also leaves the
  rest alone: every Modern outdoor, battle, transition and **out-of-scope interior** entry (`i_gym`, `i_gym_night`,
  `i_secret`, `truck_inside`) stays 0.00 % in Modern too. Only the in-scope interior entries change, and only in Modern.
- **Night entries (D8).** The harness pairs each night entry with its day twin (`NIGHT_TWINS` in `tools/regress-live.ts`:
  `i_pc_night ↔ i_pc_1f`, `i_house_night ↔ i_house_1f`, `i_lab_night ↔ i_lab`, `i_mart_night ↔ i_mart`,
  `i_gym_night ↔ i_gym`) and reports `nightLum` per pair from the Modern frames: room mean luma night/day **≥ 0.45**,
  actor luminance night/day **0.9–1.15** (actor mask as `actorLum`). Their Retro side and `i_gym_night` stay 0.00 %. A live
  in-scope entry whose recorded in-game hour (Task 1's probe) has `nightFactor > 0` is judged the same way, not by 0.00 %.
- Phase 4 features are Modern-only and in-scope-only: `interiorScope(opts)` true (D1). Everything else is untouched.
- **Budgets (Medium, 1280×800):** ≤ 150 draw calls and ≤ 1.5 M triangles on every interior entry; warm interior rebuild
  (`preview.measureRebuild()`, median of 5) build ≤ 40 ms and build + first frame ≤ 100 ms on every in-scope `i_*` entry;
  door walks (`door_enter`, `door_exit`): no program compiled, one world build per map load, no frame slower than
  build + max(40, 0.5 × build) (the hitch fix's crossing gate); same-session interleaved A/B `--ab-feature interior`
  (interior kit on vs off, same Modern build otherwise) Δgpu ≤ +1.5 ms, Δcpu ≤ +0.5 ms (proposed, ruled in Task 13);
  never judged against stored `gpuMs` (the iGPU drifts 6–14 ms between sessions). New GPU memory ≤ 4 MB per interior.
- **Coverage:** legacy share of in-map, non-void cells on the 138 in-scope maps (`out/coverage-interiors.txt`) ≤ 10 %
  on average, no map > 25 % without a controller ruling; table coverage (cells whose id is labelled, `legacy` included)
  ≥ 97 % of in-map non-void cells per tileset.
- **Programs:** constant after boot. Every new interior material kind is in `worldCatalogue` (via `INTERIOR_CATALOGUE`
  or, for the legacy HD materials, directly); `tests/smoke/catalogue.test.ts` (all 518 maps × Modern low/medium/high +
  Retro) and `tests/battleCatalogue.test.ts` pass after every task that touches materials (parallel groups: at the join).
  No new `THREE` lights anywhere (the light count is part of every program's key).
- **Error handling (spec §11):** each interior family runs inside `runKit`'s try/catch (a failure rolls its claims back:
  its cells render legacy, warned once per map); the semantic layer throwing builds the map as today; V stays the
  universal fallback. `?kitFail=<family>` (preview) proves it.
- `npx tsc --noEmit` and `npm test` pass at the end of every task (parallel groups: at the join, see below); smoke tests a
  task adds or touches pass (`npx vitest run --config tests/smoke/vitest.smoke.config.ts <file>`).
- Every look task ends with a **visual review**: `npm run regress:live -- --label tN --interiors --review
  --review-before p4-base` (`--interiors` alone = the interior entries; with `--static` the harness runs every entry, which
  is the 0.00 % gate's job: `--static --compare p4-base`, run by sequential tasks and by the controller at each join) and
  the implementer reads `_review_interior.png` (columns GBA map | before | Modern | Retro)
  against the task's checklist and says what they saw. In a parallel group the look runs after the join (see Parallel
  execution). Quality bar: modern stylised 3D (Let's Go / BDSP rooms): soft
  rounded shapes, clean bright colours from the tiles, painterly surfaces, readable silhouettes, no pixel boxes where the
  table knows the cell.
- The controller keeps `docs/superpowers/progress/modern-3d.md`; implementers report learnings and numbers. Only `opus`
  subagents work here. Bash heredocs with large content fail: write files with the editor tools; scratch in `.scratch/`.
  Implementers work in the main checkout (ROM, `out/*.state`, `vendor/` exist only there).

## Review Focus

1. **Rooms that are not one rectangle** — stairs alcoves in the back wall, jogs where furniture runs deeper than the wall
   band, two rooms in one map, 8×6 Fortree houses, the Trick House corridor (15×24), the Dept Store rooftop, the
   L-shaped Pokémon Center counters. Walls must close each room, never cross a walkable cell, never float. Pinned: Task 5
   fake rooms (rectangle, alcove, deep column, two rooms, door gap) and `checkRoomLayout`; Task 12 runs `checkRoomLayout`
   on all 138 maps and expects no finding.
2. **NPCs behind counters and the occlusion fades.** The nurse and clerks stand behind counters; Phase 2's NPC fade
   clears what stands in front of the 3 nearest NPCs, so a fading counter would show the nurse's legs. Low furniture
   (≤ 1.2 high) never fades, its screens and glass included; tall furniture does (the player behind a Mart shelf). Pinned: Task 6 `FURNITURE_SPEC` /
   material test, Task 12 static `i_pc_nurse` (stand-in player, nurse in reach) with the actor-luminance gate.
3. **Camera orbit and cutaway.** At any yaw the walls seen from outside vanish, the others stay, the player is never
   hidden, open wall ends are capped. Pinned: Task 6 `wallVisible` at yaw 0, π/2, 3π/4, π; Task 7 static `i_pc_yaw`,
   `i_house_back` (yaw π), `i_house_low` (Low preset) and the cap test.
4. **Door warps, stairs and leaving.** Entering and leaving a house, 1F ↔ 2F: one build per load, nothing compiled, no
   stale interior after leaving (the outdoor frame equals p4-base). Pinned: Task 1 `door_enter` / `door_exit`
   (crossing-gated from Task 1 on), Task 12 re-check with the full kit.
5. **Table holes and mislabels** — an unlabelled id inside a labelled piece of furniture, wall art labelled as floor, an id
   that means different things on two maps sharing a tileset. Pinned: Task 3 behaviour fallback test, Task 4 pins per
   tileset, Task 6 "a component with an unknown cell is cut at it" test, Task 12 "every TV / PC / bookshelf / shop-shelf
   behaviour cell is modelled as its kind" on all in-scope maps.

## Key design decisions (deviations from spec §8 are marked ⚑)

- **D1 Scope = the spec's five secondaries on `gTileset_Building`: 138 of the ROM's 307 INDOOR maps** (measured in
  `out/atlas/stats.txt`: GenericBuilding 73, PokemonCenter 34, Shop 23, Lab 4, BrendansMaysHouse 4 — every house, every
  Pokémon Center 1F/2F, every Mart, Birch's lab, Lanette's house, the Weather Institute, the Dept Store, the League lobby,
  the cycling-road gates, the Safari Zone entrance). Gyms (10 maps, 8 own puzzle tilesets), Battle Frontier / Pyramid /
  Tent / Dome / Pike / Factory / Arena / Palace, Contest halls, museums, Trick House puzzles, Elite Four rooms, the ship,
  the truck and the 24 secret bases keep today's look in both styles (open question 1).
- **D2 Curated id tables, behaviour fallback, no identity heuristics.** `gTileset_Building` holds only 8 metatiles
  (0x000/0x001 black void, 0x002/0x003 TV, 0x004/0x005 PC, 0x006/0x007 exit mat): the content is in the secondaries
  (ids 0x200–0x3FF). Each secondary gets a table labelling every id its maps use (`InteriorId`: a floor kind, a wall part,
  a furniture kind, or `legacy` = keep the GBA art). An unlabelled id falls back to its behaviour when that is an
  interaction behaviour (TV, PC, bookshelves, shop shelf, counter, trash can, vase, region map, arrow-warp mats); else it
  is unknown → legacy. Pixels only decide colours, never what a cell is.
- **D3 ⚑ Floors in their own program (`interiorFloor`), not the outdoor terrain shader.** Same per-cell data-texture
  layout and un-projection as `kit/terrain.ts`, but no organic border warp (rooms are rectilinear), and Phase 3's
  antialiased board / tile patterns (`battle/parts/floor.ts`: the terrain's Paving read as cracked flagstone and its Deck
  aliased) plus carpet, rug (with border band) and mat. The outdoor terrain program stays byte-identical (Modern outdoor
  0.00 %).
- **D4 Room shell from the wall-art band.** The GBA draws the back wall as 1–3 blocked rows of wall art under the void.
  Per column, the *back line* is the first room row; the 3D back wall's inner face stands `RECESS = 0.5` north of it, so
  furniture drawn in the wall rows (fridges, sinks, bookcases) stands in the recess without reaching the walkable row.
  Side and front walls follow every boundary between room cells and void. Wall-art cells become the wall: `window` →
  modelled frame + glass, `clock` → modelled clock, `decor` and unknown → upscaled pixel decal (Scale4x, the special
  facades' `facadeMaterial`), `wall` → paint. Band cells are never left to legacy (a legacy face would stand 0.5 in front
  of the wall).
- **D5 Cutaway by wall direction.** Walls are built in four meshes (inner face looking N/E/S/W into the room); per frame a
  direction is hidden when the camera's horizontal back direction (`uCamBack`) points at its outer side
  (`dot(innerNormal, camBack) < −0.25`). At the default yaw the south (front) walls vanish, as the GBA shows none; when the
  user orbits, the near walls vanish instead. No camera change in interiors (all four presets as outdoors).
- **D6 Real-world heights on the game's footprint** (open question 3): walls 2.6, counters 1.0, bookcases 2.1, beds
  0.55 …; a model's footprint is the blocked cells' ground area anchored at their south edge (depth ≤ its rows), never
  behind the wall plane. What rises above its art covers the wall art / void above it, as Phase 1's taller PC walls did.
- **D7 Low furniture never fades.** `FURNITURE_LOW` (no `KIT_FADE`) for everything ≤ 1.2 high; `FURNITURE_TALL`
  (= `BUILDING_BODY`, fades) above. A low piece's screens and glass never fade either: they go into `glowLow` / `glassLow`,
  drawn with the no-fade twins `FURNITURE_GLOW_LOW` (`{ ...PROP_GLOW, fade: false }` through `glowMesh`'s options) and
  `FURNITURE_GLASS_LOW` (`{ ...BUILDING_GLASS, fade: false }`). Walls fade too (BUILDING_BODY).
- **D8 Indoor light follows the clock (user ruling 2026-10-27: "Alt følger klokka").** In Modern, on in-scope
  interiors whose interior kit ran on the build (`World.interiorKitRan`; with the kit switched off — `setInteriorKit(false)`,
  the `--ab-feature interior` baseline — the room keeps today's light), the whole room follows the outdoor clock: the
  indoor branch of `updateLighting` takes `indoorLight(nightFactor(hour))` (`overworld/timeOfDay.ts`, pure): today's
  indoor sun / hemisphere colours and intensities at 0, blended towards a warm, dimmed lamp-lit night look at 1. Only
  the sun's and hemisphere's colour and intensity change: no tone-mapping exposure (the overworld has none to change:
  `renderer.ts` fixes `toneMappingExposure = 1`) and no new lights (the light count is in every program's key). A
  brightness floor keeps rooms readable: the room's mean luma at night ≥ 0.45× its day value. **Actor light floor:**
  for these rooms `charLight` = max(the blended light's value, `ACTOR_NIGHT_FLOOR` × the day value) per channel, so that
  actor luminance at hour 21 stays within 0.9–1.15× the hour-11 Modern value of the same entry (`ACTOR_NIGHT_FLOOR`
  starts at 0.95, tuned in Task 6 against `nightLum`). **Windows and shafts** follow through
  `KitUniforms.uOutdoorNight` (`nightFactor(hour)` when `interiorKitRan`, else 0): night glass deep blue, shafts off.
  `uNight` (the outdoor window glow) stays 0 indoors, so `KIT_GLOW` glass never lights in a room. Retro, out-of-scope
  interiors and battles started indoors (`TODAY_LIGHTS.room`) keep today's fixed indoor light (open question 4).
  Owned by Task 6 (the uniform, `indoorLight`, the blend, the actor floor), Task 7 (the glass) and Task 8 (the shafts);
  the harness's `NIGHT_TWINS` / `nightLum` (Task 1) measure it; Tasks 6, 12 and 13 gate on it.
- **D9 What moves into the kit** (Task 2, battle pixels identical): `Soup` / `lathe` / `tube` / `lin` (`kit/soup.ts`),
  `glowMesh` (`kit/glow.ts`), the wall profile, `wallPath`, windows and bookcases (`kit/interior/wallParts.ts`), the floor
  seam / boards / tiles GLSL (`kit/interior/floorGlsl.ts`). **Stays battle-only:** `HALLS`, `hallLayout`, `hallColors`,
  pillars, banners, seat tiers, court lines, light panels, the stage-bound `hallFloorMaterial`, the underwater shafts
  (they flicker; interiors get their own steady `roomShaft`).
- **D10 ⚑ Module layout:** the interior modules live in `src/render/kit/interior/` (spec: `kit/furniture.ts`); furniture
  is split into `furniture.ts` (core), `furnitureHome.ts`, `furnitureService.ts` so they can be built in parallel; the
  tables are `kit/tables/building.ts` (spec name) plus `kit/tables/interior/<tileset>.ts`.
- **D11 Unknown cells: legacy boxes with HD pixels** (spec §8): on in-scope Modern interiors the legacy opaque and cutout
  materials are swapped for HD twins that sample the metatile atlas through Phase 2's scale-free xBR (`XBR_GLSL`, rect =
  the metatile's padded 24×24 cell) when magnified, plain texture lookup when minified.
- **D12 Doors and stairs.** Exit mats (`SOUTH_ARROW_WARP` and the other arrow warps) are floor `mat` cells and cut a
  framed doorway into the wall they lie against (south for the south mats; east / west / north for the arrow warps on a
  room's side or back boundary, e.g. the cycling-road gates). Stairs are table ids (`stairsUp` rising into the back-wall recess, `stairsDown` a stairwell
  with a rail) on their warp cells.

## Parallel execution

Tasks marked with the same group letter run as parallel subagents: they own disjoint files (listed per task) and share no
interface that is still changing. Rules: (1) a parallel agent runs only its own tests (`npx vitest run <its files>`); the
controller runs `npx tsc --noEmit && npm test` plus the smoke drift guards at the **join** and attributes failures by file
ownership; (2) each agent commits only its own files with a pathspec commit, one agent at a time
(`git commit -m "…" -- <own files>`: it commits those paths whatever else is staged in the shared index; never `git add
-A`, never a bare `git commit`); (3) the agents share one working tree (the ROM, states and `vendor/` exist only there),
so a parallel agent runs **no** whole-world smoke test (`catalogue`, `golden`, `semantics`) and **no** `regress:live`
look or gate while its group runs — Vite and the smoke tests would load the other agents' half-written modules. The
looks and those smoke tests run after the join: the controller runs one `--label <group> --interiors --review
--review-before p4-base` plus the `--static --compare p4-base` gate and hands each agent its rows (or resumes the agents
one at a time for their look steps); (4) **`--gpu`, `--ab` and `measureRebuild` timing never run alongside anything** —
only Tasks 1 and 13 time the GPU, sequentially.

| Order | Tasks | Mode |
|---|---|---|
| 1 | 1 baseline | sequential (GPU timing) |
| 2 | **A:** 2 kit refactor ‖ 3 scope + table scaffold | parallel |
| 3 | **B:** 4a ‖ 4b ‖ 4c tables ‖ 5 room layout + colours | parallel (4 agents, CPU only) |
| 4 | 6 integration + furniture core | sequential |
| 5 | **C:** 7 shell ‖ 8 floors + shafts ‖ 9 home furniture ‖ 10 service furniture ‖ 11 legacy HD | parallel (5 agents; the controller may run them as 3 + 2) |
| 6 | 12 smoke, coverage, live check | sequential |
| 7 | 13 performance, robustness, docs | sequential (GPU A/B) |

---

## File Structure

Created:
- `src/render/kit/soup.ts` — `Soup`, `lathe`, `tube`, `lin`, `sub`, `cross`, `norm`, `LatheColor` (moved from battle).
- `src/render/kit/glow.ts` — `glowMesh` (moved from `battle/parts/rooms.ts`).
- `src/render/kit/interior/wallParts.ts` — `V2`, `WallFrame`, `wallFrameAt`, `SHELL`, `ShellColors`, `ShellProfile`,
  `shellProfile`, `maxProfileDepth`, `shellPalette`, `wallPath`, `WINDOW`, `addWindow`, `SHELF`, `BOOKS`, `addShelf` (moved +
  generalised).
- `src/render/kit/interior/floorGlsl.ts` — `FLOOR_SEAM_GLSL`, `BOARDS_GLSL`, `TILES_GLSL` (moved text).
- `src/render/kit/tables/building.ts` — id types, `BUILDING_PRIMARY`, `BEHAVIOR_IDS`, `INTERIOR_TABLES`, `interiorId`,
  `interiorIds`, `seedInteriorIds` (test seam).
- `src/render/kit/tables/interior/{genericBuilding,pokemonCenter,shop,lab,brendansMaysHouse}.ts` — one `InteriorTable` each.
- `src/render/kit/interior/scope.ts` — `INTERIOR_TILESETS`, `interiorScope`.
- `src/render/kit/interior/room.ts` — `roomLayout`, `checkRoomLayout`, `windowRect`, constants and types.
- `src/render/kit/interior/colors.ts` — `partColors`, `wallColors`, `floorLook`.
- `src/render/kit/interior/cutaway.ts` — `INNER_NORMAL`, `CUTAWAY_DOT`, `wallVisible`.
- `src/render/kit/interior/furniture.ts`, `furnitureHome.ts`, `furnitureService.ts` — furniture core and generators.
- `src/render/kit/interior/shell.ts` — `shellFamily`, `ROOM_GLASS`, `clockGeometry`, `SHELL_CATALOGUE`.
- `src/render/kit/interior/floors.ts`, `shafts.ts` — `floorFamily`, `interiorFloorMaterial`, `roomShaftMaterial`,
  `shaftGeometry`, `FLOOR_CATALOGUE`.
- `src/render/kit/interior/index.ts` — `furnitureFamily` (composed here), `INTERIOR_FAMILIES`, `INTERIOR_CATALOGUE`,
  `InteriorCatalogueEntry`.
- Tests: `tests/battlePins.test.ts` + `tests/battle-pins.json`, `tests/kitWallParts.test.ts`, `tests/kitInteriorTables.test.ts`,
  `tests/helpers/fakeInterior.ts`, `tests/helpers/furniture.ts`, `tests/interiorRoom.test.ts`, `tests/interiorColors.test.ts`,
  `tests/interiorCutaway.test.ts`,
  `tests/interiorFurniture.test.ts`, `tests/interiorShell.test.ts`, `tests/interiorFloors.test.ts`, `tests/interiorHome.test.ts`,
  `tests/interiorService.test.ts`, `tests/smoke/interiorTables.test.ts`, `tests/smoke/interiorWorld.test.ts`,
  `tests/smoke/interiors.test.ts`.

Modified:
- `src/render/battle/parts/soup.ts` (re-export shim), `rooms.ts`, `floor.ts` — imports only; `roomShell` delegates to
  `wallPath`; outputs byte-identical (Task 2 pins). `stadium.ts` and `skyPillar.ts` stay untouched (the shim and
  `rooms.ts`' re-exports cover their imports).
- `src/render/kit/glow.ts` (Task 6) — `glowMesh(…, options?)` for the no-fade twin.
- `src/render/kit/terrain.ts` (Task 8) — its cell-fetch GLSL exported as a constant, program text unchanged.
- `src/render/overworld/analyze.ts` — `ClassifyOptions.primaryTileset?: number` (read only by the kit).
- `src/render/overworld/world.ts` — interior families, `interiorKit`, `interiorKitRan`, `setFailFamily`, `updateCutaway`,
  HD legacy materials (`WorldMaterials.hd`).
- `src/render/overworld/overworldView.ts` — passes `primaryTileset`, `setInteriorKit`, `setFailFamily`, cutaway per frame,
  `uOutdoorNight`, the D8 blend and actor light floor.
- `src/render/overworld/timeOfDay.ts` — `indoorLight(nightK, out?)` (pure, D8).
- `src/render/overworld/materials.ts` — `createWorldMaterials(atlas, u, { hd })`, `createHdWorldMaterials`.
- `src/render/kit/materials.ts` — `KitUniforms.uOutdoorNight` (bound in `patchKit`), `KitMaterialOptions.blending`.
- `src/render/kit/catalogue.ts` — `INTERIOR_CATALOGUE` entries, `CatalogueSources.legacyHd` (required).
- `src/render/preview.ts` — `&kitFail=` (before the first build), `setInteriorKit`.
- `tools/gen-symbols.ts` (+ regenerated `src/game/symbols.ts`), `tools/regress-live.ts`, `tests/smoke/helpers/staticMap.ts`,
  `tests/smoke/catalogue.test.ts` (Task 11), `tests/smoke/semantics.test.ts` + `tests/kitRun.test.ts` (wording, Task 6),
  `tests/timeOfDay.test.ts` (Task 6), `README.md`, `CLAUDE.md`.

---

### Task 1: Interior harness entries + `p4-base` baseline

Today the harness has three indoor live entries (`item_indoor`, `truck_inside`, `vigoroth`) and no interior previews. This
task adds static interior previews (every in-scope kind, orbit angles, night, a stand-in player by the nurse, out-of-scope
controls), door walks, an `--interiors` filter and an interior review sheet, then captures the Phase 4 baseline.

**Files:**
- Modify: `tools/regress-live.ts`

**Interfaces:**
- Produces (harness): `--interiors` = the static entries named `i_*` plus the live entries in `INTERIOR_LIVE`
  (`vigoroth`, `item_indoor` if the probe finds it indoors, `truck_inside`, `door_enter`, `door_exit`); alone it runs only
  those, with `--static` every entry (as `--battles`).
- Produces (harness): `--review` also writes `_review_interior.png`: one row per interior entry of the run, columns
  GBA map (`out/atlas/<group>_<num>_<Name>.png`, the offline render `tools/map-atlas.ts` writes; blank if missing) |
  before (`out/regress-live/<--review-before>/<entry>_modern.png`) | Modern | Retro.
- Produces (harness, D8 — F1, being built by the Task 1 implementer): `NIGHT_TWINS: Record<string, string>` (night entry →
  its day twin, same camera: `i_pc_night → i_pc_1f`, `i_house_night → i_house_1f`, `i_lab_night → i_lab`,
  `i_mart_night → i_mart`, `i_gym_night → i_gym`) and `stats.json` `nightLum[night] = { roomLuma, actorLum }`: the
  Modern night frame's mean luma / its twin's, and the actor luminance (the `actorLum` mask) night / day; printed as a
  table with the gates (room ≥ 0.45, actors 0.9–1.15).
- Produces (report, F10): per indoor `out/*.state`, the in-game hour (`state.hours`, `state.minutes`) and its
  `nightFactor`, so the gates know which live in-scope entries are night entries.
- Produces (entries, used by every later task):

```ts
// static interior previews (q appended to /?autostart=1&manual=1&…), 60 frames, hour 11 unless q sets one
const STATIC_INTERIOR: StaticEntry[] = [
  { name: 'i_house_1f', q: 'map=1.0&actors=1' },            // Brendan's house 1F: kitchen, table + chairs on a rug, stairs
  { name: 'i_house_2f', q: 'map=1.1&actors=1' },            // Brendan's room: bed, PC, stairs down
  { name: 'i_may_1f', q: 'map=1.2&actors=1' },
  { name: 'i_lab', q: 'map=1.4&actors=1' },                 // Birch's lab: bookcases, desks, plants, machine
  { name: 'i_oldale_house', q: 'map=2.0&actors=1' },        // GenericBuilding house
  { name: 'i_pc_1f', q: 'map=2.2&actors=1' },               // Pokémon Center 1F: nurse, counter, healing machine, PC
  { name: 'i_pc_2f', q: 'map=2.3&actors=1' },
  { name: 'i_mart', q: 'map=2.4&actors=1' },                // Mart: shelves, counter, clerk
  { name: 'i_flat', q: 'map=11.13&actors=1' },              // Rustboro Flat2 1F
  { name: 'i_fortree_house', q: 'map=12.0&actors=1' },      // 8×6
  { name: 'i_sootopolis_house', q: 'map=15.5&actors=1' },   // 8×7
  { name: 'i_dept_1f', q: 'map=13.16&actors=1' }, { name: 'i_dept_roof', q: 'map=13.21&actors=1' },
  { name: 'i_league', q: 'map=16.10&actors=1' }, { name: 'i_weather', q: 'map=32.0&actors=1' },
  { name: 'i_trickhouse', q: 'map=29.2' },                  // corridor maze 15×24
  { name: 'i_gate', q: 'map=29.11&actors=1' },              // cycling road gate (Shop)
  { name: 'i_pc_yaw', q: 'map=2.2&actors=1&yaw=1.5708' },   // camera from the east (cutaway)
  { name: 'i_house_back', q: 'map=1.0&yaw=3.1416' },        // camera from the north: back wall cut, front wall shown
  { name: 'i_house_low', q: 'map=1.0&preset=3' },           // Low preset
  { name: 'i_pc_night', q: 'map=2.2&actors=1&hour=21' },    // windows / shafts at night (D8), twin i_pc_1f
  { name: 'i_house_night', q: 'map=1.0&actors=1&hour=21' }, // D8: the house's lamp-lit night, twin i_house_1f
  { name: 'i_lab_night', q: 'map=1.4&actors=1&hour=21' },   // twin i_lab
  { name: 'i_mart_night', q: 'map=2.4&actors=1&hour=21' },  // twin i_mart
  { name: 'i_pc_nurse', q: 'map=2.2&actors=1&x=7.5&y=4.5&focus=1' }, // stand-in player two rows south of the nurse (7,2)
  { name: 'i_house_fail', q: 'map=1.0&kitFail=furniture' },  // Task 6 on: furniture rolled back to legacy
  { name: 'i_gym', q: 'map=8.1' },                           // out of scope: Modern 0.00 % for ever
  { name: 'i_gym_night', q: 'map=8.1&hour=21' },             // out of scope: today's fixed indoor light at night too
  { name: 'i_secret', q: 'map=25.0' },                       // out of scope (SECRET_BASE): SecretBase_RedCave1
];
const NIGHT_TWINS = { i_pc_night: 'i_pc_1f', i_house_night: 'i_house_1f', i_lab_night: 'i_lab', i_mart_night: 'i_mart',
  i_gym_night: 'i_gym' };
// live door walks (crossing-gated: no compile, one build per map load, frame ≤ build + crossingMargin)
{ name: 'door_enter', state: 'out/s22.state', steps: [['', 30], ['RIGHT', 32], ['UP', 40], ['', 120]], crossings: 1 }, // into May's house 1F (1.2)
{ name: 'door_exit', state: 'out/s21.state', steps: [['', 30], ['DOWN', 82], ['', 100]], crossings: 1 }, // May's 1F → Littleroot
// INTERIOR_LIVE (review row's map): vigoroth 1.0, item_indoor 1.3, truck_inside 25.40, door_enter 1.2, door_exit 0.9
```

- [ ] **Step 1: Probe the states.** `.scratch/p4_probe.ts` (as Phase 3's battle probe: `Gba.loadState`, a few frames,
  `GameState`): print map group/num, name, `header.mapType`, player cell, whether input moves the player and the in-game
  hour (`hours`, `minutes`, `nightFactor`) for every `out/*.state`. Record in the entries' comments which states are indoors (expected: `littleroot.state` = Brendan's
  1F cutscene, `truck.state` = the truck); pick `door_exit`'s state (an indoor free-walk state; if none, `door_enter`'s
  end saved by the probe as `out/house_in.state` — gitignored). Fill `i_pc_nurse`'s cell (the nurse's template cell,
  stand-in two rows south) and `i_secret`'s map.
- [ ] **Step 2: Add the entries, `--interiors`, `INTERIOR_LIVE`, `NIGHT_TWINS` + `nightLum`, the interior review sheet.**
  Tune the door walks so each
  crosses exactly one map load and ends ≥ 30 frames after the fade-in (record the frames).
- [ ] **Step 3: Determinism.** `npm run regress:live -- --label p4det1 --interiors --static` then `--label p4det2
  --interiors --static --compare p4det1` → 0.00 % on every interior entry, both styles.
- [ ] **Step 4: Baseline.** `npm run regress:live -- --label p4-base --static --gpu` (every entry, both styles; later
  gates `--static --compare p4-base`). Then `--label p4chk --only battle,transition,r101 --compare p3-base` → 0.00 %
  (nothing changed since Phase 3; if not, report why). Report per interior entry and style: calls, triangles, programs,
  buildMs; for the door walks: builds, programs, the five slowest frames; the in-game hour / `nightFactor` of every
  indoor live state; `nightLum` per twin pair (today's fixed indoor light: ≈ 1).
- [ ] **Step 5: Typecheck, test, commit.** `npx tsc --noEmit && npm test`; `git add tools/regress-live.ts && git commit -m
  "tools: interior entries (previews, orbit, night, nurse, controls), door walks, --interiors, night twins, interior review
  sheet"`

**Gates:** Retro and Modern — no renderer code changed; door walks pass the crossing gate on today's code.
**Acceptance:** entries deterministic in both styles; `p4-base` captured; today's interior numbers in the report.

---

### Task 2 (group A): Battle room geometry into the kit — battle pixels identical

**Files:**
- Create: `src/render/kit/soup.ts`, `src/render/kit/glow.ts`, `src/render/kit/interior/wallParts.ts`,
  `src/render/kit/interior/floorGlsl.ts`, `tests/battlePins.test.ts`, `tests/battle-pins.json`, `tests/kitWallParts.test.ts`
- Modify: `src/render/battle/parts/soup.ts` (becomes `export { … } from '../../kit/soup'`), `rooms.ts`, `floor.ts`
  (imports; `rooms.ts` re-exports `SHELL`, `SHELF`, `ShellColors`, `glowMesh` so tests and `stadium.ts` keep compiling).
  `stadium.ts` and `skyPillar.ts` stay untouched: the shim and the re-exports cover their imports.

**Interfaces:**
- Produces (`kit/interior/wallParts.ts`; bodies moved verbatim where they exist):
  ```ts
  export type V2 = [number, number];                                  // x, z on the floor
  export interface WallFrame { o: V3; u: V3; w: V3; s: [number, number]; at(s: number, h: number, d: number): V3 }
  export function wallFrameAt(o: V3, u: V3, w: V3, s: [number, number]): WallFrame;   // battle's wallFrame builds via it
  export const SHELL: { thick: 0.4; base: 0.35; wainscot: 1.15; crown: 0.42; relief: 0.075; panel: {…} };   // moved
  export interface ShellColors { base: RGB; wainscot: RGB; panel: RGB; trim: RGB; wall: RGB }
  export interface ShellProfile { pts: [number, number][]; col: (keyof ShellColors | 'cap')[] }
  /** Moved; `thick` (default SHELL.thick: the battle call, pins unchanged) is the outer face's depth behind the inner one. */
  export function shellProfile(H: number, W: number, thick?: number): ShellProfile;
  /** How far the profile stands into the room at most (its crown: 0.16 for the moved profile). */
  export function maxProfileDepth(p: ShellProfile): number;
  export type ShellPalette = Record<keyof ShellColors | 'cap', RGB>;                   // linear
  export function shellPalette(c: ShellColors): ShellPalette;                          // lin(...), cap = wall × 0.8
  /** Walls along `path` (floor points, consecutive points share an axis), the room on the side `inward[k]` of segment k;
   *  each profile step's inner face offset d into the room, corners mitred (P + d·(n₀ + n₁)). A path whose last point
   *  equals its first is closed: that corner is mitred too and `caps` is ignored. An open end is offset along its own
   *  segment's normal (square), unless `ends[0]` / `ends[1]` gives the inward normal of the wall it meets there (a
   *  neighbouring run built as its own mesh): then it is mitred as that corner of a closed path would be. `caps`: every
   *  open end closed by the profile's section — on the mitre plane for an end with a neighbour (it still shows when the
   *  neighbour is cut away), square otherwise. Emits per profile step the segments' quads in path order, then the two
   *  caps (roomShell's order: the battle pins stay byte-identical; the battle passes no `ends`). */
  export function wallPath(s: Soup, path: readonly V2[], inward: readonly V2[], y0: number, profile: ShellProfile,
    C: ShellPalette, caps: boolean, ends?: readonly [V2 | null, V2 | null]): void;
  export const WINDOW: WindowSize; export interface WindowSize { width: number; height: number; sill: number; frame: number; depth: number; mullion: number }
  export function addWindow(body: Soup, glass: Soup, F: WallFrame, at: number, trim: RGB, size?: WindowSize): void;
  export const SHELF: {…}; export const BOOKS: RGB[];
  /** `depth` (default SHELF.depth) is the carcass' front; the books' depth range scales with it. */
  export function addShelf(body: Soup, F: WallFrame, at: number, wood: RGB, seed: number, width?: number, height?: number,
    depth?: number): void;
  ```
- Produces: `kit/glow.ts` `glowMesh(uniforms: KitUniforms, geometry: THREE.BufferGeometry, emissive: RGB): THREE.Mesh`
  (moved); `kit/soup.ts` (moved); `kit/interior/floorGlsl.ts` `FLOOR_SEAM_GLSL` (the `floorSeam` function), `BOARDS_GLSL`
  and `TILES_GLSL` (the two `if` branch bodies of today's `FLOOR_COLOR`, reading `fp`, `uFloor`, `uFloorAlt`, writing `k`,
  `seam`), so `floor.ts` composes the identical `FLOOR_COLOR` string. The file's header documents the names the snippets
  read and write (`fp`, `uFloor` .y size / .z seam / .w tone, `uFloorAlt`, `k`, `seam`): a program without those uniforms
  (Task 8) declares them as locals in a block around the snippet.

- [ ] **Step 1: Write the pins first, against today's code.** `tests/battlePins.test.ts` hashes (FNV-1a over the
  `Float32Array` bytes of position, normal, colour and the index if any) the geometry of: `roomShell` for the four
  `HALLS`; every mesh `HALL_PART.build` and `STADIUM_PART.build` return for each of their kinds; `SKY_PILLAR_PART.build`;
  `pillarGeometry(0.5, 9, [0.8, 0.8, 0.8])`; and the `fragHead` + `fragColor` strings of `hallFloorMaterial` for every
  `FLOOR_STYLE` kind. Contexts as `tests/arenaRooms.test.ts` builds them.

```ts
const FILE = path.join(import.meta.dirname, 'battle-pins.json');
it('battle room geometry and floor shaders are unchanged', () => {
  const got = computePins();     // { 'roomShell:gym': 'a1b2c3d4', 'hall:building:hallRoom': …, 'floor:gym': … }
  if (process.env.UPDATE_PINS) fs.writeFileSync(FILE, JSON.stringify(got, null, 2) + '\n');
  expect(got).toEqual(JSON.parse(fs.readFileSync(FILE, 'utf8')));
});
```

- [ ] **Step 2: Record them.** `UPDATE_PINS=1 npx vitest run tests/battlePins.test.ts` on the unchanged code; commit
  `tests/battlePins.test.ts tests/battle-pins.json` alone (`git add tests/battlePins.test.ts tests/battle-pins.json &&
  git commit -m "test: pin battle room geometry and floor shaders before the kit move" -- tests/battlePins.test.ts
  tests/battle-pins.json`). The JSON is never regenerated in this phase.
- [ ] **Step 3: Write the failing test** `tests/kitWallParts.test.ts`:

```ts
import { wallPath, shellProfile, shellPalette, maxProfileDepth, SHELL, SHELF, addWindow, addShelf, wallFrameAt, WINDOW } from '../src/render/kit/interior/wallParts';
import { Soup } from '../src/render/kit/soup';
import * as THREE from 'three';
const C = shellPalette({ base: [0.4, 0.3, 0.2], wainscot: [0.7, 0.55, 0.4], panel: [0.72, 0.57, 0.42], trim: [1, 1, 1], wall: [0.9, 0.88, 0.8] });
/** Some vertex of `g` lies at (x, *, z). */
const hasXZ = (g: THREE.BufferGeometry, x: number, z: number) => {
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i) - x) < 1e-5 && Math.abs(p.getZ(i) - z) < 1e-5) return true;
  return false;
};
describe('wall parts', () => {
  it('builds a closed rectangular room with mitred corners and no caps', () => {
    const s = new Soup(), T = SHELL.thick;
    wallPath(s, [[0, 0], [6, 0], [6, 4], [0, 4], [0, 0]], [[0, 1], [-1, 0], [0, -1], [1, 0]], 0, shellProfile(2.6, SHELL.wainscot), C, false);
    const g = s.geometry(); g.computeBoundingBox();
    expect(g.boundingBox!.min.x).toBeCloseTo(-T, 5); expect(g.boundingBox!.max.x).toBeCloseTo(6 + T, 5);
    expect(g.boundingBox!.max.y).toBeCloseTo(2.6, 5);
    // the closing corner (first point = last) is mitred like the others: outer corner at (−T, −T), no square end at (−T, 0) / (0, −T)
    expect(hasXZ(g, -T, -T)).toBe(true); expect(hasXZ(g, 6 + T, 4 + T)).toBe(true);
    expect(hasXZ(g, -T, 0)).toBe(false); expect(hasXZ(g, 0, -T)).toBe(false);
  });
  it('mitres an open end against the wall it meets, and takes the thickness', () => {
    const s = new Soup(), t = 0.3, prof = shellProfile(2.6, SHELL.wainscot, t);
    wallPath(s, [[0, 0], [6, 0]], [[0, 1]], 0, prof, C, true, [[1, 0], null]);  // meets a west wall (inward +x) at x = 0
    const g = s.geometry(); g.computeBoundingBox();
    expect(hasXZ(g, -t, -t)).toBe(true); expect(hasXZ(g, 0, -t)).toBe(false);     // mitred start, square end at x = 6
    expect(hasXZ(g, 6, -t)).toBe(true);
    expect(g.boundingBox!.max.z).toBeCloseTo(maxProfileDepth(prof), 5);           // the crown: 0.16 into the room
  });
  it('caps an open wall at both ends', () => {
    const a = new Soup(), b = new Soup(), prof = shellProfile(2.6, SHELL.wainscot);
    wallPath(a, [[0, 0], [5, 0]], [[0, 1]], 0, prof, C, false);
    wallPath(b, [[0, 0], [5, 0]], [[0, 1]], 0, prof, C, true);
    expect(b.geometry().getAttribute('position').count).toBeGreaterThan(a.geometry().getAttribute('position').count);
  });
  it('sizes a window by its argument and keeps the battle default', () => {
    const body = new Soup(), glass = new Soup(), F = wallFrameAt([0, 0, 0], [1, 0, 0], [0, 0, 1], [-5, 5]);
    addWindow(body, glass, F, 0, [1, 1, 1], { ...WINDOW, width: 1.2 });
    const g = glass.geometry(); g.computeBoundingBox();
    expect(g.boundingBox!.max.x - g.boundingBox!.min.x).toBeCloseTo(1.2, 5);
  });
  it('sizes a bookcase to a footprint depth and height (battle default SHELF.depth)', () => {
    const body = new Soup(), F = wallFrameAt([0, 0, 0], [1, 0, 0], [0, 0, 1], [-5, 5]);
    addShelf(body, F, 0, [0.5, 0.35, 0.2], 1, 1.0, 2.1, 0.45);
    const g = body.geometry(); g.computeBoundingBox();
    expect(g.boundingBox!.max.z).toBeLessThanOrEqual(0.45 + 1e-6); expect(g.boundingBox!.max.y).toBeCloseTo(2.1, 5);
    expect(SHELF.depth).toBe(0.58);
  });
});
```

- [ ] **Step 4: Run** `npx vitest run tests/kitWallParts.test.ts` → FAIL (module missing).
- [ ] **Step 5: Move.** Create the kit modules with the moved code, make `roomShell` call `wallPath` with today's U path
  (`inward` [[1,0],[0,1],[-1,0]], `caps` true, no `ends`) and its panel loop unchanged, compose `FLOOR_COLOR` from
  `floorGlsl.ts`, update imports. No constant, order or expression changes on the battle's paths (`thick`, `ends` and
  `depth` at their defaults reproduce today's arithmetic exactly).
- [ ] **Step 6: Run** `npx vitest run tests/battlePins.test.ts tests/kitWallParts.test.ts tests/arenaRooms.test.ts
  tests/arenaSoup.test.ts tests/battleCatalogue.test.ts` → PASS.
- [ ] **Step 7: Gate (after the group-A join, see Parallel execution rule 3).** `npm run regress:live -- --label t2
  --battles --compare p4-base` → 0.00 % on every battle entry, both styles.
- [ ] **Step 8: Commit** — `git add src/render/kit/soup.ts src/render/kit/glow.ts src/render/kit/interior/wallParts.ts
  src/render/kit/interior/floorGlsl.ts tests/kitWallParts.test.ts && git commit -m "refactor(kit): battle room geometry, wall profile, windows,
  bookcases, glow mesh and floor patterns into the kit (battle output pinned)" -- src/render/kit/soup.ts
  src/render/kit/glow.ts src/render/kit/interior/wallParts.ts src/render/kit/interior/floorGlsl.ts src/render/battle/parts
  tests/kitWallParts.test.ts` (pathspec commit: only these paths)

**Gates:** battle pins unchanged; battle entries 0.00 % both styles; overworld untouched.
**Acceptance:** the pins pass without regeneration; `wallPath` serves the battle and the overworld.

---

### Task 3 (group A): Interior scope, tileset symbols, table scaffold, id report

**Files:**
- Create: `src/render/kit/tables/building.ts`, `src/render/kit/tables/interior/{genericBuilding,pokemonCenter,shop,lab,brendansMaysHouse}.ts`
  (empty tables, `target: 0`, no pins), `src/render/kit/interior/scope.ts`, `tests/kitInteriorTables.test.ts`,
  `tests/smoke/interiorTables.test.ts`
- Modify: `tools/gen-symbols.ts` (WANTED += `gTileset_Building`, `gTileset_GenericBuilding`, `gTileset_PokemonCenter`,
  `gTileset_Shop`, `gTileset_Lab`, `gTileset_BrendansMaysHouse`; then `npm run symbols`), `src/game/symbols.ts`,
  `src/render/overworld/analyze.ts` (`ClassifyOptions.primaryTileset?: number`, doc: "read only by the kit"),
  `src/render/overworld/overworldView.ts` (`buildWorld` passes `primaryTileset`), `tests/smoke/helpers/staticMap.ts`
  (`primaryTileset: map.layout.primaryTileset`)

**Interfaces:**
- Produces (`kit/tables/building.ts`):
  ```ts
  export type FloorKind = 'boards' | 'tiles' | 'carpet' | 'rug' | 'mat';
  export type WallPart = 'wall' | 'window' | 'decor' | 'clock';
  export type FurnitureKind = 'bed' | 'table' | 'chair' | 'tv' | 'pc' | 'bookshelf' | 'plant' | 'fridge' | 'sink' | 'cabinet'
    | 'crate' | 'trashCan' | 'vase' | 'counter' | 'healer' | 'pcCounter' | 'martShelf' | 'stairsUp' | 'stairsDown';
  export type InteriorId = FloorKind | WallPart | FurnitureKind | 'legacy';
  export const FLOOR_KINDS: readonly FloorKind[]; export const WALL_PARTS: readonly WallPart[];
  /** In exactly the union's order above (Task 6's `isLow` test depends on it). */
  export const FURNITURE_KINDS: readonly FurnitureKind[];
  /** A pin: map-local cell (x, y) of map [group, num] must read as `id`. */
  export interface TablePin { map: [number, number]; x: number; y: number; id: InteriorId }
  export interface InteriorTable { name: string; ids: ReadonlyMap<number, InteriorId>; target: number; pins: readonly TablePin[] }
  export const BUILDING_PRIMARY: ReadonlyMap<number, InteriorId>;   // 0x002/0x003 tv, 0x004/0x005 pc, 0x006/0x007 mat
  export const BEHAVIOR_IDS: ReadonlyMap<number, InteriorId>;      // TELEVISION tv, PC pc, PICTURE_BOOK_SHELF / BOOKSHELF /
    // POKEMON_CENTER_BOOKSHELF bookshelf, SHOP_SHELF martShelf, COUNTER counter, TRASH_CAN trashCan, VASE vase,
    // REGION_MAP decor, SOUTH/NORTH/EAST/WEST_ARROW_WARP mat
  export const INTERIOR_TABLES: ReadonlyMap<number /* SYM tileset address */, InteriorTable>;
  /** Secondary table (m ≥ 512), the Building primary (m < 512), else BEHAVIOR_IDS[beh]; null = unknown (legacy). */
  export function interiorId(m: number, beh: number, secondary: number, tables?: ReadonlyMap<number, InteriorTable>): InteriorId | null;
  /** Per analysis cell (void: null), memoised per analysis (a `WeakMap<MapAnalysis, …>`). The model families read their
   *  ids only through this. */
  export function interiorIds(a: MapAnalysis): readonly (InteriorId | null)[];
  /** Test seam: makes `interiorIds(a)` return `ids` (fakeInterior's legend ids reach the families' extract this way). */
  export function seedInteriorIds(a: MapAnalysis, ids: readonly (InteriorId | null)[]): void;
  ```
- Produces (`kit/interior/scope.ts`): `INTERIOR_TILESETS: ReadonlySet<number>` (the five SYM addresses);
  `interiorScope(o: Pick<ClassifyOptions, 'indoor' | 'primaryTileset' | 'secondaryTileset'>): boolean` — indoor,
  primary `SYM.gTileset_Building`, secondary in the set.
- Produces (smoke): `out/interior-ids.txt` — per in-scope tileset, per id used on its maps' in-map cells: hex id, cells,
  maps, behaviour name, layer type, blocked share, current label (`-` unlabelled) — the curators' worklist.

- [ ] **Step 1: Write the failing tests** `tests/kitInteriorTables.test.ts`:

```ts
import { interiorId, interiorIds, seedInteriorIds, BUILDING_PRIMARY, BEHAVIOR_IDS, INTERIOR_TABLES, FURNITURE_KINDS, FLOOR_KINDS, WALL_PARTS, type InteriorTable } from '../src/render/kit/tables/building';
import { fakeAnalysis } from './helpers/fakeMap';
import { interiorScope, INTERIOR_TILESETS } from '../src/render/kit/interior/scope';
import { MB } from '../src/game/behaviors';
import { SYM } from '../src/game/symbols';
describe('interior id tables', () => {
  it('labels the Building primary tileset', () => {
    expect([0x002, 0x003, 0x004, 0x005, 0x006, 0x007].map((m) => BUILDING_PRIMARY.get(m))).toEqual(['tv', 'tv', 'pc', 'pc', 'mat', 'mat']);
    expect(BUILDING_PRIMARY.has(0x001)).toBe(false);                 // the black void: K.Void
  });
  it('looks an id up in the secondary table, the primary, then by behaviour', () => {
    const t: InteriorTable = { name: 'fake', ids: new Map([[0x210, 'rug']]), target: 0, pins: [] };
    const tables = new Map([[0xdead, t]]);
    expect(interiorId(0x210, MB.NORMAL, 0xdead, tables)).toBe('rug');
    expect(interiorId(0x002, MB.NORMAL, 0xdead, tables)).toBe('tv');
    expect(interiorId(0x211, MB.BOOKSHELF, 0xdead, tables)).toBe('bookshelf');
    expect(interiorId(0x211, MB.NORMAL, 0xdead, tables)).toBeNull();
    expect(interiorId(0x210, MB.NORMAL, 0xbeef, tables)).toBeNull();
  });
  it('maps the interaction behaviours', () => {
    expect([MB.SHOP_SHELF, MB.PICTURE_BOOK_SHELF, MB.POKEMON_CENTER_BOOKSHELF, MB.COUNTER, MB.REGION_MAP, MB.SOUTH_ARROW_WARP]
      .map((b) => BEHAVIOR_IDS.get(b))).toEqual(['martShelf', 'bookshelf', 'bookshelf', 'counter', 'decor', 'mat']);
  });
  it('has one table per in-scope tileset, labelling secondary ids with known ids only', () => {
    expect([...INTERIOR_TABLES.keys()].sort()).toEqual([...INTERIOR_TILESETS].sort());
    const known = new Set<string>([...FURNITURE_KINDS, ...FLOOR_KINDS, ...WALL_PARTS, 'legacy']);
    for (const t of INTERIOR_TABLES.values()) for (const [m, id] of t.ids) {
      expect(m >= 0x200 && m < 0x400).toBe(true); expect(known.has(id)).toBe(true);
    }
  });
  it('lists the furniture kinds in the union order', () => {
    expect(FURNITURE_KINDS).toEqual(['bed', 'table', 'chair', 'tv', 'pc', 'bookshelf', 'plant', 'fridge', 'sink', 'cabinet',
      'crate', 'trashCan', 'vase', 'counter', 'healer', 'pcCounter', 'martShelf', 'stairsUp', 'stairsDown']);
  });
  it('serves seeded ids for an analysis', () => {
    const a = fakeAnalysis(['..', '..']), ids = ['rug', null, 'table', 'mat'] as const;
    const seeded = Array.from({ length: a.N }, (_, i) => ids[i % 4]);
    seedInteriorIds(a, seeded);
    expect(interiorIds(a)).toBe(seeded);
  });
  it('scopes interiors', () => {
    const o = { indoor: true, primaryTileset: SYM.gTileset_Building, secondaryTileset: SYM.gTileset_PokemonCenter };
    expect(interiorScope(o)).toBe(true);
    expect(interiorScope({ ...o, indoor: false })).toBe(false);
    expect(interiorScope({ ...o, secondaryTileset: 0 })).toBe(false);
    expect(interiorScope({ ...o, primaryTileset: SYM.gTileset_General })).toBe(false);
  });
});
```

  and `tests/smoke/interiorTables.test.ts`: over `loadAllMaps`, the in-scope maps (`interiorScope(loadStaticMap(g, n).opts)`)
  must number exactly **138** and include 1.0, 2.2, 2.4, 1.4 and exclude 8.1 (Petalburg Gym); per tileset, the
  table-labelled share of in-map non-void cells (an id the secondary table or `BUILDING_PRIMARY` labels, `legacy`
  included; the behaviour fallback does **not** count) ≥ that table's `target`, the fallback's share reported beside it;
  every pin reads as its id; no table label contradicts `BEHAVIOR_IDS` on a used id whose behaviour is TELEVISION, PC,
  BOOKSHELF, PICTURE_BOOK_SHELF, POKEMON_CENTER_BOOKSHELF or SHOP_SHELF (labelled exactly that kind, or unlabelled);
  writes `out/interior-ids.txt`.
- [ ] **Step 2: Run** both → FAIL (modules missing).
- [ ] **Step 3: Implement**; `npm run symbols`.
- [ ] **Step 4: Run** both, `npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/golden.test.ts
  tests/smoke/semantics.test.ts` (unchanged) → PASS — after the group-A join (Parallel execution rule 3; until then only
  the two new tests). Read `out/interior-ids.txt` and report the used-id count per tileset; copy it to
  `out/interior-ids.task3.txt`, the curators' fixed worklist (group B's smoke runs rewrite `out/interior-ids.txt`).
- [ ] **Step 5: Commit** — `git add tools/gen-symbols.ts src/game/symbols.ts src/render/overworld/analyze.ts
  src/render/overworld/overworldView.ts tests/smoke/helpers/staticMap.ts src/render/kit/tables src/render/kit/interior/scope.ts
  tests/kitInteriorTables.test.ts tests/smoke/interiorTables.test.ts && git commit -m "feat(kit): interior scope, Building
  tileset ids, behaviour fallback, table scaffold and id report" -- <the same paths>` (pathspec commit)

**Gates:** no rendering change (Retro/Modern 0.00 % on `--only i_house_1f,i_pc_1f,r101`, run after the group-A join).
Programs unchanged.
**Acceptance:** 138 in-scope maps; the worklist exists.

---

### Task 4 (group B, three parallel agents): Curate the secondary tables

- **4a:** `tables/interior/genericBuilding.ts` (73 maps). **4b:** `pokemonCenter.ts` + `shop.ts` (57 maps).
  **4c:** `brendansMaysHouse.ts` + `lab.ts` (8 maps). Each agent owns only its files.

**Interfaces:** Consumes `InteriorTable`, `InteriorId` (Task 3). Produces filled tables (`target: 0.97`, ≥ 6 pins per
tileset, at least one per FurnitureKind the tileset draws).

- [ ] **Step 1: Sheets and maps.** `npx tsx tools/map-atlas.ts --no-maps --sheet-only <Name> --sheet-scale 5
  --sheet-chunk 32` (label, layer and behaviour above each metatile; both layers | top only) and the map renders in
  `out/atlas/<g>_<n>_<Name>.png`; worklist `out/interior-ids.task3.txt` (Task 3's copy: the other curators' smoke runs
  rewrite `out/interior-ids.txt` while you work).
- [ ] **Step 2: Label by these rules.** Every used id gets an `InteriorId`; a multi-cell object labels **all** its cells
  with its kind (a bed's head and foot, a table's four quarters, a counter's top and front rows); wall-art rows: `wall`
  (paint, wainscot, skirting), `window`, `clock`, `decor` (posters, pictures, maps, calendars, shelves painted flat on the
  wall); walkable floors `boards` / `tiles` / `carpet`, rugs `rug`, mats `mat`; floor art no family can draw (the Pokémon
  Center's Poké Ball inlay, emblems) and anything doubtful `legacy`. An id whose meaning differs between maps is `legacy`
  — **except** an id whose behaviour is TELEVISION, PC, BOOKSHELF, PICTURE_BOOK_SHELF, POKEMON_CENTER_BOOKSHELF or
  SHOP_SHELF: it is labelled exactly its `BEHAVIOR_IDS` kind or left unlabelled (the fallback gives it that kind), never
  `legacy` or another kind (Task 3's smoke checks it; Task 12 models every such cell as its kind).
- [ ] **Step 3: Pins.** Add pins read off the map renders (e.g. 4b: Oldale PC 1F's healing machine, nurse counter,
  PC, plant, floor tile, exit mat; Oldale Mart's shelves, counter; 4c: Brendan's 1F table, chairs, rug, stairs, TV,
  window; Brendan's 2F bed, PC; Birch's lab bookshelf).
- [ ] **Step 4: Run** `npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/interiorTables.test.ts`
  → PASS for the agent's tilesets (others may still be at target 0).
- [ ] **Step 5: Commit** — `git commit -m "data(kit): <tileset> interior table" -- src/render/kit/tables/interior/<own
  files>` (pathspec commit, one agent at a time).

**Acceptance:** each table ≥ 97 % of its maps' in-map non-void cells labelled; pins pass; the report lists the ids left
`legacy` and why.

---

### Task 5 (group B): Room layout and colour sampling (pure)

**Files:**
- Create: `src/render/kit/interior/room.ts`, `src/render/kit/interior/colors.ts`, `tests/helpers/fakeInterior.ts`,
  `tests/interiorRoom.test.ts`, `tests/interiorColors.test.ts`

**Interfaces:**
- Consumes: `InteriorId`, `interiorId`, `seedInteriorIds` (Task 3), `GridWarp` (`kit/events.ts`), `ShellColors` (Task 2).
- Produces (`room.ts`):
  ```ts
  export const RECESS = 0.5;     // the back wall's inner face this far north of the back line
  export const WALL_H = 2.6;     // wall height over the room floor
  export const WALL_T = 0.3;     // wall thickness (outwards)
  export const BAND_MAX = 3;     // at most this many wall-art rows under the void
  export type WallDir = 'N' | 'E' | 'S' | 'W';   // the side of the room the wall closes (N = back wall, looks south)
  /** A straight wall: its inner face on `line` (world z for N/S, world x for E/W), from `from` to `to` along the other axis. */
  export interface WallRun { dir: WallDir; line: number; from: number; to: number; floorY: number }
  /** Wall art on a back wall: columns [x0, x1), art rows row0..row1 (0 = the band's top) of a band `rows` tall. */
  export interface WallFeature { kind: 'window' | 'clock' | 'decor'; x0: number; x1: number; row0: number; row1: number; rows: number; cells: number[] }
  /** An exit's opening in the wall of direction `dir`: on its run's `line`, from `from` to `to` along the run. */
  export interface DoorGap { dir: WallDir; line: number; from: number; to: number }
  export interface RoomLayout {
    rooms: number;
    inside: Uint8Array;    // per analysis cell: room floor area (walkable, furniture, stairs, mats)
    band: Uint8Array;      // per cell: back-wall art (non-void, above the back line)
    backLine: Int32Array;  // per column (x − a.minX): grid row of the first room row of its northernmost room; −1 none
    runs: WallRun[]; features: WallFeature[]; doors: DoorGap[];
    floorTile: number;     // the most common walkable floor metatile (boards / tiles / carpet)
  }
  export function roomLayout(a: MapAnalysis, ids: readonly (InteriorId | null)[], warps: readonly GridWarp[]): RoomLayout;  // memoised per analysis
  /** Invariant findings (empty = sound): a run crossing a walkable cell, an inside boundary edge without a run, a run
   *  with from ≥ to, a door not on a run of its own direction and line. */
  export function checkRoomLayout(a: MapAnalysis, L: RoomLayout): string[];
  /** A window feature's glass rectangle on its back wall (shared by the shell's window and the floor family's shaft):
   *  x centred on the feature, width x1 − x0 − 0.3; its art rows stretched over 0.2 … WALL_H − 0.3:
   *  y0 = 0.2 + (row0 / rows)·(WALL_H − 0.5), y1 = 0.2 + ((row1 + 1) / rows)·(WALL_H − 0.5); z = the N run's line there. */
  export function windowRect(L: RoomLayout, f: WallFeature): { x0: number; x1: number; y0: number; y1: number; z: number };
  ```
  Rules: per column, each maximal non-void vertical segment [t, b]: its back line is the first walkable row in
  [t, min(b, t + BAND_MAX)], else t + (the room's mode band height). A column whose band is deeper than its room's mode
  takes the mode when its extra rows (those below the mode) carry furniture ids (the furniture stands on the floor, as a
  bookcase drawn in and below the wall rows); deeper rows of wall art (`wall` / `window` / `clock` / `decor` ids) keep
  the column's own back line (the back wall steps forward there). Rows t … backLine − 1 are band, the rest inside.
  Boundary edges between inside and non-inside cells become runs (merged when collinear and adjacent): N at
  z = row − RECESS, S at z = row + 1, W at x, E at x + 1; an E/W run beside band cells spans from its own N line to the
  neighbouring column's N line (alcove jogs). Features group band cells of one id in one row-run, merged downward. Door
  gaps: warp cells that are `mat` on a room's boundary: on its bottom row → `S` (line = row + 1, from x to x + 1); an
  EAST / WEST / NORTH_ARROW_WARP mat on its east / west column or top row → `E` / `W` / `N` on that side's run (from / to
  = the cell's extent along the run); adjacent mat cells on one run merge.
- Produces (`colors.ts`):
  ```ts
  export interface PartColors { main: RGB; second: RGB; accent: RGB; dark: RGB }   // sRGB
  /** main: most frequent lit colour (luma ≥ 0.2) of the metatiles' pixels; second: the next most frequent with a channel
   *  ≥ 0.1 from main (else main); accent: the most saturated colour (saturation ≥ 0.3) with ≥ 6 px (else second); dark:
   *  the most frequent with luma < 0.2 (else main × 0.5). */
  export function partColors(info: TileInfo, metatiles: readonly number[], layer?: 'both' | 'bottom'): PartColors;
  /** A back wall's colours: wall = main of its `wall` cells' top rows, wainscot = main of the band's lowest row's `wall`
   *  cells, base = wainscot × 0.6, panel = wainscot × 1.05, trim = mix(wall, white, 0.5); soften()ed. */
  export function wallColors(a: MapAnalysis, L: RoomLayout, ids: readonly (InteriorId | null)[]): ShellColors;
  export function floorLook(info: TileInfo, m: number): { tint: RGB };              // main of the bottom layer, soften()ed
  ```
- Produces (`tests/helpers/fakeInterior.ts`): `fakeInterior(rows: string[], legend?: Record<string, { mt: number;
  blocked: boolean; beh?: number; id: InteriorId | null }>): { a: MapAnalysis; ids: (InteriorId | null)[] }` — an indoor
  analysis (margin 1, border = void metatile 1 with `isVoid`), ids from the legend, **seeded** with
  `seedInteriorIds(a, ids)` so the families' `extract` sees them through `interiorIds(a)`. Default legend: `' '` void, `W`
  wall, `O` window, `C` clock, `D` decor, `.` boards, `r` rug, `T` table, `c` chair, `B` bookshelf, `F` fridge, `M` mat (beh
  `SOUTH_ARROW_WARP`), `E` mat (beh `EAST_ARROW_WARP`), `S` stairsUp (walkable), `s` stairsDown (walkable), `?` unknown
  blocked.

- [ ] **Step 1: Write the failing tests** `tests/interiorRoom.test.ts`:

```ts
import { roomLayout, checkRoomLayout, windowRect, RECESS, WALL_H } from '../src/render/kit/interior/room';
import { fakeInterior } from './helpers/fakeInterior';
const HOUSE = [
  '          ',
  ' WWOOWWWW ',
  ' WWOOWFWW ',
  ' ........ ',
  ' ..TT.... ',
  ' ..TT..rr ',
  ' ......rr ',
  ' ....M... ',
  '          ',
];
const runs = (L: ReturnType<typeof roomLayout>, d: string) => L.runs.filter((r) => r.dir === d);
describe('room layout', () => {
  it('closes a rectangular room: back wall in the recess, sides, front, a door, a window', () => {
    const { a, ids } = fakeInterior(HOUSE);
    const L = roomLayout(a, ids, [{ x: 5, y: 7, dest: 'LITTLEROOT_TOWN' }]);
    expect(L.rooms).toBe(1);
    expect(runs(L, 'N')).toEqual([{ dir: 'N', line: 3 - RECESS, from: 1, to: 9, floorY: 0 }]);
    expect(runs(L, 'S')).toEqual([{ dir: 'S', line: 8, from: 1, to: 9, floorY: 0 }]);
    expect(runs(L, 'W')).toEqual([{ dir: 'W', line: 1, from: 3 - RECESS, to: 8, floorY: 0 }]);
    expect(runs(L, 'E')).toEqual([{ dir: 'E', line: 9, from: 3 - RECESS, to: 8, floorY: 0 }]);
    expect(L.doors).toEqual([{ dir: 'S', line: 8, from: 5, to: 6 }]);
    expect(L.features).toEqual([expect.objectContaining({ kind: 'window', x0: 3, x1: 5, row0: 0, row1: 1, rows: 2 })]);
    const w = windowRect(L, L.features[0]);
    expect(w.x0).toBeCloseTo(3.15, 5); expect(w.x1).toBeCloseTo(4.85, 5); expect(w.y0).toBeCloseTo(0.2, 5);
    expect(w.y1).toBeCloseTo(0.2 + WALL_H - 0.5, 5); expect(w.z).toBeCloseTo(3 - RECESS, 5);
    expect(L.band[a.idx(6, 2)]).toBe(1);            // the fridge stands in the band (furniture claims it first)
    expect(L.inside[a.idx(3, 4)]).toBe(1);
    expect(checkRoomLayout(a, L)).toEqual([]);
  });
  it('opens an alcove where stairs cut the back wall', () => {
    const { a, ids } = fakeInterior(['          ', ' WWWWWSWW ', ' WWWWWSWW ', ' ........ ', ' ........ ', '          ']);
    const L = roomLayout(a, ids, []);
    expect(runs(L, 'N').map((r) => [r.line, r.from, r.to])).toEqual([[3 - RECESS, 1, 6], [1 - RECESS, 6, 7], [3 - RECESS, 7, 9]]);
    expect(runs(L, 'W')).toContainEqual({ dir: 'W', line: 6, from: 1 - RECESS, to: 3 - RECESS, floorY: 0 });
    expect(runs(L, 'E')).toContainEqual({ dir: 'E', line: 7, from: 1 - RECESS, to: 3 - RECESS, floorY: 0 });
    expect(checkRoomLayout(a, L)).toEqual([]);
  });
  it('keeps the back wall straight over a bookshelf running below the band', () => {
    const { a, ids } = fakeInterior(['        ', ' WWBWW ', ' WWBWW ', ' ..B.. ', ' ..... ', '        '].map((r) => r.padEnd(8)));
    const L = roomLayout(a, ids, []);
    expect(runs(L, 'N')).toHaveLength(1);           // column 3's band is one row deeper than the mode: furniture → the mode
    expect(L.inside[a.idx(3, 3)]).toBe(1);          // the shelf's lower row is room (furniture on the floor)
  });
  it('steps the back wall forward where wall art runs deeper than the band', () => {
    const { a, ids } = fakeInterior(['       ', ' WWWWW ', ' WWOWW ', ' ..O.. ', ' ..... ', '       ']);
    const L = roomLayout(a, ids, []);
    expect(runs(L, 'N').map((r) => [r.line, r.from, r.to])).toEqual([[3 - RECESS, 1, 3], [4 - RECESS, 3, 4], [3 - RECESS, 4, 6]]);
    expect(L.band[a.idx(3, 3)]).toBe(1);
    expect(checkRoomLayout(a, L)).toEqual([]);
  });
  it('cuts a door into a side wall for an arrow-warp mat', () => {
    const { a, ids } = fakeInterior(['        ', ' WWWWWW ', ' .....E ', ' ...... ', '        ']);
    const L = roomLayout(a, ids, [{ x: 6, y: 2, dest: 'ROUTE_110' }]);
    expect(L.doors).toEqual([{ dir: 'E', line: 7, from: 2, to: 3 }]);
    expect(checkRoomLayout(a, L)).toEqual([]);
  });
  it('separates two rooms divided by void', () => {
    const { a, ids } = fakeInterior(['         ', ' WWW WWW ', ' ... ... ', ' ... ... ', '         ']);
    const L = roomLayout(a, ids, []);
    expect(L.rooms).toBe(2);
    expect(runs(L, 'N')).toHaveLength(2);
    expect(checkRoomLayout(a, L)).toEqual([]);
  });
});
```

  and `tests/interiorColors.test.ts` (paint metatile 0x230 in a `fakeInfo()`: rows 0–2 red (31,4,4) = 48 px, rows 3–11
  brown (18,10,4) except column 0 = 135 px, rows 12–15 tan (28,24,16) except column 0 = 60 px, column 0 rows 3–15 outline
  (2,2,3) = 13 px):

```ts
it('takes main, second, accent and dark colours', () => {
  const c = partColors(info, [0x230]);
  expect(c).toEqual({ main: bgr555ToSrgb(BROWN), second: bgr555ToSrgb(TAN), accent: bgr555ToSrgb(RED), dark: bgr555ToSrgb(OUTLINE) });
});
it('falls back when a part has no accent or no outline', () => {
  const c = partColors(plainInfo, [0x231]);            // one colour only
  expect(c.second).toEqual(c.main); expect(c.accent).toEqual(c.main); expect(c.dark).toEqual(scale(c.main, 0.5));
});
```

- [ ] **Step 2: Run** `npx vitest run tests/interiorRoom.test.ts tests/interiorColors.test.ts` → FAIL.
- [ ] **Step 3: Implement** `room.ts`, `colors.ts`, `fakeInterior.ts`.
- [ ] **Step 4: Run** → PASS. After the group-B join (the tables final), run `roomLayout` + `checkRoomLayout` over the 138
  maps from a scratch script (unknown ids allowed) and report the findings (Task 12 pins zero).
- [ ] **Step 5: Commit** — `git add src/render/kit/interior/room.ts src/render/kit/interior/colors.ts tests/helpers/fakeInterior.ts
  tests/interiorRoom.test.ts tests/interiorColors.test.ts && git commit -m "feat(kit): interior room layout (wall band, back
  line, runs, windows, doors) and part colours" -- <the same paths>` (pathspec commit)

**Acceptance:** tests pass; the scratch run's findings listed in the report.

---

### Task 6: Interior integration — families on in-scope maps, furniture core, cutaway, catalogue plumbing

**Files:**
- Create: `src/render/kit/interior/index.ts`, `cutaway.ts`, `furniture.ts`, stubs `shell.ts`, `floors.ts`,
  `shafts.ts`, `furnitureHome.ts`, `furnitureService.ts` (families named `shell` / `floor` that claim nothing, empty
  catalogues, empty generator maps), `tests/interiorCutaway.test.ts`, `tests/interiorFurniture.test.ts`,
  `tests/helpers/furniture.ts`, `tests/smoke/interiorWorld.test.ts`
- Modify: `src/render/overworld/world.ts`, `src/render/overworld/overworldView.ts`, `src/render/overworld/timeOfDay.ts`,
  `src/render/kit/materials.ts`, `src/render/kit/glow.ts`, `src/render/kit/catalogue.ts`, `src/render/preview.ts`,
  `tests/timeOfDay.test.ts`, `tests/smoke/semantics.test.ts` and `tests/kitRun.test.ts` (wording only: "indoor maps are
  left to legacy" / "never on indoor maps" now hold for the outdoor families and for indoor maps out of the interior scope;
  their assertions are unchanged)

**Interfaces:**
- Consumes: Tasks 2, 3, 5.
- Produces (`index.ts`): `furnitureFamily = furnitureFamilyWith({ ...HOME_GENERATORS, ...SERVICE_GENERATORS })` (composed
  **here**: `furniture.ts` never imports the generator modules, which import it — no import cycle);
  `INTERIOR_FAMILIES: readonly Family<unknown>[] = [furnitureFamily, shellFamily, floorFamily]`;
  `interface InteriorCatalogueEntry { material: KitMaterialOptions; attrs: Record<string, number>; castShadow: boolean }`;
  `INTERIOR_CATALOGUE = [...SHELL_CATALOGUE, ...FLOOR_CATALOGUE]` — `worldCatalogue` adds one
  `kit(e.material, e.attrs, e.castShadow)` per entry (deduplicated by signature as today). `FURNITURE_CATALOGUE` joins it
  at the group-C join (controller edit, once Tasks 9/10 draw it: before that its entries would be "drawn on no map" in the
  drift guard).
- Produces (`world.ts`): `World` constructor `(atlas, materials, uniforms, families = FAMILIES, interiorFamilies =
  INTERIOR_FAMILIES)`; `WorldBuildContext.interiorKit?: boolean` (default true); the kit runs when Modern, not underground,
  and either outdoor (`families`) or `interiorScope(opts) && interiorKit` (`interiorFamilies`); `interiorKitRan: boolean`
  (the interior families ran on the last build — Modern, in scope, kit on — even if one of them failed: read by
  `updateLighting` for D8 and by Task 11 for the HD legacy materials); `setFailFamily(name: string | null)` (the named
  family's extract throws: the harness's and tests' failure path); `updateCutaway(camBack: THREE.Vector2)` sets
  `visible = wallVisible(mesh.userData.wallDir, camBack)` on every kit mesh carrying `userData.wallDir`.
- Produces (`timeOfDay.ts`, D8, pure):
  ```ts
  export interface IndoorLight { sunColor: THREE.Color; sunI: number; sky: THREE.Color; ground: THREE.Color; hemiI: number }
  /** Today's indoor values (updateLighting's indoor branch, moved here unchanged): sun (1, 0.95, 0.85) × 1.5, sky
   *  (1, 0.97, 0.92), ground (0.55, 0.5, 0.45), hemisphere × 1.7. */
  export const INDOOR_DAY: Readonly<IndoorLight>;
  /** The lamp-lit night (starting values, tuned in Step 6): sun (1, 0.72, 0.45) × 0.6, sky (0.95, 0.78, 0.6), ground
   *  (0.4, 0.32, 0.26), hemisphere × 1.0. */
  export const INDOOR_NIGHT: Readonly<IndoorLight>;
  /** INDOOR_DAY blended towards INDOOR_NIGHT by nightK (0..1), into `out`; nightK = 0 returns INDOOR_DAY's values exactly. */
  export function indoorLight(nightK: number, out?: IndoorLight): IndoorLight;
  /** The actors' light floor at night, as a share of the day charLight (D8; starting value). */
  export const ACTOR_NIGHT_FLOOR = 0.95;
  ```
- Produces (`overworldView.ts`): `setInteriorKit(on: boolean)` (rebuild on next sync, like `setWorldStyle`);
  `setFailFamily(name: string | null)` (pass-through to the private `world`); calls
  `world.updateCutaway(kitUniforms.uCamBack.value)` every `update`. In `updateLighting`, with
  `lit = worldStyle === 'modern' && world.interiorKitRan`: `kitUniforms.uOutdoorNight.value = lit ? nightFactor(hour) : 0`;
  when `lit`, the indoor branch takes `indoorLight(nightFactor(hour))` instead of its constants, and `charLight` = per
  channel max(the blended light's charLight, `ACTOR_NIGHT_FLOOR` × the charLight of `INDOOR_DAY`). Only the sun's and
  hemisphere's colour and intensity change: no exposure (the overworld has none), no new lights, the sun's direction stays
  as today (`tod = 12` indoors), `uNight` stays 0 indoors. When not `lit` (Retro, out of scope, kit off) every value is
  today's exactly.
- Produces (`materials.ts`): `KitUniforms.uOutdoorNight: { value: number }` (created 0, bound in `patchKit`'s uniform map;
  no shader declares it yet: every program unchanged); `KitMaterialOptions.blending?: THREE.Blending` (set by `configure`,
  default `NormalBlending`; not program-affecting, not in the pool key — the shafts' additive blend, Task 8).
- Produces (`glow.ts`): `glowMesh(uniforms, geometry, emissive, options: KitMaterialOptions = PROP_GLOW)` (the battle's
  calls unchanged; furniture passes `FURNITURE_GLOW_LOW` for low pieces).
- Produces (`preview.ts`): `&kitFail=<family>` → `view.setFailFamily`, parsed **before** the constructor's first
  `rebuild()`; `PreviewApp.setInteriorKit(on)` (rebuild now).
- Produces (`cutaway.ts`): `INNER_NORMAL: Record<WallDir, V2>` (N [0, 1], S [0, −1], W [1, 0], E [−1, 0]: into the room,
  x/z); `CUTAWAY_DOT = −0.25`; `wallVisible(dir: WallDir, camBack: { x: number; y: number }): boolean` =
  `INNER_NORMAL[dir] · camBack ≥ CUTAWAY_DOT`.
- Produces (`furniture.ts`):
  ```ts
  export interface FurnitureSpec { height: number; depth: number }   // real-world units; low = height ≤ 1.2 (no fade)
  export const FURNITURE_SPEC: Readonly<Record<FurnitureKind, FurnitureSpec>> = {
    bed: { height: 0.55, depth: 2.0 }, table: { height: 0.75, depth: 1.6 }, chair: { height: 0.9, depth: 0.6 },
    tv: { height: 1.1, depth: 0.5 }, pc: { height: 1.2, depth: 0.6 }, bookshelf: { height: 2.1, depth: 0.45 },
    plant: { height: 1.3, depth: 0.7 }, fridge: { height: 1.9, depth: 0.5 }, sink: { height: 0.95, depth: 0.5 },
    cabinet: { height: 1.0, depth: 0.5 }, crate: { height: 0.8, depth: 0.8 }, trashCan: { height: 0.6, depth: 0.5 },
    vase: { height: 0.6, depth: 0.5 }, counter: { height: 1.0, depth: 0.9 }, healer: { height: 1.3, depth: 0.8 },
    pcCounter: { height: 1.05, depth: 0.9 }, martShelf: { height: 1.6, depth: 1.4 }, stairsUp: { height: 1.6, depth: 1 },
    stairsDown: { height: 0, depth: 1 },
  };
  export const isLow = (k: FurnitureKind) => FURNITURE_SPEC[k].height <= 1.2;
  export interface Footprint { x0: number; x1: number; z0: number; z1: number; y: number; height: number }   // world
  /** Columns x0..x1, rows y0..y1 (inclusive) at floor height h: x [x0, x1 + 1]; z1 = y1 + 1 + h; z0 = max(z1 − min(spec.depth,
   *  rows), wallZ) — never behind `wallZ` (−Infinity when free-standing). */
  export function fitFurniture(kind: FurnitureKind, x0: number, x1: number, y0: number, y1: number, h: number, wallZ: number): Footprint;
  /** What stands against a back wall keeps this far in front of its inner face: the wall's relief (baseboard, rail) never
   *  shows through its back (= SHELF.back). The family passes wallZ = the N run's line + WALL_BACK. */
  export const WALL_BACK = SHELL.relief + 0.015;
  export interface FurniturePiece {
    kind: FurnitureKind; cells: number[];
    xy: [number, number][];      // the cells' grid coordinates, in `cells` order
    floorY: number;              // the floor height the piece stands on
    foot: Footprint;             // the component's bounding footprint
    cellFeet: Footprint[];       // one per cell (fitFurniture of that cell alone): non-rectangular components (L counters)
    facing: WallDir | null;      // chairs: towards the nearest table piece; stairs: the side they are entered from; else null
    colors: PartColors; seed: number;
  }
  /** Low pieces' screens and glass go into glowLow / glassLow (D7: they never fade). */
  export interface FurnitureOut { tall: Soup; low: Soup; glass: Soup; glow: Soup; glassLow: Soup; glowLow: Soup }
  export type FurnitureGenerator = (p: FurniturePiece, out: FurnitureOut, q: Quality) => void;
  export const FURNITURE_TALL: KitMaterialOptions;       // = BUILDING_BODY
  export const FURNITURE_LOW: KitMaterialOptions;        // { vertexColors: true, roughness: 0.8 } — no fade
  export const FURNITURE_GLASS: KitMaterialOptions;      // = BUILDING_GLASS
  export const FURNITURE_GLASS_LOW: KitMaterialOptions;  // { ...BUILDING_GLASS, fade: false }
  export const FURNITURE_GLOW_LOW: KitMaterialOptions;   // { ...PROP_GLOW, fade: false }
  /** Components: 4-connected cells of one furniture kind, cut at any cell whose id differs (unknown included). A component
   *  whose kind has a generator claims CLAIM_OBJECT (+ CLAIM_TOP where its art overhangs into the cell north of it, same id),
   *  with groundMt = the room's floorTile; one without stays legacy. Ids through interiorIds(a) only. */
  export function furnitureFamilyWith(generators: Partial<Record<FurnitureKind, FurnitureGenerator>>): Family<FurniturePiece[]>;
  /** TALL / LOW / GLASS / GLASS_LOW on PNC, cast; PROP_GLOW and FURNITURE_GLOW_LOW on PNC, no cast (glowMesh). */
  export const FURNITURE_CATALOGUE: readonly InteriorCatalogueEntry[];
  ```
  The family's build merges each non-empty Soup into one mesh (`tall` FURNITURE_TALL, `low` FURNITURE_LOW, `glass`
  FURNITURE_GLASS, `glassLow` FURNITURE_GLASS_LOW: cast + receive shadows; `glow` via `glowMesh`, `glowLow` via
  `glowMesh(…, FURNITURE_GLOW_LOW)`: receive only, no cast — as the catalogue). An empty Soup makes no mesh.
- Produces (`tests/helpers/furniture.ts`, shared by Tasks 9 and 10): `piece(kind, overrides?)` (foot = `fitFurniture(kind,
  2, 3, 4, 5, 0, -Infinity)`, `cellFeet` its four cells, test colours), `newOut()`, `boxOf(out)` (all six soups),
  `run(generators, kind, q = 'medium', overrides?)` (a fresh `newOut()` filled by `generators[kind](piece(kind, overrides))`),
  `hashOut(out)`, `tris(out)`, `countClusters(soup, srgb)` (vertices whose colour
  equals `lin(srgb)` within 1e-3; their triangles grouped into clusters that share vertex positions).

- [ ] **Step 1: Write the failing tests** `tests/interiorCutaway.test.ts`:

```ts
const back = (yaw: number) => ({ x: Math.sin(yaw), y: Math.cos(yaw) });
const shown = (yaw: number) => (['N', 'E', 'S', 'W'] as const).filter((d) => wallVisible(d, back(yaw)));
it('hides the walls the camera sees from outside', () => {
  expect(shown(0)).toEqual(['N', 'E', 'W']);
  expect(shown(Math.PI / 2)).toEqual(['N', 'S', 'W']);
  expect(shown((3 * Math.PI) / 4)).toEqual(['S', 'W']);
  expect(shown(Math.PI)).toEqual(['E', 'S', 'W']);
});
```

  `tests/interiorFurniture.test.ts`:

```ts
it('anchors a free table at the south edge of its cells', () => {
  expect(fitFurniture('table', 3, 4, 5, 6, 0, -Infinity)).toEqual({ x0: 3, x1: 5, z0: 7 - 1.6, z1: 7, y: 0, height: 0.75 });
});
it('keeps furniture in the wall band in front of the wall and its relief', () => {
  const f = fitFurniture('fridge', 6, 6, 1, 2, 0, 3 - RECESS + WALL_BACK);
  expect(f.z0).toBeCloseTo(2.59, 5); expect(f).toMatchObject({ z1: 3, height: 1.9 });
});
it('never fades low furniture, its screens and glass included', () => {
  expect(FURNITURE_KINDS.filter(isLow)).toEqual(['bed', 'table', 'chair', 'tv', 'pc', 'sink', 'cabinet', 'crate', 'trashCan',
    'vase', 'counter', 'pcCounter', 'stairsDown']);
  expect(FURNITURE_LOW.fade).toBeFalsy(); expect(FURNITURE_TALL.fade).toBe(true);
  expect(FURNITURE_GLASS_LOW.fade).toBeFalsy(); expect(FURNITURE_GLOW_LOW.fade).toBeFalsy();
});
it('gives a piece its cells, per-cell footprints and a chair its facing', () => {
  const { a } = fakeInterior(['        ', ' WWWWWW ', ' ...... ', ' .cTT.. ', ' ...... ', '        ']);
  const stub = (p: FurniturePiece, o: FurnitureOut) => o.low.quad([p.foot.x0, 0, p.foot.z0], [p.foot.x1, 0, p.foot.z0],
    [p.foot.x1, 0, p.foot.z1], [p.foot.x0, 0, p.foot.z1], [0, 1, 0], [1, 1, 1]);
  const pieces = furnitureFamilyWith({ table: stub, chair: stub }).extract({ a, events: NO_EVENTS, quality: 'medium' }, new Claims(a.N));
  const table = pieces.find((p) => p.kind === 'table')!, chair = pieces.find((p) => p.kind === 'chair')!;
  expect(table.xy).toEqual([[3, 3], [4, 3]]); expect(table.cellFeet).toHaveLength(2); expect(table.floorY).toBe(0);
  expect(chair.facing).toBe('E'); expect(table.facing).toBeNull();
});
it('cuts a component at an unknown cell and leaves kinds without a generator to legacy', () => {
  const { a, ids } = fakeInterior(['        ', ' WWWWWW ', ' .TT?T. ', ' ...... ', '        ']);
  const gen = vi.fn((p: FurniturePiece, o: FurnitureOut) => o.low.quad([p.foot.x0, 0, p.foot.z0], [p.foot.x1, 0, p.foot.z0],
    [p.foot.x1, 0, p.foot.z1], [p.foot.x0, 0, p.foot.z1], [0, 1, 0], [1, 1, 1]));
  const fam = furnitureFamilyWith({ table: gen });
  const claims = new Claims(a.N), pieces = fam.extract({ a, events: NO_EVENTS, quality: 'medium' }, claims);
  expect(pieces.map((p) => p.cells.length)).toEqual([2, 1]);             // TT | T, the ? stays legacy
  expect(claims.has(a.idx(4, 2), CLAIM_OBJECT)).toBe(false);
  expect(furnitureFamilyWith({}).extract({ a, events: NO_EVENTS, quality: 'medium' }, new Claims(a.N))).toEqual([]);
});
```

  `tests/smoke/interiorWorld.test.ts`:

```ts
const report = (g: number, n: number, style: WorldStyle, interiorKit = true) => {
  const s = loadStaticMap(g, n);
  world.build(s.grid, s.opts, { style, events: gridEvents(s.map.events, 0), quality: 'medium', mapKey: `${g}.${n}`, interiorKit });
  return world.kitReport.map((r) => `${r.name}:${r.ok}`);
};
it('runs the interior families on in-scope interiors in Modern only', () => {
  expect(report(2, 2, 'modern')).toEqual(['furniture:true', 'shell:true', 'floor:true']);
  expect(world.interiorKitRan).toBe(true);
  expect(report(2, 2, 'retro')).toEqual([]);
  expect(world.interiorKitRan).toBe(false);
  expect(report(2, 2, 'modern', false)).toEqual([]);
  expect(world.interiorKitRan).toBe(false);
  expect(report(8, 1, 'modern')).toEqual([]);                 // Petalburg Gym: out of scope
  expect(report(0, 10, 'modern')).toContain('terrain:true');  // outdoors as before
});
it('rolls a failing interior family back, warning once per map', () => {
  world.setFailFamily('furniture');
  expect(report(2, 2, 'modern')).toEqual(['furniture:false', 'shell:true', 'floor:true']);
  report(2, 2, 'modern');
  expect(warn.mock.calls.filter((c) => String(c[0]).includes('furniture failed'))).toHaveLength(1);
  world.setFailFamily(null);
});
```

  and in `tests/timeOfDay.test.ts` (D8):

```ts
it('lights a room as today at day and blends to the lamp-lit night', () => {
  const day = indoorLight(0);
  expect(day.sunColor.equals(new THREE.Color(1.0, 0.95, 0.85))).toBe(true); expect(day.sunI).toBe(1.5);
  expect(day.sky.equals(new THREE.Color(1.0, 0.97, 0.92))).toBe(true); expect(day.ground.equals(new THREE.Color(0.55, 0.5, 0.45))).toBe(true);
  expect(day.hemiI).toBe(1.7);                                          // today's indoor constants, bit for bit
  const night = indoorLight(1);
  expect(night.sunI).toBe(INDOOR_NIGHT.sunI); expect(night.hemiI).toBe(INDOOR_NIGHT.hemiI);
  expect(night.sunI).toBeLessThan(day.sunI); expect(night.hemiI).toBeLessThan(day.hemiI);
  expect(indoorLight(0.5).sunI).toBeCloseTo((day.sunI + night.sunI) / 2, 6);
});
```

- [ ] **Step 2: Run** them → FAIL.
- [ ] **Step 3: Implement** the above (stubs export the names Tasks 7–11 fill: `shellFamily`, `SHELL_CATALOGUE`,
  `floorFamily`, `FLOOR_CATALOGUE`, `roomShaftMaterial`/`shaftGeometry` placeholders, `HOME_GENERATORS = {}`,
  `SERVICE_GENERATORS = {}`; `updateLighting`'s indoor branch reads `INDOOR_DAY` / `indoorLight`; reword the two stale
  test descriptions).
- [ ] **Step 4: Run** the tests, `tests/smoke/catalogue.test.ts`, `golden`, `semantics` → PASS; `npx tsc --noEmit && npm test`.
- [ ] **Step 5: Gate.** `npm run regress:live -- --label t6 --static --compare p4-base` → 0.00 % in both styles on every
  entry **except** the Modern side of the in-scope night entries (`i_pc_night`, `i_house_night`, `i_lab_night`,
  `i_mart_night`, and any live in-scope entry Task 1 recorded at night), which D8 changes: they pass `nightLum` (room
  ≥ 0.45, actors 0.9–1.15 of their day twin). Everything else — the day interiors (no generator, no shell, no floor yet:
  in-scope interiors still legacy; `i_house_fail` too), `i_gym_night`, every Retro entry — is 0.00 %; `door_enter`,
  `door_exit` pass their gate.
- [ ] **Step 6: Look (D8).** `npm run regress:live -- --label t6 --interiors --review --review-before p4-base` on the night
  twins: the rooms warm and dimmed at night but readable, actors as bright as by day (the floor), nothing else changed;
  tune `INDOOR_NIGHT` and `ACTOR_NIGHT_FLOOR` until `nightLum` holds with margin, and report the numbers.
- [ ] **Step 7: Commit** — `git add src/render/kit/interior src/render/overworld/world.ts src/render/overworld/overworldView.ts
  src/render/overworld/timeOfDay.ts src/render/kit/materials.ts src/render/kit/glow.ts src/render/kit/catalogue.ts
  src/render/preview.ts tests/interiorCutaway.test.ts tests/interiorFurniture.test.ts tests/helpers/furniture.ts
  tests/timeOfDay.test.ts tests/smoke/interiorWorld.test.ts tests/smoke/semantics.test.ts tests/kitRun.test.ts && git commit
  -m "feat(world): interior families on in-scope interiors, furniture core and fitting, cutaway, outdoor-night uniform,
  indoor light follows the clock, failure hook"`

**Gates:** as Step 5 (0.00 % everywhere but the Modern in-scope night entries, which pass `nightLum`); drift guards pass;
programs constant.
**Acceptance:** the plumbing is in, the room light follows the clock; Tasks 7–11 only fill their own modules.

---

### Task 7 (group C): Room shell — walls, windows, clocks, decals, doorways

**Files:**
- Modify (own): `src/render/kit/interior/shell.ts`
- Create: `tests/interiorShell.test.ts`

**Interfaces:**
- Consumes: `wallPath` (with `ends`), `shellProfile` (with `thick`), `maxProfileDepth`, `shellPalette`, `addWindow`,
  `wallFrameAt`, `WINDOW` (Task 2); `roomLayout`, `windowRect`, `RECESS`, `WALL_H`, `WALL_T`, `WallRun`, `WallFeature`,
  `DoorGap` (Task 5); `wallColors`, `partColors` (Task 5); `INNER_NORMAL` (Task 6); `KitUniforms.uOutdoorNight` (Task 6,
  D8); `facadeMaterial` + `scale4x` (kit/buildings.ts, kit/upscale.ts); `interiorIds`.
- Produces:
  ```ts
  /** Window glass seen from inside: its vertex colours (a sky gradient) turned towards night blue by uOutdoorNight (D8). */
  export const ROOM_GLASS: KitMaterialOptions;            // vertexColors, roughness 0.15, fade, hookKey 'roomGlass'
  export function clockGeometry(radius: number, face: RGB, rim: RGB): THREE.BufferGeometry;   // PNC, a round wall clock
  export const shellFamily: Family<ShellPlacement>;        // extract: claims band cells CLAIM_OBJECT | CLAIM_TOP (groundMt = floorTile)
  export interface ShellPlacement { layout: RoomLayout; colors: ShellColors; decals: WallFeature[] }
  export const SHELL_CATALOGUE: readonly InteriorCatalogueEntry[];  // BUILDING_BODY PNC cast; ROOM_GLASS PNC cast
  ```
  Build (every mesh carries `userData.wallDir`, so the cutaway hides it with its wall): per `WallDir` one `BUILDING_BODY`
  mesh `walls<Dir>` holding only the wall profile — each run a `wallPath` of one segment, `caps: true`, `ends` = for each
  end the `INNER_NORMAL` of the run of the other axis that meets it at that corner (mitred there, its cap on the mitre
  plane), `null` where none does (door gaps, alcove ends: square caps); profile `shellProfile(WALL_H, SHELL.wainscot,
  WALL_T)`, colours `wallColors`. Per `WallDir` one `BUILDING_BODY` mesh `fixtures<Dir>`: window casings and sills
  (`addWindow` at `windowRect(L, f)`), clocks (`clockGeometry` at the feature's centre), door frames and the closed door
  slabs (trim colour). Glass in one `ROOM_GLASS` mesh `roomWindows` (`wallDir` 'N'). `decor` and unknown band cells → one
  decal quad each in `facadeMaterial(tex, null)` (Scale4x of the cells' pixels into one texture per build, in
  `kit.disposables`), mesh `wallDecals` (`wallDir` 'N'), 0.01 in front of the inner face over the feature's stretched band.
  Door gaps (any `dir`) → the run of that direction skips the gap below a lintel at 2.1.

- [ ] **Step 1: Write the failing test** `tests/interiorShell.test.ts` (built from `fakeInterior(HOUSE)` with a fake
  `TileInfo`, `kitMaterial` on `createKitUniforms()`):

```ts
let g: THREE.Object3D, claims: Claims, bandCells: number[];
const box = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);
/** Vertices of `o`'s geometry strictly inside x0..x1 and below yMax (a wall standing in a doorway has some). */
const wallQuadsBelow = (o: THREE.Object3D, r: { x0: number; x1: number; yMax: number }) => {
  const p = (o as THREE.Mesh).geometry.getAttribute('position');
  let n = 0;
  for (let i = 0; i < p.count; i++) if (p.getX(i) > r.x0 && p.getX(i) < r.x1 && p.getY(i) < r.yMax) n++;
  return n;
};
beforeAll(() => {
  const { a } = fakeInterior(HOUSE);                          // (seeds interiorIds(a))
  // test-local: shellFamily extract + build, a fake TileInfo, events = the HOUSE door warp (5, 7)
  ({ group: g, claims } = buildShell(a, { warps: [{ x: 5, y: 7, dest: 'LITTLEROOT_TOWN' }], signs: [] }));
  const L = roomLayout(a, interiorIds(a), [{ x: 5, y: 7, dest: 'LITTLEROOT_TOWN' }]);
  bandCells = [...L.band.keys()].filter((i) => L.band[i] === 1);
});
const DEPTH = maxProfileDepth(shellProfile(WALL_H, SHELL.wainscot, WALL_T));   // the crown: 0.16
it('builds one wall mesh per direction, tagged for the cutaway', () => {
  expect(['N', 'E', 'S', 'W'].map((d) => g.getObjectByName(`walls${d}`)!.userData.wallDir)).toEqual(['N', 'E', 'S', 'W']);
});
it('stands the back wall in the recess, WALL_H tall, and leaves the room open', () => {
  const n = box(g.getObjectByName('wallsN')!);
  expect(n.max.z).toBeCloseTo(3 - RECESS + DEPTH, 2); expect(n.max.y).toBeCloseTo(WALL_H, 2);
  expect(n.min.z).toBeCloseTo(3 - RECESS - WALL_T, 2);
  expect(box(g.getObjectByName('wallsS')!).min.z).toBeCloseTo(8 - DEPTH, 2);
});
it('opens the doorway and glazes the window', () => {
  expect(wallQuadsBelow(g.getObjectByName('wallsS')!, { x0: 5.05, x1: 5.95, yMax: 2.0 })).toBe(0);
  const glass = box(g.getObjectByName('roomWindows')!);
  expect(glass.min.x).toBeGreaterThanOrEqual(3); expect(glass.max.x).toBeLessThanOrEqual(5);
  expect(String(ROOM_GLASS.fragColor ?? '') + String(ROOM_GLASS.fragHead ?? '')).toContain('uOutdoorNight');
});
it('claims every band cell so no legacy face stands in front of the wall', () => {
  expect(bandCells.length).toBeGreaterThan(0);
  for (const i of bandCells) expect(claims.has(i, CLAIM_OBJECT)).toBe(true);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/interiorShell.test.ts` → FAIL.
- [ ] **Step 3: Implement** `shell.ts` and its catalogue.
- [ ] **Step 4: Run** → PASS. Commit (Step 6) before the look: the look runs after the group-C join.
- [ ] **Step 5: Look (after the join).** The controller's `--label tC --interiors --review --review-before p4-base` rows:
  every in-scope room closed by walls with thickness, baseboard, wainscot and rail in the room's own colours, mitred
  corners with no gap at the top, windows framed with glass, wall art as crisp decals where the GBA shows it, the doorway
  in the front wall (visible in `i_house_back`) and side doorways in `i_gate`, the front walls gone at the default camera,
  the east walls gone in `i_pc_yaw`, capped ends, no wall through a walkable cell; the glass deep blue in the night entries
  (`i_pc_night`, `i_house_night`, `i_lab_night`, `i_mart_night`). Gate at the join: Retro 0.00 %, Modern outdoor / battle /
  `i_gym` / `i_gym_night` / `i_secret` / `truck_inside` 0.00 %.
- [ ] **Step 6: Commit** — `git add src/render/kit/interior/shell.ts tests/interiorShell.test.ts && git commit -m
  "feat(kit): interior room shell — walls, windows, clocks, wall decals, doorways, cutaway meshes" --
  src/render/kit/interior/shell.ts tests/interiorShell.test.ts` (pathspec commit)

**Gates:** as Step 5, at the join; drift guard at the join. **Acceptance:** the Step 5 bullets.

---

### Task 8 (group C): Floors and window light shafts

**Files:**
- Modify (own): `src/render/kit/interior/floors.ts`, `src/render/kit/interior/shafts.ts`, `src/render/kit/terrain.ts`
  (exports its cell-fetch GLSL constant only; program text unchanged)
- Create: `tests/interiorFloors.test.ts`

**Interfaces:**
- Consumes: `FLOOR_SEAM_GLSL`, `BOARDS_GLSL`, `TILES_GLSL` (Task 2); `roomLayout`, `windowRect`, `floorLook`,
  `interiorIds` (Tasks 3, 5); `KitUniforms.uOutdoorNight`, `KitMaterialOptions.blending` (Task 6).
- Modifies (own in group C): `src/render/kit/terrain.ts` — exports its per-cell texel fetch / grid-cell GLSL as a
  constant (`TERRAIN_CELL_GLSL`) that its own program composes **with its text unchanged** (Modern outdoor stays 0.00 %:
  the gate proves it); the interior floor uses the same constant instead of a copy.
- Produces:
  ```ts
  export const enum FloorMat { Boards = 0, Tiles = 1, Carpet = 2, Rug = 3, Mat = 4 }
  /** edges: bit 0 N, 1 E, 2 S, 3 W — the neighbour on that side is another floor kind (rugs and mats draw their border). */
  export interface FloorCell { i: number; h: number; mat: FloorMat; tint: RGB; edges: number }
  /** Inside + claimed-object + band cells of the rooms. A walkable cell takes its own id's kind (unknown floor ids and
   *  `legacy` stay legacy); a cell under furniture, wall or stairsUp takes the kind and tint most common among the walkable
   *  floor cells of its 8-neighbourhood, else the room's floorTile. A `stairsDown` cell gets no floor (the stairwell's
   *  hole: Task 10's generator draws it). */
  export function floorCells(a: MapAnalysis, ids: readonly (InteriorId | null)[], L: RoomLayout, claims: Claims): FloorCell[];
  /** RGBA8 per analysis cell: rgb = sRGB tint, a = mat << 4 | edges. */
  export function encodeFloor(a: MapAnalysis, cells: readonly FloorCell[]): Uint8Array;
  export function interiorFloorMaterial(tex: THREE.Texture, gridMin: THREE.Vector2, gridSize: THREE.Vector2): KitMaterialOptions;  // hookKey 'interiorFloor'
  export const floorFamily: Family<FloorCell[]>;   // claims CLAIM_SURFACE; build: floor mesh (receive, no cast) + shafts
  export const FLOOR_CATALOGUE: readonly InteriorCatalogueEntry[];   // interiorFloorMaterial PN no cast; roomShaftMaterial PNC no cast
  // shafts.ts
  /** transparent, depthWrite false, blending AdditiveBlending (an additive volume, spec §8), emissive daylight ×
   *  (1 − uOutdoorNight) (D8: none at night); alpha through a uniform; hookKey 'roomShaft'. */
  export function roomShaftMaterial(alpha: number): KitMaterialOptions;
  /** One soft strip per window feature: from its glass (`windowRect(L, f)`, the rectangle the shell glazes) down and into
   *  the room (slant 0.6 south per unit fall) to the floor, vertex colours r = across (0..1), g = along (0 window … 1 floor). */
  export function shaftGeometry(L: RoomLayout): THREE.BufferGeometry | null;
  ```
  GLSL: grid cell from `vKitWorld` and the cell's texel fetch through `TERRAIN_CELL_GLSL` (no warp, no bilinear tint
  blend); boards and tiles from `floorGlsl.ts` (boards along z, 0.55 wide; tiles 1.0 cell, seams on the grid). The program
  declares no `uFloor` / `uFloorAlt` uniforms: each snippet is inlined in a block that declares the names it reads as
  locals from the cell's kind — `{ vec4 uFloor = vec4(kind, size, seamDark, tone); vec3 uFloorAlt = …; <BOARDS_GLSL> }`,
  with `fp`, `k`, `seam` declared before — so the pinned battle text is used unchanged. Carpet: soft pile noise; rug: pile +
  a border band 0.12 wide on its `edges` sides in tint × 0.7 + a thin inner line; mat: woven stripes, border.

- [ ] **Step 1: Write the failing test** `tests/interiorFloors.test.ts`:

```ts
/** Claims with the table cells claimed CLAIM_OBJECT, as the furniture family would. */
const claimsWithTable = (a: MapAnalysis, ids: readonly (InteriorId | null)[]) => {
  const c = new Claims(a.N);
  ids.forEach((id, i) => { if (id === 'table') c.claim(i, CLAIM_OBJECT); });
  return c;
};
const HOUSE = ['          ', ' WWOOWWWW ', ' WWOOWFWW ', ' ........ ', ' ..TT.... ', ' ..TT..rr ', ' ......rr ', ' ....M... ', '          '];
it('gives the rug its kind and border edges, and the table cells the rug under them', () => {
  const { a, ids } = fakeInterior(['          ', ' WWWWWWWW ', ' ........ ', ' ..rrrr.. ', ' ..rTTr.. ', ' ..rrrr.. ', ' ........ ', '          ']);
  const cells = floorCells(a, ids, roomLayout(a, ids, []), claimsWithTable(a, ids));
  const at = (x: number, y: number) => cells.find((c) => c.i === a.idx(x, y))!;
  expect(at(4, 4).mat).toBe(FloorMat.Rug);                        // under the table: the rug around it
  expect(at(3, 3).edges).toBe(0b1001);                             // NW corner of the rug: border N and W
  expect(at(4, 3).edges).toBe(0b0001);
  expect(at(5, 2).mat).toBe(FloorMat.Boards);
});
it('leaves the stairwell without floor', () => {
  const { a, ids } = fakeInterior(['        ', ' WWWWWW ', ' ...s.. ', ' ...... ', '        ']);
  const cells = floorCells(a, ids, roomLayout(a, ids, []), new Claims(a.N));
  expect(cells.some((c) => c.i === a.idx(4, 2))).toBe(false);
  expect(cells.some((c) => c.i === a.idx(3, 2))).toBe(true);
});
it('packs kind and edges in the alpha byte', () => {
  const { a } = fakeInterior(['    ', ' .. ', '    ']);
  const data = encodeFloor(a, [{ i: 7, h: 0, mat: FloorMat.Rug, tint: [1, 0.5, 0], edges: 0b0101 }]);
  expect([...data.subarray(28, 32)]).toEqual([255, 128, 0, (3 << 4) | 0b0101]);
});
it('lays one shaft per window, from the glass to the floor, gone at night', () => {
  const { a, ids } = fakeInterior(HOUSE);
  const L = roomLayout(a, ids, [{ x: 5, y: 7, dest: 'LITTLEROOT_TOWN' }]);
  const g = shaftGeometry(L)!; g.computeBoundingBox();
  const w = windowRect(L, L.features[0]);
  expect(g.boundingBox!.min.y).toBeCloseTo(0, 1);
  expect(g.boundingBox!.max.y).toBeLessThanOrEqual(w.y1 + 1e-3); expect(g.boundingBox!.max.y).toBeGreaterThan(w.y0);
  expect(g.boundingBox!.min.x).toBeGreaterThanOrEqual(w.x0 - 1e-3); expect(g.boundingBox!.max.z).toBeGreaterThan(3 - RECESS);
  const m = roomShaftMaterial(0.4);
  expect(m.transparent).toBe(true); expect(m.depthWrite).toBe(false); expect(m.blending).toBe(THREE.AdditiveBlending);
  expect(String(m.fragEmissive ?? '') + String(m.fragColor ?? '')).toContain('uOutdoorNight');
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. Commit (Step 6) before the look: the look
  runs after the group-C join.
- [ ] **Step 5: Look (after the join).** The controller's `--label tC --interiors --review --review-before p4-base` rows:
  wooden boards in houses, tiles in the PC / Mart / lab in their own colours, rugs with borders under tables, mats at the
  exits, no floor over a stairwell (`i_house_2f`), no moiré at the far wall, soft daylight shafts falling from the windows
  by day and none in the night entries; legacy cells (the PC's floor emblem) still pixel art. Gate at the join: Retro and
  the controls 0.00 %, Modern outdoor 0.00 % (the terrain's program text unchanged).
- [ ] **Step 6: Commit** — `git add src/render/kit/interior/floors.ts src/render/kit/interior/shafts.ts
  src/render/kit/terrain.ts tests/interiorFloors.test.ts && git commit -m "feat(kit): interior floors (boards, tiles,
  carpet, rugs, mats) and window light shafts" -- src/render/kit/interior/floors.ts src/render/kit/interior/shafts.ts
  src/render/kit/terrain.ts tests/interiorFloors.test.ts` (pathspec commit)

**Acceptance:** the Step 5 bullets.

---

### Task 9 (group C): Furniture kit I — home

**Files:**
- Modify (own): `src/render/kit/interior/furnitureHome.ts`
- Create: `tests/interiorHome.test.ts`

**Interfaces:**
- Consumes: `FurnitureGenerator`, `FurniturePiece` (`xy`, `cellFeet`, `facing`), `FurnitureOut` (`glowLow`, `glassLow`),
  `FURNITURE_SPEC`, `isLow` (Task 6); test helpers `tests/helpers/furniture.ts` (Task 6); `Soup`, `lathe`, `tube`,
  `addShelf` (with `depth`) (Task 2); `soften`, `mix`, `scale` (kit/palette.ts).
- Produces: `HOME_GENERATORS: Partial<Record<FurnitureKind, FurnitureGenerator>>` for `bed` (frame, mattress, pillow,
  blanket in main/second), `table` (top with rounded edge, four legs; cloth in accent when the art shows one), `chair`
  (seat cushion + back, its back away from `p.facing`, the nearest table), `tv` (low cabinet + screen; screen into
  `glowLow`), `bookshelf` (`addShelf` sized to the footprint: width, `FURNITURE_SPEC` height, depth `foot.z1 − foot.z0`),
  `plant` (pot lathe + leaf crown of blobs, sways nothing), `fridge` (rounded box, two doors, handle), `sink` (counter with
  basin, tap, cupboard doors), `cabinet`, `crate` (planked box), `trashCan`, `vase` (lathes). Low kinds write to `out.low`
  (screens `glowLow`, glass `glassLow`), tall ones to `out.tall` (`glow`, `glass`) by `isLow`. Quality: lathe sides 8 / 12 /
  16 (low / medium / high), blob subdivision likewise. Colours from `p.colors` through `soften()`.

- [ ] **Step 1: Write the failing test** `tests/interiorHome.test.ts`:

```ts
import { piece, newOut, boxOf, run, hashOut, tris } from './helpers/furniture';
const KINDS = ['bed', 'table', 'chair', 'tv', 'bookshelf', 'plant', 'fridge', 'sink', 'cabinet', 'crate', 'trashCan', 'vase'] as const;
it.each(KINDS)('%s stays inside its footprint at its height, in the right soups', (kind) => {
  const out = newOut(), p = piece(kind); HOME_GENERATORS[kind]!(p, out, 'medium');
  const b = boxOf(out), f = p.foot;
  expect(b.min.x).toBeGreaterThanOrEqual(f.x0 - 1e-3); expect(b.max.x).toBeLessThanOrEqual(f.x1 + 1e-3);
  expect(b.min.z).toBeGreaterThanOrEqual(f.z0 - 1e-3); expect(b.max.z).toBeLessThanOrEqual(f.z1 + 1e-3);
  expect(b.max.y).toBeCloseTo(FURNITURE_SPEC[kind].height, 1);
  if (isLow(kind)) expect(out.tall.empty && out.glass.empty && out.glow.empty).toBe(true);
  else expect(out.low.empty && out.glassLow.empty && out.glowLow.empty).toBe(true);
});
it('turns a chair to face its table', () => {
  const east = boxOf(run(HOME_GENERATORS, 'chair', 'medium', { facing: 'E' }));
  const west = boxOf(run(HOME_GENERATORS, 'chair', 'medium', { facing: 'W' }));
  expect(east.equals(west)).toBe(false);
});
it('is deterministic and scales with quality', () => {
  expect(hashOut(run(HOME_GENERATORS, 'plant', 'medium'))).toBe(hashOut(run(HOME_GENERATORS, 'plant', 'medium')));
  expect(tris(run(HOME_GENERATORS, 'plant', 'low'))).toBeLessThan(tris(run(HOME_GENERATORS, 'plant', 'high')));
});
```

  (`run(generators, kind, q, overrides?)`: the helper's `run` with piece overrides.)

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. Commit (Step 6) before the look: the look
  runs after the group-C join.
- [ ] **Step 5: Look (after the join, on the controller's `tC` rows)** on `i_house_1f`, `i_house_2f`,
  `i_may_1f`, `i_oldale_house`, `i_flat`, `i_fortree_house`, `i_sootopolis_house`, `i_lab`: beds, tables with chairs,
  TVs, bookcases, plants, kitchens recognisable from the GBA art, in its colours, standing where the game blocks (no
  model over a walkable cell: walk the stand-in player round with `&focus=1&x=&y=` spot checks), tall pieces dither when
  the stand-in stands behind them, low ones never (TV screens included); chairs face their tables.
- [ ] **Step 6: Commit** — `git add src/render/kit/interior/furnitureHome.ts tests/interiorHome.test.ts && git commit -m
  "feat(kit): home furniture — beds, tables, chairs, TVs, bookcases, plants, kitchens, crates" --
  src/render/kit/interior/furnitureHome.ts tests/interiorHome.test.ts` (pathspec commit)

**Acceptance:** the Step 5 bullets.

---

### Task 10 (group C): Furniture kit II — Pokémon Center, Mart, computers, stairs

**Files:**
- Modify (own): `src/render/kit/interior/furnitureService.ts`
- Create: `tests/interiorService.test.ts`

**Interfaces:**
- Consumes: as Task 9.
- Produces: `SERVICE_GENERATORS` for `pc` (desk, monitor with a `glowLow` screen, keyboard: a low piece, nothing of it
  fades), `healer` (the healing machine: a console with six Poké Ball cradles — red/white lathes — and a lit panel in
  `glow`), `pcCounter` (the nurse's counter: a long rounded counter in main, a top in second, a front band in accent;
  follows its component's L-shape cell by cell through `p.cellFeet` / `p.xy`, never over a walkable cell inside the L),
  `counter` (a shop / reception counter, same construction plainer), `martShelf` (a double-sided gondola: base, shelves,
  rows of goods in the tile's accent and second colours, seeded), `stairsUp` (steps rising north into the recess, 0.2
  rise, a rail on the open side), `stairsDown` (a stairwell: steps falling north below the floor, a rail around the hole —
  Task 8's `floorCells` leaves `stairsDown` cells without floor).

- [ ] **Step 1: Write the failing test** `tests/interiorService.test.ts` (helpers from `tests/helpers/furniture.ts`) — the
  footprint / height / soup case of Task 9 for `pc`, `healer`, `pcCounter`, `counter`, `martShelf`, plus:

```ts
import { piece, newOut, boxOf, run, countClusters } from './helpers/furniture';
it('gives the healing machine six cradles and a lit panel', () => {
  const out = newOut(); SERVICE_GENERATORS.healer!(piece('healer'), out, 'medium');
  expect(out.glow.empty).toBe(false);
  expect(countClusters(out.tall, [0.85, 0.15, 0.15])).toBe(6);       // six red ball halves (sRGB; the helper compares lin())
});
it('follows an L-shaped counter cell by cell', () => {
  const L = piece('pcCounter', { xy: [[2, 4], [3, 4], [3, 5]], cellFeet: [fitFurniture('pcCounter', 2, 2, 4, 4, 0, -Infinity),
    fitFurniture('pcCounter', 3, 3, 4, 4, 0, -Infinity), fitFurniture('pcCounter', 3, 3, 5, 5, 0, -Infinity)] });
  const out = newOut(); SERVICE_GENERATORS.pcCounter!(L, out, 'medium');
  const p = out.low.geometry().getAttribute('position');
  for (let i = 0; i < p.count; i++) expect(p.getX(i) < 3 - 1e-3 && p.getZ(i) > 5 + 1e-3).toBe(false);   // nothing over (2, 5)
});
it('climbs the stairs into the wall and sinks the stairwell under the floor', () => {
  const up = boxOf(run(SERVICE_GENERATORS, 'stairsUp')), down = boxOf(run(SERVICE_GENERATORS, 'stairsDown'));
  expect(up.max.y).toBeCloseTo(1.6, 1); expect(down.min.y).toBeLessThan(-0.5);
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. Commit (Step 6) before the look: the look
  runs after the group-C join.
- [ ] **Step 5: Look (after the join, on the controller's `tC` rows)** on `i_pc_1f`, `i_pc_2f`, `i_mart`, `i_dept_1f`,
  `i_league`, `i_gate`, `i_weather`, `i_house_1f` (stairs), `i_house_2f` (stairs down, no floor over the well),
  `i_pc_nurse`: the nurse behind her counter shows from the waist up and neither the counter nor the PC's screen dithers;
  the healing machine, PC, Mart gondolas and counters read clearly; stairs lead into the wall / down.
- [ ] **Step 6: Commit** — `git add src/render/kit/interior/furnitureService.ts tests/interiorService.test.ts && git commit -m
  "feat(kit): service furniture — healing machine, nurse counter, computers, Mart shelves, counters, stairs" --
  src/render/kit/interior/furnitureService.ts tests/interiorService.test.ts` (pathspec commit)

**Acceptance:** the Step 5 bullets.

---

### Task 11 (group C): Legacy boxes with HD pixels for unknown interior cells

**Files:**
- Modify (own): `src/render/overworld/materials.ts`, `src/render/overworld/world.ts` (material choice only),
  `src/render/overworld/overworldView.ts` (creates the HD twins), `src/render/kit/catalogue.ts` (`CatalogueSources.legacyHd`),
  `tests/smoke/catalogue.test.ts` (the drift guard builds its `World` with the HD twins and passes `legacyHd`)
- Test: `tests/smoke/interiorWorld.test.ts` (one case appended)

**Interfaces:**
- Consumes: `XBR_GLSL` (actors/xbr.glsl.ts), `CELL`, `PAD` (metatileAtlas.ts), `World.interiorKitRan` (Task 6).
- Produces: `createWorldMaterials(atlas, u, opts?: { hd?: boolean })` — one definition: with `hd` the opaque (with its
  window glow, the same injection) and cutout materials also replace, after `<map_fragment>`, the sampled colour by
  `xbrSample` at the fragment's texel position inside its metatile's 24×24 cell (the padding replicates the edge texels)
  when the texel footprint `max(fwidth(p))` < 1, else the plain lookup; program keys `world-opaque-hd`, `world-cutout-hd`
  (today's keys unchanged without `hd`). `createHdWorldMaterials(atlas, u): Pick<WorldMaterials, 'opaque' | 'cutout'>` =
  `createWorldMaterials(atlas, u, { hd: true })`'s opaque and cutout.
- Produces: `WorldMaterials.hd?: Pick<WorldMaterials, 'opaque' | 'cutout'>` — the `World` gets the twins inside its
  `materials`; it draws the legacy quads with them when `interiorKitRan` on the build (and `hd` is given), else with
  today's. `CatalogueSources.legacyHd: Pick<WorldMaterials, 'opaque' | 'cutout'>` (**required**: two LEGACY-attribute
  catalogue meshes, cast, as the legacy ones); `OverworldView` creates the twins once and passes them to both.

- [ ] **Step 1: Write the failing test** (appended to `tests/smoke/interiorWorld.test.ts`; `build` / `legacyMeshes` are
  declared in the file: `build` = `report`'s build, `legacyMeshes(world)` = the world group's meshes carrying `aGlow`):

```ts
it('draws unknown interior cells with the HD legacy materials, everything else with today\'s', () => {
  const mats = (g: number, n: number, style: WorldStyle) => { build(g, n, style); return legacyMeshes(world).map((m) => (m.material as THREE.Material).customProgramCacheKey()); };
  const pc = mats(2, 2, 'modern');
  expect(pc.length).toBeGreaterThan(0);
  expect(pc.every((k) => k.endsWith('-hd') || k === 'world-water')).toBe(true);
  expect(mats(2, 2, 'retro').some((k) => k.endsWith('-hd'))).toBe(false);
  expect(mats(8, 1, 'modern').some((k) => k.endsWith('-hd'))).toBe(false);
  expect(mats(0, 10, 'modern').some((k) => k.endsWith('-hd'))).toBe(false);
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (catalogue: two LEGACY-attribute meshes with the HD twins; the
  drift guard passes `{ ...legacy, hd: createHdWorldMaterials(…) }` to its `World` and `legacyHd` to `worldCatalogue`).
  **Step 4: Run** the appended case → PASS. `tests/smoke/catalogue.test.ts` runs at the group-C join (Parallel execution
  rule 3), not while Tasks 7–10 are mid-edit. Commit (Step 6) before the look.
- [ ] **Step 5: Look (after the join, on the controller's `tC` rows):** the cells still legacy on in-scope maps (the PC's
  floor emblem, `legacy`-labelled art, unknown ids) are smooth-edged, not blurred, no seams at metatile borders; Retro and
  the controls 0.00 %.
- [ ] **Step 6: Commit** — `git add src/render/overworld/materials.ts src/render/overworld/world.ts
  src/render/overworld/overworldView.ts src/render/kit/catalogue.ts tests/smoke/catalogue.test.ts
  tests/smoke/interiorWorld.test.ts && git commit -m "feat(world): HD-smoothed legacy boxes for the interior cells the kit
  leaves" -- <the same paths>` (pathspec commit)

**Acceptance:** the Step 5 bullets.

**Join of group C (controller):** (1) add `...FURNITURE_CATALOGUE` to `INTERIOR_CATALOGUE` in
`src/render/kit/interior/index.ts` (Tasks 9/10 now draw it; commit it alone); (2) `npx tsc --noEmit && npm test`, the
smoke drift guards (`catalogue`, `battleCatalogue`), `interiorWorld`; (3) `npm run regress:live -- --label tC
--interiors --review --review-before p4-base` (the looks of Tasks 7–11: hand each agent its rows, or resume them one at a
time); (4) `npm run regress:live -- --label tC-gate --static --compare p4-base`: Retro 0.00 % everywhere; Modern outdoor,
battle and the controls (`i_gym`, `i_gym_night`, `i_secret`, `truck_inside`) 0.00 %; the night twins pass `nightLum`.

---

### Task 12: Interior smoke tests, coverage report, live check with actors and doors

**Files:**
- Create: `tests/smoke/interiors.test.ts`
- Modify: whatever its findings require, kept small (larger issues go back to the controller)

**Interfaces:** Consumes everything above. Produces `out/coverage-interiors.txt` (per in-scope map: legacy share of in-map
non-void cells, worst first; average) — legacy = not `CLAIM_SURFACE`, or blocked and not `CLAIM_OBJECT`.

- [ ] **Step 1: Write the tests** `tests/smoke/interiors.test.ts` (extract as `World.build` runs it, margin 14):

```ts
// Every in-scope map once (loadAllMaps + interiorScope), with what the tests read: its analysis, ids, room layout and the
// furniture family's pieces, extracted as World.build runs the interior families.
interface Scoped { name: string; group: number; num: number; a: MapAnalysis; layout: RoomLayout; pieces: FurniturePiece[];
  beh(i: number): number }
const IN_SCOPE: Scoped[] = loadInScope();                       // defined in this file
const byName = (re: RegExp) => IN_SCOPE.filter((m) => re.test(m.name));
const PC_1F = byName(/_PokemonCenter_1F$/);                     // the 16 Pokémon Center 1F maps
const MARTS = byName(/_Mart$/);                                 // the 12 Marts (out/atlas/stats.txt; UnusedMart does not match)
/** Pieces per kind on a map. */
const kinds = (m: Scoped) => m.pieces.reduce<Record<string, number>>((k, p) => ({ ...k, [p.kind]: (k[p.kind] ?? 0) + 1 }), {});
const at = (g: number, n: number) => IN_SCOPE.find((m) => m.group === g && m.num === n)!;
/** Cells of `m` whose behaviour is one of `behs`; the kind of the piece that holds cell `i` (null: none). */
const cellsWithBehaviour = (m: Scoped, behs: number[]) => [...Array(m.a.N).keys()].filter((i) => behs.includes(m.beh(i)));
const pieceKindAt = (m: Scoped, i: number) => m.pieces.find((p) => p.cells.includes(i))?.kind ?? null;
it('models exactly one healing machine and one nurse counter in every Pokémon Center 1F', () => {
  expect(PC_1F).toHaveLength(16);
  for (const m of PC_1F) { const k = kinds(m); expect(k.healer, m.name).toBe(1); expect(k.pcCounter, m.name).toBe(1); }
});
it('gives every Mart shelves and a counter', () => {
  expect(MARTS).toHaveLength(12);
  for (const m of MARTS) { const k = kinds(m); expect(k.martShelf, m.name).toBeGreaterThanOrEqual(2); expect(k.counter, m.name).toBeGreaterThanOrEqual(1); }
});
it('models every interaction-behaviour cell as its kind', () => {
  for (const m of IN_SCOPE) for (const i of cellsWithBehaviour(m, [MB.TELEVISION, MB.PC, MB.BOOKSHELF, MB.PICTURE_BOOK_SHELF,
    MB.POKEMON_CENTER_BOOKSHELF, MB.SHOP_SHELF])) expect(pieceKindAt(m, i), `${m.name} ${i}`).toBe(BEHAVIOR_IDS.get(m.beh(i)));
});
it('lays sound room layouts on every in-scope map', () => {
  for (const m of IN_SCOPE) expect(checkRoomLayout(m.a, m.layout), m.name).toEqual([]);
});
it('furnishes the houses', () => {
  expect(kinds(at(1, 0))).toMatchObject({ table: 1, tv: 1, stairsUp: 1 });     // Brendan's 1F
  expect(kinds(at(1, 1))).toMatchObject({ bed: 1, pc: 1, stairsDown: 1 });     // Brendan's 2F
});
it('writes the coverage report and holds it', () => {
  const c = coverageAll(IN_SCOPE);
  expect(c.average).toBeLessThanOrEqual(0.10);
  expect(c.over25.map((m) => m.name)).toEqual(RULED_OVER_25);   // [] unless the controller rules otherwise
});
```

  (Maps are matched by name, never by number: the PC list is the 16 `*_PokemonCenter_1F` maps of `out/atlas/stats.txt`;
  `MARTS` the `*_Mart` maps — `13_8 LilycoveCity_UnusedMart` and `25_38 ContestHallSmart` do not match.)
- [ ] **Step 2: Run** → fix what fails (table labels, layout rules) within the owning modules; repeat.
- [ ] **Step 3: Live check.** `npm run regress:live -- --label t12 --static --selftest --compare p4-base --review
  --review-before p4-base`: Retro 0.00 % everywhere; Modern outdoor, battle and control entries (`i_gym`, `i_gym_night`,
  `i_secret`, `truck_inside`) 0.00 %; `door_enter` / `door_exit` pass (no compile, one build, frame gate) and
  `door_exit`'s outdoor frame equals p4-base's Modern. Actor luminance: on the **day** interior entries 0.9–1.15× Retro
  (median ≥ 0.95); on the **night** entries (`NIGHT_TWINS`, and any live in-scope entry Task 1 recorded at night) D8's
  rules from `nightLum` instead — actors 0.9–1.15× their day twin, room mean luma ≥ 0.45× the day twin's (Retro, whose
  indoor light stays fixed, is no reference at night). `vigoroth` (Mom and the Vigoroths among the boxes in the modelled
  room) and `item_indoor` look right; `i_pc_nurse`: the nurse's upper body over the counter, no dither on it.
- [ ] **Step 4: Live by eye.** `npx tsx tools/shot3d.ts --state out/s22.state --wait 3000 --keys "<door_enter's keys>"`
  and back out: no stall, no console error, the room and then Littleroot as in the harness.
- [ ] **Step 5: Commit** — `git add tests/smoke/interiors.test.ts <fixed files> && git commit -m "test(smoke): interiors —
  Pokémon Centers, Marts, behaviour cells, room layouts, coverage"`

**Gates:** as Step 3. **Acceptance:** tests pass; coverage within budget; numbers in the report.

---

### Task 13: Performance, robustness and documentation

**Files:**
- Modify: `tools/regress-live.ts` (`--ab-feature interior`: `emu.renderer.overworld.setInteriorKit(on)` /
  `preview.setInteriorKit(on)`, `previewWhen: (q) => /map=(1|2|11|12|13|15|16|29|32)\./.test(q)` over the `i_*` entries,
  budgets 1.5 / 0.5 ms), small fixes the checks require, `README.md`, `CLAUDE.md`

- [ ] **Step 1: Full run.** `npm run regress:live -- --label p4 --static --gpu --selftest --compare p4-base --review
  --review-before p4-base`: every Global Constraint with numbers — Retro 0.00 %; Modern outdoor / battle / controls
  (`i_gym`, `i_gym_night`, `i_secret`, `truck_inside`) 0.00 %; calls ≤ 150 and triangles ≤ 1.5 M on every interior entry;
  door walks gated; luminance: day interior entries 0.9–1.15× Retro, night entries by `nightLum` (actors 0.9–1.15× and
  room luma ≥ 0.45× their day twin).
- [ ] **Step 2: Rebuild cost.** `preview.measureRebuild()` × 5 (median) on every in-scope `i_*` entry: build ≤ 40 ms,
  build + first frame ≤ 100 ms. Over budget: profile (`roomLayout`, Soup writes, Scale4x decals) and fix, or report.
- [ ] **Step 3: Interleaved A/B.** `--ab --ab-feature interior` (64 quads) on `vigoroth`, `item_indoor`, `i_pc_1f`,
  `i_mart`, `i_house_1f`, `i_lab`, `i_dept_1f`; one `--ab-aa` on two of them. The "off" arm is exactly today's interior,
  light included (D8: with the kit off `interiorKitRan` is false, so no night blend and `uOutdoorNight` 0). Budget Δgpu ≤
  +1.5 ms, Δcpu ≤ +0.5 ms; over: profile (floor fragment cost, shafts overdraw, decal texture size) and fix, or report
  for a ruling.
- [ ] **Step 4: Quality, DPR, robustness.** `--query quality=low` and `quality=high` (GTAO; programs stable through the
  door walks), `--dpr 2 --styles modern --only i_pc_1f,i_house_1f`; `i_house_fail` (furniture legacy, shell and floor
  modelled, one warning); a style switch in an interior (`TOGGLE_STYLE` entry `vigoroth_switch`, `sameAs: 'vigoroth'`,
  `samePrograms`); V in an interior and back.
- [ ] **Step 5: Docs.** `README.md`: Phase 4 (modelled rooms, scope, what stays). `CLAUDE.md`: `--interiors`, the `i_*`
  previews, `p4-base`, `--ab-feature interior`, `&kitFail=`. Report every known gap for the progress log (at least: the
  out-of-scope interiors; `legacy`-labelled art; shafts are light only, no dust; doors closed slabs; walls fixed height).
- [ ] **Step 6: Commit** — `git add tools/regress-live.ts README.md CLAUDE.md <fixed files> && git commit -m "docs+perf:
  Phase 4 checks, interior A/B, harness docs"` (check `git status`: never `out/`, states or the ROM).

**Gates:** the final full run. **Acceptance:** every Global Constraint verified with numbers in the report.

---

## Self-review

**Spec §8 coverage:** `tables/building.ts` for `gTileset_Building` + BrendansMaysHouse, GenericBuilding, PokemonCenter,
Shop, Lab — Tasks 3 (types, primary, behaviour fallback, scope, worklist), 4 (curation, pins, ≥ 97 %). Furniture kit:
bed, table, chair, TV, bookshelf, potted plant, fridge, sink/counter, crates — Task 9; PC, healing machine, PC counter,
Mart shelves, counter, stairs — Task 10; clock — Task 7 (wall-mounted); rug — Task 8 (a floor kind); colours from the
tiles — Task 5 `partColors` / `wallColors` / `floorLook`. Rooms: back/side walls with thickness, baseboards (the moved
profile), window frames — Task 7; soft light shafts (additive volumes) — Task 8; floor materials planks / tiles / carpet —
Task 8 (D3 ⚑: own program with the terrain's data layout). Unknown interior cells: legacy boxes with upscaled textures —
Task 11 (and wall art as Scale4x decals, Task 7). §3 architecture: families on the semantic layer, claims, legacy for the
rest (Task 6). §9: unit tests for pure parts (Tasks 2, 3, 5, 6–10), ROM smoke (Tasks 3, 6, 11, 12) and the coverage
report (Task 12), save-state interior shots (Tasks 1, 12). §10: calls / triangles / rebuild / A/B / quality scaling
(Global Constraints, Tasks 9, 13). §11: per-family rollback, `&kitFail` (Tasks 6, 13). §12: no hand-modelled characters,
no game-logic change, no downloads. Carry-overs: boot-time catalogue + drift guard (Tasks 6–11), one build per map load
(door walks, Tasks 1, 12), Phase 2 actors' fades and luminance (Tasks 6, 12), Retro 0.00 % gate (every task).

**Placeholder scan:** `door_exit`'s state (`out/s21.state`), `i_pc_nurse`'s cell (7.5, 4.5) and `i_secret`'s map (25.0)
were found by Task 1's probe and are recorded in the harness and in Task 1's entry block; the indoor states' in-game hours
come from the same probe; table ids are curated in Task 4 by the stated rules against the generated worklist; tuning
constants are starting values with the visual review that ends their tuning.

**Interfaces used across tasks:** `Soup`, `lathe`, `tube`, `lin` (T2 → T7, T9, T10); `wallPath` (+ `ends`),
`shellProfile` (+ `thick`), `maxProfileDepth`, `shellPalette`, `addWindow`, `addShelf` (+ `depth`), `wallFrameAt`,
`ShellColors` (T2 → T5, T7, T9); `glowMesh` (T2 → T6, which adds its `options`, → T9, T10); `FLOOR_SEAM_GLSL`,
`BOARDS_GLSL`, `TILES_GLSL` (T2 → T8); `InteriorId`, `FurnitureKind`, `FloorKind`, `FURNITURE_KINDS`, `interiorId`,
`interiorIds`, `seedInteriorIds`, `BEHAVIOR_IDS`, `INTERIOR_TABLES` (T3 → T4–T12); `interiorScope`,
`ClassifyOptions.primaryTileset` (T3 → T6); `roomLayout`, `checkRoomLayout`, `windowRect`, `RECESS`, `WALL_H`, `WALL_T`,
`WallRun`, `WallFeature`, `DoorGap` (with `dir`), `partColors`, `wallColors`, `floorLook`, `fakeInterior` (T5 → T6–T12);
`INTERIOR_FAMILIES`, `INTERIOR_CATALOGUE`, `InteriorCatalogueEntry`, `INNER_NORMAL`, `wallVisible`, `fitFurniture`,
`WALL_BACK`, `FURNITURE_SPEC`, `isLow`, `FurniturePiece` (`xy`, `floorY`, `cellFeet`, `facing`), `FurnitureOut`
(`glassLow`, `glowLow`), `FurnitureGenerator`, `FURNITURE_LOW`/`TALL`/`GLASS`/`GLASS_LOW`/`GLOW_LOW`,
`furnitureFamilyWith`, `KitUniforms.uOutdoorNight`, `KitMaterialOptions.blending`, `indoorLight`, `INDOOR_DAY`,
`INDOOR_NIGHT`, `ACTOR_NIGHT_FLOOR`, `World.interiorKitRan` / `setFailFamily` / `updateCutaway`,
`OverworldView.setFailFamily`, `setInteriorKit`, `tests/helpers/furniture.ts` (T6 → T7–T13); `shellFamily`,
`SHELL_CATALOGUE`, `ROOM_GLASS` (T7); `floorFamily`, `FLOOR_CATALOGUE`, `roomShaftMaterial`, `shaftGeometry`,
`TERRAIN_CELL_GLSL` (T8); `HOME_GENERATORS` (T9); `SERVICE_GENERATORS` (T10); `createWorldMaterials(…, { hd })`,
`createHdWorldMaterials`, `WorldMaterials.hd`, `CatalogueSources.legacyHd` (T11); `NIGHT_TWINS`, `nightLum` (T1 → T6,
T12, T13).

## Open questions for the user

1. **Scope:** only the spec's five secondaries (138 of 307 indoor maps: every house, Pokémon Center, Mart, Birch's lab,
   Lanette's house, Weather Institute, Dept Store, League lobby); gyms (10 maps, 8 puzzle tilesets), the Battle Frontier
   buildings, Contest halls, museums, Trick House puzzle rooms, Elite Four rooms and secret bases keep today's look?
   **Recommended: yes** — gyms as a later "Phase 4b" (each needs its own table and puzzle-aware rules).
2. **Time of day indoors** (answered below: superseded by D8)**:** room light stays fixed as today, but windows and light shafts follow the outdoor clock (deep
   blue glass and no shafts at night)? **Recommended: yes** (cheap, one uniform; alternative: always daylight windows).
3. **Proportions:** real-world heights (walls 2.6, counters 1.0, bookcases 2.1) on the game's blocked footprint, rising
   over the wall art above them, rather than squat furniture fitted exactly to the GBA's rows? **Recommended:
   real-world heights** (Phase 1's buildings did the same; the default camera still lines footprints up with the art).
4. **(Pre-flight F38, open)** "Everything follows the clock": should a battle that starts in an in-scope room follow
   the clock too? Today such battles use the fixed `TODAY_LIGHTS.room` light, and Phase 4 keeps every battle entry at
   0.00 %. **Recommended: no, not in Phase 4** (a later battle-light change, with its own baseline). The controller
   asks the user before Task 6.

**User answers (2026-10-27):** 1 — yes (the five secondaries; gyms etc. in a later Phase 4b). 2 — **"everything follows
the clock"** (not the recommendation): the whole room light follows the outdoor clock in Modern in-scope interiors, see
D8. 3 — real-world heights. Plan approved ("Godkjenn og kjør"), subagent-driven with parallel agents where the plan's
groups allow.

**Controller ruling on open question 4 (F38, 2026-10-27):** no — battles that start in an in-scope room keep Phase 3's
behaviour (indoor battle halls do not follow the clock); D8 applies to the overworld interior only. The user may
override this later.
