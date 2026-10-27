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

## Global Constraints

- **No Nintendo assets in the repository and no third-party downloads.** Tables map metatile ids to our own labels (as
  Phase 1's `tables/general.ts`); colours and pixels are decoded at runtime from the user's ROM / live VRAM.
- World mapping unchanged: grid (x, y) at height h → world (X = x, Y = h, Z = y + h). Interior models stand on the cells
  the game blocks, anchored at the south edge of their cells (spec §13: "models are built in un-projected space so they
  meet the ground where the game's collision is"); their heights are real-world (D6).
- **Retro renders every map exactly as today.** Gate after every task: `npm run regress:live -- --label tN --static
  --compare p4-base` reports **0.00 %** on every Retro entry (live, static map, static battle). Phase 4 also leaves the
  rest alone: every Modern outdoor, battle, transition and **out-of-scope interior** entry (`i_gym`, `i_secret`,
  `truck_inside`) stays 0.00 % in Modern too. Only the in-scope interior entries change, and only in Modern.
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
  Retro) and `tests/battleCatalogue.test.ts` pass after every task that touches materials.
- **Error handling (spec §11):** each interior family runs inside `runKit`'s try/catch (a failure rolls its claims back:
  its cells render legacy, warned once per map); the semantic layer throwing builds the map as today; V stays the
  universal fallback. `?kitFail=<family>` (preview) proves it.
- `npx tsc --noEmit` and `npm test` pass at the end of every task (parallel groups: at the join, see below); smoke tests a
  task adds or touches pass (`npx vitest run --config tests/smoke/vitest.smoke.config.ts <file>`).
- Every look task ends with a **visual review**: `npm run regress:live -- --label tN --interiors --static --review
  --review-before p4-base` and the implementer reads `_review_interior.png` (columns GBA map | before | Modern | Retro)
  against the task's checklist and says what they saw. Quality bar: modern stylised 3D (Let's Go / BDSP rooms): soft
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
   (≤ 1.2 high) never fades; tall furniture does (the player behind a Mart shelf). Pinned: Task 6 `FURNITURE_SPEC` /
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
  (= `BUILDING_BODY`, fades) above. Walls fade too (BUILDING_BODY).
- **D8 Indoor light follows the clock (user ruling 2026-10-27: "Alt følger klokka").** In Modern, on in-scope
  interiors only, the whole room follows the outdoor clock: the indoor branch of `updateLighting` blends from today's
  daylight values towards a warm, lamp-lit evening/night look by `nightFactor(hour)` (sun/hemisphere dimmed and warmed,
  exposure following partly; a brightness floor so rooms stay readable — battler-style rule: actor luminance at
  hour 21 stays within 0.9–1.15× the hour-11 Modern value of the same entry, and the room's mean luma at night ≥ 0.45×
  its day value). **Windows and shafts** follow too through `KitUniforms.uOutdoorNight` (`nightFactor(hour)` indoors,
  0 elsewhere): night glass deep blue, shafts off. Retro and out-of-scope interiors keep today's fixed indoor light.
  Owned by Task 6 (the uniform + the light blend) and Task 8 (glass/shafts); Task 12 checks the night entries.
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
- **D12 Doors and stairs.** Exit mats (`SOUTH_ARROW_WARP` and the arrow warps) are floor `mat` cells and cut a framed
  doorway into the south wall. Stairs are table ids (`stairsUp` rising into the back-wall recess, `stairsDown` a stairwell
  with a rail) on their warp cells.

## Parallel execution

Tasks marked with the same group letter run as parallel subagents: they own disjoint files (listed per task) and share no
interface that is still changing. Rules: (1) a parallel agent runs only its own tests (`npx vitest run <its files>`); the
controller runs `npx tsc --noEmit && npm test` plus the smoke drift guards at the **join** and attributes failures by file
ownership; (2) each agent commits only its own files (`git add <files>`, never `-A`); (3) screenshot runs of
`regress:live` may overlap (distinct `--label`s), but **`--gpu`, `--ab` and `measureRebuild` timing never run alongside
anything** — only Tasks 1 and 13 time the GPU, sequentially.

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
  `shellProfile`, `shellPalette`, `wallPath`, `WINDOW`, `addWindow`, `SHELF`, `BOOKS`, `addShelf` (moved + generalised).
- `src/render/kit/interior/floorGlsl.ts` — `FLOOR_SEAM_GLSL`, `BOARDS_GLSL`, `TILES_GLSL` (moved text).
- `src/render/kit/tables/building.ts` — id types, `BUILDING_PRIMARY`, `BEHAVIOR_IDS`, `INTERIOR_TABLES`, `interiorId`,
  `interiorIds`.
- `src/render/kit/tables/interior/{genericBuilding,pokemonCenter,shop,lab,brendansMaysHouse}.ts` — one `InteriorTable` each.
- `src/render/kit/interior/scope.ts` — `INTERIOR_TILESETS`, `interiorScope`.
- `src/render/kit/interior/room.ts` — `roomLayout`, `checkRoomLayout`, constants and types.
- `src/render/kit/interior/colors.ts` — `partColors`, `wallColors`, `floorLook`.
- `src/render/kit/interior/cutaway.ts` — `INNER_NORMAL`, `CUTAWAY_DOT`, `wallVisible`.
- `src/render/kit/interior/furniture.ts`, `furnitureHome.ts`, `furnitureService.ts` — furniture core and generators.
- `src/render/kit/interior/shell.ts` — `shellFamily`, `ROOM_GLASS`, `clockGeometry`, `SHELL_CATALOGUE`.
- `src/render/kit/interior/floors.ts`, `shafts.ts` — `floorFamily`, `interiorFloorMaterial`, `roomShaftMaterial`,
  `shaftGeometry`, `FLOOR_CATALOGUE`.
- `src/render/kit/interior/index.ts` — `INTERIOR_FAMILIES`, `INTERIOR_CATALOGUE`, `InteriorCatalogueEntry`.
- Tests: `tests/battlePins.test.ts` + `tests/battle-pins.json`, `tests/kitWallParts.test.ts`, `tests/kitInteriorTables.test.ts`,
  `tests/helpers/fakeInterior.ts`, `tests/interiorRoom.test.ts`, `tests/interiorColors.test.ts`, `tests/interiorCutaway.test.ts`,
  `tests/interiorFurniture.test.ts`, `tests/interiorShell.test.ts`, `tests/interiorFloors.test.ts`, `tests/interiorHome.test.ts`,
  `tests/interiorService.test.ts`, `tests/smoke/interiorTables.test.ts`, `tests/smoke/interiorWorld.test.ts`,
  `tests/smoke/interiors.test.ts`.

Modified:
- `src/render/battle/parts/soup.ts` (re-export shim), `rooms.ts`, `floor.ts`, `stadium.ts`, `skyPillar.ts` — imports
  only; `roomShell` delegates to `wallPath`; outputs byte-identical (Task 2 pins).
