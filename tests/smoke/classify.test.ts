// Runs the classifier on the live backup map of a save state and prints the kind map.
import { it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

it('classify-live', async () => {
  const { Gba } = await import('../../src/gba/gba');
  const { GameState } = await import('../../src/game/state');
  const { SYM } = await import('../../src/game/symbols');
  const { MetatileAtlas } = await import('../../src/render/overworld/metatileAtlas');
  const { analyzeMetatiles } = await import('../../src/render/overworld/tileInfo');
  const { classify } = await import('../../src/render/overworld/classify');
  const root = path.resolve(import.meta.dirname, '../..');
  const rom = fs.readdirSync(root).find((f) => f.endsWith('.gba'))!;
  const gba = new Gba(new Uint8Array(fs.readFileSync(path.join(root, rom))));
  gba.loadState(new Uint8Array(fs.readFileSync(path.join(root, process.env.LOAD ?? 'out/lr_out.state'))));
  gba.runFrame();
  const st = new GameState(gba.bus);
  st.update();
  const fakeTex = { vram: null, palette: null } as never;
  const atlas = new MetatileAtlas(fakeTex, 1);
  atlas.setTilesets(st.mem, st.layout!.primaryTileset, st.layout!.secondaryTileset);
  const charBase = ((gba.bus.io16[6] >>> 2) & 3) * 0x4000;
  const palOff = (SYM.gPlttBufferUnfaded & 0x3ffff) >>> 1;
  const info = analyzeMetatiles(gba.bus, atlas.entries, atlas.attributes, charBase, gba.bus.ewram16.subarray(palOff, palOff + 256));
  const border = [0, 1, 2, 3].map((i) => st.mem.u16(st.layout!.border + i * 2));
  const model = classify({ width: st.backupWidth, height: st.backupHeight, cells: st.readBackupGrid(), border, borderW: 2, borderH: 2, borderPhase: 1 },
    { info, generalPrimary: st.layout!.primaryTileset === SYM.gTileset_General, indoor: false, underground: false, underwater: false, margin: 2 });
  const grid = st.readBackupGrid();
  const hex: string[] = [];
  for (let y = 0; y < st.backupHeight; y++) {
    hex.push(Array.from(grid.subarray(y * st.backupWidth, (y + 1) * st.backupWidth)).map((v) => (v & 0x3ff).toString(16).padStart(3, '0') + ((v >> 10) & 3 ? '#' : '.')).join(' '));
  }
  fs.writeFileSync(path.join(root, 'out/classify.txt'),
    `charBase ${charBase} bg2cnt ${gba.bus.io16[6].toString(16)} generalPrimary ${st.layout!.primaryTileset === SYM.gTileset_General}\n` + model.debugMap() + '\n' + hex.join('\n'));
}, 120000);
