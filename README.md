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
| Esc / O | Settings (quality, effects, volume, `.sav` import/export) |
| H / F1 | Help overlay |

Gamepads use the standard mapping. In-game saves (Start → Save) go to your browser
(IndexedDB) and can be exported as a `.sav` file that other emulators can read.

## What you're looking at

- **Overworld.** Every map is rebuilt in 3D from the live map grid. The renderer turns the
  GBA's oblique ¾ projection back into 3D: buildings get front walls and sloped roofs, trees
  become camera-facing cards, cliffs become plateaus with rock faces, furniture becomes
  boxes, and water is a glossy, gently moving surface. Tiles are decoded from live video
  memory on the GPU, so tile animations (water, flowers) and in-game map edits appear
  immediately. NPCs, the player, and field effects are lit billboards with soft shadows.
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
src/render/     Three.js renderer: overworld (classifier, world mesh, trees, weather, sky),
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
```

`/?map=<group>.<num>` opens a static 3D preview of any map (WASD/mouse to fly; `&hour=`,
`&weather=`, `&flash=` change the conditions).

## Notes and limitations

- Link-cable features (trading, link battles, Union Room) are unavailable. The game
  handles their absence the same way it does on a lone GBA.
- The 3D reconstruction is heuristic. A few unusual maps may show odd geometry, and you
  can press V at any time to switch to the original 2D view.
- Audio needs one key press or click before it can start (a browser requirement).