- `src/render/overworld/analyze.ts` — `ClassifyOptions.primaryTileset?: number` (read only by the kit).
- `src/render/overworld/world.ts` — interior families, `interiorKit`, `setFailFamily`, `updateCutaway`, HD legacy materials.
- `src/render/overworld/overworldView.ts` — passes `primaryTileset`, `setInteriorKit`, cutaway per frame, `uOutdoorNight`.
- `src/render/overworld/materials.ts` — `createHdWorldMaterials`.
- `src/render/kit/materials.ts` — `KitUniforms.uOutdoorNight` (bound in `patchKit`).
- `src/render/kit/catalogue.ts` — `INTERIOR_CATALOGUE` entries, `CatalogueSources.legacyHd`.
- `src/render/preview.ts` — `&kitFail=`, `setInteriorKit`.
- `tools/gen-symbols.ts` (+ regenerated `src/game/symbols.ts`), `tools/regress-live.ts`, `tests/smoke/helpers/staticMap.ts`,
  `README.md`, `CLAUDE.md`.

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
  { name: 'i_pc_night', q: 'map=2.2&actors=1&hour=21' },    // windows / shafts at night
  { name: 'i_pc_nurse', q: 'map=2.2&actors=1&x=<nurse x>&y=<nurse y + 2>&focus=1' }, // stand-in player at the counter
  { name: 'i_house_fail', q: 'map=1.0&kitFail=furniture' },  // Task 6 on: furniture rolled back to legacy
  { name: 'i_gym', q: 'map=8.1' },                           // out of scope: Modern 0.00 % for ever
  { name: 'i_secret', q: 'map=<a secret base group.num>' },  // out of scope (SECRET_BASE)
];
// live door walks (crossing-gated: no compile, one build per map load, frame ≤ build + crossingMargin)
{ name: 'door_enter', state: 'out/s22.state', steps: [['', 30], /* walk into a Littleroot door */], crossings: 1 },
{ name: 'door_exit', state: '<an indoor free-walk state>', steps: [['', 30], /* walk out over the exit mat */], crossings: 1 },
```

- [ ] **Step 1: Probe the states.** `.scratch/p4_probe.ts` (as Phase 3's battle probe: `Gba.loadState`, a few frames,
  `GameState`): print map group/num, name, `header.mapType`, player cell and whether input moves the player, for every
  `out/*.state`. Record in the entries' comments which states are indoors (expected: `littleroot.state` = Brendan's
  1F cutscene, `truck.state` = the truck); pick `door_exit`'s state (an indoor free-walk state; if none, `door_enter`'s
  end saved by the probe as `out/house_in.state` — gitignored). Fill `i_pc_nurse`'s cell (the nurse's template cell,
  stand-in two rows south) and `i_secret`'s map.
- [ ] **Step 2: Add the entries, `--interiors`, `INTERIOR_LIVE`, the interior review sheet.** Tune the door walks so each
  crosses exactly one map load and ends ≥ 30 frames after the fade-in (record the frames).
- [ ] **Step 3: Determinism.** `npm run regress:live -- --label p4det1 --interiors --static` then `--label p4det2
  --interiors --static --compare p4det1` → 0.00 % on every interior entry, both styles.
- [ ] **Step 4: Baseline.** `npm run regress:live -- --label p4-base --static --gpu` (every entry, both styles; later
  gates `--static --compare p4-base`). Then `--label p4chk --only battle,transition,r101 --compare p3-base` → 0.00 %
  (nothing changed since Phase 3; if not, report why). Report per interior entry and style: calls, triangles, programs,
  buildMs; for the door walks: builds, programs, the five slowest frames.
- [ ] **Step 5: Typecheck, test, commit.** `npx tsc --noEmit && npm test`; `git add tools/regress-live.ts && git commit -m
  "tools: interior entries (previews, orbit, night, nurse, controls), door walks, --interiors, interior review sheet"`

**Gates:** Retro and Modern — no renderer code changed; door walks pass the crossing gate on today's code.
**Acceptance:** entries deterministic in both styles; `p4-base` captured; today's interior numbers in the report.

---

### Task 2 (group A): Battle room geometry into the kit — battle pixels identical

**Files:**
- Create: `src/render/kit/soup.ts`, `src/render/kit/glow.ts`, `src/render/kit/interior/wallParts.ts`,
  `src/render/kit/interior/floorGlsl.ts`, `tests/battlePins.test.ts`, `tests/battle-pins.json`, `tests/kitWallParts.test.ts`
- Modify: `src/render/battle/parts/soup.ts` (becomes `export { … } from '../../kit/soup'`), `rooms.ts`, `floor.ts`,
  `stadium.ts`, `skyPillar.ts` (imports; `rooms.ts` re-exports `SHELL`, `SHELF`, `ShellColors`, `glowMesh` so tests and
  `stadium.ts` keep compiling)

**Interfaces:**
- Produces (`kit/interior/wallParts.ts`; bodies moved verbatim where they exist):
  ```ts
  export type V2 = [number, number];                                  // x, z on the floor
  export interface WallFrame { o: V3; u: V3; w: V3; s: [number, number]; at(s: number, h: number, d: number): V3 }
  export function wallFrameAt(o: V3, u: V3, w: V3, s: [number, number]): WallFrame;   // battle's wallFrame builds via it
  export const SHELL: { thick: 0.4; base: 0.35; wainscot: 1.15; crown: 0.42; relief: 0.075; panel: {…} };   // moved
  export interface ShellColors { base: RGB; wainscot: RGB; panel: RGB; trim: RGB; wall: RGB }
  export interface ShellProfile { pts: [number, number][]; col: (keyof ShellColors | 'cap')[] }
  export function shellProfile(H: number, W: number): ShellProfile;                    // moved
  export type ShellPalette = Record<keyof ShellColors | 'cap', RGB>;                   // linear
  export function shellPalette(c: ShellColors): ShellPalette;                          // lin(...), cap = wall × 0.8
  /** Walls along `path` (floor points, consecutive points share an axis), the room on the side `inward[k]` of segment k;
   *  each profile step's inner face offset d into the room, corners mitred (P + d·(n₀ + n₁)), open ends offset along their
   *  own segment's normal; `caps`: the open ends closed by the profile's section. Emits per profile step the segments'
   *  quads in path order, then the two caps (roomShell's order: the battle pins stay byte-identical). */
  export function wallPath(s: Soup, path: readonly V2[], inward: readonly V2[], y0: number, profile: ShellProfile,
    C: ShellPalette, caps: boolean): void;
  export const WINDOW: WindowSize; export interface WindowSize { width: number; height: number; sill: number; frame: number; depth: number; mullion: number }
  export function addWindow(body: Soup, glass: Soup, F: WallFrame, at: number, trim: RGB, size?: WindowSize): void;
  export const SHELF: {…}; export const BOOKS: RGB[];
  export function addShelf(body: Soup, F: WallFrame, at: number, wood: RGB, seed: number, width?: number, height?: number): void;
  ```
- Produces: `kit/glow.ts` `glowMesh(uniforms: KitUniforms, geometry: THREE.BufferGeometry, emissive: RGB): THREE.Mesh`
  (moved); `kit/soup.ts` (moved); `kit/interior/floorGlsl.ts` `FLOOR_SEAM_GLSL` (the `floorSeam` function), `BOARDS_GLSL`
  and `TILES_GLSL` (the two `if` branch bodies of today's `FLOOR_COLOR`, reading `fp`, `uFloor`, `uFloorAlt`, writing `k`,
  `seam`), so `floor.ts` composes the identical `FLOOR_COLOR` string.

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
  `tests/battlePins.test.ts tests/battle-pins.json` alone (`git commit -m "test: pin battle room geometry and floor
  shaders before the kit move"`). The JSON is never regenerated in this phase.
- [ ] **Step 3: Write the failing test** `tests/kitWallParts.test.ts`:

