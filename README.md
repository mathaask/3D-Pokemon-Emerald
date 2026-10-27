# Emerald 3D

Pokémon Emerald, re-imagined in 3D. The **original game code runs unmodified** inside a
GBA emulator written for this project, so every mechanic, script, battle, and story beat is
exactly the real game. A new renderer then reads the game's live state from emulated memory
and redraws the world in real time as an HD-2D style diorama: perspective camera, lighting,
shadows, a day/night cycle from the game clock, 3D weather, and 3D battles.

No Nintendo assets are included. Everything is decoded at runtime from **your own ROM**.

## Running

Requirements: Node 20+ and a recent Chrome or Edge (WebGL2).

```bash
npm install
npm start          # opens http://localhost:5173
```

Put a Pokémon Emerald ROM (`*.gba`, USA/Europe rev 0, SHA-1 `f3ae0881…`) in the project
root and it loads automatically. Otherwise you can drag and drop it onto the page.

## Controls

| Key | Action |
|---|---|
| Arrows / WASD | D-pad |
| Z, Space, K | A |
| X, J, Backspace | B (hold to run once you have the Running Shoes) |
| Enter | Start |
| Shift | Select |
| Q / E | L / R |
| Tab (hold) | Fast-forward ×4 |
| Mouse drag, `,` `.` | Orbit camera |
| Mouse wheel, `+` `-` | Zoom |
| C | Cycle camera style (Classic / Close / Wide / Low) |
| V | Toggle 3D / classic 2D |
| F5 / F9 | Quick save / load state |
| Esc / O | Settings (world style, sprite edges, quality, effects, volume, `.sav` import/export) |
| H / F1 | Help overlay |

Gamepads use the standard mapping. In-game saves (Start → Save) go to your browser
(IndexedDB) and can be exported as a `.sav` file that other emulators can read.

## What you're looking at

- **Overworld.** Every map is rebuilt in 3D from the live map grid: the renderer turns the
  GBA's oblique ¾ projection back into a 3D scene. Outdoors, the default **Modern** world
  style recognises what the tiles show and draws real models: terrain, cliffs and ledges with
  rock faces, water with shore foam and a gentle swell, rounded trees, tall grass that sways
  and parts around the player and NPCs, flower beds, houses, Pokémon Centers, Marts, gyms and
  special buildings, and props such as signs, mailboxes, fences and boulders. Their colours
  are sampled from the ROM's own tiles, so every town keeps its palette. Scenery between the
  camera and the player dithers away in a small circle, so the player is never hidden.
  Anything the models don't cover yet (caves, interiors, mountain rock and a few unusual
  tiles; see the limitations below) is drawn the original way: pixel art from live video
  memory on boxes, sloped roofs and camera-facing cards, so tile animations and in-game map
  edits appear immediately.
  **Settings → World style → Retro 3D** switches the whole world back to that pixel-art
  reconstruction. NPCs, the player, and field effects are lit billboards with soft shadows.
- **Characters and objects (Modern).** The player, NPCs and Pokémon in the overworld are their
  own animated sprites, inflated into soft relief: each sprite frame (decoded live from video
  memory, so every walking and turning frame is the game's) is lifted towards the camera by a
  height field computed on the GPU from its silhouette, shaded by the scene's sun, sky and
  lantern with a rim of sky light, and casts its true silhouette as a shadow. They keep facing
  the camera as it orbits. **Settings → Sprite edges** chooses **HD smooth** (default: the pixel
  edges are smoothed by an xBR-style filter at any zoom) or **Pixel** (crisp texels).
  Poké Balls, Strength boulders, breakable rocks, Cut trees, the moving truck and berry trees
  (one model per growth stage, with soft tilled beds) are real 3D models, coloured from their
  own sprite's pixels; they follow the game's objects live and show the game's own animation
  while a rock breaks or a tree is cut. Everything else stays an inflated sprite (boats, the
  S.S. Tidal, moving boxes, dolls and cushions), and shadows under feet, ripples, footprints
  and grass overlays are flat as before. NPCs standing behind tree crowns or roofs near the
  player are cleared by the same dithered fade as the player. Retro 3D keeps the flat cards.
- **Lighting.** The sun and sky follow the in-game clock. Building windows glow at night.
  Caves that need Flash are lit only by the player's light. Rain, thunderstorms (with
  lightning), volcanic ash, sandstorms, and underwater bubbles are real 3D particles.
- **Battles.** Each GBA battle sprite is projected into a 3D arena through a reference
  camera that matches the original layout. Lunges, faints, and move effects keep their
  original choreography but move through real space.
