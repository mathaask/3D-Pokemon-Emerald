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

**Branch:** `phase4b-special-interiors` from `main` (3418844). Do not rely on line numbers in `renderer.ts`,
`overworldView.ts`, `world.ts`, `room.ts` or the kit families: refer to functions by name.

**Out of scope (Phase 4c, a separate later plan):** the Battle Frontier (59 maps incl. Pyramid, Trainer Hill, tents),
contest lobby/halls, the S.S. Tidal and `InsideShip`, the General-primary Facility rooms (Space Center, harbors, cable
car, Shipyard), secret bases and their decorations. **Never in 4b or 4c:** Mt Pyre 1F–6F, the Aqua Hideout and the
Fossil Maniac's tunnel (dungeons: a cave pass), the link rooms (Trade Center, Record Corner, Colosseums, Union Room —
link-only, spec §12), templates/unused maps and the event islands (survey: 31 maps).

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
- Ledger: walkable cells carry nothing above 0.45 (`WALKABLE_SEAT`); one piece per cell for non-table kinds (`FURNITURE_SPLIT`);
  flat indoor floors (`flattenFloors`); half-height partitions; colours from the tilesets' ROM tiles (`colorInfo`), never
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
- **Night (D8 for the new rooms).** New night/dusk twins (`NIGHT_TWINS`, two-sided): room luma night/day 0.45–0.8, dusk
  0.7–0.95, actors 0.9–1.15. Dewford's dark entries are exempt from the room band (their light is the flash rule, D10).
- **Budgets (Medium, 1280×800).** ≤ 150 draw calls and ≤ 1.5 M triangles on every interior entry; warm rebuild
  (`preview.measureRebuild()`, median of 5) build ≤ 40 ms, build + first frame ≤ 100 ms on every new `i_*` entry;
  same-session A/B `--ab-feature interior` Δgpu ≤ **+2.0 ms** (Phase 4 ruling), Δcpu ≤ +0.5 ms; new GPU memory ≤ 4 MB per
  interior. **Patch budgets (proposed, ruled in Task 15):** a live-cell patch ≤ 1.0 ms CPU, a legacy-cell patch ≤ 12 ms
  (median ≤ 8 ms); no program compiled, no world build, no geometry/material/texture object created by a patch; every
  grid change applied in the sync of the frame that reads it (`patches == gridChanges` on a puzzle walk); the frame
  holding a patch ≤ the walk's median frame + 4 ms (live) / + 16 ms (legacy). Map loads into and out of gyms keep the
  crossing gate (one build, no compile, frame ≤ build + max(40, 0.5 × build)).
- **Coverage:** legacy share of in-map non-void cells on the 45 maps ≤ 10 % on average, no map > 25 % without a
  controller ruling; table coverage ≥ 97 % per tileset (on the tables' own maps).
- **Programs constant after boot.** Every new material is in `worldCatalogue` (via `INTERIOR_CATALOGUE`); the drift guard
  passes after every task that touches materials (parallel groups: at the join). No new `THREE` lights (Dewford's darkness
  reuses the existing lantern, D10).
- **Error handling (spec §11):** every family inside `runKit`'s try/catch; a failed family's `LiveCells` is dropped with
  it (its cells legacy, patched by the legacy path); `World.patch` never throws (a refusal rebuilds).
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
   map, both styles), harness `patches == gridChanges` (Tasks 1, 3, 14).
2. **Visibility differing from the GBA** — a maze wall, statue, barrier or toggle wall hiding a walkable cell or a trainer
   the GBA shows; an invisible wall (blocked cell drawn as floor) getting a model; Dewford's lit circle bigger or smaller
   than the GBA's. Pinned: Task 10 / 11a `massHeight` and prop heights ≤ their art rows; Task 14
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
  its `PuzzleId { kind, state, variant }`. **`interiorIds(a)` returns the puzzle kind for every state of a mechanic** —
  state-free — so no family but `puzzle` can see a cell's state.
- **D3 ⚑ Incremental world update (spec §3.2 rebuilds on every grid change).** A same-map, same-tileset grid change goes
  to `World.patch(grid, changed, ctx)`: (a) a changed cell some family registered as live (`LiveCells.accepts`) is applied
  by that family (`apply`: a state texel; never new geometry, material or texture); (b) an unclaimed cell is re-checked by
  re-running `analyze` (+ `flattenFloors` when the interior kit ran) and `emitLegacy` with the build's claims: if the
  analysis' structural arrays (`kind`, `height`, `groundH`, `groundOf`, `building`, `roundTree`, `waterLevel`) and
  `groundRefs` are unchanged and the new quad list differs from the old only in `metatile` / `variant` / `tu` / `tv` (same
  count, order, corners, normal, shade, `cutout`, `water`, `glow`), the UVs of those quads are rewritten in place
  (`addUpdateRange`); on an interior-kit map both the old and new ids of such a cell must be inert (`interiorId` null or
  `legacy`, no puzzle id, behaviour not in `BEHAVIOR_IDS`). All-or-nothing: every changed cell is checked before any is
  applied; anything else (a claimed cell that is not live, > `PATCH_MAX_CELLS` = 256 cells, a structural change, an
  outdoor Modern map — its families are not live yet) returns a refusal and the world rebuilds as today. Where it runs:
  Modern interiors (kit or no kit) and, by `PATCH_RETRO` (open question 1, default true), Retro on every map; Modern
  outdoors only measures (Task 3 reports the per-step outdoor rebuilds — Fortree bridges, Route 113 ash, Pacifidlog logs —
  as a follow-up candidate; making outdoor families live is not in 4b).
- **D4 Puzzle geometry is state-free; the state is a texel.** The `puzzle` family (first in `INTERIOR_FAMILIES`) claims
  every mechanic cell `CLAIM_SURFACE | CLAIM_OBJECT | CLAIM_TOP` whatever its state, builds the geometry every state needs,
  and stores the states in one RGBA8 `DataTexture` (one texel per analysis cell: r = state, g = variant, b = kind + 1).
  Floors pick their look in the fragment shader, raised parts (barriers, toggle walls, doors, stairs) move in the vertex
  shader (`vertTransform`: shadows follow through its depth twin) — both through `PUZZLE_STATE_GLSL`. A patch writes a
  texel and flags the texture (one 4–16 KB upload). The room layout reads every mechanic cell as room floor (inside,
  walkable) whatever its collision, so walls never move with a state.
- **D5 Mechanics: GBA logic, modern look, state at a glance.** The game's cells, collision and timing are untouched (we only
  draw): every state the grid holds has its own look, and those looks differ by a readable amount (`PUZZLE_LOOK`, tested).

  | Mechanic (kind) | Maps | GBA logic (unchanged) | 3D treatment | State shown by |
  |---|---|---|---|---|
  | Thin ice (`thinIce`) | Sootopolis 1F/B1F | ice → cracked when stepped off → broken; fall to B1F | glossy pale-blue slab with soft depth tint; cracked: white fracture lines; broken: dark hole with a jagged rim | cracks / hole |
  | Hidden stairs (`hiddenStairs`) | Sootopolis 1F | appear when a tier's ice is cleared | stone steps rise out of the ice edge | absent / risen |
  | Floor switch (`floorSwitch`) | Mauville, Mossdeep, Trick House 2 | step toggles | round pad: raised = dim with a rim, pressed = sunk with a glowing ring (the "light-up floors") | glow |
  | Electric barrier (`barrier`; variant pole / beam H / beam V) | Mauville | on/off by switch | metal poles, glass tubes between them; on: bright core inside the glass; off: clear empty glass | core lit / clear |
  | Arrow tile (`arrowTile`; state = direction) | Mossdeep, Trick House 7 | forced move; switches turn it | inset tile with glowing chevrons | chevron direction |
  | Warp pad (`warpPad`) | Mossdeep, Trick House 7 | warp | glowing ring pad | always lit |
  | Toggle wall (`toggleWall`; variant red / blue) | Trick House 3 | a switch raises one colour, lowers the other | tinted translucent glass block; up: raised to its art height; down: flush floor plate | raised / flush |
  | Gym door (`gymDoor`; state = slide frame) | Petalburg, E4 entrances/exits, Trick House doors | scripted closed / opening frames / open | framed sliding door panels | slide position |
  | Geyser hole (`geyserHole`) | Lavaridge 1F/B1F | warp | sand crater with a warm glow | static |
  | Rotating gate (actor) | Fortree, Trick House 6 | sprite rotation (`rotating_gate.c`) | wooden turnstile at the pivot, yaw from the sprite's rotation (Task 13) | yaw |
  | Darkness | Dewford | `flashLevel` radius | the lantern's falloff matched to the GBA radius (D10) | lit circle |
  | Slide ice / ledges / tiers | Sootopolis, Trick House 8, HoF; Lavaridge, Fortree; Sootopolis, Rustboro | floor behaviour | floor kinds `ice`, `ledge`, `tier` (Task 12): sheen, bevelled lip, edge shadow — flat floors (open question 2) | static |
  | Invisible walls | any blocked cell drawn as floor | collision only | nothing: geometry follows the art labels, never collision alone | — |
