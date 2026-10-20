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
| Esc / O | Settings (world style, quality, effects, volume, `.sav` import/export) |
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
- **Lighting.** The sun and sky follow the in-game clock. Building windows glow at night.
  Caves that need Flash are lit only by the player's light. Rain, thunderstorms (with
  lightning), volcanic ash, sandstorms, and underwater bubbles are real 3D particles.
- **Battles.** Each GBA battle sprite is projected into a 3D arena through a reference
  camera that matches the original layout. Lunges, faints, and move effects keep their
  original choreography but move through real space. The arena is themed per battle
  environment, using colours sampled from the game's own backgrounds.
- **Menus and cutscenes** are shown as the crisp original screen on an ambilight backdrop.

## Project layout

```
src/gba/        GBA emulator: ARM7TDMI CPU, PPU, APU, DMA, timers, HLE BIOS, Flash, RTC
src/game/       Emerald knowledge: symbol addresses, live-state reader, sprite classes, ROM decoders
src/render/     Three.js renderer: overworld (map analysis, world mesh, weather, sky), kit (Modern
                style models: terrain, water, cliffs, trees, grass, flowers, buildings, props),
                battle (arena, reference-camera projection), HUD, post-processing, map preview
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
npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/golden.test.ts tests/smoke/semantics.test.ts
                                           # ROM-driven smoke tests; coverage report → out/coverage*.txt
```

`npm run regress` writes one PNG per map and hour, a contact sheet per hour
(`_sheet_h11.png`, `_sheet_h21.png`) and render stats (`stats.json`: draw calls, triangles,
world build time), so two labels can be compared side by side. Both `regress` and `shot3d`
need the ROM in the project root and a local Chrome (or Edge) install, which they drive
headless; the smoke tests need the ROM.

`/?map=<group>.<num>` opens a static 3D preview of any map (WASD/mouse to fly; `&hour=`,
`&weather=`, `&flash=` change the conditions).

## Notes and limitations

- Link-cable features (trading, link battles, Union Room) are unavailable. The game
  handles their absence the same way it does on a lone GBA.
- The 3D reconstruction is heuristic. A few unusual maps may show odd geometry, and you
  can press V at any time to switch to the original 2D view. In Modern style the mountain
  ridges (Mt Chimney, Route 112, Jagged Pass), much of Ever Grande City's rock, the crater
  walls of Sootopolis and Lavaridge's cliffs, and a few special buildings (Devon Corp, the
  Battle Pyramid, Pike and Palace) still use the pixel-art reconstruction.
- Audio needs one key press or click before it can start (a browser requirement).