- **Battle arenas (Modern).** Every battle takes place in a modelled arena built for the
  background the GBA draws, picked the way the game picks it (battle type, then trainer, then
  the map, then the terrain). There are 24 of them:
  - *Outdoors* (grass, long grass, sand, plain): rolling ground with groves of rounded trees,
    grass clumps, flowers, dunes and palms, and rocks.
  - *Water* (sea, pond, underwater): the sea with islets and palms; a pond with lily pads,
    reeds and a sandy bank; the sea floor with kelp, caustics and light shafts.
  - *Rock* (mountain, cave, cave pond, Kyogre's cave, Groudon's lava cave): cliff walls,
    stalagmites, boulders, dark water and glowing lava.
  - *Indoor halls* (building, gym, Gym Leader, Battle Frontier): panelled rooms with
    bookcases, gym courts with banners, and stadium seating with glowing panels.
  - *Stadium rooms* for Team Magma's and Team Aqua's hideouts, the four Elite Four rooms and the
    Champion's room, each with its own theme: lava and pipes, fountains, spikes, candelabra, ice
    crystals, stone pillars.
  - *The Sky Pillar* for Rayquaza: a broken stone floor over a sea of clouds.

  The two platforms are modelled per terrain: an earth disc with a grass skirt, a sand mound, a
  stone slab, a lily pad, cave rock, a rock on the sea floor, or a ripple ring on open water. Colours are sampled from the battle background the game
  loads from your ROM, so every arena keeps the GBA's palette. Outdoor battles share the
  overworld's time of day. A gradient sky with soft clouds sits over the outdoor arenas. The
  battle camera looks down at the GBA's angle, so the sky shows only in water reflections and as
  cloud shadows drifting over the ground. The Pokémon (and the trainers' intro pictures) are
  inflated sprites like the overworld characters, lit by the arena, and the **Sprite edges**
  setting applies to them. A floating Pokémon's shadow lies flat on its platform.
  What stays 2D: move-effect sprites are flat cards in 3D space, as before. Health boxes, text
  boxes and menus are the crisp original screen on top, and so are full-screen background move
  effects. Every shader a battle can draw is compiled at boot, so no shader compiles when a battle
  starts (the first battle of each arena type in a session still builds its scenery once: one
  longer frame, about 0.1 s, during the battle's opening transition). **Retro 3D** keeps the original themed arena with flat cards, unchanged. A world-style
  switch in the middle of a battle applies at once, and V shows the original GBA screen at any
  point.
- **Menus and cutscenes** are shown as the crisp original screen on an ambilight backdrop.

## Project layout

```
src/gba/        GBA emulator: ARM7TDMI CPU, PPU, APU, DMA, timers, HLE BIOS, Flash, RTC
src/game/       Emerald knowledge: symbol addresses, live-state reader, sprite classes, ROM decoders
src/render/     Three.js renderer: overworld (map analysis, world mesh, weather, sky), kit (Modern
                style models: terrain, water, cliffs, trees, grass, flowers, buildings, props),
                battle (reference-camera projection, Modern arenas built from parts, the Retro
                arena, battle sky), HUD, post-processing, map and battle previews
src/ui, input, audio   Shell, settings, keyboard/gamepad, AudioWorklet output
tools/          Headless runner, scripted play, screenshot capture, map atlas, analysis
tests/          Unit tests (CPU, core hardware, PPU, APU, ROM) + ROM-driven smoke tests
docs/           Design spec, implementation plan, map-data analysis
```

## Developer tools

```bash
npm test                                   # unit tests
npx tsx tools/play.ts --load s.state "A*5/30" "UP 3" "shot x"     # scripted headless play
npx tsx tools/shot3d.ts --state s.state --wait 3000               # screenshot the real app
npx tsx tools/shot3d.ts --query "map=0.9&hour=21"                  # 3D preview of any map
node --import tsx tools/map-atlas.ts       # render every map to out/atlas/
npm run regress -- --label mine            # 16 maps at day + night → out/regress/mine/ (add --style retro)
npm run regress:live -- --label mine --static --gpu --selftest
                                           # live save-state scenes + map previews with actors, both styles
                                           # (add --compare <label> to diff against an earlier run)
npm run regress:live -- --label mine --battles --review
                                           # battles only: live battles + a preview of every arena kind,
                                           # review sheet GBA | before | Modern | Retro (--review-before <label>)
npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/golden.test.ts tests/smoke/semantics.test.ts
                                           # ROM-driven smoke tests; coverage report → out/coverage*.txt
```

`npm run regress:live` (`tools/regress-live.ts`) replays save states frame by frame in manual
mode (`?manual=1`: no frame loop, fixed clock; `emu.step(keys, frames)` emulates and renders,
returning each frame's renderer CPU ms) and screenshots each scene in Modern and Retro, plus,
with `--static`, map previews showing the map's object events (`?map=…&actors=1&focusGfx=<id>`).
`--compare <label>` diffs every shot against an earlier run, `--gpu` times 60 frames with GPU
timer queries, `--selftest` checks the GPU inflation field and the HD edge filter against CPU
references, and `--ab` measures what the Modern characters and objects cost over flat cards in
the same session (`--ab-feature battle`: the Modern battle over the Retro one; `--ab-feature
battlers`: the inflated battlers over flat cards). `--battles` runs only the battle entries:
the live battles and a static preview of every arena kind, each saved next to the GBA's own
picture of the same scene. `--review` adds `_review_battle.png`, one row per battle with the
columns GBA | before (`--review-before <label>`) | Modern | Retro. The header of the tool
documents every flag and the `stats.json` fields.

`npm run regress` writes one PNG per map and hour, a contact sheet per hour
(`_sheet_h11.png`, `_sheet_h21.png`) and render stats (`stats.json`: draw calls, triangles,
world build time, and what a map crossing costs: a warm rebuild and the first frame after it), so two labels can be compared side by side. Both `regress` and `shot3d`
need the ROM in the project root and a local Chrome (or Edge) install, which they drive
headless; the smoke tests need the ROM.

`/?map=<group>.<num>` opens a static 3D preview of any map (WASD/mouse to fly; `&hour=`,
`&weather=`, `&flash=` change the conditions; `&actors=1` adds the map's object events from
their ROM templates, `&focusGfx=<id>` / `&focusObj=<n>` aims the camera at one of them, and
`&style=retro`, `&quality=`, `&spriteFilter=pixel` override the settings).

`/?battle=<kind>` opens a static battle in any arena kind (`grass`, `longGrass`, `sand`, …
`rayquaza`; the list is in `src/game/battle/arenaKind.ts`) straight from the ROM. `&player=` and
`&enemy=` pick the Pokémon by internal species id (Torchic vs Zigzagoon by default),
`&double=1&player2=…&enemy2=…` makes a double battle, and `&hour=`, `&style=retro`,
`&quality=`, `&yaw=`, `&spriteFilter=pixel` work as in the map preview. Drag turns the camera.
`npx tsx tools/shot3d.ts --query "battle=gym&player=281&enemy=74"` screenshots one.

## Notes and limitations

- Link-cable features (trading, link battles, Union Room) are unavailable. The game
  handles their absence the same way it does on a lone GBA.
- The 3D reconstruction is heuristic. A few unusual maps may show odd geometry, and you
  can press V at any time to switch to the original 2D view. In Modern style the mountain
  ridges (Mt Chimney, Route 112, Jagged Pass), much of Ever Grande City's rock, the crater
  walls of Sootopolis and Lavaridge's cliffs, and a few special buildings (Devon Corp, the
  Battle Pyramid, Pike and Palace) still use the pixel-art reconstruction.
- The two largest multi-piece world sprites, the S.S. Tidal and the submarine's shadow, are still
  drawn from their base sprite shape (garbled) in both 3D styles; the moving truck is composed
  correctly.
- Battle effects, in both 3D styles:
  - Sprites the GBA rotates show unrotated, and the mosaic (pixelate) effect isn't drawn.
  - Move effects the GBA draws semi-transparent or brightened show opaque at normal brightness.
  - Full-screen background move effects stay a flat 2D layer over the 3D scene.
  - A few moves (Dig, Memento, Mimic) can show a flat copy of the Pokémon beside its 3D sprite.
  - During full-screen fades (a battle starting or ending) the Pokémon darken a little more than
    the rest of the scene for a moment.
- Battle arenas (Modern), what they don't do:
  - The sky shows only in water reflections and cloud shadows: the camera never frames the horizon.
  - Double battles reuse the two single-battle platforms: a side's two Pokémon share one, and
    their feet can sink into it.
  - Every Battle Frontier facility uses the same hall.
  - The trainers' intro pictures are inflated sprites like the Pokémon, not modelled figures.
- Battle arenas (Modern), the look:
  - At night the exposure only partly follows the dark, and the moonlit field is dim.
  - At night slab tops and sides differ in tone, islets and long grass are too saturated, and
    rocks on grass look moonlit.
  - Long grass is too saturated by day too, and its nearest blades look flat.
  - Palms come in one height only.
  - Underwater, the kelp's shape is simple and the light shafts are faint against the haze.
  - On the sea, the glint near the camera is heavy.
  - Mountain scree is paler than the GBA's darker pebbles.
  - Phoebe's room reads mid-purple rather than gloomy.
  - The Sky Pillar's broken edge reads as a step, not a jagged break.
  - With the camera turned part way, Groudon's lava pools can sit behind the Pokémon.
  - Groudon's lava glows with bloom (about 1–1.2 ms extra on an integrated GPU); Team Magma's lava
    and Phoebe's candles skip the glow halo to stay within budget.
- Battle camera edge cases (Modern):
  - Zoomed fully in when a battle starts, the opening sweep can show bare tree trunks for about
    half a second (the zoom carries over from the last battle).
  - Zoomed fully in, the palms on the sea's islets are above the top of the screen.
  - Windows wider than 21:9 can show unfinished scenery at the sides, such as the Sky Pillar's haze.
- Code-level open items with no visible effect today (the order of equal-priority sprites in the
  battle preview, the height of the overworld's flat ground decals, rock walls modelled taller
  than any view shows) are tracked in the progress log.
- Audio needs one key press or click before it can start (a browser requirement).