- **D6 Visibility rule on puzzle maps** (`MapProfile.puzzle`: the 10 gyms and 8 Trick House rooms). A model standing on
  blocked cells is at most as tall as the rows its GBA art spans there (its cells plus the same-label art rows north of
  them, un-projected), so at the default camera it hides what the GBA art hides and nothing more; nothing above
  `WALKABLE_SEAT` stands on a walkable or mechanic cell; maze masses with room on their north side are ≤ `MASS_H_MAX` = 1.0.
  Phase 4's real-world heights still hold in the town specials (rooms, not puzzles).
- **D7 Room layout v2.** `MapProfile.shell`: `'band'` (Phase 4's back band in a recess, `bandMax` per map) or
  `'perimeter'` (no band: walls stand on the boundary between room material and void, no recess; wall-art cells under the
  void and blocked masses inside the room become **masses** built as solids with their art as decals on their faces).
  Masses (`RoomLayout.masses`): Phase 4 partitions keep their own path; `mazeWall` / `ridge` labels and perimeter wall art
  become `maze` / `ridge` / `perimeter` masses. Doors: arrow mats as today, plus warps whose cell behaviour is a door
  (`DOOR_BEHAVIORS`, `NON_ANIMATED_DOOR`) or a NORMAL warp on a room's boundary row with void beyond (Petalburg's inter-room
  doors, the E4 entrances) cut a gap in that wall. The 137 Phase 4 layouts are pinned unchanged (15 digests).
- **D8 Initial profiles** (Task 2; Task 5 may propose changes with evidence, the controller edits `scope.ts`): perimeter
  shell for Dewford 3.3 (band fit 22 %), Sootopolis 15.0/15.1 (32 %), Fortree 12.1 (50 %) and Mossdeep Game Corner 14.11
  (33 %); band for the rest, `bandMax` 3. Themes: 16.0 `sidney`, 16.1 `phoebe`, 16.2 `glacia`, 16.3 `drake`, 16.4
  `champion`, 16.5–16.9 `hall`, 16.11 `hallOfFame`. Puzzle: the 10 gyms and 29.3–29.10.
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
  mechanic too, by applying decomp edit lists through `preview.setCells`.

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
- `src/render/kit/interior/geom/{puzzleFloors,puzzleRaised,gymWalls,leagueProps,specialFurniture}.ts` — pure geometry.
- `src/render/kit/interior/furnitureLeague.ts`, `furnitureSpecial.ts` — generator maps (stubs in Task 7).
- `src/render/kit/interior/themes.ts` — `themeOf`, `THEME_LIGHT`.
- `src/render/actors/rotatingGate.ts` — the gate model.
- Tests: `tests/gridDiff.test.ts`, `tests/smoke/helpers/worldDigest.ts`, `tests/smoke/worldPatch.test.ts`,
  `tests/kitPuzzleState.test.ts`, `tests/helpers/puzzle.ts`, `tests/interiorPuzzleFloors.test.ts`,
  `tests/interiorPuzzleRaised.test.ts`, `tests/interiorGymWalls.test.ts`, `tests/interiorLeague.test.ts`,
  `tests/interiorSpecial.test.ts`, `tests/rotatingGate.test.ts`, `tests/smoke/specialInteriors.test.ts`,
  `tests/smoke/interiorVisibility.test.ts`.

Modified:
- `tools/regress-live.ts`, `tools/gen-symbols.ts` + `src/game/symbols.ts`.
- `src/render/kit/semantics.ts` (`LiveCells`, `Family.live`, `runKit().live`), `src/render/overworld/world.ts` (`patch`),
  `src/render/overworld/overworldView.ts` (`updateGrid`, counters, flash light), `src/render/renderer.ts` (stats),
  `src/render/preview.ts` (`setCells`, stats).
- `src/render/kit/tables/building.ts`, `src/render/kit/interior/scope.ts`, `room.ts`, `shell.ts`, `geom/shellParts.ts`,
  `floors.ts`, `geom/floorPatterns.ts`, `furniture.ts` (spec/split entries for the new kinds), `index.ts`.
- `src/render/overworld/timeOfDay.ts` (`flashLight`), `src/game/spriteKinds.ts`, `src/render/actors/objectMap.ts`,
  `actorLayer.ts` (gate route).
- Tests: `tests/kitInteriorTables.test.ts`, `tests/smoke/interiorTables.test.ts`, `tests/interiorFurniture.test.ts` (kind
  lists), `tests/interiorRoom.test.ts`, `tests/smoke/interiorRooms.test.ts`, `tests/interiorFloors.test.ts`,
  `tests/timeOfDay.test.ts`, `tests/overworldLighting.test.ts`, `tests/smoke/interiorWorld.test.ts`; `README.md`, `CLAUDE.md`.

---

### Task 1: Harness entries, puzzle fixtures, grid-change counters, `p4b-base`

Today the harness has no gym, League, special-room or Trick House puzzle entry (only `i_gym` = Petalburg 8.1 and
`i_trickhouse` = the corridor 29.2), no save state inside a gym, and no way to change a cell in a preview. This task adds
all of it, records what every runtime cell change costs today, and captures the Phase 4b baseline.