```ts
import { wallPath, shellProfile, shellPalette, SHELL, addWindow, wallFrameAt, WINDOW } from '../src/render/kit/interior/wallParts';
import { Soup } from '../src/render/kit/soup';
const C = shellPalette({ base: [0.4, 0.3, 0.2], wainscot: [0.7, 0.55, 0.4], panel: [0.72, 0.57, 0.42], trim: [1, 1, 1], wall: [0.9, 0.88, 0.8] });
describe('wall parts', () => {
  it('builds a closed rectangular room with mitred corners and no caps', () => {
    const s = new Soup();
    wallPath(s, [[0, 0], [6, 0], [6, 4], [0, 4], [0, 0]], [[0, 1], [-1, 0], [0, -1], [1, 0]], 0, shellProfile(2.6, SHELL.wainscot), C, false);
    const g = s.geometry(); g.computeBoundingBox();
    expect(g.boundingBox!.min.x).toBeCloseTo(-SHELL.thick, 5); expect(g.boundingBox!.max.x).toBeCloseTo(6 + SHELL.thick, 5);
    expect(g.boundingBox!.max.y).toBeCloseTo(2.6, 5);
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
});
```

- [ ] **Step 4: Run** `npx vitest run tests/kitWallParts.test.ts` → FAIL (module missing).
- [ ] **Step 5: Move.** Create the kit modules with the moved code, make `roomShell` call `wallPath` with today's U path
  (`inward` [[1,0],[0,1],[-1,0]], `caps` true) and its panel loop unchanged, compose `FLOOR_COLOR` from `floorGlsl.ts`,
  update imports. No constant, order or expression changes.
- [ ] **Step 6: Run** `npx vitest run tests/battlePins.test.ts tests/kitWallParts.test.ts tests/arenaRooms.test.ts
  tests/arenaSoup.test.ts tests/battleCatalogue.test.ts` → PASS.
- [ ] **Step 7: Gate.** `npm run regress:live -- --label t2 --battles --compare p4-base` → 0.00 % on every battle entry,
  both styles.
- [ ] **Step 8: Commit** — `git add src/render/kit/soup.ts src/render/kit/glow.ts src/render/kit/interior/wallParts.ts
  src/render/kit/interior/floorGlsl.ts src/render/battle/parts tests/kitWallParts.test.ts && git commit -m "refactor(kit):
  battle room geometry, wall profile, windows, bookcases, glow mesh and floor patterns into the kit (battle output pinned)"`

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
  /** Per analysis cell (void: null), memoised per analysis. */
  export function interiorIds(a: MapAnalysis): readonly (InteriorId | null)[];
  ```
- Produces (`kit/interior/scope.ts`): `INTERIOR_TILESETS: ReadonlySet<number>` (the five SYM addresses);
  `interiorScope(o: Pick<ClassifyOptions, 'indoor' | 'primaryTileset' | 'secondaryTileset'>): boolean` — indoor,
  primary `SYM.gTileset_Building`, secondary in the set.
- Produces (smoke): `out/interior-ids.txt` — per in-scope tileset, per id used on its maps' in-map cells: hex id, cells,
  maps, behaviour name, layer type, blocked share, current label (`-` unlabelled) — the curators' worklist.

- [ ] **Step 1: Write the failing tests** `tests/kitInteriorTables.test.ts`:

```ts
import { interiorId, BUILDING_PRIMARY, BEHAVIOR_IDS, INTERIOR_TABLES, FURNITURE_KINDS, FLOOR_KINDS, WALL_PARTS, type InteriorTable } from '../src/render/kit/tables/building';
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
  must number exactly **138** and include 1.0, 2.2, 2.4, 1.4 and exclude 8.1 (Petalburg Gym); per tileset, the labelled
  share of in-map non-void cells (`interiorIds` non-null) ≥ that table's `target`; every pin reads as its id; writes
  `out/interior-ids.txt`.
- [ ] **Step 2: Run** both → FAIL (modules missing).
- [ ] **Step 3: Implement**; `npm run symbols`.
- [ ] **Step 4: Run** both, `npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/golden.test.ts
  tests/smoke/semantics.test.ts` (unchanged) → PASS. Read `out/interior-ids.txt` and report the used-id count per tileset.
- [ ] **Step 5: Commit** — `git add tools/gen-symbols.ts src/game/symbols.ts src/render/overworld/analyze.ts
  src/render/overworld/overworldView.ts tests/smoke/helpers/staticMap.ts src/render/kit/tables src/render/kit/interior/scope.ts
  tests/kitInteriorTables.test.ts tests/smoke/interiorTables.test.ts && git commit -m "feat(kit): interior scope, Building
  tileset ids, behaviour fallback, table scaffold and id report"`

**Gates:** no rendering change (Retro/Modern 0.00 % on `--only i_house_1f,i_pc_1f,r101`). Programs unchanged.
**Acceptance:** 138 in-scope maps; the worklist exists.

---

### Task 4 (group B, three parallel agents): Curate the secondary tables

- **4a:** `tables/interior/genericBuilding.ts` (73 maps). **4b:** `pokemonCenter.ts` + `shop.ts` (57 maps).
  **4c:** `brendansMaysHouse.ts` + `lab.ts` (8 maps). Each agent owns only its files.

**Interfaces:** Consumes `InteriorTable`, `InteriorId` (Task 3). Produces filled tables (`target: 0.97`, ≥ 6 pins per
tileset, at least one per FurnitureKind the tileset draws).

- [ ] **Step 1: Sheets and maps.** `npx tsx tools/map-atlas.ts --no-maps --sheet-only <Name> --sheet-scale 5
  --sheet-chunk 32` (label, layer and behaviour above each metatile; both layers | top only) and the map renders in
  `out/atlas/<g>_<n>_<Name>.png`; worklist `out/interior-ids.txt`.
