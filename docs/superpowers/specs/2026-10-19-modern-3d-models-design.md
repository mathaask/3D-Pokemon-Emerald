# Emerald 3D — Modern 3D Models Design Spec

Date: 2026-10-19
Status: design approved section-by-section in chat; awaiting written-spec review
Builds on: `2026-10-16-emerald-3d-design.md` (emulator + live-state renderer, unchanged)

## 1. Intent

The user has seen the current 3D reconstruction (GBA pixel art pasted onto boxes, sloped quads
and camera-facing cards) and wants the models "improved a lot", explicitly allowing the look to
change for higher quality.

Decisions made with the user:
- **Art direction: modern stylized 3D** (Pokémon Let's Go / BDSP feel): real geometry, soft
  rounded shapes, bright clean colours, painterly procedural surfaces.
- **Scope: all four areas**: outdoor environment, interiors, characters (player & NPCs), battles.
- **Approach A**: semantic placement + procedural model kit + per-cell legacy fallback,
  delivered in four phases (1 Foundation + Outdoor, 2 Characters & Pokémon, 3 Battles,
  4 Interiors).

Constraints (unchanged from the base spec):
- Gameplay is the original ROM running in the emulator; the renderer only reads state.
- **No Nintendo assets in the repository, and no third-party asset downloads.** All geometry,
  textures and colours are procedural or decoded at runtime from the user's ROM.
- Browser app (Vite, Three.js, WebGL2), Chrome/Edge.

Success criteria:
1. On every representative map (§9.3), the dominant elements (ground, trees, grass, water,
   cliffs, buildings, common props) are real 3D models, not pixel-textured quads.
2. Each town keeps its identity: colours are sampled from the ROM tiles (Fallarbor's ash,
   Fortree's jungle, Sootopolis' white stone, Slateport's paving).
3. Nothing breaks: any cell the new layer doesn't recognise renders exactly as today.
4. 60 fps on a mid-range desktop GPU at 1080p, "medium" quality (budgets in §10).
5. The current look remains available ("World style: Retro 3D").

## 2. Current state (what is being replaced)

- `src/render/overworld/classify.ts` (~800 lines) decides cell kinds (floor, water, ledge,
  block, tree, building, stairs, void), solves per-cell heights, flood-fills buildings from
  doors, and **directly emits pixel-textured quads** (`Quad`, `TreeQuad`).
- `world.ts` batches those quads into three meshes (opaque, cutout, water) sampling the live
  metatile atlas; `treeCards.ts` renders tree rows as cylindrical billboards.
- Characters/field effects are `billboards.ts` cards; battles are `battle/battleView.ts` +
  `battle/arena.ts` (icosahedron trees, cone grass).
- World mapping ("un-projection"): grid cell (x, y) at height h is placed at
  world (X = x, Y = h, Z = y + h). This keeps cliff faces vertical and lines the default camera
  up with the original art. **The new layer keeps this mapping** so characters, camera, weather,
  and battles need no coordinate changes.

## 3. Architecture

```
live backup grid + ROM map events (warps, bg events) + live tile pixels (TileInfo)
        │
        ▼
 overworld/analyze.ts      cell kinds, heights, water levels, building footprints, tree runs,
        │                  ground references.  (Split out of classify.ts; algorithms unchanged.)
        ▼
 kit/semantics.ts          MapAnalysis + events + id tables + sampled colours
        │                  → Placement[]  and  claimed: Uint8Array (per cell)
        ▼
 kit/*.ts generators       terrain, cliffs, water, trees, grass, flowers, buildings, props
        │                  → THREE.Object3D (instanced / merged), added to World.group
        ▼
 overworld/legacyQuads.ts  today's quad emission, run only for cells NOT claimed
                           (and for every cell when World style = Retro 3D)
```

### 3.1 Module layout

```
src/render/overworld/
  analyze.ts          NEW  (kinds/heights/buildings/trees extracted from classify.ts)
  legacyQuads.ts      NEW  (quad emission extracted from classify.ts; takes a claimed mask)
  classify.ts         becomes a thin wrapper: analyze + legacyQuads (keeps existing callers/tests)
  world.ts            builds kit output + legacy meshes; owns disposal
src/render/kit/
  semantics.ts        Placement extraction
  palette.ts          colour sampling from TileInfo (dominant/average colours by mask, sRGB→linear,
                      "soften" toward the art-direction palette)
  noise.glsl.ts       shared GLSL: hash, value/simplex noise, fbm, voronoi
  materials.ts        stylized material factory (MeshStandardMaterial + onBeforeCompile hooks):
                      wind sway, occlusion fade, night glow, vertex-colour gradients
  geom.ts             seeded RNG, geometry merge, noise displacement, instancing helpers
  terrain.ts          ground surface + cell data texture
  cliffs.ts           rock walls, ledge lips, stair steps
  water.ts            water surface, seabed, waterfalls
  trees.ts            tree generators + instanced placement
  grass.ts            tall/long grass clumps
  flowers.ts          flower instances
  buildings.ts        building generators per kind
  props.ts            sign posts, mailboxes, fences, lamps, rocks, railings
  upscale.ts          xBR-family pixel-art upscaler: `special` facades (phase 1), sprites (phase 2)
  tables/general.ts   curated metatile-id → prop/terrain table for gTileset_General
  tables/building.ts  (phase 4) curated table for gTileset_Building + common indoor secondaries
src/render/actors/    (phase 2) inflated sprites, object model replacements
src/render/battle/    (phase 3) arena rebuilt from kit
```

### 3.2 Coordinates and live updates

- Placements are expressed in grid space (x, y, h) and converted with the un-projection
  (Z = y + h) by generators via one helper `toWorld(x, y, h)`.
- Backup-grid coordinates include `MAP_OFFSET = 7`; warp/bg event coordinates are map-local and
  are shifted by +7 before matching (live play). The static preview uses the layout grid
  directly (offset 0).
- The world is rebuilt whenever the grid, tilesets or map change (existing `gridChanged` logic),
  so Cut / Rock Smash / Secret Base / Sootopolis water / door metatile edits are reflected.
- Animated tiles: models do not sample animated tiles. Water and flowers animate procedurally.
  Unclaimed cells keep live-animated legacy rendering.

## 4. Semantic layer

### 4.1 Inputs
- `MapAnalysis` (from `analyze.ts`): kind, height, waterLevel, groundOf, building list
  (cells, door row), tree runs (column, rows, round/narrow), layer type, behaviour, metatile id.
- `TileInfo`: composite/bottom pixels, coverage, green/blue fractions.
- Map events for the current map from the ROM (`loadMap` / events decoder): warps (destination
  map group/num → name via `mapNames.ts`), bg events (signs, hidden items).
- Primary tileset identity (`gTileset_General` / `gTileset_Building`) to enable id tables.

### 4.2 Placement types (phase 1)

| type | fields | source |
|---|---|---|
| `ground` | per cell: material, tint, height | every Floor/Stairs/Ledge cell and the ground under claimed objects |
| `water` | per cell: level, shore distance; waterfall flag | Water kind, `MB.WATERFALL` |
| `cliff` | edge segments between heights; style rock / grass lip / ledge | height steps from analysis; Block runs whose colour class is rock or General cliff ids |
| `tree` | x, z, base h, style round / narrow / palm, leaf & trunk colour, seed | Tree runs (existing round/narrow detection + secondary-tileset green heuristic) |
| `grass` | cells, long flag, tint | `MB.TALL_GRASS`, `MB.LONG_GRASS`, ash grass |
| `flower` | cell, petal colours | General flower ids; secondary-tileset heuristic (small saturated blobs on green) |
| `building` | footprint (x0..x1, rows), base h, door x, kind, roof / wall / trim colours, facade cells | door flood-fill + warp destination name |
| `prop` | cell(s), prop kind (sign, mailbox, fence-white, fence-wood, lamp, rock, bollard, railing, …), colours | `tables/general.ts`, sign bg events |

Each placement claims its cells. Claimed cells are skipped by `legacyQuads`; the ground under
claimed objects is emitted by `terrain` using the cell's `groundOf` reference.

### 4.3 Building kind from warp destination

Door cell → warp at that cell → destination map name:

| name pattern | kind |
|---|---|
| `*_PokemonCenter_1F` | `pc` |
| `*_Mart` | `mart` |
| `*_Gym` | `gym` |
| `*Lab*` | `lab` |
| `*House*`, `*_1F` of a home, `*_PlayersHouse_*` / `BrendansHouse` / `MaysHouse` | `house` |
| anything else (Contest Hall, Museum, Game Corner, Weather Institute, Space Center, …) | `special` |
| no warp found (neighbour-map strip) | `house` if ≤ 6 wide, else `special` |

### 4.4 Colour sampling
Colours come from the live tiles so towns keep their identity: roof colour = dominant colour of
the building's top rows; wall colour = dominant colour of the bottom rows excluding blue (glass)
and dark outline pixels; leaf colour = mean of green pixels of the tree cells; ground tint =
mean of the cell's bottom layer. Colours pass through `palette.soften()` (slight desaturation
of extremes, lift of very dark values) so they read well under PBR lighting.

## 5. Phase 1 — Foundation + Outdoor environment

### 5.1 Foundation
- Split `classify.ts` into `analyze.ts` + `legacyQuads.ts` with **no visual change** (verified
  by pixel-identical before/after screenshots of the regression set).
- Setting **World style: Modern / Retro 3D** (default Modern), persisted with the other
  settings; Retro = legacy for all cells.
- Shared GLSL noise, material factory, seeded RNG, toWorld helper.
- Visual regression batch (§9.3) and a "legacy coverage" report per map.

### 5.2 Terrain (ground)
- One mesh per height-connected region of ground cells (2×2 vertices per cell, shared edges
  welded where heights match), at the un-projected positions.
- Per-cell data texture (RGBA8): material id, tint RGB. Fragment shader samples the 4 nearest
  cells with fbm-warped coordinates for organic borders and blends procedural detail:
  - grass (two-tone noise blades, hue jitter), dirt path (pebbles via voronoi, darker edges),
    sand (ripples), paving / cobble (voronoi stones with grout), wooden deck (planks along
    the longer axis), ash-grass, rock floor, mud/puddle.
- Material is chosen by behaviour first (`MB.SAND`, `DEEP_SAND`, `ASHGRASS`, `PUDDLE`, …), then
  by the General table, then by the colour class of the cell's bottom-layer pixels
  (green → grass, tan/brown → dirt, light grey/blue-grey → paving, yellow-white → sand).
- Ledges: a rounded grassy lip mesh along the ledge edge, oriented by jump direction.
- Stairs: stone/wood steps along the ramp produced by the height solver.

### 5.3 Cliffs
- Walls along every height step between ground regions (and along Block runs classified as
  rock): vertical strips subdivided ~4×/unit, displaced by 3D fbm outward, triplanar rock
  shading with horizontal strata, darker at the base, ambient-occluded crevices via noise.
- A rounded grass/soil lip at the top edge matching the upper ground material.

### 5.4 Water
- Surface mesh per connected water region at its level; per-cell data texture with distance to
  shore (BFS) → shallow/deep tint, foam band animated along shores, seabed (sand) visible in
  shallows through partial transparency.
- Fresnel reflection of the sky colours, layered scrolling normal noise, sun specular glints,
  gentle vertex swell (existing behaviour kept).
- Waterfalls (`MB.WATERFALL`): vertical sheet with streaking flow texture + foam/mist at base.
- Currents: normal scroll direction follows the current behaviour.

### 5.5 Trees
- Generators produce a few geometry variants per style (seeded): **round** (broad clustered
  crown of 5–9 noise-displaced icospheres + tapered trunk with root flare), **narrow**
  (conifer-like stacked cones or slim crown, matching the GBA narrow tree), **palm** (for
  coastal/tropical tilesets when the tree tile is detected on sand).
- Instanced per variant; per-instance scale, rotation, hue jitter; crown colour gradient
  (darker underside, lighter top) via vertex colours; trunk colour from ROM.
- Wind: vertex sway in the material, amplitude by height, phase by position.
- Dense forest: same trees, slightly larger crowns so canopies merge; ground under a forest
  is darkened.

### 5.6 Grass and flowers
- Tall grass: instanced clumps (blades as tapered curved strips), ~24 blades/cell at medium,
  ~1.0× cell height; long grass ~1.6×. Wind sway; blades within ~0.7 units of any character
  foot bend away (uniform array of up to 8 actor positions).
- In Modern style the GBA grass-overlay field-effect sprites (`SpriteKind.Grass`) are hidden.
- Flowers: instanced stem + 5-petal head, colours from the tile's two most saturated colours,
  slight sway; 3–5 flowers per flower cell.

### 5.7 Buildings
Shared construction: walls with real thickness on a stone/concrete plinth, door recessed
with a step, framed windows (glass emissive at night — reuses the existing night glow), roof
with eaves overhang and thickness, gutters/trim. Footprint and height come from the analysis
(wall rows, roof rows) under the un-projection, so buildings occupy exactly the cells the game
blocks.
- `house`: gable or hip roof (hip if footprint ≥ 5 wide) with tile rows; roof/wall colours from
  ROM; chimney when the roof pixels contain a grey blob; windows placed symmetrically around
  the door, count from width.
- `pc`: red roof (sampled), white walls, wide glass sliding doors, Poké Ball emblem disc on the
  roof front, "POKéMON CENTER" sign (canvas-rendered text texture).
- `mart`: blue roof (sampled), "POKé MART" sign, awning, glass door.
- `gym`: larger hall, flat-ish roof with raised centre, "POKéMON GYM" sign, pillars by door.
- `lab`: long low building, light roof, roof vent/dish detail.
- `special`: real massing (walls, roof, eaves) with the **front wall textured by the ROM
  facade pixels upscaled with `upscale.ts`**, so signage and character survive.
- Occlusion fade (see 5.9) applies to roofs.

### 5.8 Props (`tables/general.ts`)
Curated by rendering the General tileset sheet with ids and labelling it: sign posts, white
picket fences, wooden fences, lamp posts, rocks/boulders on land, bollards, bridge railings,
small bushes, flower ids, ledge ids, cliff ids, path/sand/water-edge ids. Sign bg events
override to `sign`/`mailbox` on that cell. Fences are generated as runs (posts + rails) along
contiguous fence cells.

### 5.9 Occlusion fade and lighting polish
- Trees, roofs and tall props whose fragments fall between the camera and the player (inside
  a screen-space circle around the player and closer to the camera than the player) dither out
  (ordered 4×4 Bayer dither, smooth radius), so the player is never hidden.
- Soft shadows (`PCFSoftShadowMap`), shadow camera follows the target (existing), sun colour
  keyframes unchanged; tilt-shift strength reduced for the modern look; GTAO/bloom kept.

## 6. Phase 2 — Characters, Pokémon, field objects

- **Inflated sprites** (`actors/inflate.ts`): for every sprite atlas slot, compute a distance
  field of the alpha silhouette (CPU chamfer transform, re-run when the slot's content hash
  changes). Upload as a companion "height" texture. Each actor is a camera-facing grid mesh
  (16×32 segments) displaced along its normal by `k · sqrt(dist)` on the front and back halves;
  normals from the height gradient → lit with the scene lights (replacing the flat `charLight`
  approximation), rim light, and real shape shadows (custom depth material). Animation frames
  stay the game's own; flat decals and grass overlays keep their current treatment.
- **HD edge-smoothing** (`kit/upscale.ts`): xBR-family (or MMPX) upscale of sprite slots to 4×
  before inflation sampling; nearest-neighbour remains selectable in settings.
- **Object model replacements** by `graphicsId` (`actors/objectModels.ts`): item ball → 3D Poké
  Ball, Strength boulder → boulder, breakable rock → cracked rock, Cut tree → small 3D tree,
  berry trees → 3D plants per growth stage (stage from the sprite frame). Unmapped objects use
  inflated sprites.

## 7. Phase 3 — Battles

- Arena rebuilt from kit generators: trees, grass clumps, water shader, rocks/cliffs, sand
  dunes, cave walls, indoor room, chosen per battle environment as today, colours still sampled
  from the battle terrain background.
- Modelled platforms per terrain: earth disc with grass skirt, sand mound, stone slab, water
  lily pad / ripple ring, cave rock.
- Battlers (64×64 front/back sprites) use Phase 2 inflation. Move-effect sprites remain
  additive/alpha billboards in 3D space; reference-camera choreography is unchanged.
- Sky: gradient dome with procedural soft clouds for outdoor environments.

## 8. Phase 4 — Interiors

- `tables/building.ts`: curated metatile-id → furniture/surface table for `gTileset_Building`
  plus `BrendansMaysHouse`, `GenericBuilding`, `PokemonCenter`, `Shop`, `Lab` secondaries.
- Furniture kit (`kit/furniture.ts`): bed, table, chair, TV, PC, bookshelf, potted plant,
  fridge, sink/counter, clock, healing machine, PC counter, Mart shelves, stairs, rug, crates.
  Colours from the tiles.
- Rooms: back/side walls with thickness, baseboards, window frames with soft light shafts
  (additive volumes), floor materials (planks, tiles, carpet) via the terrain shader.
- Unknown interior cells: legacy boxes with upscaled textures.

## 9. Testing and verification

### 9.1 Unit tests (`npm test`)
Pure functions: building-kind mapping from map names, terrain material classification from
colour samples, placement claiming rules, palette softening, distance field + inflation height
math, upscaler on small fixtures, fence-run grouping.

### 9.2 ROM-driven smoke tests (`tests/smoke`, need the ROM)
Semantic assertions on real maps via the static map loader:
- Littleroot Town: 2 `house` + 1 `lab`.
- Oldale Town: exactly one `pc` and one `mart`.
- Route 101: ≥ 1 `grass` placement; Petalburg Woods: ≥ 100 trees.
- Slateport: water region + shore foam cells; Fortree: deck heights > ground.
- Legacy-coverage report: % of non-void cells left on legacy per map, printed and written to
  `out/coverage.txt`; Phase 1 target ≤ 15 % on the regression set.

### 9.3 Visual regression set
`tools/shot3d.ts --batch` over: Littleroot, Oldale, Petalburg, Rustboro, Petalburg Woods,
Slateport, Mauville, Route 113 (ash), Fortree, Lilycove, Route 119, Sootopolis, Mossdeep,
Route 110 (bridges), each at hour 11 and hour 21. Captured before Phase 1 (baseline) and after
each milestone into `out/3d/`; every image is inspected. Phases 2–4 add save-state shots
(walk, battle, interiors) from existing `out/*.state` files.

## 10. Performance budgets (medium quality, 1080p, mid-range GPU)
- ≤ 150 draw calls and ≤ 1.5 M triangles on the densest map in view.
- World rebuild ≤ 150 ms (no hitch when crossing map connections).
- Instancing for trees, grass, flowers, fence posts; static meshes merged per material.
- Quality settings scale: grass blades/cell (low 8, medium 24, high 48), shadow map
  (1024/2048/4096), tree crown subdivision, GTAO on/off.

## 11. Error handling
- Each generator runs in try/catch: on error its placements' cells are un-claimed (legacy
  renders them) and the error is logged once per map.
- If the semantic layer throws, the whole map builds in Retro 3D.
- V (classic 2D) remains the universal fallback.

## 12. Non-goals
- No hand-modelled per-character 3D models (Phase 2 inflation is the generic solution).
- No changes to game logic, timing, input, saves or audio.
- No external or downloaded assets.
- Link features remain out of scope.

## 13. Risks
- **Heuristic misclassification** (e.g. a fence read as a cliff): mitigated by the curated
  General table, per-cell legacy fallback, and the coverage report + visual regression set.
- **Un-projection artefacts on true 3D models** (objects whose GBA art implies height are
  shifted south by h): models are built in un-projected space so they meet the ground where
  the game's collision is; verified on the regression set from orbit angles too.
- **Performance of grass/trees on dense maps**: instancing + quality scaling; measured on the
  densest maps (Petalburg Woods, Route 119/120).