**Files:**
- Create: `tools/lib/decompEdits.ts`, `tools/lib/warp.ts`, `tools/puzzle-states.ts`
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
  'patch' | 'build'` — writes the preview grid and rebuilds (today: always `'build'`; Task 3 routes it through
  `updateGrid`).
- Produces (harness):
  ```ts
  /** A puzzle walk / edit entry's gate. 'record': report only (today's rebuild ms + first frame per change). 'gate':
   *  after the settle, builds 0, programs constant, patches == gridChanges ≥ 1, every patch within its budget
   *  (path 'live' ≤ 1.0 ms, 'legacy' ≤ 12 ms), the patch frame ≤ the walk's median frame + 4 / + 16 ms. Per style:
   *  `retro` / `modern` (a style without its own mode records). */
  interface PuzzleGate { retro: 'record' | 'gate'; modern: 'record' | 'gate'; path: 'live' | 'legacy' }
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
  `i_pz_e4` (16.0: the entrance-closing script), `i_pz_lily` (13.3: the painting script; legacy/decor path). Outdoor
  measurements (`o_*`, run with `--static` only, record, never gated): `o_fortree_bridge` (0.4: four
  `METATILE_Fortree_Bridge*_Lowered`), `o_ash` (0.28: four ash cells → grass), `o_pacifidlog` (0.15: a log bridge's
  sunk frame). Live walks (`puzzle` record, crossing-style frame recording): `pz_ice` (`out/pz_sootopolis.state`: three
  steps over thin ice), `pz_switch` (`pz_mauville`: onto the switch), `pz_arrows` (`pz_mossdeep`: onto the arrow switch),
  `pz_e4_door` (`pz_e4`: the door closes behind the player), `pz_th3` (`pz_th3`: onto the switch); map loads
  (`crossings: 1`): `gym_hole` (`pz_lavaridge`: into a geyser hole → B1F). `NIGHT_TWINS` += the seven new pairs
  (`i_g_dewford_night_dark ↔ i_g_dewford_dark`, room band exempt); `INTERIOR_LIVE` += the walks (their maps);
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
  builds, rebuild ms and first-frame ms per change (today's cost, the "before" of D3); the outdoor `o_*` numbers.
- [ ] **Step 6: Commit** — `git add tools/lib/decompEdits.ts tools/lib/warp.ts tools/puzzle-states.ts tools/regress-live.ts
  tools/gen-symbols.ts src/game/symbols.ts src/render/overworld/overworldView.ts src/render/renderer.ts src/render/preview.ts
  && git commit -m "tools: Phase 4b entries (gyms, League, specials, Trick House, twins, 4c controls), puzzle fixtures and
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
  export type WallPart = 'wall' | 'window' | 'decor' | 'clock' | 'painting' | 'blackboard' | 'mazeWall' | 'ridge';
  export type FurnitureKind = /* Phase 4's 19, then */ … | 'statue' | 'pillar' | 'brazier' | 'dais' | 'displayCase'
    | 'fishTank' | 'modelShip' | 'plinth' | 'slotMachine' | 'rouletteTable' | 'schoolDesk' | 'flowerBin' | 'bikeRack' | 'machine';
  export type PuzzleKind = 'thinIce' | 'floorSwitch' | 'barrier' | 'arrowTile' | 'warpPad' | 'gymDoor' | 'toggleWall'
    | 'hiddenStairs' | 'geyserHole';
  export const PUZZLE_KINDS: readonly PuzzleKind[];
  export type InteriorId = FloorKind | WallPart | FurnitureKind | PuzzleKind | 'legacy';
  /** A mechanic id's meaning: its kind, its state (0 … puzzleStateCount(kind) − 1) and a kind-specific variant
   *  (barrier: 0 pole, 1 beam H, 2 beam V; toggleWall: 0 red, 1 blue; arrowTile: state = direction 0 N, 1 E, 2 S, 3 W;
   *  gymDoor: state = slide frame, 0 closed … last open; thinIce: 0 intact, 1 cracked, 2 broken; floorSwitch: 0 raised,
   *  1 pressed; hiddenStairs: 0 hidden, 1 stairs; warpPad, geyserHole: state 0 only). */
  export interface PuzzleId { kind: PuzzleKind; state: number; variant: number }
  export function puzzleStateCount(kind: PuzzleKind): number;   // thinIce 3, floorSwitch 2, barrier 2, arrowTile 4,
    // gymDoor 4, toggleWall 2, hiddenStairs 2, warpPad 1, geyserHole 1
  export interface InteriorTable {
    name: string; ids: ReadonlyMap<number, InteriorId>; target: number; pins: readonly TablePin[];
    /** The primary this table's ids < 512 belong to (default gTileset_Building, read from BUILDING_PRIMARY); another
     *  primary's ids the table uses are labelled in `ids` (BikeShop: gTileset_General). */
    primary?: number;
    /** The maps ("group.num") the table is in scope on (absent: every map of its tileset — Phase 4's five). */
    maps?: readonly string[];
    /** Mechanic ids → their meaning; every key is also in `ids`, labelled with its kind. */
    puzzle?: ReadonlyMap<number, PuzzleId>;
  }
  /** As today, plus `primary` (default gTileset_Building): ids < 512 of another primary read the table's own `ids`. */
  export function interiorId(m: number, beh: number, secondary: number, tables?: ReadonlyMap<number, InteriorTable>,
    primary?: number): InteriorId | null;
  /** The mechanic meaning of metatile m on a map of `secondary` (null: none). */
  export function puzzleId(m: number, secondary: number, tables?: ReadonlyMap<number, InteriorTable>): PuzzleId | null;
  ```
  `interiorIds(a)` passes `a.opts.primaryTileset`. `INTERIOR_TABLES` gets the 23 entries.
  Starting `FURNITURE_SPEC` (height, depth) / `FURNITURE_SPLIT`: statue 1.6/0.8 component, pillar 2.6/0.7 cell, brazier
  1.1/0.6 cell, dais 0.3/2.0 component, displayCase 1.1/0.8 rects, fishTank 1.5/0.8 rects, modelShip 1.0/1.2 component,
  plinth 0.9/0.7 cell, slotMachine 1.5/0.7 cell, rouletteTable 0.95/1.6 component, schoolDesk 0.75/0.7 cell, flowerBin
  0.7/0.8 cell, bikeRack 0.9/1.0 rects, machine 1.4/0.8 rects (Tasks 11a/11b report tuning; the controller edits).
  Starting `FLOOR_MAT`: stone/ice/metal/ledge/tier → Tiles, sand → Carpet (Task 12 gives them their own).
- Produces (`scope.ts`):
  ```ts
  export type ShellMode = 'band' | 'perimeter';
  export type RoomTheme = 'sidney' | 'phoebe' | 'glacia' | 'drake' | 'champion' | 'hall' | 'hallOfFame';
  export interface MapProfile { shell: ShellMode; bandMax: number; theme: RoomTheme | null; puzzle: boolean }
  export const DEFAULT_PROFILE: MapProfile;                  // { shell: 'band', bandMax: 3, theme: null, puzzle: false }
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
  worklists).

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
    puzzle: new Map([[0x220, { kind: 'thinIce', state: 0, variant: 0 }], [0x221, { kind: 'thinIce', state: 1, variant: 0 }]]) };
  const tables = new Map([[0xdead, t]]);
  expect(interiorId(0x0a0, MB.NORMAL, 0xdead, tables, SYM.gTileset_General)).toBe('boards');
  expect(interiorId(0x0a0, MB.NORMAL, 0xdead, tables)).toBeNull();            // Building primary: not labelled
  expect(interiorId(0x221, MB.NORMAL, 0xdead, tables)).toBe('thinIce');
  expect(puzzleId(0x221, 0xdead, tables)).toEqual({ kind: 'thinIce', state: 1, variant: 0 });
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
  expect(mapProfile('15.0')).toMatchObject({ shell: 'perimeter', puzzle: true });
  expect(mapProfile('16.3')).toMatchObject({ shell: 'band', theme: 'drake', puzzle: false });
  expect(mapProfile('2.2')).toEqual(DEFAULT_PROFILE);
  expect(PHASE4B_MAPS.size).toBe(45);
  setPhase4bScope(PHASE4B_DEFAULT);
});
```

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
- Modify: `src/render/kit/semantics.ts`, `src/render/overworld/world.ts`, `src/render/overworld/overworldView.ts`,
  `src/render/renderer.ts`, `src/render/preview.ts`, `tools/regress-live.ts` (gate switches only)

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
  /** Retro patches its legacy cells too (open question 1; false: Retro rebuilds as today). */
  export const PATCH_RETRO = true;
  export type PatchRefusal = 'noWorld' | 'tooMany' | 'outdoorKit' | 'retro' | 'claimedNotLive' | 'notInert' | 'structure'
    | 'quads';
  export type PatchResult = { ok: true; ms: number; live: number; legacy: number } | { ok: false; reason: PatchRefusal };
  // World += patch(grid: GridData, changed: readonly number[], ctx: WorldBuildContext): PatchResult;
  //          patches: number; lastPatchMs: number; lastPatch: PatchResult | null;
  ```
  The build keeps what a patch needs (the analysis, claims, the legacy quad list with each quad's batch and first vertex,
  the families' `LiveCells`, whether the kit ran and which). `patch` follows D3: map `changed` (grid indices) to analysis
  cells; refuse `'outdoorKit'` when outdoor families ran, `'retro'` in Retro without `PATCH_RETRO`, `'tooMany'` over the cap;
  each claimed cell must be accepted by a `LiveCells` (`'claimedNotLive'`); the unclaimed ones go through the re-analysis
  check (`'notInert'`, `'structure'`, `'quads'`); then apply all (live `apply`, UV rewrite with the atlas' `uv()` exactly as
  `buildMeshes` writes them, `addUpdateRange`, the analysis and quad list swapped for the new ones). It never calls
  `analyzeMetatiles`, never throws (an exception is a refusal, warned once per map).
- Produces (`overworldView.ts`): `updateGrid(grid: GridData, build: () => void): 'patch' | 'build'` — the sync's
  same-map-key, same-tilesets grid change and the preview's `setCells` both call it: `changedCells` against the last
  grid, `world.patch`, else `build()`; counters `gridChanges`, `patches`, `lastPatchMs`, `patchRefusals: Record<PatchRefusal,
  number>`. A map or tileset change still builds directly (as today). `wouldRebuild` is unchanged (the SyncGate defers map
  loads only).
- Produces (stats): `Renderer.stats()` / `PreviewApp.stats()` += `patches`, `lastPatchMs` (and `gridChanges`, Task 1).
- Produces (`tests/smoke/helpers/worldDigest.ts`): `worldDigest(w: World): string` — FNV-1a over every mesh under
  `w.group` in traversal order: its name, visibility, material program key (`customProgramCacheKey`), every geometry
  attribute's bytes (index included), instance attributes, and every `DataTexture` it references (`userData.digest`
  marks state textures).

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
  expect(patchVsBuild(0, 4, 'retro', fortreeBridge(4)).r.ok).toBe(true);  // Retro: legacy only
  expect(patchVsBuild(29, 5, 'retro', manyEdits(29, 5, 300)).r).toEqual({ ok: false, reason: 'tooMany' });
});
it('refuses a claimed cell no family follows', () => {
  // an in-scope Phase 4 room: a furniture cell changed (no LiveCells there)
  expect(patchVsBuild(1, 0, 'modern', [{ ...cellOf(1, 0, 'table'), metatile: 0x201, blocked: true, label: 't' }]).r)
    .toEqual({ ok: false, reason: 'claimedNotLive' });
});
```

  (Helpers `crack`, `broken`, `fortreeBridge`, `manyEdits`, `cellOf`, `PUZZLE_MAPS` are declared in the file from
  `tools/lib/decompEdits.ts` and the maps' grids.) Plus a live-cell case with a fake family: a `Family` whose `live`
  accepts one cell and counts `apply` calls — `world.patch` on that cell → `{ ok: true, live: 1 }`, one apply, builds
  unchanged; the same family made to fail in `build`: its claims roll back and its live cells are dropped, so the cell
  patches as legacy (`{ ok: true, live: 0, legacy: 1 }`). The legacy cases need the gyms out of scope — true by default
  until Task 7, which wraps them in `setPhase4bScope(false)`; Task 14 checks every edit with the full kit.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (semantics, world, view, renderer, preview `setCells` → `updateGrid`).
- [ ] **Step 4: Run** → PASS; `npx tsc --noEmit && npm test`; after the group-A join, `catalogue`, `golden`, `semantics`,
  `interiorWorld` unchanged.
- [ ] **Step 5: Gate (after the join).** Switch every puzzle walk and edit entry to `retro: 'gate'`, `modern: 'gate'`
  (path `legacy`: the gyms are out of scope, legacy in both styles). `npm run regress:live -- --label t3 --static --compare
  p4b-base` → 0.00 % in both styles on every entry; every walk and edit entry: builds 0, patches == gridChanges, patch ≤ 12
  ms, no compile; `gym_hole` passes its crossing gate. Report per entry: patch ms (max / median), refusals, and the frame
  costs against Task 1's rebuild numbers; the `o_*` entries: Retro patched (ms), Modern `'outdoorKit'` (today's rebuild ms
  kept as the follow-up's evidence).
- [ ] **Step 6: Commit** — `git commit -m "feat(world): incremental world update — live cells and legacy UV patches
  instead of a rebuild per cell change" -- <the files above>` (pathspec)

**Gates:** as Step 5. **Acceptance:** patched = rebuilt digests; walks gated with no build.

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
  (`legacy`/unlabelled with no interaction behaviour), and every state of one mechanic on a cell shares the kind and
  variant (the state alone changes); blocked cells drawn as floor art are labelled their floor kind (invisible walls
  stay invisible, D5); maze and rock masses `mazeWall` / `ridge`; raised tier art `tier`, ledges `ledge`; framed pictures
  `painting`, chalkboards `blackboard`. 4c: the E4 entrance/exit door metatiles are `gymDoor` frames; the HoF floor `ice`
  is cosmetic (floor kind, no mechanic). 4d: `bikeShop.ts` sets `primary: SYM.gTileset_General` and labels the General ids
  its map uses.
- [ ] **Step 3: Pins** read off the map renders, at least one per mechanic state (from the decomp's coordinates).
- [ ] **Step 4: Run** `npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/interiorTables.test.ts` →
  PASS for the agent's tilesets.
- [ ] **Step 5: Commit** — `git commit -m "data(kit): <tilesets> interior tables" -- src/render/kit/tables/interior/<own files>`

**Acceptance:** ≥ 97 % labelled per tileset; every live id a mechanic or inert; the report lists `legacy` ids and why.

---

### Task 5 (group B): Room layout v2 — profiles, perimeter shells, masses, doors in any wall (pure)

**Files:**
- Modify (own): `src/render/kit/interior/room.ts`, `tests/interiorRoom.test.ts`, `tests/helpers/fakeInterior.ts` (legend
  only), `tests/smoke/interiorRooms.test.ts`

**Interfaces:**
- Consumes: `MapProfile`, `DEFAULT_PROFILE` (Task 2), the new ids and `PUZZLE_KINDS` (Task 2).
- Produces:
  ```ts
  export type MassKind = 'maze' | 'ridge' | 'perimeter';
  /** A solid block of blocked room cells the shell builds as a low solid (Task 10): `backed` = it touches the void on its
   *  north side (a perimeter wall's art, may stand to WALL_H); otherwise room lies north of it (≤ MASS_H_MAX, D6). */
  export interface Mass { id: number; kind: MassKind; cells: number[]; backed: boolean }
  // RoomLayout += masses: Mass[]; mass: Int32Array (per cell: its mass id, −1); runs carry `mass: true` around masses
  //   (as `partition: true` today); profile: MapProfile
  export function roomLayout(a: MapAnalysis, ids: readonly (InteriorId | null)[], warps: readonly GridWarp[],
    profile?: MapProfile): RoomLayout;                      // memoised per analysis and profile; default DEFAULT_PROFILE
  export function checkRoomLayout(a: MapAnalysis, L: RoomLayout, warps?: readonly GridWarp[]): string[];
    // += a mass run crossing a walkable cell, a mass cell inside, a door gap not on a run of its own line
  ```
  Rules: **mechanic cells** (an id in `PUZZLE_KINDS`) are inside and walkable for the layout whatever their collision
  (D4). **Band** profile: Phase 4's rules with `profile.bandMax` for `BAND_MAX`; `mazeWall` / `ridge` cells in the room →
  masses of that kind. **Perimeter** profile: every in-map non-void cell is room material; N/E/S/W runs stand on its
  boundary with the void (no recess: N line = the top row y); blocked cells with a wall-part id (`wall`, `window`, `clock`,
  `decor`, `painting`, `blackboard`, `mazeWall`) or `ridge`, 4-connected, are masses — `perimeter` when backed, else
  `maze` / `ridge` by label; no band, no features (their art becomes the masses' decals in Task 10). **Doors** (both
  profiles): arrow mats as today; a warp on a cell with a door behaviour (`DOOR_BEHAVIORS`, `NON_ANIMATED_DOOR`) or a
  `gymDoor` id, or a NORMAL-behaviour warp on a room's boundary cell with void beyond, cuts a gap in the run on that side
  (`dir` = the side the void lies on; adjacent cells merge). Phase 4 maps (DEFAULT_PROFILE, no new ids) give byte-identical
  layouts (the 15 pinned digests).
- Produces (`fakeInterior.ts` legend additions): `Z` mazeWall (blocked), `R` ridge (blocked), `i` thinIce (walkable),
  `I` thinIce (blocked: a broken hole reads blocked in some states), `b` barrier (blocked), `G` gymDoor (beh
  `PETALBURG_GYM_DOOR`, walkable), `N` NORMAL warp floor (walkable), `P` painting (wall art).

- [ ] **Step 1: Write the failing tests** (appended to `tests/interiorRoom.test.ts`):

```ts
const GYM: MapProfile = { shell: 'perimeter', bandMax: 3, theme: null, puzzle: true };
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
  expect(L.doors).toEqual([{ dir: 'S', line: 4, from: 3, to: 4 }, { dir: 'S', line: 8, from: 3, to: 4 }]);
  expect(checkRoomLayout(a, L)).toEqual([]);
});
it('takes a deeper band where the profile allows it', () => {
  const deep = ['       ', ' WWWWW ', ' WWWWW ', ' WWWWW ', ' WWWWW ', ' ..... ', '       '];
  expect(roomLayout(...asArgs(fakeInterior(deep)), { ...DEFAULT_PROFILE, bandMax: 4 }).runs.find((r) => r.dir === 'N')!.line)
    .toBe(5 - RECESS);
});
```

  (`asArgs({ a, ids }) = [a, ids, []] as const`.) `tests/smoke/interiorRooms.test.ts`: the 15 pinned Phase 4 digests
  unchanged; for the 45 maps (`setPhase4bScope(true)`, each with `mapProfile`) the findings are written to
  `out/rooms-4b.txt` (pinned to zero in Task 14, not here: the tables may still be filling).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS (`npx vitest run tests/interiorRoom.test.ts`;
  the smoke after the group-B join). Report the findings per map and whether a map's D8 profile looks wrong (evidence:
  band fit, findings) — the controller edits `scope.ts`.
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
  /** Every analysis cell whose metatile is a mechanic id of the map's secondary (through puzzleId, or the seed). */
  export function puzzleCells(a: MapAnalysis): PuzzleCell[];
  /** Test seam (as seedInteriorIds): makes puzzleCells read these ids (one per analysis cell, null = none). */
  export function seedPuzzleIds(a: MapAnalysis, ids: readonly (PuzzleId | null)[]): void;
  /** One RGBA8 texel per analysis cell (r state, g variant, b kind index + 1, 0 none), NearestFilter, no mipmaps;
   *  `texture.userData.digest = true` (worldDigest reads its data). */
  export class PuzzleStateTexture {
    readonly texture: THREE.DataTexture;
    constructor(a: MapAnalysis, cells: readonly PuzzleCell[]);
    state(i: number): number;
    /** Writes the texel and flags the texture once (needsUpdate); no allocation. */
    set(i: number, state: number): void;
  }
  /** GLSL (vertex and fragment): uniforms uPuzzleState (sampler2D), uPuzzleGrid (vec4: minX, minY, GW, GH);
   *  `vec4 puzzleTexel(vec2 gridXY)`, `float puzzleStateAt(vec2 gridXY)` (texelFetch, no filtering). */
  export const PUZZLE_STATE_GLSL: string;
  export function puzzleUniforms(tex: PuzzleStateTexture, a: MapAnalysis): Record<string, { value: unknown }>;
  /** accepts: raw's metatile is a mechanic id of the same kind and variant as the cell's (collision and elevation any);
   *  apply: tex.set(i, its state). */
  export function puzzleLiveCells(name: string, a: MapAnalysis, cells: readonly PuzzleCell[], tex: PuzzleStateTexture): LiveCells;
  /** The look of each state, shared by the shaders (as GLSL constants via puzzleLookGlsl) and the tests. */
  export interface PuzzleStateLook { tint: RGB; glow: number; raise: number; crack: number; open: number }
  export const PUZZLE_LOOK: Readonly<Record<PuzzleKind, readonly PuzzleStateLook[]>>;   // one entry per state
  export function puzzleLookGlsl(): string;   // `PuzzleStateLook puzzleLook(int kind, int state)` from PUZZLE_LOOK
  ```
  `PUZZLE_LOOK` starting values (tuned in Tasks 8/9's looks): thinIce intact {tint (0.80, 0.92, 1.0), crack 0}, cracked
  {crack 1}, broken {open 1}; floorSwitch raised {glow 0, raise 0.08}, pressed {glow 1, raise 0}; barrier off {glow 0},
  on {glow 1}; arrowTile 4 × {glow 0.6} (direction from the state); gymDoor frames {open 0, 0.33, 0.67, 1}; toggleWall
  down {raise 0}, up {raise 1}; hiddenStairs hidden {raise 0}, stairs {raise 1}; warpPad {glow 0.8}; geyserHole {glow 0.3}.
- Produces (`tests/helpers/puzzle.ts`): `fakePuzzle(rows, legend?)` → `fakeInterior` plus `seedPuzzleIds` from a legend
  of `PuzzleId`s (defaults: `i` thinIce 0, `c` thinIce 1, `o` thinIce 2, `s` floorSwitch 0, `S` floorSwitch 1, `b` barrier
  pole off, `B` barrier beam H on, `d` gymDoor 0, `w` toggleWall red 0, `x` toggleWall red 1; blocked states — broken
  ice, barrier on, toggle wall up — carry collision as the game sets it). Letters not in it keep `fakeInterior`'s legend.

- [ ] **Step 1: Write the failing tests** `tests/kitPuzzleState.test.ts`:

```ts
it('finds the mechanic cells and writes their states into the texture', () => {
  const { a } = fakePuzzle(['       ', ' WWWWW ', ' .ics. ', ' ..b.. ', '       ']);
  const cells = puzzleCells(a), tex = new PuzzleStateTexture(a, cells);
  expect(cells.map((c) => [c.kind, c.state])).toEqual([['thinIce', 0], ['thinIce', 1], ['floorSwitch', 0], ['barrier', 0]]);
  const c = cells[2]; tex.set(c.i, 1);
  expect(tex.state(c.i)).toBe(1); expect(tex.texture.needsUpdate).toBe(true);   // (version bumped)
});
it('accepts a change to another state of the same mechanic only', () => {
  const { a } = fakePuzzle(['     ', ' WWW ', ' i.s ', '     ']), cells = puzzleCells(a);
  const live = puzzleLiveCells('puzzle', a, cells, new PuzzleStateTexture(a, cells));
  const ice = cells[0];
  expect(live.accepts(ice.i, rawOf('thinIce', 2))).toBe(true);          // broken, collision any
  expect(live.accepts(ice.i, rawOf('floorSwitch', 1))).toBe(false);
  expect(live.accepts(ice.i, 0x201)).toBe(false);                       // not a mechanic id
});
it('makes every state of a mechanic readable at a glance', () => {
  for (const kind of PUZZLE_KINDS) {
    const looks = PUZZLE_LOOK[kind];
    expect(looks).toHaveLength(puzzleStateCount(kind));
    for (let s = 1; s < looks.length; s++) for (let t = 0; t < s; t++) {
      const d = Math.max(Math.abs(luma(looks[s].tint) - luma(looks[t].tint)), Math.abs(looks[s].glow - looks[t].glow),
        Math.abs(looks[s].raise - looks[t].raise), Math.abs(looks[s].crack - looks[t].crack), Math.abs(looks[s].open - looks[t].open));
      expect(d, `${kind} ${t}/${s}`).toBeGreaterThanOrEqual(kind === 'arrowTile' ? 0 : 0.3);   // arrows differ by direction
    }
  }
});
it('keeps every other family blind to a mechanic cell\'s state', () => {
  // the same map with each mechanic in each state: interiorIds, the room layout and the furniture/shell/floor extract agree
  const variants = ['i', 'c', 'o'].map((k) => fakePuzzle(['        ', ' WWWWWW ', ` .T${k}T. `, ' ...... ', '        ']));
  const out = variants.map(({ a }) => extractAll({ a, events: NO_EVENTS, quality: 'medium' },
    [furnitureFamily, shellFamily, floorFamily].map(withoutPuzzleCells)));
  for (const o of out.slice(1)) expect(digestPayloads(o)).toBe(digestPayloads(out[0]));
});
```

  (`rawOf(kind, state)` = the fake legend's metatile with no collision; `withoutPuzzleCells(f)` = `f` after a stand-in
  puzzle family that claims the mechanic cells first, as Task 7's will; `digestPayloads` hashes the payloads as JSON with
  typed arrays as lists; `T` is `fakeInterior`'s table. A blocked-state case — `b` / `B`, `w` / `x` — is added at the
  group-B join, once Task 5's "mechanic cells are floor" rule is in.)
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(kit): puzzle state core — mechanic cells, state texture, live cells,
  state looks" -- src/render/kit/interior/puzzle/state.ts tests/kitPuzzleState.test.ts tests/helpers/puzzle.ts`

**Acceptance:** tests pass; the invariance test fails if `interiorIds` exposes a state (checked by the reviewer by mutation).

---

### Task 13 (group B): Rotating gates as models

**Files:**
- Create: `src/render/actors/rotatingGate.ts`, `tests/rotatingGate.test.ts`
- Modify (own): `src/game/spriteKinds.ts`, `src/render/actors/objectMap.ts`, `src/render/actors/actorLayer.ts` (the gate
  route only), `tools/gen-symbols.ts` (WANTED += `SpriteCallback_RotatingGate`), `src/game/symbols.ts`

**Interfaces:**
- Consumes: `SpriteSnap` (`callback`, `rotation`, `worldX`, `worldY`, `width`, `height`), `SpriteSample` (spriteColors).
- Produces:
  ```ts
  /** A Fortree / Trick House 6 gate (rotating_gate.c): the sprite whose callback is SpriteCallback_RotatingGate. */
  export function isRotatingGate(s: SpriteSnap): boolean;
  /** Arm lengths (cells, 0–2) towards N/E/S/W at rotation 0, read from the sprite's opaque pixels along each axis from its
   *  centre (the pivot). */
  export interface GateArms { n: number; e: number; s: number; w: number }
  export function gateArms(sample: SpriteSample): GateArms;
  /** A wooden turnstile: a post at the pivot, one rail per arm (0.9 high, two bars), coloured from the sprite's main /
   *  dark colours; quality scales the post's sides (8/12/16). */
  export function gateGeometry(arms: GateArms, colors: { main: RGB; dark: RGB }, q: Quality): THREE.BufferGeometry;
  ```
  The actor layer routes a gate sprite to `'model'` in Modern (Retro: its card, as today); the model's yaw is the
  sprite's `-rotation` every frame (the GBA's affine rotation, so it turns exactly as the game draws it), its position the
  pivot cell. `ObjectModelKind` += `'rotatingGate'`.

- [ ] **Step 1: Write the failing tests:** `gateArms` on synthetic samples (an L gate 2+1, a T gate) → the arms;
  `gateGeometry` bounding box = the arms' extent (± 0.05) and height 0.9; rails ≤ 0.9 (D6: they hide nothing the sprite
  does not); `isRotatingGate` by callback only; `routeSprite` of a gate in Retro → `'card'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; `npm run symbols`. **Step 4: Run** → PASS.
- [ ] **Step 5: Look (after the group-B join).** `i_g_fortree` and `i_th6` with `actors=1` show the gates as turnstiles at
  the GBA's angles; Retro 0.00 %.
- [ ] **Step 6: Commit** — `git commit -m "feat(actors): rotating gates as turnstile models turning with the sprite" --
  <the files above>` (pathspec)

**Acceptance:** tests pass; the look's bullets.

**Join of group B (controller):** `npx tsc --noEmit && npm test`; smoke `interiorTables` (4b on), `interiorRooms`,
`catalogue`; `npm run regress:live -- --label tB --static --compare p4b-base` → 0.00 % except the Modern gate entries
(Task 13); the scope is still off. Apply Task 5's profile proposals to `scope.ts` (controller commit).

---

### Task 7: Integration — the 4b scope on, the puzzle family, themes, darkness × clock

**Files:**
- Create: `src/render/kit/interior/puzzle/index.ts`, stubs `puzzle/floors.ts`, `puzzle/raised.ts`,
  `furnitureLeague.ts`, `furnitureSpecial.ts` (empty kind sets, `null` builders, empty catalogues, `{}` generator maps),
  `src/render/kit/interior/themes.ts`
- Modify: `src/render/kit/interior/scope.ts` (`PHASE4B_DEFAULT = true`), `index.ts` (families, catalogue), `shell.ts`,
  `floors.ts`, `furniture.ts` (pass `mapProfile(ctx.mapKey)` to `roomLayout` only), `src/render/overworld/timeOfDay.ts`,
  `src/render/overworld/overworldView.ts` (flash light), `tests/timeOfDay.test.ts`, `tests/overworldLighting.test.ts`,
  `tests/smoke/interiorWorld.test.ts`, `tests/smoke/worldPatch.test.ts` (`setPhase4bScope(false)` around the legacy cases)

**Interfaces:**
- Consumes: Tasks 2, 3, 5, 6.
- Produces (`puzzle/index.ts`):
  ```ts
  export interface PuzzlePlacement { cells: PuzzleCell[] }
  /** extract: the mechanic cells whose kind a builder draws (PUZZLE_FLOOR_KINDS ∪ PUZZLE_RAISED_KINDS), claimed
   *  CLAIM_SURFACE | CLAIM_OBJECT | CLAIM_TOP (groundMt = the room's floorTile); build: one PuzzleStateTexture (in
   *  kit.disposables), buildPuzzleFloors + buildPuzzleRaised; live: puzzleLiveCells over the claimed cells. */
  export const puzzleFamily: Family<PuzzlePlacement>;
  export const PUZZLE_CATALOGUE: readonly InteriorCatalogueEntry[];   // [...PUZZLE_FLOOR_CATALOGUE, ...PUZZLE_RAISED_CATALOGUE]
  // stubs, filled by Tasks 8 / 9:
  // floors.ts: PUZZLE_FLOOR_KINDS: ReadonlySet<PuzzleKind>; buildPuzzleFloors(cells: readonly PuzzleCell[], ctx:
  //   SemanticContext, kit: KitContext, tex: PuzzleStateTexture): THREE.Object3D | null; PUZZLE_FLOOR_CATALOGUE
  // raised.ts: PUZZLE_RAISED_KINDS, buildPuzzleRaised(… same …), PUZZLE_RAISED_CATALOGUE
  ```
  `INTERIOR_FAMILIES = [puzzleFamily, furnitureFamily, shellFamily, floorFamily]`; `furnitureFamily =
  furnitureFamilyWith({ ...HOME_GENERATORS, ...SERVICE_GENERATORS, ...LEAGUE_GENERATORS, ...SPECIAL_GENERATORS })`;
  `INTERIOR_CATALOGUE` += `PUZZLE_CATALOGUE` (empty until the group-C join adds the drawn entries, F6).
- Produces (`themes.ts`): `themeOf(mapKey: string | null): RoomTheme | null` (= `mapProfile(mapKey).theme`);
  `THEME_LIGHT: Readonly<Record<RoomTheme, RGB>>` — the emissive accent of flames, candles and glows (light colours, not
  surface colours, D9): sidney (1.0, 0.45, 0.25), phoebe (0.65, 0.45, 1.0), glacia (0.55, 0.85, 1.0), drake (1.0, 0.55,
  0.2), champion (1.0, 0.85, 0.5), hall (1.0, 0.8, 0.55), hallOfFame (1.0, 0.95, 0.75) (tuned in the looks).
- Produces (`timeOfDay.ts`, pure, D10):
  ```ts
  /** Moved from updateLighting unchanged: the GBA's lit radius in px per flashLevel 0…8. */
  export const FLASH_RADIUS_PX: readonly number[];           // [200, 72, 64, 56, 48, 40, 32, 24, 0]
  export interface FlashLight { distance: number; decay: number; intensity: number; ambient: number }
  /** The lantern and room-light scale for a modelled dark room: the lit area matches the GBA circle. */
  export function flashLight(level: number): FlashLight;
  /** three's punctual-light attenuation for that lantern at floor distance d (cells), for the tests. */
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
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (stubs, families, scope on, themes, flash; callers pass the profile).
- [ ] **Step 4: Run** the tests, `catalogue`, `golden`, `semantics`, `interiorRooms`, `worldPatch` → PASS; `npx tsc
  --noEmit && npm test`.