- [ ] **Step 2: Label by these rules.** Every used id gets an `InteriorId`; a multi-cell object labels **all** its cells
  with its kind (a bed's head and foot, a table's four quarters, a counter's top and front rows); wall-art rows: `wall`
  (paint, wainscot, skirting), `window`, `clock`, `decor` (posters, pictures, maps, calendars, shelves painted flat on the
  wall); walkable floors `boards` / `tiles` / `carpet`, rugs `rug`, mats `mat`; floor art no family can draw (the Pokémon
  Center's Poké Ball inlay, emblems) and anything doubtful `legacy`. An id whose meaning differs between maps is `legacy`.
- [ ] **Step 3: Pins.** Add pins read off the map renders (e.g. 4b: Oldale PC 1F's healing machine, nurse counter,
  PC, plant, floor tile, exit mat; Oldale Mart's shelves, counter; 4c: Brendan's 1F table, chairs, rug, stairs, TV,
  window; Brendan's 2F bed, PC; Birch's lab bookshelf).
- [ ] **Step 4: Run** `npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/interiorTables.test.ts`
  → PASS for the agent's tilesets (others may still be at target 0).
- [ ] **Step 5: Commit** — `git add src/render/kit/tables/interior/<own files> && git commit -m "data(kit): <tileset>
  interior table"`.

**Acceptance:** each table ≥ 97 % of its maps' in-map non-void cells labelled; pins pass; the report lists the ids left
`legacy` and why.

---

### Task 5 (group B): Room layout and colour sampling (pure)

**Files:**
- Create: `src/render/kit/interior/room.ts`, `src/render/kit/interior/colors.ts`, `tests/helpers/fakeInterior.ts`,
  `tests/interiorRoom.test.ts`, `tests/interiorColors.test.ts`

**Interfaces:**
- Consumes: `InteriorId`, `interiorId` (Task 3), `GridWarp` (`kit/events.ts`), `ShellColors` (Task 2).
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
  export interface DoorGap { x0: number; x1: number; z: number }       // an exit's opening in a south wall
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
   *  with from ≥ to, a door not on a south run. */
  export function checkRoomLayout(a: MapAnalysis, L: RoomLayout): string[];
  ```
  Rules: per column, each maximal non-void vertical segment [t, b]: its back line is the first walkable row in
  [t, min(b, t + BAND_MAX)], else t + (the room's mode band height); a column whose band is deeper than its room's mode by
  > 1 takes the mode (the extra rows are furniture standing on the floor). Rows t … backLine − 1 are band, the rest
  inside. Boundary edges between inside and non-inside cells become runs (merged when collinear and adjacent): N at
  z = row − RECESS, S at z = row + 1, W at x, E at x + 1; an E/W run beside band cells spans from its own N line to the
  neighbouring column's N line (alcove jogs). Features group band cells of one id in one row-run, merged downward. Door
  gaps: warp cells that are `mat` on a room's bottom row.
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
  analysis (margin 1, border = void metatile 1 with `isVoid`), ids from the legend. Default legend: `' '` void, `W` wall,
  `O` window, `C` clock, `D` decor, `.` boards, `r` rug, `T` table, `B` bookshelf, `F` fridge, `M` mat (beh
  `SOUTH_ARROW_WARP`), `S` stairsUp (walkable), `?` unknown blocked.

- [ ] **Step 1: Write the failing tests** `tests/interiorRoom.test.ts`:

```ts
import { roomLayout, checkRoomLayout, RECESS } from '../src/render/kit/interior/room';
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
    expect(L.doors).toEqual([{ x0: 5, x1: 6, z: 8 }]);
    expect(L.features).toEqual([expect.objectContaining({ kind: 'window', x0: 3, x1: 5, row0: 0, row1: 1, rows: 2 })]);
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
    expect(runs(L, 'N')).toHaveLength(1);
    expect(L.inside[a.idx(3, 3)]).toBe(1);          // the shelf's lower row is room (furniture on the floor)
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
- [ ] **Step 4: Run** → PASS. Also run `roomLayout` + `checkRoomLayout` over the 138 maps from a scratch script with the
  tables as they stand (unknown ids allowed) and report the findings (Task 12 pins zero).
- [ ] **Step 5: Commit** — `git add src/render/kit/interior/room.ts src/render/kit/interior/colors.ts tests/helpers/fakeInterior.ts
  tests/interiorRoom.test.ts tests/interiorColors.test.ts && git commit -m "feat(kit): interior room layout (wall band, back
  line, runs, windows, doors) and part colours"`

**Acceptance:** tests pass; the scratch run's findings listed in the report.

---

### Task 6: Interior integration — families on in-scope maps, furniture core, cutaway, catalogue plumbing

**Files:**
- Create: `src/render/kit/interior/index.ts`, `cutaway.ts`, `furniture.ts`, stubs `shell.ts`, `floors.ts`,
  `shafts.ts`, `furnitureHome.ts`, `furnitureService.ts` (families named `shell` / `floor` that claim nothing, empty
  catalogues, empty generator maps), `tests/interiorCutaway.test.ts`, `tests/interiorFurniture.test.ts`,
  `tests/smoke/interiorWorld.test.ts`
- Modify: `src/render/overworld/world.ts`, `src/render/overworld/overworldView.ts`, `src/render/kit/materials.ts`,
  `src/render/kit/catalogue.ts`, `src/render/preview.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 5.
- Produces (`index.ts`): `INTERIOR_FAMILIES: readonly Family<unknown>[] = [furnitureFamily, shellFamily, floorFamily]`;
  `interface InteriorCatalogueEntry { material: KitMaterialOptions; attrs: Record<string, number>; castShadow: boolean }`;
  `INTERIOR_CATALOGUE = [...FURNITURE_CATALOGUE, ...SHELL_CATALOGUE, ...FLOOR_CATALOGUE]` — `worldCatalogue` adds one
  `kit(e.material, e.attrs, e.castShadow)` per entry (deduplicated by signature as today).
- Produces (`world.ts`): `World` constructor `(atlas, materials, uniforms, families = FAMILIES, interiorFamilies =
  INTERIOR_FAMILIES)`; `WorldBuildContext.interiorKit?: boolean` (default true); the kit runs when Modern, not underground,
  and either outdoor (`families`) or `interiorScope(opts) && interiorKit` (`interiorFamilies`); `setFailFamily(name: string |
  null)` (the named family's extract throws: the harness's and tests' failure path); `updateCutaway(camBack: THREE.Vector2)`
  sets `visible = wallVisible(mesh.userData.wallDir, camBack)` on every kit mesh carrying `userData.wallDir`.
- Produces (`overworldView.ts`): `setInteriorKit(on: boolean)` (rebuild on next sync, like `setWorldStyle`); calls
  `world.updateCutaway(kitUniforms.uCamBack.value)` every `update`; in `updateLighting` sets
  `kitUniforms.uOutdoorNight.value = indoor ? nightFactor(hour) : 0`, and (D8, Modern + in-scope interior only) blends
  the indoor room light towards the lamp-lit night look by the same factor; Retro and out-of-scope interiors keep
  today's indoor values exactly. Test: the blend at night 0 equals today's indoor values exactly (day pixels identical).
- Produces (`materials.ts`): `KitUniforms.uOutdoorNight: { value: number }` (created 0, bound in `patchKit`'s uniform map;
  no shader declares it yet: every program unchanged).
- Produces (`preview.ts`): `&kitFail=<family>` → `world.setFailFamily`; `PreviewApp.setInteriorKit(on)` (rebuild now).
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
   *  rows), wallZ) — never behind the back wall's inner face `wallZ` (−Infinity when free-standing). */
  export function fitFurniture(kind: FurnitureKind, x0: number, x1: number, y0: number, y1: number, h: number, wallZ: number): Footprint;
  export interface FurniturePiece { kind: FurnitureKind; cells: number[]; foot: Footprint; colors: PartColors; seed: number }
  export interface FurnitureOut { tall: Soup; low: Soup; glass: Soup; glow: Soup }
  export type FurnitureGenerator = (p: FurniturePiece, out: FurnitureOut, q: Quality) => void;
  export const FURNITURE_TALL: KitMaterialOptions;   // = BUILDING_BODY
  export const FURNITURE_LOW: KitMaterialOptions;    // { vertexColors: true, roughness: 0.8 } — no fade
  export const FURNITURE_GLASS: KitMaterialOptions;  // = BUILDING_GLASS
  /** Components: 4-connected cells of one furniture kind, cut at any cell whose id differs (unknown included). A component
   *  whose kind has a generator claims CLAIM_OBJECT (+ CLAIM_TOP where its art overhangs into the cell north of it, same id),
   *  with groundMt = the room's floorTile; one without stays legacy. */
  export function furnitureFamilyWith(generators: Partial<Record<FurnitureKind, FurnitureGenerator>>): Family<FurniturePiece[]>;
  export const furnitureFamily: Family<FurniturePiece[]>;   // furnitureFamilyWith({ ...HOME_GENERATORS, ...SERVICE_GENERATORS })
  export const FURNITURE_CATALOGUE: readonly InteriorCatalogueEntry[];  // TALL/LOW/GLASS on PNC, cast; PROP_GLOW PNC no cast (glowMesh)
  ```
  The family's build merges each Soup into one mesh (`tall` FURNITURE_TALL, `low` FURNITURE_LOW, `glass`
  FURNITURE_GLASS, `glow` via `glowMesh`), cast + receive shadows.

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
it('keeps furniture in the wall band in front of the wall', () => {
  expect(fitFurniture('fridge', 6, 6, 1, 2, 0, 3 - RECESS)).toMatchObject({ z0: 2.5, z1: 3, height: 1.9 });
});
it('never fades low furniture', () => {
  expect(FURNITURE_KINDS.filter(isLow)).toEqual(['bed', 'table', 'chair', 'tv', 'pc', 'sink', 'cabinet', 'crate', 'trashCan',
    'vase', 'counter', 'pcCounter', 'stairsDown']);
  expect(FURNITURE_LOW.fade).toBeFalsy(); expect(FURNITURE_TALL.fade).toBe(true);
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
  expect(report(2, 2, 'retro')).toEqual([]);
  expect(report(2, 2, 'modern', false)).toEqual([]);
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

- [ ] **Step 2: Run** them → FAIL.
- [ ] **Step 3: Implement** the above (stubs export the names Tasks 7–11 fill: `shellFamily`, `SHELL_CATALOGUE`,
  `floorFamily`, `FLOOR_CATALOGUE`, `roomShaftMaterial`/`shaftGeometry` placeholders, `HOME_GENERATORS = {}`,
  `SERVICE_GENERATORS = {}`).
- [ ] **Step 4: Run** the tests, `tests/smoke/catalogue.test.ts`, `golden`, `semantics` → PASS; `npx tsc --noEmit && npm test`.
- [ ] **Step 5: Gate.** `npm run regress:live -- --label t6 --static --compare p4-base` → 0.00 % everywhere in both
  styles (no generator, no shell, no floor yet: in-scope interiors still legacy; `i_house_fail` too); `door_enter`,
  `door_exit` pass their gate.
- [ ] **Step 6: Commit** — `git add src/render/kit/interior src/render/overworld/world.ts src/render/overworld/overworldView.ts
  src/render/kit/materials.ts src/render/kit/catalogue.ts src/render/preview.ts tests/interiorCutaway.test.ts
  tests/interiorFurniture.test.ts tests/smoke/interiorWorld.test.ts && git commit -m "feat(world): interior families on
  in-scope interiors, furniture core and fitting, cutaway, outdoor-night uniform, failure hook"`

**Gates:** every entry 0.00 % both styles; drift guards pass; programs constant.
**Acceptance:** the plumbing is in; Tasks 7–11 only fill their own modules.

---

### Task 7 (group C): Room shell — walls, windows, clocks, decals, doorways

**Files:**
- Modify (own): `src/render/kit/interior/shell.ts`
- Create: `tests/interiorShell.test.ts`

**Interfaces:**
- Consumes: `wallPath`, `shellProfile`, `shellPalette`, `addWindow`, `wallFrameAt`, `WINDOW` (Task 2); `roomLayout`,
  `RECESS`, `WALL_H`, `WALL_T`, `WallRun`, `WallFeature`, `DoorGap` (Task 5); `wallColors`, `partColors` (Task 5);
  `facadeMaterial` + `scale4x` (kit/buildings.ts, kit/upscale.ts); `interiorIds`.
- Produces:
  ```ts
  /** Window glass seen from inside: its vertex colours (a sky gradient) turned towards night blue by uOutdoorNight. */
  export const ROOM_GLASS: KitMaterialOptions;            // vertexColors, roughness 0.15, fade, hookKey 'roomGlass'
  export function clockGeometry(radius: number, face: RGB, rim: RGB): THREE.BufferGeometry;   // PNC, a round wall clock
  export const shellFamily: Family<ShellPlacement>;        // extract: claims band cells CLAIM_OBJECT | CLAIM_TOP (groundMt = floorTile)
  export interface ShellPlacement { layout: RoomLayout; colors: ShellColors; decals: WallFeature[] }
  export const SHELL_CATALOGUE: readonly InteriorCatalogueEntry[];  // BUILDING_BODY PNC cast; ROOM_GLASS PNC cast
  ```
  Build: per `WallDir` one `BUILDING_BODY` mesh named `walls<Dir>` with `userData.wallDir`, each run a `wallPath` of one
  segment with `caps: true` (the profile's section closes both ends; at a corner the two runs meet on the same section
  plane), height `WALL_H`, thickness `WALL_T`, colours `wallColors`; window features → `addWindow` sized to the feature
  (width x1 − x0 − 0.3, sill / height from its art rows stretched over 0.2 … WALL_H − 0.3), glass in `ROOM_GLASS`;
  clocks → `clockGeometry` on the wall at the feature's centre; `decor` and unknown band cells → one decal quad each in
  `facadeMaterial(tex, null)` (Scale4x of the cells' pixels into one texture per build, in `kit.disposables`), 0.01 in
  front of the inner face over the feature's stretched band; door gaps → the S run skips the gap below a lintel at 2.1 and
  a door frame (BUILDING_BODY) plus a closed door slab in the trim colour.

- [ ] **Step 1: Write the failing test** `tests/interiorShell.test.ts` (built from `fakeInterior(HOUSE)` with a fake
  `TileInfo`, `kitMaterial` on `createKitUniforms()`):

```ts
it('builds one wall mesh per direction, tagged for the cutaway', () => {
  const g = buildShell(HOUSE);
  expect(['N', 'E', 'S', 'W'].map((d) => g.getObjectByName(`walls${d}`)!.userData.wallDir)).toEqual(['N', 'E', 'S', 'W']);
});
it('stands the back wall in the recess, WALL_H tall, and leaves the room open', () => {
  const n = box(g.getObjectByName('wallsN')!);
  expect(n.max.z).toBeCloseTo(3 - RECESS + SHELL.relief, 2); expect(n.max.y).toBeCloseTo(WALL_H, 2);
  expect(box(g.getObjectByName('wallsS')!).min.z).toBeCloseTo(8 - SHELL.relief, 2);
});
it('opens the doorway and glazes the window', () => {
  expect(wallQuadsBelow(g.getObjectByName('wallsS')!, { x0: 5.05, x1: 5.95, yMax: 2.0 })).toBe(0);
  const glass = box(g.getObjectByName('roomWindows')!);
  expect(glass.min.x).toBeGreaterThanOrEqual(3); expect(glass.max.x).toBeLessThanOrEqual(5);
});
it('claims every band cell so no legacy face stands in front of the wall', () => {
  for (const i of bandCells) expect(claims.has(i, CLAIM_OBJECT)).toBe(true);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/interiorShell.test.ts` → FAIL.
- [ ] **Step 3: Implement** `shell.ts` and its catalogue.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Look.** `npm run regress:live -- --label t7 --interiors --static --review --review-before p4-base`:
  every in-scope room closed by walls with thickness, baseboard, wainscot and rail in the room's own colours, windows framed
  with glass, wall art as crisp decals where the GBA shows it, the doorway in the front wall (visible in `i_house_back`),
  the front walls gone at the default camera, the east walls gone in `i_pc_yaw`, capped ends, no wall through a walkable
  cell; Retro 0.00 %, Modern outdoor / battle / `i_gym` / `i_secret` / `truck_inside` 0.00 %.
- [ ] **Step 6: Commit** — `git add src/render/kit/interior/shell.ts tests/interiorShell.test.ts && git commit -m
  "feat(kit): interior room shell — walls, windows, clocks, wall decals, doorways, cutaway meshes"`

**Gates:** as Step 5; drift guard at the join. **Acceptance:** the Step 5 bullets.

---

### Task 8 (group C): Floors and window light shafts

**Files:**
- Modify (own): `src/render/kit/interior/floors.ts`, `src/render/kit/interior/shafts.ts`
- Create: `tests/interiorFloors.test.ts`

**Interfaces:**
- Consumes: `FLOOR_SEAM_GLSL`, `BOARDS_GLSL`, `TILES_GLSL` (Task 2); `roomLayout`, `floorLook`, `interiorIds` (Tasks 3, 5);
  `KitUniforms.uOutdoorNight` (Task 6).
- Produces:
  ```ts
  export const enum FloorMat { Boards = 0, Tiles = 1, Carpet = 2, Rug = 3, Mat = 4 }
  /** edges: bit 0 N, 1 E, 2 S, 3 W — the neighbour on that side is another floor kind (rugs and mats draw their border). */
  export interface FloorCell { i: number; h: number; mat: FloorMat; tint: RGB; edges: number }
  /** Inside + claimed-object + band cells of the rooms. A walkable cell takes its own id's kind (unknown floor ids and
   *  `legacy` stay legacy); a cell under furniture, wall or stairs takes the kind and tint most common among the walkable
   *  floor cells of its 8-neighbourhood, else the room's floorTile. */
  export function floorCells(a: MapAnalysis, ids: readonly (InteriorId | null)[], L: RoomLayout, claims: Claims): FloorCell[];
  /** RGBA8 per analysis cell: rgb = sRGB tint, a = mat << 4 | edges. */
  export function encodeFloor(a: MapAnalysis, cells: readonly FloorCell[]): Uint8Array;
  export function interiorFloorMaterial(tex: THREE.Texture, gridMin: THREE.Vector2, gridSize: THREE.Vector2): KitMaterialOptions;  // hookKey 'interiorFloor'
  export const floorFamily: Family<FloorCell[]>;   // claims CLAIM_SURFACE; build: floor mesh (receive, no cast) + shafts
  export const FLOOR_CATALOGUE: readonly InteriorCatalogueEntry[];   // interiorFloorMaterial PN no cast; roomShaftMaterial PNC no cast
  // shafts.ts
  export function roomShaftMaterial(alpha: number): KitMaterialOptions;   // transparent, depthWrite false, emissive daylight × (1 − uOutdoorNight); hookKey 'roomShaft'
  /** One soft strip per window feature: from the glass down and into the room (slant 0.6 south per unit fall) to the floor,
   *  vertex colours r = across (0..1), g = along (0 window … 1 floor). */
  export function shaftGeometry(L: RoomLayout): THREE.BufferGeometry | null;
  ```
  GLSL: grid cell from `vKitWorld` (as the terrain), texel fetch of the cell (no warp, no bilinear tint blend); boards
  and tiles from `floorGlsl.ts` (boards along z, 0.55 wide; tiles 1.0 cell, seams on the grid); carpet: soft pile noise;
  rug: pile + a border band 0.12 wide on its `edges` sides in tint × 0.7 + a thin inner line; mat: woven stripes, border.

- [ ] **Step 1: Write the failing test** `tests/interiorFloors.test.ts`:

```ts
it('gives the rug its kind and border edges, and the table cells the rug under them', () => {
  const { a, ids } = fakeInterior(['          ', ' WWWWWWWW ', ' ........ ', ' ..rrrr.. ', ' ..rTTr.. ', ' ..rrrr.. ', ' ........ ', '          ']);
  const cells = floorCells(a, ids, roomLayout(a, ids, []), claimsWithTable(a));
  const at = (x: number, y: number) => cells.find((c) => c.i === a.idx(x, y))!;
  expect(at(4, 4).mat).toBe(FloorMat.Rug);                        // under the table: the rug around it
  expect(at(3, 3).edges).toBe(0b1001);                             // NW corner of the rug: border N and W
  expect(at(4, 3).edges).toBe(0b0001);
  expect(at(5, 2).mat).toBe(FloorMat.Boards);
});
it('packs kind and edges in the alpha byte', () => {
  const data = encodeFloor(a, [{ i: 7, h: 0, mat: FloorMat.Rug, tint: [1, 0.5, 0], edges: 0b0101 }]);
  expect([...data.subarray(28, 32)]).toEqual([255, 128, 0, (3 << 4) | 0b0101]);
});
it('lays one shaft per window, from the glass to the floor', () => {
  const g = shaftGeometry(roomLayout(...HOUSE))!; g.computeBoundingBox();
  expect(g.boundingBox!.min.y).toBeCloseTo(0, 1); expect(g.boundingBox!.max.z).toBeGreaterThan(3 - RECESS);
  expect(roomShaftMaterial(0.4).transparent).toBe(true); expect(roomShaftMaterial(0.4).depthWrite).toBe(false);
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Look.** `--label t8 --interiors --static --review --review-before p4-base`: wooden boards in houses,
  tiles in the PC / Mart / lab in their own colours, rugs with borders under tables, mats at the exits, no moiré at the
  far wall, soft daylight shafts falling from the windows by day and none in `i_pc_night` (glass deep blue there); legacy
  cells (the PC's floor emblem) still pixel art; Retro and the controls 0.00 %.
- [ ] **Step 6: Commit** — `git add src/render/kit/interior/floors.ts src/render/kit/interior/shafts.ts
  tests/interiorFloors.test.ts && git commit -m "feat(kit): interior floors (boards, tiles, carpet, rugs, mats) and window
  light shafts"`

**Acceptance:** the Step 5 bullets.

---

### Task 9 (group C): Furniture kit I — home

**Files:**
- Modify (own): `src/render/kit/interior/furnitureHome.ts`
- Create: `tests/interiorHome.test.ts`

**Interfaces:**
- Consumes: `FurnitureGenerator`, `FurniturePiece`, `FurnitureOut`, `FURNITURE_SPEC` (Task 6); `Soup`, `lathe`, `tube`,
  `addShelf` (Task 2); `soften`, `mix`, `scale` (kit/palette.ts).
- Produces: `HOME_GENERATORS: Partial<Record<FurnitureKind, FurnitureGenerator>>` for `bed` (frame, mattress, pillow,
  blanket in main/second), `table` (top with rounded edge, four legs; cloth in accent when the art shows one), `chair`
  (seat cushion + back, facing the nearest table), `tv` (low cabinet + screen; screen into `glow`), `bookshelf`
  (`addShelf` sized to the footprint), `plant` (pot lathe + leaf crown of blobs, sways nothing), `fridge` (rounded box,
  two doors, handle), `sink` (counter with basin, tap, cupboard doors), `cabinet`, `crate` (planked box), `trashCan`,
  `vase` (lathes). Low kinds write to `out.low`, tall ones to `out.tall` (`isLow`). Quality: lathe sides 8 / 12 / 16
  (low / medium / high), blob subdivision likewise. Colours from `p.colors` through `soften()`.

- [ ] **Step 1: Write the failing test** `tests/interiorHome.test.ts`:

```ts
const KINDS = ['bed', 'table', 'chair', 'tv', 'bookshelf', 'plant', 'fridge', 'sink', 'cabinet', 'crate', 'trashCan', 'vase'] as const;
const piece = (kind: FurnitureKind): FurniturePiece => ({ kind, cells: [0], foot: fitFurniture(kind, 2, 3, 4, 5, 0, -Infinity),
  colors: { main: [0.7, 0.5, 0.3], second: [0.9, 0.9, 0.85], accent: [0.8, 0.2, 0.2], dark: [0.2, 0.15, 0.1] }, seed: 1 });
it.each(KINDS)('%s stays inside its footprint at its height, in the right soup', (kind) => {
  const out = newOut(); HOME_GENERATORS[kind]!(piece(kind), out, 'medium');
  const b = boxOf(out), f = piece(kind).foot;
  expect(b.min.x).toBeGreaterThanOrEqual(f.x0 - 1e-3); expect(b.max.x).toBeLessThanOrEqual(f.x1 + 1e-3);
  expect(b.min.z).toBeGreaterThanOrEqual(f.z0 - 1e-3); expect(b.max.z).toBeLessThanOrEqual(f.z1 + 1e-3);
  expect(b.max.y).toBeCloseTo(FURNITURE_SPEC[kind].height, 1);
  expect((isLow(kind) ? out.tall : out.low).empty).toBe(true);
});
it('is deterministic and scales with quality', () => {
  expect(hashOut(run('plant', 'medium'))).toBe(hashOut(run('plant', 'medium')));
  expect(tris(run('plant', 'low'))).toBeLessThan(tris(run('plant', 'high')));
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Look.** `--label t9 --interiors --static --review --review-before p4-base` on `i_house_1f`, `i_house_2f`,
  `i_may_1f`, `i_oldale_house`, `i_flat`, `i_fortree_house`, `i_sootopolis_house`, `i_lab`: beds, tables with chairs,
  TVs, bookcases, plants, kitchens recognisable from the GBA art, in its colours, standing where the game blocks (no
  model over a walkable cell: walk the stand-in player round with `&focus=1&x=&y=` spot checks), tall pieces dither when
  the stand-in stands behind them, low ones never.
- [ ] **Step 6: Commit** — `git add src/render/kit/interior/furnitureHome.ts tests/interiorHome.test.ts && git commit -m
  "feat(kit): home furniture — beds, tables, chairs, TVs, bookcases, plants, kitchens, crates"`

**Acceptance:** the Step 5 bullets.

---

### Task 10 (group C): Furniture kit II — Pokémon Center, Mart, computers, stairs

**Files:**
- Modify (own): `src/render/kit/interior/furnitureService.ts`
- Create: `tests/interiorService.test.ts`

**Interfaces:**
- Consumes: as Task 9.
- Produces: `SERVICE_GENERATORS` for `pc` (desk, monitor with a `glow` screen, keyboard), `healer` (the healing machine:
  a console with six Poké Ball cradles — red/white lathes — and a lit panel in `glow`), `pcCounter` (the nurse's counter:
  a long rounded counter in main, a top in second, a front band in accent; follows its component's L-shape cell by cell),
  `counter` (a shop / reception counter, same construction plainer), `martShelf` (a double-sided gondola: base, shelves,
  rows of goods in the tile's accent and second colours, seeded), `stairsUp` (steps rising north into the recess, 0.2
  rise, a rail on the open side), `stairsDown` (a stairwell: steps falling north below the floor, a rail around the hole —
  the floor family leaves the cell to the stairs).

- [ ] **Step 1: Write the failing test** `tests/interiorService.test.ts` — the footprint / height / soup test of Task 9
  for `pc`, `healer`, `pcCounter`, `counter`, `martShelf`, plus:

```ts
it('gives the healing machine six cradles and a lit panel', () => {
  const out = newOut(); SERVICE_GENERATORS.healer!(piece('healer'), out, 'medium');
  expect(out.glow.empty).toBe(false);
  expect(countClusters(out.tall, [0.85, 0.15, 0.15])).toBe(6);       // six red ball halves
});
it('climbs the stairs into the wall and sinks the stairwell under the floor', () => {
  const up = boxOf(run('stairsUp')), down = boxOf(run('stairsDown'));
  expect(up.max.y).toBeCloseTo(1.6, 1); expect(down.min.y).toBeLessThan(-0.5);
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Look.** on `i_pc_1f`, `i_pc_2f`, `i_mart`, `i_dept_1f`, `i_league`, `i_gate`, `i_weather`, `i_house_1f`
  (stairs), `i_house_2f` (stairs down), `i_pc_nurse`: the nurse behind her counter shows from the waist up and the counter
  never dithers; the healing machine, PC, Mart gondolas and counters read clearly; stairs lead into the wall / down.
- [ ] **Step 6: Commit** — `git add src/render/kit/interior/furnitureService.ts tests/interiorService.test.ts && git commit -m
  "feat(kit): service furniture — healing machine, nurse counter, computers, Mart shelves, counters, stairs"`

**Acceptance:** the Step 5 bullets.

---

### Task 11 (group C): Legacy boxes with HD pixels for unknown interior cells

**Files:**
- Modify (own): `src/render/overworld/materials.ts`, `src/render/overworld/world.ts` (material choice only),
  `src/render/overworld/overworldView.ts` (creates the HD twins), `src/render/kit/catalogue.ts` (`CatalogueSources.legacyHd`)
- Test: `tests/smoke/interiorWorld.test.ts` (one case appended)

**Interfaces:**
- Consumes: `XBR_GLSL` (actors/xbr.glsl.ts), `CELL`, `PAD` (metatileAtlas.ts), `interiorScope`.
- Produces: `createHdWorldMaterials(atlas: THREE.Texture, u: WorldUniforms): Pick<WorldMaterials, 'opaque' | 'cutout'>` —
  today's opaque (with the window glow) and cutout materials plus, after `<map_fragment>`, a replacement of the sampled
  colour by `xbrSample` at the fragment's texel position inside its metatile's 24×24 cell (the padding replicates the
  edge texels) when the texel footprint `max(fwidth(p))` < 1, else the plain lookup; program keys `world-opaque-hd`,
  `world-cutout-hd`. `World` draws the legacy quads with them when the interior kit ran on the build, else with today's.

- [ ] **Step 1: Write the failing test** (appended to `tests/smoke/interiorWorld.test.ts`):

```ts
it('draws unknown interior cells with the HD legacy materials, everything else with today\'s', () => {
  const mats = (g: number, n: number, style: WorldStyle) => { build(g, n, style); return legacyMeshes(world).map((m) => (m.material as THREE.Material).customProgramCacheKey()); };
  expect(mats(2, 2, 'modern').every((k) => k.endsWith('-hd') || k === 'world-water')).toBe(true);
  expect(mats(2, 2, 'retro').some((k) => k.endsWith('-hd'))).toBe(false);
  expect(mats(8, 1, 'modern').some((k) => k.endsWith('-hd'))).toBe(false);
  expect(mats(0, 10, 'modern').some((k) => k.endsWith('-hd'))).toBe(false);
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (catalogue: two LEGACY-attribute meshes with the HD twins).
  **Step 4: Run** it and `tests/smoke/catalogue.test.ts` → PASS.
- [ ] **Step 5: Look.** `--label t11 --interiors --static --review --review-before p4-base`: the cells still legacy on
  in-scope maps (the PC's floor emblem, `legacy`-labelled art, unknown ids) are smooth-edged, not blurred, no seams at
  metatile borders; Retro and the controls 0.00 %.
- [ ] **Step 6: Commit** — `git add src/render/overworld/materials.ts src/render/overworld/world.ts
  src/render/overworld/overworldView.ts src/render/kit/catalogue.ts tests/smoke/interiorWorld.test.ts && git commit -m
  "feat(world): HD-smoothed legacy boxes for the interior cells the kit leaves"`

**Acceptance:** the Step 5 bullets. **Join of group C (controller):** `npx tsc --noEmit && npm test`, the smoke drift
guards (`catalogue`, `battleCatalogue`), `interiorWorld`, then `npm run regress:live -- --label tC --static --compare
p4-base` (Retro and the controls 0.00 %).

---

### Task 12: Interior smoke tests, coverage report, live check with actors and doors

**Files:**
- Create: `tests/smoke/interiors.test.ts`
- Modify: whatever its findings require, kept small (larger issues go back to the controller)

**Interfaces:** Consumes everything above. Produces `out/coverage-interiors.txt` (per in-scope map: legacy share of in-map
non-void cells, worst first; average) — legacy = not `CLAIM_SURFACE`, or blocked and not `CLAIM_OBJECT`.

- [ ] **Step 1: Write the tests** `tests/smoke/interiors.test.ts` (extract as `World.build` runs it, margin 14):

```ts
const PC_1F = [[2, 2], [3, 1], [4, 5], [5, 4], [6, 4], [7, 0], [8, 4], [9, 11], [10, 5], [11, 5], [12, 2], [13, 6], [14, 3], [15, 2], [16, 12], [26, 53]];
it('models exactly one healing machine and one nurse counter in every Pokémon Center 1F', () => {
  for (const [g, n] of PC_1F) { const k = kinds(g, n); expect(k.healer, `${g}.${n}`).toBe(1); expect(k.pcCounter, `${g}.${n}`).toBe(1); }
});
it('gives every Mart shelves and a counter', () => {
  for (const [g, n] of MARTS) { const k = kinds(g, n); expect(k.martShelf).toBeGreaterThanOrEqual(2); expect(k.counter).toBeGreaterThanOrEqual(1); }
});
it('models every interaction-behaviour cell as its kind', () => {
  for (const m of IN_SCOPE) for (const i of cellsWithBehaviour(m, [MB.TELEVISION, MB.PC, MB.BOOKSHELF, MB.PICTURE_BOOK_SHELF,
    MB.POKEMON_CENTER_BOOKSHELF, MB.SHOP_SHELF])) expect(pieceKindAt(m, i), `${m.name} ${i}`).toBe(BEHAVIOR_IDS.get(m.beh(i)));
});
it('lays sound room layouts on every in-scope map', () => {
  for (const m of IN_SCOPE) expect(checkRoomLayout(m.a, m.layout), m.name).toEqual([]);
});
it('furnishes the houses', () => {
  expect(kinds(1, 0)).toMatchObject({ table: 1, tv: 1, stairsUp: 1 });     // Brendan's 1F
  expect(kinds(1, 1)).toMatchObject({ bed: 1, pc: 1, stairsDown: 1 });     // Brendan's 2F
});
it('writes the coverage report and holds it', () => {
  const c = coverageAll(IN_SCOPE);
  expect(c.average).toBeLessThanOrEqual(0.10);
  expect(c.over25.map((m) => m.name)).toEqual(RULED_OVER_25);   // [] unless the controller rules otherwise
});
```

  (The PC list is the 16 `*_PokemonCenter_1F` maps; adjust group/num to `loadAllMaps`' names if any differs — match by
  name, not number.)
- [ ] **Step 2: Run** → fix what fails (table labels, layout rules) within the owning modules; repeat.
- [ ] **Step 3: Live check.** `npm run regress:live -- --label t12 --static --selftest --compare p4-base --review
  --review-before p4-base`: Retro 0.00 % everywhere; Modern outdoor, battle and control entries 0.00 %; `door_enter` /
  `door_exit` pass (no compile, one build, frame gate) and `door_exit`'s outdoor frame equals p4-base's Modern; actor
  luminance on interior entries 0.9–1.15× Retro (median ≥ 0.95); `vigoroth` (Mom and the Vigoroths among the boxes in the
  modelled room) and `item_indoor` look right; `i_pc_nurse`: the nurse's upper body over the counter, no dither on it.
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
  --review-before p4-base`: every Global Constraint with numbers — Retro 0.00 %; Modern outdoor / battle / controls 0.00 %;
  calls ≤ 150 and triangles ≤ 1.5 M on every interior entry; door walks gated; luminance band.
- [ ] **Step 2: Rebuild cost.** `preview.measureRebuild()` × 5 (median) on every in-scope `i_*` entry: build ≤ 40 ms,
  build + first frame ≤ 100 ms. Over budget: profile (`roomLayout`, Soup writes, Scale4x decals) and fix, or report.
- [ ] **Step 3: Interleaved A/B.** `--ab --ab-feature interior` (64 quads) on `vigoroth`, `item_indoor`, `i_pc_1f`,
  `i_mart`, `i_house_1f`, `i_lab`, `i_dept_1f`; one `--ab-aa` on two of them. Budget Δgpu ≤ +1.5 ms, Δcpu ≤ +0.5 ms; over:
  profile (floor fragment cost, shafts overdraw, decal texture size) and fix, or report for a ruling.
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

**Placeholder scan:** `door_exit`'s state, `i_pc_nurse`'s cell and `i_secret`'s map are found by Task 1's probe (named
rule, recorded in the file); table ids are curated in Task 4 by the stated rules against the generated worklist; tuning
constants are starting values with the visual review that ends their tuning.

**Interfaces used across tasks:** `Soup`, `lathe`, `tube`, `lin` (T2 → T7, T9, T10); `wallPath`, `shellProfile`,
`shellPalette`, `addWindow`, `addShelf`, `wallFrameAt`, `ShellColors` (T2 → T5, T7, T9); `glowMesh` (T2 → T6, T9, T10);
`FLOOR_SEAM_GLSL`, `BOARDS_GLSL`, `TILES_GLSL` (T2 → T8); `InteriorId`, `FurnitureKind`, `FloorKind`, `interiorId`,
`interiorIds`, `BEHAVIOR_IDS`, `INTERIOR_TABLES` (T3 → T4–T12); `interiorScope`, `ClassifyOptions.primaryTileset` (T3 →
T6, T11); `roomLayout`, `checkRoomLayout`, `RECESS`, `WALL_H`, `WALL_T`, `WallRun`, `WallFeature`, `DoorGap`,
`partColors`, `wallColors`, `floorLook`, `fakeInterior` (T5 → T6–T12); `INTERIOR_FAMILIES`, `INTERIOR_CATALOGUE`,
`InteriorCatalogueEntry`, `wallVisible`, `fitFurniture`, `FURNITURE_SPEC`, `isLow`, `FurniturePiece`, `FurnitureOut`,
`FurnitureGenerator`, `FURNITURE_LOW`/`TALL`/`GLASS`, `furnitureFamilyWith`, `KitUniforms.uOutdoorNight`,
`World.setFailFamily` / `updateCutaway`, `setInteriorKit` (T6 → T7–T13); `shellFamily`, `SHELL_CATALOGUE`, `ROOM_GLASS`
(T7); `floorFamily`, `FLOOR_CATALOGUE`, `roomShaftMaterial`, `shaftGeometry` (T8); `HOME_GENERATORS` (T9);
`SERVICE_GENERATORS` (T10); `createHdWorldMaterials` (T11).

## Open questions for the user

1. **Scope:** only the spec's five secondaries (138 of 307 indoor maps: every house, Pokémon Center, Mart, Birch's lab,
   Lanette's house, Weather Institute, Dept Store, League lobby); gyms (10 maps, 8 puzzle tilesets), the Battle Frontier
   buildings, Contest halls, museums, Trick House puzzle rooms, Elite Four rooms and secret bases keep today's look?
   **Recommended: yes** — gyms as a later "Phase 4b" (each needs its own table and puzzle-aware rules).
2. **Time of day indoors:** room light stays fixed as today, but windows and light shafts follow the outdoor clock (deep
   blue glass and no shafts at night)? **Recommended: yes** (cheap, one uniform; alternative: always daylight windows).
3. **Proportions:** real-world heights (walls 2.6, counters 1.0, bookcases 2.1) on the game's blocked footprint, rising
   over the wall art above them, rather than squat furniture fitted exactly to the GBA's rows? **Recommended:
   real-world heights** (Phase 1's buildings did the same; the default camera still lines footprints up with the art).

**User answers (2026-10-27):** 1 — yes (the five secondaries; gyms etc. in a later Phase 4b). 2 — **"everything follows
the clock"** (not the recommendation): the whole room light follows the outdoor clock in Modern in-scope interiors, see
D8. 3 — real-world heights. Plan approved ("Godkjenn og kjør"), subagent-driven with parallel agents where the plan's
groups allow.
