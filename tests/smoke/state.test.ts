// Dumps a GameState snapshot from a save state into out/state.txt (LOAD, FRAMES env).
import { it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

it('state', async () => {
  const out: string[] = [];
  const { Gba } = await import('../../src/gba/gba');
  const { GameState } = await import('../../src/game/state');
  const root = path.resolve(import.meta.dirname, '../..');
  const rom = fs.readdirSync(root).find((f) => f.endsWith('.gba'))!;
  const gba = new Gba(new Uint8Array(fs.readFileSync(path.join(root, rom))));
  gba.loadState(new Uint8Array(fs.readFileSync(path.join(root, process.env.LOAD ?? 'out/littleroot.state'))));
  for (let i = 0; i < Number(process.env.FRAMES ?? 2); i++) gba.runFrame();
  const st = new GameState(gba.bus);
  st.update();
  out.push(JSON.stringify({
    scene: st.scene, cb2: st.callback2.toString(16), map: [st.mapGroup, st.mapNum], pos: [st.posX, st.posY],
    cam: [st.cameraX, st.cameraY], s2m: [st.spriteToMapX, st.spriteToMapY], sco: [st.spriteCoordOffsetX, st.spriteCoordOffsetY],
    backup: [st.backupWidth, st.backupHeight], layout: st.layout, weather: st.weather, time: [st.hours, st.minutes],
  }));
  for (const o of st.objects) out.push('obj ' + JSON.stringify(o));
  for (const s of st.sprites) {
    out.push(`spr ${s.index} aff ${s.affine} dbl ${s.doubleSize} sc ${s.scaleX.toFixed(2)},${s.scaleY.toFixed(2)} tpl ${s.template.toString(16)} xy ${s.x},${s.y} x2y2 ${s.x2},${s.y2} c2c ${s.c2cX},${s.c2cY} wh ${s.width}x${s.height} co ${s.coordOffset} inv ${s.invisible} world ${s.worldX},${s.worldY} scr ${s.screenX},${s.screenY} pal ${s.palette} tile ${s.tileNum}`);
  }
  fs.writeFileSync(path.join(root, 'out/state.txt'), out.join('\n'));
}, 60000);