- [ ] **Step 5: Gate.** Set every puzzle walk and edit entry's `modern` to `'record'` (until the group-C join: the
  mechanic cells are labelled but no builder draws them yet, so the kit's floor claims them and a change rebuilds); Retro
  stays `'gate'`. `npm run regress:live -- --label t7 --static --compare p4b-base`: Retro 0.00 % everywhere; Modern 0.00 % on
  outdoor, battles, the 4c controls and every `PHASE4_INTERIOR` entry; the 45 maps' entries change (rooms with Phase 4's
  shell, floor and furniture; new kinds legacy); the new night/dusk twins pass `nightLum`; `gym_hole` and `door_*` pass the
  crossing gate.
- [ ] **Step 6: Look.** `npm run regress:live -- --label t7 --interiors --review --review-before p4b-base`: every new
  room closed and sound, no wall over a walkable cell, Dewford dark with a lit circle the size of the GBA's (`i_g_dewford_dark`,
  `i_g_dewford_night_dark`), the night twins lamp-lit; report what reads poorly for group C.
- [ ] **Step 7: Commit** — `git commit -m "feat(kit): Phase 4b scope on — puzzle family, League/special generator slots,
  themes, flash light under the clock" -- <the files above>` (pathspec)

**Gates:** Step 5. **Acceptance:** the plumbing is in; group C fills only its own modules.

---

**Group C runs in two phases (Phase 4's ledger ruling).** Phase A, in parallel with Task 7: each agent writes only its
`geom/` file and its node test (pure geometry, GLSL strings, material options; no harness, no edits to Task 7's files).
Phase B, after Task 7 is approved: each wires its builder or generators into its own family file, runs its look under
the GPU lock, and commits. Shared rules for every group-C piece: colours from `colorInfo(a)` (D11); low pieces (≤ 1.2)
never fade (`FURNITURE_LOW`, glow/glass low twins); on puzzle maps the D6 height rule; geometry follows labels, never
collision alone; quality scales sides 8 / 12 / 16.

### Task 8 (group C): Puzzle floors — thin ice, switches, arrow tiles, warp pads, geyser holes

**Files:**
- Create: `src/render/kit/interior/geom/puzzleFloors.ts`, `tests/interiorPuzzleFloors.test.ts`
- Modify (own, Phase B): `src/render/kit/interior/puzzle/floors.ts`

**Interfaces:**
- Consumes: `PuzzleCell`, `PuzzleStateTexture`, `PUZZLE_STATE_GLSL`, `puzzleUniforms`, `puzzleLookGlsl`, `PUZZLE_LOOK`
  (Task 6); `floorTint` (floorPatterns); the stub's signatures (Task 7).
- Produces: `PUZZLE_FLOOR_KINDS = new Set(['thinIce', 'floorSwitch', 'arrowTile', 'warpPad', 'geyserHole'])`;
  `puzzleFloorGeometry(a: MapAnalysis, cells: readonly PuzzleCell[], tint: (c: PuzzleCell) => RGB): THREE.BufferGeometry`
  — one quad per cell at floor height 0.002 (above the room floor), attributes position, normal, color (the cell's ROM
  tint), `aCell` (vec2: grid x, y; the state lookup), `aKind` (kind index); `puzzleFloorMaterial(uniforms):
  KitMaterialOptions` (hookKey `puzzleFloor`, roughness by kind: ice 0.12, others 0.5; `fragColor` + `fragEmissive` from
  `puzzleLook(kind, state)`: ice — a glossy slab with a soft inner tint, procedural fracture lines seeded per cell scaled
  by `crack`, a dark hole with a jagged rim by `open`; switch — a pad with a rim, a glowing ring by `glow`; arrow —
  inset chevrons rotated by the state's direction, glowing; warp pad — a ring with a slow pulse (`uTime`); geyser hole —
  a sand crater with a warm glow); the switch's `raise` is drawn as a shaded rim (flat floors, open question 2).
  `buildPuzzleFloors` (Phase B) builds one mesh (receive shadows, no cast) with `puzzleUniforms(tex, a)`;
  `PUZZLE_FLOOR_CATALOGUE` one entry (PNC + `aCell`, `aKind`; no cast).
- [ ] **Step 1: Write the failing test** (`fakePuzzle`, a fake `TileInfo`):

```ts
it('lays one quad per mechanic floor cell, at the floor, with its cell and kind', () => {
  const { a } = fakePuzzle(['       ', ' WWWWW ', ' .ics. ', '       ']);
  const cells = puzzleCells(a).filter((c) => PUZZLE_FLOOR_KINDS.has(c.kind));
  const g = puzzleFloorGeometry(a, cells, () => [0.5, 0.6, 0.8]); g.computeBoundingBox();
  expect(g.getAttribute('position').count).toBe(4 * cells.length);
  expect(g.boundingBox!.max.y).toBeLessThan(0.01);
  expect(g.getAttribute('aCell').getX(0)).toBe(cells[0].x);
});
it('reads the state texture in its shader, and only there', () => {
  const { a: a0 } = fakePuzzle(['     ', ' WWW ', ' .i. ', '     ']);
  const m = puzzleFloorMaterial(puzzleUniforms(new PuzzleStateTexture(a0, []), a0));
  const glsl = `${m.fragHead ?? ''}${m.fragColor ?? ''}${m.fragEmissive ?? ''}`;
  expect(glsl).toContain('puzzleStateAt'); expect(m.hookKey).toBe('puzzleFloor');
  expect(Object.keys(m.uniforms ?? {}).sort()).toEqual(['uPuzzleGrid', 'uPuzzleState']);
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (Phase A: geom + material; Phase B: `floors.ts`). **Step 4: Run** → PASS.
- [ ] **Step 5: Look (Phase B, after Task 7).** `i_g_sootopolis`, `i_g_sootopolis_b1f`, `i_pz_sootopolis` (cracked and
  broken cells read as such next to intact ones), `i_g_mauville`, `i_pz_mauville` (pressed switches lit), `i_g_mossdeep`,
  `i_pz_mossdeep` (arrows point as the GBA's), `i_th7`, `i_g_lavaridge`; each state readable without the GBA column.
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
- Consumes: as Task 8, plus `RoomLayout` doors (Task 5) for the door frames, `PARTITION_H`.
- Produces: `PUZZLE_RAISED_KINDS = new Set(['barrier', 'toggleWall', 'gymDoor', 'hiddenStairs'])`;
  `raisedArtRows(a, ids, cells): Map<number, number>` (per cell: the rows its art spans, D6); `puzzleRaisedGeometry(a,
  cells, rows): { body: THREE.BufferGeometry; glass: THREE.BufferGeometry }` — barrier poles (metal, `rows` high ≤ 1.0)
  and beams (a glass tube between poles, its core a strip inside); toggle-wall blocks (tinted glass, `rows` high); door
  panels in their frames (two leaves sliding apart along the run); stairs (stone steps); each vertex carries `aCell` and
  `aPart` (0 static, 1 moves with the state); `puzzleRaisedMaterial(uniforms, glass: boolean): KitMaterialOptions` (hookKey
  `puzzleRaised` / `puzzleRaisedGlass`; `vertTransform` reads `puzzleLook(kind, state)` and moves `aPart` vertices: toggle
  walls and stairs scale their height by `raise` (0 → a flush 0.02 plate), doors slide by `open`, the beam core scales to 0
  when off; `fragEmissive` lights the beam core and the toggle walls' edges by `glow`). The glass is opaque with the kit's
  dithered fade (the Phase 4 glass rule: no transparent sort). `PUZZLE_RAISED_CATALOGUE`: body PNC cast, glass PNC cast
  (with their depth twins, through `vertTransform`).
- [ ] **Step 1: Write the failing tests:** a barrier row `fakePuzzle([... ' bBBb ' ...])` → poles at the `b` cells,
  one beam spanning the `B` cells, max height ≤ `raisedArtRows` (≤ 1.0); a toggle wall `x` → block height = its art rows,
  every moving vertex `aPart` 1; a door `d` on a `DoorGap` → two leaves inside the gap; `vertTransform` contains
  `puzzleStateAt`; a state change needs no geometry change (`puzzleRaisedGeometry` takes no state: its digest is the same for
  `w` and `x` maps with the same cells).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (Phase A / B). **Step 4: Run** → PASS.
- [ ] **Step 5: Look (Phase B).** `i_g_mauville`, `i_pz_mauville` (barriers on = lit core in glass; off = clear tube),
  `i_th3`, `i_pz_th3` (red/blue blocks raised / flush as the GBA's walls / floor), `i_gym`, `i_pz_petalburg` (doors closed /
  open), `i_e4_sidney`, `i_pz_e4` (entrance closed), `i_pz_sootopolis` (stairs risen); nothing taller than its art.
- [ ] **Step 6: Commit** — `git commit -m "feat(kit): raised mechanics — glass barriers, toggle walls, sliding gym doors,
  rising stairs, moved by state" -- <own files>`

**Acceptance:** the Step 5 bullets.

---

### Task 10 (group C): Gym and League shell — perimeter walls, masses, paintings, blackboards

**Files:**
- Create: `src/render/kit/interior/geom/gymWalls.ts`, `tests/interiorGymWalls.test.ts`
- Modify (own, Phase B): `src/render/kit/interior/shell.ts`, `src/render/kit/interior/geom/shellParts.ts`

**Interfaces:**
- Consumes: `RoomLayout.masses` / `mass` / `profile`, the perimeter runs (Task 5); `wallPath`, `shellProfile`,
  `PARTITION_PROFILE`, `partitionLoops`, `packDecals`, `decalGeometry` (Phase 4); `colorInfo`.
- Produces (`gymWalls.ts`):
  ```ts
  export const MASS_H_MAX = 1.0;                 // a mass with room north of it (D6)
  /** A mass's height: backed → min(its art rows, WALL_H); else min(its art rows, MASS_H_MAX); ridge ≤ 0.6. */
  export function massHeight(a: MapAnalysis, L: RoomLayout, ids: readonly (InteriorId | null)[], m: Mass): number;
  /** The outline loops of a mass (as partitionLoops), and its south faces' decal quads (its art, Scale4x as the shell's). */
  export function massLoops(a: MapAnalysis, L: RoomLayout, m: Mass): PartitionLoop[];
  export function massDecals(a: MapAnalysis, L: RoomLayout, m: Mass, h: number): Omit<DecalQuad, 'uv'>[];
  /** Framed painting / blackboard on a wall feature: frame body + inset (the art as the decal). */
  export function addPictureFrame(s: Soup, F: WallFrame, at: number, w: number, h: number, frame: RGB, board: boolean): void;
  ```
  The shell (Phase B): perimeter runs as walls (`WALL_H`, cutaway as Phase 4); masses as solids (`BUILDING_BODY`, a
  rounded top edge; `ridge` as rough rock with a bevel; `perimeter` masses as wall blocks with crown) with their decals;
  `painting` / `blackboard` features framed (`addPictureFrame`) where Phase 4 drew decals. No new program (existing
  shell materials). Band-profile maps without new ids build byte-identical shells (Phase 4 maps unchanged).
- [ ] **Step 1: Write the failing tests:** `massHeight` — a backed 3-row perimeter mass → 2.6 cap honoured (min(3, WALL_H)
  → 2.6), an inner 1-row maze → 1.0 at most and ≤ its art rows, a ridge → ≤ 0.6; `massLoops` of an L mass closed and
  never over a walkable cell (`fakeInterior` with `Z`); `addPictureFrame` stays within its width and 0.06 off the wall.
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
- Consumes: `FurnitureGenerator`, `FurniturePiece`, `FURNITURE_SPEC`, `isLow` (Phase 4), `tests/helpers/furniture.ts`,
  `THEME_LIGHT`, `themeOf` (Task 7). `FurniturePiece` gains `theme: RoomTheme | null` (from `themeOf(ctx.mapKey)`) and
  `artRows: number | null` (on puzzle maps: the rows its art spans, D6; null elsewhere) — the one edit to `furniture.ts`
  this task makes, in Phase B, announced to the controller; generators clip their height to `artRows` when set.
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
- Consumes: as Task 11a (no `theme`).
- Produces: `SPECIAL_GENERATORS` for `displayCase` (glass-topped case on a base, exhibits as rounded shapes in the art's
  accent; glass into `glassLow`), `fishTank` (glass tank, water volume tinted from the art, rocks; tall: fades), `modelShip`
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

### Task 12 (group C): Floors v2 — stone, ice, sand, metal, ledges, tiers, themed stone

**Files:**
- Modify (own): `src/render/kit/interior/geom/floorPatterns.ts`, `src/render/kit/interior/floors.ts`,
  `tests/interiorFloors.test.ts`

**Interfaces:**
- Consumes: Phase 4's floor family; `themeOf` (Task 7).
- Produces: `FloorMat` += `Stone = 5, Ice = 6, Sand = 7, Metal = 8, Ledge = 9, Tier = 10`; `FLOOR_MAT` maps the new kinds
  to them (replacing Task 2's stand-ins); patterns — stone: large flagstones with soft seams; ice: polished sheen
  (roughness through the pattern's tone), faint streaks; sand: fine grain; metal: plate seams and rivets; ledge: a
  bevelled lip on the cell's south edge with a shadow line below; tier: an edge lip and shadow on the sides where the
  neighbour is not `tier` (the `edges` bits) — all flat (open question 2). Each pattern its own draw (Phase 4's per-pattern
  split keeps derivatives in uniform control flow); a per-build `uFloorTheme` (int from `themeOf`) varies stone's tone
  and veining per E4 room. Phase 4's five patterns byte-identical.
- [ ] **Step 1: Write the failing tests:** `encodeFloor` packs `Tier` with its edges; `floorCells` gives a `ledge` cell its
  kind and a `tier` cell the edges towards non-tier neighbours; the material's GLSL for the Phase 4 patterns unchanged
  (hash of their snippet strings, pinned before the edit).
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Look (Phase B)** on `i_e4_*` (themed stone), `i_hof` (ice sheen), `i_g_lavaridge*` (sand, ledges),
  `i_g_sootopolis*` (tiers), `i_g_mauville` / `i_g_mossdeep` (metal), `i_th8` (ice); no moiré far away; Phase 4 entries
  0.00 %.
- [ ] **Step 6: Commit** — `git commit -m "feat(kit): floors v2 — stone, ice, sand, metal, ledges, tiers, themed stone" --
  <own files>`

**Join of group C (controller):** (1) add the drawn catalogue entries (`PUZZLE_FLOOR_CATALOGUE`, `PUZZLE_RAISED_CATALOGUE`
via `PUZZLE_CATALOGUE`; League/special furniture through `FURNITURE_CATALOGUE` as drawn) and apply the reported
`FURNITURE_SPEC` tuning (commit alone); (2) `npx tsc --noEmit && npm test`, the drift guards, `interiorWorld`,
`worldPatch`; (3) switch every puzzle walk and edit entry's `modern` back to `'gate'` with `path: 'live'` (the mechanics
are live now); (4) `npm run regress:live -- --label tC --interiors --review --review-before p4b-base` (hand each agent its
rows); (5) `npm run regress:live -- --label tC-gate --static --compare p4b-base`: Retro 0.00 % everywhere; Modern outdoor,
battles, 4c controls and `PHASE4_INTERIOR` 0.00 %; the twins pass `nightLum`; every puzzle walk and edit entry passes its
gate in both styles (Modern: live path, ≤ 1.0 ms, 0 builds).

---

### Task 14: Smoke, coverage, visibility, patch digests, live check

**Files:**
- Create: `tests/smoke/specialInteriors.test.ts`, `tests/smoke/interiorVisibility.test.ts`
- Modify: `tests/smoke/worldPatch.test.ts` (the full-kit cases), whatever the findings require, kept small

**Interfaces:** Consumes everything above. Produces `out/coverage-interiors-4b.txt` (per 4b map: legacy share, worst first;
average) and `out/patch-4b.txt` (per map and edit: path, ms, refusal).

- [ ] **Step 1: Write the tests.** `specialInteriors.test.ts` (the 45 maps, extracted as `World.build` runs them):

```ts
it('scopes exactly the 45 maps', () => expect(IN_4B.map((m) => m.key).sort()).toEqual([...PHASE4B_MAPS.keys()].sort()));
it('lays sound room layouts', () => { for (const m of IN_4B) expect(checkRoomLayout(m.a, m.layout, m.warps), m.name).toEqual([]); });
it('models every mechanic cell as its kind, and every live id of the decomp as a mechanic or inert', () => {
  for (const m of IN_4B) {
    for (const c of puzzleCells(m.a)) expect(m.puzzleClaimed.has(c.i), `${m.name} ${c.kind} ${c.x},${c.y}`).toBe(true);
    for (const id of liveIdsOf(m)) expect(isMechanic(m, id) || isInert(m, id), `${m.name} 0x${id.toString(16)}`).toBe(true);
  }
});
it('models every interaction-behaviour cell as its kind', () => { /* Phase 4's rule over IN_4B */ });
it('furnishes the rooms', () => {
  expect(kinds(at(16, 11))).toMatchObject({ dais: 1 });                // Hall of Fame
  expect(kinds(at(9, 7)).displayCase ?? 0).toBeGreaterThan(0);          // Oceanic Museum 1F
  expect(kinds(at(10, 3)).slotMachine ?? 0).toBeGreaterThanOrEqual(6); // Mauville Game Corner
});
it('holds coverage', () => { const c = coverageAll(IN_4B); expect(c.average).toBeLessThanOrEqual(0.10);
  expect(c.over25.map((m) => m.name)).toEqual(RULED_OVER_25); });
```

  `interiorVisibility.test.ts` (D5, D6) on the puzzle maps: no triangle of any kit mesh above `WALKABLE_SEAT` over a
  walkable or mechanic cell (Phase 4's `interiorFitting` method), counting raised mechanics at their tallest state only
  over cells that are blocked in that state; every mass and prop at most its art rows (`massHeight`, `raisedArtRows`,
  furniture `artRows`); every blocked cell labelled with a floor kind (an invisible wall) carries no kit triangle above
  0.05. `worldPatch.test.ts`: on every 4b map, for every script edit and every C-level mechanic state change (every cell of
  a mechanic to each of its other states), Modern full kit and Retro: `patch` ok and digest = rebuild, except refusals the
  test lists (expected only for legacy-structural edits; each listed with its reason in `out/patch-4b.txt`, none on a
  mechanic cell).
- [ ] **Step 2: Run** → fix what fails in the owning modules (tables, layout rules, generators); repeat.
- [ ] **Step 3: Live check.** `npm run regress:live -- --label t14 --static --selftest --compare p4b-base --review
  --review-before p4b-base`: Global Constraints' gates — Retro 0.00 %; Modern outdoor, battles, 4c controls and
  `PHASE4_INTERIOR` 0.00 %; day actor luminance 0.9–1.15× Retro on the new day entries (median ≥ 0.95); twins two-sided;
  every puzzle walk: 0 builds, `patches == gridChanges`, live patches ≤ 1.0 ms, no compile, the patch frame within margin;
  `gym_hole` and the door walks crossing-gated.
- [ ] **Step 4: Live by eye.** `npx tsx tools/shot3d.ts --state out/pz_sootopolis.state --wait 1000 --keys "<pz_ice's
  keys>"` and the Mauville switch: no stall, no console error, each crack and barrier flip on the frame the GBA shows it
  (compare `--eval "emu.gbaPng()"` frames).
- [ ] **Step 5: Commit** — `git add tests/smoke/specialInteriors.test.ts tests/smoke/interiorVisibility.test.ts
  tests/smoke/worldPatch.test.ts <fixed files> && git commit -m "test(smoke): Phase 4b — layouts, mechanics, visibility,
  patch digests, coverage"`

**Gates:** Step 3. **Acceptance:** tests pass; coverage within budget; numbers in the report.

---

### Task 15: Performance, robustness, documentation

**Files:**
- Modify: `tools/regress-live.ts` (`--ab-feature interior`'s `previewWhen` regex += groups 3, 4, 8, 9, 10, 14, 15, 16, 17,
  22, 28, 29), small fixes the checks require, `README.md`, `CLAUDE.md`

- [ ] **Step 1: Full run.** `npm run regress:live -- --label p4b --static --gpu --selftest --compare p4b-base --review
  --review-before p4b-base --expect-same`: every Global Constraint with numbers (calls ≤ 150, triangles ≤ 1.5 M on every
  interior entry; controls pixel-identical; gates as Task 14).
- [ ] **Step 2: Rebuild cost.** `preview.measureRebuild()` × 5 (median) on every new `i_*` entry: build ≤ 40 ms, build +
  first frame ≤ 100 ms (Petalburg 9×112 and Mossdeep 26×36 are the largest). Over: profile and fix, or report.
- [ ] **Step 3: Patch cost.** Per walk and edit entry: patch ms (max, median) by path, the patch frame against the walk's
  median, `--dpr 2` and `--query quality=low|high` on `pz_ice` and `pz_switch`; propose the patch budgets' final values
  for the controller's ruling (they were proposed in Global Constraints).
- [ ] **Step 4: Interleaved A/B.** `--ab --ab-feature interior` (64 quads) on `i_g_mauville`, `i_g_sootopolis`,
  `i_g_petalburg_entry`, `i_e4_drake`, `i_hof`, `i_s_ocean_1f`, `i_s_corner`, `i_th3`, `pz_ice` (live), plus `--ab-aa` on
  two. Budget Δgpu ≤ +2.0 ms, Δcpu ≤ +0.5 ms; over: profile (puzzle floor fragment cost, glass overdraw, the state
  texture fetch in the vertex shader) and fix, or report for a ruling.
- [ ] **Step 5: Robustness.** `i_g_mauville_fail` (puzzle family rolled back: its cells legacy, patched by the legacy path,
  one warning); a style switch mid-walk on `pz_ice` (`TOGGLE_STYLE` entry `pz_ice_switch`, `sameAs: 'pz_ice'`,
  `samePrograms`); V and back on `pz_switch` (`sameAs`); a patch then a rebuild (style switch) show the same state.
- [ ] **Step 6: Docs.** `README.md`: Phase 4b (the 45 rooms, the mechanics, the incremental update). `CLAUDE.md`: the new
  entries, `p4b-base`, `tools/puzzle-states.ts`, `preview.setCells`, `stats().patches`, `&kitFail=puzzle`. Report every
  known gap for the progress log (at least: outdoor families not live yet — the measured outdoor per-step rebuilds;
  legacy-cell patches re-run the whole analysis; Phase 4c's scope; flat tiers if ruled so).
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
Dewford keeps its darkness (D9, D10, Task 7). **Carried rulings:** walkable ≤ 0.45, one piece per cell, flat floors,
half-height partitions (masses as low solids), D8, F38, the GPU lock, ROM-tile colours, +2.0 ms, two-sided night gates
(Lessons list, Global Constraints).

**Interfaces used across tasks:** `PuzzleKind`, `PUZZLE_KINDS`, `PuzzleId`, `puzzleId`, `puzzleStateCount`,
`InteriorTable.{primary, maps, puzzle}`, `interiorId(…, primary)`, the new Floor/Wall/Furniture kinds, `MapProfile`,
`ShellMode`, `RoomTheme`, `PHASE4B_MAPS`, `PHASE4B_DEFAULT`, `setPhase4bScope`, `mapProfile`, `DEFAULT_PROFILE` (T2 → T4–T14);
`LiveCells`, `Family.live`, `runKit().live`, `changedCells`, `World.patch`, `PatchResult`, `PatchRefusal`,
`PATCH_MAX_CELLS`, `PATCH_RETRO`, `OverworldView.updateGrid`, stats `patches` / `lastPatchMs` / `gridChanges`,
`PreviewApp.setCells`, `worldDigest` (T1/T3 → T6–T15); `Mass`, `MassKind`, `RoomLayout.{masses, mass, profile}`,
`roomLayout(…, profile)` (T5 → T7, T10, T14); `PuzzleCell`, `puzzleCells`, `seedPuzzleIds`, `PuzzleStateTexture`,
`PUZZLE_STATE_GLSL`, `puzzleUniforms`, `puzzleLiveCells`, `PUZZLE_LOOK`, `puzzleLookGlsl`, `fakePuzzle` (T6 → T7–T9,
T14); `puzzleFamily`, `PUZZLE_CATALOGUE`, `PUZZLE_FLOOR_KINDS`, `buildPuzzleFloors`, `PUZZLE_RAISED_KINDS`,
`buildPuzzleRaised`, `themeOf`, `THEME_LIGHT`, `FLASH_RADIUS_PX`, `flashLight`, `lanternFalloff`, `LEAGUE_GENERATORS`,
`SPECIAL_GENERATORS` (T7 → T8–T12); `massHeight`, `MASS_H_MAX`, `raisedArtRows` (T9, T10 → T14); `isRotatingGate`,
`gateArms`, `gateGeometry` (T13); `metatileLabels`, `scriptEdits`, `cMetatiles`, `editRaw`, `warpInto`, `PuzzleGate`,
`EditSpec`, `PHASE4_INTERIOR` (T1 → T2, T3, T14).

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
