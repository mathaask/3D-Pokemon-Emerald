// Live visual regression: loads save states in manual mode (?manual=1: no frame loop, fixed RTC,
// fixed 1/60 s timestep), steps them frame by frame with scripted keys (emu.step) and screenshots
// each scene in both world styles. Same inputs give the same frames, so runs diff pixel for pixel.
//
//   npm run regress:live -- --label <name> [--styles modern,retro] [--only a,b] [--dpr 1]
//     [--query k=v&…] [--compare <label>] [--gpu] [--selftest] [--static]
//     [--ab [--ab-method frame|block] [--ab-rounds n] [--ab-feature actors|npcfade] [--ab-aa]]
//
// Output: out/regress-live/<label>/<entry>_<style>.png, _sheet_<style>.png (4 columns), _crops.png
// (per entry 320×400 centre crops, Modern | Retro: the camera centres on the player) and stats.json
// ({ [entry_style]: { calls, triangles, programs, stepMsMax | buildMs, gpuMs?, gpuP90?, cpuMs?, diff?,
// selftest?, selftestMid? } }; stepMsMax = the largest renderer.render CPU ms of the entry's frames after its first,
// cold one; static entries report the preview's cold world build ms instead).
// --static adds the static map-preview entries (object events from ROM templates; STATIC below);
// --only names entries of either kind. --query is appended to every page URL. --compare diffs every PNG against out/regress-live/<label>/
// (a pixel differs when a channel differs by > 8; diff = { pct (2 decimals), bbox (null: identical),
// pixels (-1: sizes differ) }). --gpu times 60 more frames on the GPU after the screenshot (timer
// queries, medians). stats.json is merged per label, so partial --only runs add or replace entries
// (a failed entry's shot and stats are removed); the sheets are rebuilt from every PNG in the folder.
// --selftest runs the inflation-field self-test (emu/preview.selfTest(): the GPU field vs its CPU reference
// on the current atlas, the bleed fixture, the GPU ms of one update) on the entries marked `selftest`, in
// Modern (Retro computes no field), after their steps; it goes into stats and the field's slots into
// _field_<entry>.png (grey = height / max, blue tint = transparent in the atlas). An entry's
// `selftestAfter: n` adds a self-test point right after step n (`selftestMid`, _field_<entry>_mid.png).
// Gated: slots > 0, maxErr and fixtureMaxErr ≤ max(0.02, 0.003·inflateMax()) px (SELFTEST_TOL: half-float
// rounding grows with the field's height). The same call checks the HD sprite-edge shader (XBR_GLSL) against
// its CPU reference on a fixture: xbr.maxErr ≤ 2/255 (XBR_TOL).
// --ab (live entries, Modern) measures what the Phase 2 actors (inflated characters, object models) cost over the
// same build with them off (every sprite a card, the pre-Task-5 path; the inflation field's passes run in both): after
// the steps it snapshots the emulator (both modes emulate the same frames), then, by --ab-method:
//   frame (default): --ab-rounds ABBA quads (default 128) of single frames — each half switches the mode, renders one
//     untimed settle frame and times the next one alone; the snapshot is restored every 60 frames; per quad
//     (on₁ + on₂ − off₁ − off₂) / 2. Adjacent frames ~40 ms apart share the iGPU's clock state, which drifts by
//     several ms within seconds on the Intel/ANGLE machine: A/A runs (--ab-aa) read within ±0.3 ms at 64 quads.
//   block: --ab-rounds rounds (default 8) of on/off pairs in alternating order, each block restoring the snapshot,
//     5 settle frames and gpuFrames(60); per round on − off. Steadier per block, but A/A runs at 16 rounds read
//     +0.15 … +0.80 ms (Phase 2 Task 12): it cannot resolve the +1.0 / +0.3 ms budgets.
// Two variants: idle, and walking (entries with a `walk` key held throughout; `moved` = the least px the player walked
// in any timed block / restore window, so one that did not walk shows). Reported per entry: medians of on, off and of
// the paired deltas (on − off), GPU and CPU ms, into stats (`ab`) and a table flagging the cell over +1.0 ms GPU /
// +0.5 ms CPU (the Phase 2 budgets; reported, not gated). --ab-aa runs both arms on (A/A: the method's noise floor).
// --ab-feature npcfade switches the NPC occlusion fade instead (Task 11: the player's circle only as the baseline;
// flagged over +0.3 ms GPU), on the live entries and, idle only, the static ones with a stand-in player (&focus; the
// preview's same frames, no snapshot).
// Actor luminance (every run with both styles): after each screenshot the actors are drawn flat magenta
// once more without advancing time (_mask_<entry>_<style>.png); at the end, per entry, the Modern / Retro
// ratio of the shots' mean luma over the pixels where an actor is visible in both masks (occluders and the
// Modern occlusion dither excluded) goes into stats (`actorLum` on the Modern key) and a table.
// Exits non-zero when an entry fails, the page logs an error, --compare lacks a reference shot, or a
// self-test misses parity.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import puppeteer, { type Page } from 'puppeteer-core';
import { inflateMax } from '../src/render/actors/inflateMath';

interface LiveEntry {
  name: string; state: string; steps: [string, number][]; query?: string; eval?: string;
  /** --selftest: self-test after the steps; `selftestAfter`: also right after step n (mid-walk). */
  selftest?: boolean; selftestAfter?: number;
  /** --ab walking variant: the direction held (one that walks ≥ 3 cells from the steps' end); none: idle only. */
  walk?: string;
}

// Frame counts are tuned so each scene matches its comment (emu.step frames at 1/60 s; a walk
// takes 16 frames per cell). r101: standing still, the youngster stays off-screen left, so the
// player walks 3 cells towards him. transition: the battle flash peaks at 8 frames and is gone by
// 15; at 40 the spiral wipe starts over the zoomed overworld, its actors still visible.
// r101_grass's mid-walk self-test (after DOWN 18) lands on a frame whose sync changed the atlas's alpha
// (the player is still walking), as does its final one: a field one sync behind the atlas fails there.
// `walk` directions were probed (70 frames held from the steps' end); birch, lr_truck and vigoroth are
// cutscenes that hold the player (no `walk`; their NPCs move), truck_inside has 2-3 free cells.
const LIVE: LiveEntry[] = [
  { name: 'r101', state: 'out/r101.state', steps: [['LEFT', 48], ['', 30]], walk: 'LEFT' },  // Route 101: player, youngster, boy
  { name: 'r101_grass', state: 'out/r101.state', steps: [['LEFT', 108], ['DOWN', 18], ['', 30]], selftest: true, selftestAfter: 1, walk: 'UP' }, // standing in tall grass
  { name: 'r101_tree', state: 'out/r101.state', steps: [['LEFT', 66], ['DOWN', 42], ['', 30]], walk: 'LEFT' }, // against the treeline (fade)
  { name: 'r101_low', state: 'out/r101.state', query: 'camera=3', steps: [['', 30]], walk: 'LEFT' }, // Low preset: volume visible
  { name: 'r101_yaw', state: 'out/r101.state', eval: 'emu.renderer.overworld.yaw = 0.9', steps: [['', 30]], walk: 'LEFT' },
  { name: 'birch', state: 'out/s27.state', steps: [['', 30]], selftest: true },               // Birch, bag, Zigzagoon (a Pokémon)
  { name: 'lr_truck', state: 'out/lr_out.state', steps: [['', 30]], selftest: true },         // Littleroot: Mom, truck (gfx 94)
  { name: 'lr_walk', state: 'out/s22.state', steps: [['', 30]], walk: 'LEFT' },              // Littleroot free walk
  { name: 'item_indoor', state: 'out/s16.state', steps: [['', 30]], walk: 'RIGHT' },         // indoor item ball (gfx 59)
  { name: 'truck_inside', state: 'out/truck.state', steps: [['', 30]], walk: 'RIGHT' },      // moving boxes (gfx 113)
  { name: 'vigoroth', state: 'out/littleroot.state', steps: [['', 30]] },                     // indoor, Vigoroths (Pokémon)
  { name: 'battle', state: 'out/battle1.state', steps: [['', 30]] },                          // gated 0.00 % in Retro only
  { name: 'transition', state: 'out/wild_transition.state', steps: [['', 40]] },             // gated 0.00 % in Retro only
];

/**
 * Static preview scenes, run with --static (or named by --only): the map preview with the map's
 * object events from their ROM templates (`/?autostart=1&manual=1&actors=1&<q>&style=…`), 60 frames
 * at 1/60 s, hour 11 unless q sets one (the preview's default). The camera looks at the first
 * template with graphics id G (focusGfx) or at template N (focusObj); one naming no template fails
 * the entry. littleroot_npcs looks at the fat man (12,13): Birch, the twin, the boy and a truck are
 * in frame too (Mom's cell is inside her house). Berry trees show stage localId % 5: Route 104's
 * framed patch holds stages 0-2 (r104_berries / r104_night); r123_berries frames Route 123's
 * two rows of six (templates 0-3, 9-16), all five stages.
 */
interface StaticEntry { name: string; q: string; selftest?: boolean }
const STATIC: StaticEntry[] = [
  { name: 'littleroot_npcs', q: 'map=0.9&focusGfx=17', selftest: true }, { name: 'rustboro_npcs', q: 'map=0.3' },
  { name: 'r104_berries', q: 'map=0.19&focusGfx=60' }, { name: 'r104_night', q: 'map=0.19&focusGfx=60&hour=21' },
  { name: 'r123_berries', q: 'map=0.38&focusObj=3' },
  { name: 'r116_cut', q: 'map=0.31&focusGfx=82' }, { name: 'r114_rocks', q: 'map=0.29&focusGfx=86' },
  { name: 'fiery_boulders', q: 'map=24.14&focusGfx=87' }, { name: 'r119_items', q: 'map=0.34&focusGfx=59' },
  { name: 'granite_flash', q: 'map=24.7&flash=2&focusObj=0' },
  // Granite Cave B2F (Flash): a breakable rock one cell north of the lantern, where Rock Smash puts the player (model lamp ceiling)
  // (added in Phase 2 Task 8: its p2-base Retro reference was captured then, in fix round 3, with --label p2-base --only
  // granite_rocks --styles retro; Retro renders unchanged through Phase 2, 0.00 % on every older entry)
  { name: 'granite_rocks', q: 'map=24.9&flash=2&x=5.5&y=15.5' },
  { name: 'woods_shade', q: 'map=24.11&focusObj=3&hour=17.5' }, // Petalburg Woods: a Bug Catcher in tree shade (shadows on actors)
  // Route 104: Mr. Briney's boat (gfx 88), a single 32×32 sprite that the subsprite composition leaves as it is
  // (added in Phase 2 Task 10: its p2-base Retro and Modern references were captured at 1c6fe5a, before the composition,
  // with --label p2-base --only r104_boat)
  { name: 'r104_boat', q: 'map=0.19&focusGfx=88' },
  // Route 103: a stand-in player on the sand path (&focus=1 at the camera target, cell 53,12) and, 3 cells east, the
  // NPC of template 11 (gfx 25, cell 56,13) behind a tree crown: the NPC occlusion fade clears it (Task 11; no Petalburg
  // Woods NPC stands behind a crown). (Added in Phase 2 Task 11: its p2-base Retro and Modern references were captured
  // at 9cd7896, before the NPC fade, with --label p2-base --only r103_npc)
  { name: 'r103_npc', q: 'map=0.18&x=53.5&y=12.5&focus=1' },
  // Petalburg Woods, dense canopy: a stand-in player (&focus=1, cell 32,34) and, 2 cells west, the NPC of template 10
  // (gfx 13, cell 30,34), not hidden, below a wall of crowns: the NPC fade must leave those crowns whole (no holes
  // without a purpose). (Added in Phase 2 Task 11 fix round 1: its p2-base Retro and Modern references were captured
  // at 9cd7896, before the NPC fade, with --label p2-base --only woods_npc)
  { name: 'woods_npc', q: 'map=24.11&x=32.5&y=34.5&focus=1' },
  // woods_npc with the camera turned half way round (&yaw=π, from the north): the crown wall now stands between the
  // camera and the NPC, which the NPC fade clears ("in front" follows the camera's yaw). (Added in Phase 2 Task 11 fix
  // round 2: its p2-base Retro and Modern references were captured at 9cd7896, before the NPC fade, with --label p2-base
  // --only woods_npc_yaw)
  { name: 'woods_npc_yaw', q: 'map=24.11&x=32.5&y=34.5&focus=1&yaw=3.1416' },
];

type Entry = (LiveEntry & { kind: 'live' }) | (StaticEntry & { kind: 'static' });

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const VIEW_W = 1280;
const VIEW_H = 800;
const CROP_W = 320;
const CROP_H = 400;

/** Inflation-field self-test parity tolerance (sprite px: half-float rounding grows with the height) and the
 *  field update's GPU target (ms, reported). */
const SELFTEST_TOL = Math.max(0.02, 0.003 * inflateMax());
/** xBR self-test parity tolerance (RGBA 0..1: the RGBA8 target's rounding plus float differences). */
const XBR_TOL = 2 / 255;
const FIELD_GPU_MS = 0.3;
/** --ab-feature: what the A/B switches off for its baseline, on the live page (emu) and, where it can, the static
 *  preview (idle only: nothing walks there), and its budgets over that baseline (GPU frame, renderer CPU; ms), flagged
 *  in the table: the Phase 2 actors +1.0 / +0.5, the NPC occlusion fade (Task 11) +0.3 / +0.5. `previewWhen`: the static
 *  entries (by query) where the switch changes anything (the NPC fade needs a stand-in player, &focus; elsewhere both
 *  arms would be the same frames). */
interface AbFeature {
  what: string; gpuMs: number; cpuMs: number; live: (on: boolean) => string; preview?: (on: boolean) => string;
  previewWhen?: (q: string) => boolean;
}
const AB_FEATURES: Record<string, AbFeature> = {
  actors: {
    what: 'Phase 2 actors (inflated + models) on vs off (all cards)', gpuMs: 1.0, cpuMs: 0.5,
    live: (on) => `emu.renderer.overworld.setActorInflation(${on})`,
  },
  npcfade: {
    what: "NPC occlusion fade on vs off (the player's circle only)", gpuMs: 0.3, cpuMs: 0.5,
    live: (on) => `emu.renderer.overworld.setNpcFade(${on})`, preview: (on) => `preview.setNpcFade(${on})`,
    previewWhen: (q) => /(^|&)focus=/.test(q),
  },
};

interface SelfTest { slots: number; maxErr: number; fixtureMaxErr: number; gpuMs: number; xbr: { maxErr: number } }
interface Diff { pct: number; bbox: { x: number; y: number; w: number; h: number } | null; pixels: number }
/** Actor luminance of an entry's Modern shot relative to its Retro shot, over the visible actor pixels. */
interface ActorLum { ratio: number; modern: number; retro: number; pixels: number }
/** Fewer visible actor pixels than this: no luminance (battle, an actor hidden in one style). */
const ACTOR_LUM_MIN_PX = 200;
/** One --ab variant: medians of on, off and of the per-round paired deltas (ms); `moved` = the least px the
 *  player walked in any timed block (walking). */
interface AbVariant { gpuOn: number; gpuOff: number; dGpu: number; cpuOn: number; cpuOff: number; dCpu: number; moved?: number }
/** --ab-method: `block` = rounds of 60-frame blocks per mode (abVariant), `frame` = ABBA quads of single frames
 *  (abVariantFrames, the default: it resolves the deltas better, see the header). */
type AbMethod = 'block' | 'frame';
interface EntryStats {
  calls: number; triangles: number; programs: number; stepMsMax?: number; buildMs?: number;
  gpuMs?: number; gpuP90?: number; cpuMs?: number;
  diff?: Diff; selftest?: SelfTest; selftestMid?: SelfTest;
  /** `rounds`: blocks per mode (block) or ABBA quads (frame, `half`: its settle / timed frames per half); `aa`: an A/A
   *  run (both arms on: the noise floor). */
  ab?: { method: AbMethod; rounds: number; half?: AbHalf; idle: AbVariant; walk?: AbVariant; aa?: boolean };
  /** On the Modern key: Modern / Retro actor luminance (both styles in the run). */
  actorLum?: ActorLum;
}

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Pixel size of a PNG file (IHDR). */
function pngSize(file: string): { w: number; h: number } {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// Diff of two PNGs (data URLs) in the page: a pixel differs when any channel differs by > 8.
// (a string: tsx would wrap the functions of a function argument in a helper the page lacks)
const DIFF_FN = `(async function (a, b) {
  function load(src) {
    return new Promise(function (res, rej) {
      var i = new Image();
      i.onload = function () { res(i); };
      i.onerror = function () { rej(new Error('cannot decode image')); };
      i.src = src;
    });
  }
  var ia = await load(a), ib = await load(b);
  var w = ia.naturalWidth, h = ia.naturalHeight;
  if (ib.naturalWidth !== w || ib.naturalHeight !== h) {
    return { pct: 100, bbox: { x: 0, y: 0, w: Math.max(w, ib.naturalWidth), h: Math.max(h, ib.naturalHeight) }, pixels: -1 };
  }
  function pixels(img) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    return g.getImageData(0, 0, w, h).data;
  }
  var pa = pixels(ia), pb = pixels(ib);
  var n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var k = (y * w + x) * 4;
      if (Math.abs(pa[k] - pb[k]) > 8 || Math.abs(pa[k + 1] - pb[k + 1]) > 8 ||
          Math.abs(pa[k + 2] - pb[k + 2]) > 8 || Math.abs(pa[k + 3] - pb[k + 3]) > 8) {
        n++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { pct: Math.round((n / (w * h)) * 10000) / 100, bbox: n ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null, pixels: n };
})`;

// Actor luminance of an entry: the mean sRGB luma (Rec. 709) of its Modern and Retro shots over the pixels
// where an actor is visible in both (each style's actor-mask shot: magenta, eroded by 1 px; occluders and
// the occlusion dither excluded). A string for the page, as DIFF_FN.
const LUM_FN = `(async function (shotM, shotR, maskM, maskR) {
  function load(src) {
    return new Promise(function (res, rej) {
      var i = new Image();
      i.onload = function () { res(i); };
      i.onerror = function () { rej(new Error('cannot decode image')); };
      i.src = src;
    });
  }
  var imgs = await Promise.all([load(shotM), load(shotR), load(maskM), load(maskR)]);
  var w = imgs[0].naturalWidth, h = imgs[0].naturalHeight;
  function pixels(img) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    return g.getImageData(0, 0, w, h).data;
  }
  var pm = pixels(imgs[0]), pr = pixels(imgs[1]), mm = pixels(imgs[2]), mr = pixels(imgs[3]);
  function magenta(d, x, y) { var k = (y * w + x) * 4; return d[k] > 200 && d[k + 1] < 90 && d[k + 2] > 200; }
  function both(x, y) { return magenta(mm, x, y) && magenta(mr, x, y); }
  var n = 0, sm = 0, sr = 0;
  for (var y = 1; y < h - 1; y++) {
    for (var x = 1; x < w - 1; x++) {
      if (!(both(x, y) && both(x - 1, y) && both(x + 1, y) && both(x, y - 1) && both(x, y + 1))) continue;
      var k = (y * w + x) * 4;
      sm += 0.2126 * pm[k] + 0.7152 * pm[k + 1] + 0.0722 * pm[k + 2];
      sr += 0.2126 * pr[k] + 0.7152 * pr[k + 1] + 0.0722 * pr[k + 2];
      n++;
    }
  }
  return { pixels: n, modern: n ? sm / n : 0, retro: n ? sr / n : 0 };
})`;

async function actorLum(page: Page, files: [string, string, string, string]): Promise<ActorLum | null> {
  const url = (f: string) => JSON.stringify(`data:image/png;base64,${fs.readFileSync(f).toString('base64')}`);
  await page.setContent('<html><body></body></html>');
  const r = await page.evaluate(`${LUM_FN}(${files.map(url).join(', ')})`) as { pixels: number; modern: number; retro: number };
  if (r.pixels < ACTOR_LUM_MIN_PX || r.retro <= 0) return null;
  return { ratio: round(r.modern / r.retro, 3), modern: round(r.modern, 1), retro: round(r.retro, 1), pixels: r.pixels };
}

async function diffPng(page: Page, file: string, ref: string): Promise<Diff> {
  const url = (f: string) => JSON.stringify(`data:image/png;base64,${fs.readFileSync(f).toString('base64')}`);
  await page.setContent('<html><body></body></html>');
  return await page.evaluate(`${DIFF_FN}(${url(file)}, ${url(ref)})`) as Diff;
}

/** Renders an HTML page of the run folder's images (relative URLs) and screenshots it whole. */
async function shootHtml(page: Page, dir: string, html: string, out: string, width: number, scale: number): Promise<void> {
  const file = path.join(dir, '_page.html');
  fs.writeFileSync(file, html);
  try {
    await page.setViewport({ width, height: 400, deviceScaleFactor: scale });
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    await page.screenshot({ path: out as `${string}.png`, fullPage: true });
  } finally {
    fs.rmSync(file, { force: true });
  }
  console.log(`sheet ${out}`);
}

const CAPTION = 'figcaption{position:absolute;left:4px;top:2px;color:#ff0;font:bold 14px sans-serif;text-shadow:0 0 3px #000}';

/** Contact sheets (4 thumbnails per row, one per style) and the centre-crop sheet, from every PNG in `dir`. */
async function buildSheets(page: Page, dir: string): Promise<void> {
  const order = [...LIVE.map((e) => e.name), ...STATIC.map((e) => e.name)];
  const shots = new Map<string, Set<string>>();
  for (const f of fs.readdirSync(dir)) {
    const m = /^([^_].*)_(modern|retro)\.png$/.exec(f);
    if (m) (shots.get(m[1]) ?? shots.set(m[1], new Set()).get(m[1])!).add(m[2]);
  }
  const rank = (n: string) => { const i = order.indexOf(n); return i < 0 ? order.length : i; };
  const names = [...shots.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  for (const style of ['modern', 'retro']) {
    const list = names.filter((n) => shots.get(n)!.has(style));
    if (!list.length) continue;
    const cells = list.map((n) => `<figure><img src="${n}_${style}.png"><figcaption>${n}</figcaption></figure>`).join('');
    await shootHtml(page, dir, `<style>body{margin:0;background:#222;display:grid;grid-template-columns:repeat(4,400px)}
      figure{margin:0;position:relative}img{width:400px;height:250px;display:block}${CAPTION}</style>${cells}`,
    path.join(dir, `_sheet_${style}.png`), 1600, 1);
  }
  // centre crops at the screenshots' own resolution (a --dpr 2 run keeps its detail)
  let scale = 1;
  const cells: string[] = [];
  for (const n of names) {
    for (const style of ['modern', 'retro']) {
      const f = `${n}_${style}.png`;
      if (!shots.get(n)!.has(style)) {
        cells.push(`<figure><div></div><figcaption>${n} ${style} (missing)</figcaption></figure>`);
        continue;
      }
      const { w, h } = pngSize(path.join(dir, f));
      const s = w / VIEW_W;
      scale = Math.max(scale, s);
      cells.push(`<figure><div style="background:url('${f}') center/${w / s}px ${h / s}px no-repeat"></div><figcaption>${n} ${style}</figcaption></figure>`);
    }
  }
  if (!cells.length) return;
  await shootHtml(page, dir, `<style>body{margin:0;background:#222;display:grid;grid-template-columns:repeat(4,${CROP_W}px)}
    figure{margin:0;position:relative;border:0}div{width:${CROP_W}px;height:${CROP_H}px;background-color:#333}${CAPTION}</style>${cells.join('')}`,
  path.join(dir, '_crops.png'), CROP_W * 4, scale);
}

/**
 * One self-test point: `api`.selfTest() and the field dump (_field_<dump>.png). ok: some slots were
 * compared and both parity errors are finite and within SELFTEST_TOL (NaN arrives as null), and the xBR
 * shader's within XBR_TOL.
 */
async function selfTestPoint(page: Page, api: string, outDir: string, dump: string): Promise<{ result: SelfTest; ok: boolean; text: string }> {
  const result = await page.evaluate(`${api}.selfTest()`) as SelfTest;
  const png = await page.evaluate(`${api}.fieldDump()`) as string;
  fs.writeFileSync(path.join(outDir, `_field_${dump}.png`), Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
  const within = (v: number) => Number.isFinite(v) && v <= SELFTEST_TOL;
  const xbrOk = Number.isFinite(result.xbr?.maxErr) && result.xbr.maxErr <= XBR_TOL;
  const ok = result.slots > 0 && within(result.maxErr) && within(result.fixtureMaxErr) && xbrOk;
  let text = `selftest ${result.slots} slots maxErr ${result.maxErr} fixture ${result.fixtureMaxErr} gpu ${round(result.gpuMs, 3)} ms`
    + ` xbr maxErr ${result.xbr?.maxErr}`;
  if (!(result.gpuMs <= FIELD_GPU_MS)) text += ` (> ${FIELD_GPU_MS} ms target)`;
  return { result, ok, text };
}

/** The player's world position (px), or null (no player: battle, cutscene without one). */
const PLAYER_POS = `(() => { const st = emu.renderer.state; const p = st.player;
  const s = p && st.sprites.find((q) => q.index === p.spriteId); return s ? [s.worldX, s.worldY] : null; })()`;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

/**
 * One --ab variant: `rounds` on/off pairs (order alternating per round) of `feature`, each block settling 5 frames
 * and timing gpuFrames(60). Live: each block restores the snapshot `window.__abSnap` first, `keys` held through it.
 * Static (the preview): the same frames, idle.
 */
async function abVariant(page: Page, rounds: number, keys: string, feature: AbFeature, live: boolean, aa = false): Promise<AbVariant> {
  type T = { gpuMs: number; cpuMs: number };
  const on: T[] = [], off: T[] = [];
  let moved = Infinity;
  const k = JSON.stringify(keys);
  for (let r = 0; r < rounds; r++) {
    for (const mode of r % 2 === 0 ? [true, false] : [false, true]) {
      if (!live) {
        await page.evaluate(`${feature.preview!(mode || aa)}; preview.frames(5)`);
        (mode ? on : off).push(await page.evaluate('preview.gpuFrames(60)') as T);
        continue;
      }
      await page.evaluate(`${feature.live(mode || aa)}; emu.gba.loadState(window.__abSnap)`);
      await page.evaluate(`emu.gpuFrames(5, ${k})`);
      const p0 = await page.evaluate(PLAYER_POS) as number[] | null;
      const g = await page.evaluate(`emu.gpuFrames(60, ${k})`) as T;
      const p1 = await page.evaluate(PLAYER_POS) as number[] | null;
      moved = Math.min(moved, p0 && p1 ? Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) : 0);
      (mode ? on : off).push(g);
    }
  }
  const v: AbVariant = {
    gpuOn: round(median(on.map((x) => x.gpuMs)), 3), gpuOff: round(median(off.map((x) => x.gpuMs)), 3),
    dGpu: round(median(on.map((x, i) => x.gpuMs - off[i].gpuMs)), 3),
    cpuOn: round(median(on.map((x) => x.cpuMs)), 3), cpuOff: round(median(off.map((x) => x.cpuMs)), 3),
    dCpu: round(median(on.map((x, i) => x.cpuMs - off[i].cpuMs)), 3),
  };
  if (keys) v.moved = round(moved, 1);
  return v;
}

/** Frames emulated between snapshot restores in an interleaved --ab variant (live; settle frames included). */
const FRAME_AB_WINDOW = 60;

/** One half of an interleaved --ab quad: untimed settle frames after the switch, then timed frames back to back. */
interface AbHalf { settle: number; timed: number }

/**
 * One interleaved --ab variant (`--ab-method frame`): `quads` ABBA quads (on off off on, then off on on off). Each half
 * switches the mode, emulates and renders `half.settle` untimed frames back to back (a switch re-uploads the instance
 * buffers the modes share, and the iGPU ramps its clock after the harness's idle waits: the settle frames take both),
 * then times `half.timed` frames back to back (gpuFrames: their median). Live: the snapshot `window.__abSnap` is
 * restored before a half once FRAME_AB_WINDOW frames ran since the last restore, `keys` held throughout. Per quad the
 * delta is (on₁ + on₂ − off₁ − off₂) / 2: a quad spans well under a second, so the iGPU's clock and thermal drift
 * (several ms within seconds) cancel, and so do a linear trend and the half's place in the quad. Medians over the quads.
 * `aa`: both arms on (an A/A run: the method's noise floor).
 */
async function abVariantFrames(page: Page, quads: number, keys: string, feature: AbFeature, live: boolean, aa: boolean,
  half: AbHalf): Promise<AbVariant> {
  const k = JSON.stringify(keys);
  const on = live ? feature.live(true) : feature.preview!(true);
  const off = live ? feature.live(aa) : feature.preview!(aa);
  const script = `(async () => {
    const out = []; let moved = Infinity, frames = ${FRAME_AB_WINDOW}, p0 = null, restores = 0;
    const pos = () => ${live ? PLAYER_POS : 'null'};
    for (let q = 0; q < ${quads}; q++) {
      for (const m of q % 2 === 0 ? [1, 0, 0, 1] : [0, 1, 1, 0]) {
        ${live ? `if (frames >= ${FRAME_AB_WINDOW}) {
          if (restores++ > 0) { const p1 = pos(); moved = Math.min(moved, p0 && p1 ? Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) : 0); }
          emu.gba.loadState(window.__abSnap); frames = 0; p0 = undefined;
        }` : ''}
        if (m) { ${on}; } else { ${off}; }
        ${live ? `emu.step(${k}, ${half.settle})` : `preview.frames(${half.settle})`};
        ${live ? 'if (p0 === undefined) p0 = pos();' : ''}
        const g = await ${live ? `emu.gpuFrames(${half.timed}, ${k})` : `preview.gpuFrames(${half.timed})`};
        frames += ${half.settle + half.timed};
        out.push(m, g.gpuMs, g.cpuMs);
      }
    }
    return { out, moved };
  })()`;
  try {
    const r = await page.evaluate(script) as { out: number[]; moved: number | null };
    const on: number[][] = [[], []], off: number[][] = [[], []], dG: number[] = [], dC: number[] = [];
    for (let q = 0; q < quads; q++) {
      let g = 0, c = 0;
      for (let h = 0; h < 4; h++) {
        const [m, gpu, cpu] = r.out.slice((q * 4 + h) * 3, (q * 4 + h) * 3 + 3);
        (m ? on : off)[0].push(gpu);
        (m ? on : off)[1].push(cpu);
        g += m ? gpu : -gpu;
        c += m ? cpu : -cpu;
      }
      dG.push(g / 2);
      dC.push(c / 2);
    }
    const v: AbVariant = {
      gpuOn: round(median(on[0]), 3), gpuOff: round(median(off[0]), 3), dGpu: round(median(dG), 3),
      cpuOn: round(median(on[1]), 3), cpuOff: round(median(off[1]), 3), dCpu: round(median(dC), 3),
    };
    // (a window that never completed: no walking shown, Infinity → null over JSON)
    if (keys && live) v.moved = round(r.moved ?? 0, 1);
    return v;
  } finally {
    await page.evaluate(on);
  }
}

/** --ab on a live entry after its steps: idle and (with `walk`) walking variants; leaves the entry as found. */
async function abMeasure(page: Page, e: LiveEntry, rounds: number, feature: AbFeature, method: AbMethod, aa: boolean, half: AbHalf):
  Promise<NonNullable<EntryStats['ab']>> {
  await page.evaluate('window.__abSnap = emu.gba.saveState()');
  const run = (keys: string) => method === 'frame' ? abVariantFrames(page, rounds, keys, feature, true, aa, half)
    : abVariant(page, rounds, keys, feature, true, aa);
  try {
    const idle = await run('');
    const walk = e.walk ? await run(e.walk) : undefined;
    return { method, rounds, ...(method === 'frame' ? { half } : {}), idle, walk, ...(aa ? { aa } : {}) };
  } finally {
    await page.evaluate(`${feature.live(true)}; emu.gba.loadState(window.__abSnap)`);
  }
}

/** --ab on a static entry (a feature with a preview switch): idle only; leaves the feature on. */
async function abMeasureStatic(page: Page, rounds: number, feature: AbFeature, method: AbMethod, aa: boolean, half: AbHalf):
  Promise<NonNullable<EntryStats['ab']>> {
  try {
    const idle = method === 'frame' ? await abVariantFrames(page, rounds, '', feature, false, aa, half) : await abVariant(page, rounds, '', feature, false, aa);
    return { method, rounds, ...(method === 'frame' ? { half } : {}), idle, ...(aa ? { aa } : {}) };
  } finally {
    await page.evaluate(feature.preview!(true));
  }
}

const abText = (v: AbVariant) => `${v.dGpu >= 0 ? '+' : ''}${v.dGpu.toFixed(2)} gpu ${v.dCpu >= 0 ? '+' : ''}${v.dCpu.toFixed(3)} cpu`
  + (v.moved !== undefined ? ` (moved ${v.moved} px)` : '');

async function main(): Promise<void> {
  const root = path.resolve(import.meta.dirname, '..');
  const label = arg('label', '');
  if (!label) throw new Error('--label <name> is required');
  const styles = arg('styles', 'modern,retro').split(',').filter(Boolean);
  for (const s of styles) if (s !== 'modern' && s !== 'retro') throw new Error(`unknown style: ${s}`);
  const only = arg('only', '').split(',').filter(Boolean);
  const dpr = parseFloat(arg('dpr', '1'));
  const extra = arg('query', '');
  const compare = arg('compare', '');
  if (compare && compare === label) throw new Error('--compare must name another run than --label (it would diff a run against itself)');
  const gpu = flag('gpu');
  const selftest = flag('selftest');
  const ab = flag('ab');
  const abMethod = arg('ab-method', 'frame') as AbMethod;
  if (abMethod !== 'block' && abMethod !== 'frame') throw new Error(`unknown --ab-method ${abMethod} (block, frame)`);
  const abRounds = parseInt(arg('ab-rounds', abMethod === 'frame' ? '128' : '8'), 10);
  const abAa = flag('ab-aa');
  const abHalf: AbHalf = { settle: parseInt(arg('ab-settle', '4'), 10), timed: parseInt(arg('ab-timed', '4'), 10) };
  if (!(abHalf.settle >= 1 && abHalf.timed >= 1)) throw new Error('--ab-settle / --ab-timed must be positive integers');
  if (ab && !(abRounds >= 1)) throw new Error('--ab-rounds must be a positive integer');
  const abFeatureName = arg('ab-feature', 'actors');
  const abFeature = AB_FEATURES[abFeatureName];
  if (!abFeature) throw new Error(`unknown --ab-feature ${abFeatureName} (${Object.keys(AB_FEATURES).join(', ')})`);
  const abRows: string[] = [];
  const lumRows: { name: string; lum: ActorLum }[] = [];
  const all: Entry[] = [...LIVE.map((e) => ({ ...e, kind: 'live' as const })), ...STATIC.map((e) => ({ ...e, kind: 'static' as const }))];
  for (const n of only) {
    if (!all.some((e) => e.name === n)) throw new Error(`unknown entry: ${n}`);
  }
  // --only picks entries of both kinds by name; otherwise every live entry, and the static ones with --static
  const entries = only.length ? all.filter((e) => only.includes(e.name)) : all.filter((e) => e.kind === 'live' || flag('static'));
  const outDir = path.join(root, 'out/regress-live', label);
  const refDir = compare ? path.join(root, 'out/regress-live', compare) : '';
  if (refDir && !fs.existsSync(refDir)) throw new Error(`no reference run ${refDir}`);
  fs.mkdirSync(outDir, { recursive: true });
  const statsFile = path.join(outDir, 'stats.json');
  const stats: Record<string, EntryStats> = fs.existsSync(statsFile) ? JSON.parse(fs.readFileSync(statsFile, 'utf8')) : {};

  const server = await createServer({ root, server: { port: 5197, strictPort: false }, logLevel: 'error' });
  await server.listen();
  const port = (server.httpServer!.address() as { port: number }).port;
  const browser = await puppeteer.launch({
    executablePath: CHROME.find((p) => fs.existsSync(p))!,
    headless: true,
    args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required',
      '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
    defaultViewport: { width: VIEW_W, height: VIEW_H, deviceScaleFactor: dpr },
  });
  const failures: string[] = [];
  const errored: string[] = []; // entries that logged page errors
  const missingRefs: string[] = [];
  const selftestFailures: string[] = [];
  let pageErrors = 0;
  const diffs: string[] = [];
  try {
    // one tab only: a second one would hide this one (no rAF, no presented canvas frames)
    const page = await browser.newPage();
    let current = '';
    page.on('pageerror', (e) => { pageErrors++; console.log(`[${current} page error] ${(e as Error).message}`); });
    page.on('console', (m) => {
      if (m.location().url?.endsWith('/favicon.ico')) return;
      if (m.type() === 'error') pageErrors++;
      if (m.type() === 'error' || m.type() === 'warn') console.log(`[${current} page ${m.type()}] ${m.text()}`);
    });
    let gpuName = '';
    for (const e of entries) {
      for (const style of styles) {
        const key = `${e.name}_${style}`;
        current = key;
        const errorsBefore = pageErrors;
        try {
          // live entries drive the game page (window.emu), static ones the map preview (window.preview)
          const api = e.kind === 'live' ? 'emu' : 'preview';
          let q: string;
          if (e.kind === 'live') {
            if (!fs.existsSync(path.join(root, e.state))) throw new Error(`missing save state ${e.state}`);
            q = ['manual=1', `state=/${e.state}`, `style=${style}`, e.query, extra].filter(Boolean).join('&');
          } else {
            q = ['autostart=1', 'manual=1', 'actors=1', e.q, `style=${style}`, extra].filter(Boolean).join('&');
          }
          await page.goto(`http://localhost:${port}/?${q}`, { waitUntil: 'load' });
          await page.waitForFunction(e.kind === 'live' ? '!!(window.emu && window.emu.step)' : '!!(window.preview && window.preview.frames)',
            { timeout: 120_000, polling: 100 });
          if (!gpuName) {
            gpuName = await page.evaluate(`(() => {
              const gl = ${e.kind === 'live' ? 'emu.renderer.webgl' : 'preview.webgl'}.getContext();
              const dbg = gl.getExtension('WEBGL_debug_renderer_info');
              return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
            })()`) as string;
            console.log(`GPU: ${gpuName}`);
          }
          let stepMsMax: number | undefined;
          const selfTests = selftest && e.selftest === true && style === 'modern';
          let mid: { result: SelfTest; ok: boolean; text: string } | undefined;
          if (e.kind === 'live') {
            if (e.eval) await page.evaluate(e.eval);
            // the entry's first frame builds the world and compiles programs (seconds, varying with
            // Chrome's program cache): stepMsMax is the largest frame time after it
            stepMsMax = 0;
            for (const [n, [keys, frames]] of e.steps.entries()) {
              const times = await page.evaluate(`emu.step(${JSON.stringify(keys)}, ${frames})`) as number[];
              for (const t of n === 0 ? times.slice(1) : times) stepMsMax = Math.max(stepMsMax, t);
              if (selfTests && e.selftestAfter === n) mid = await selfTestPoint(page, api, outDir, `${e.name}_mid`);
            }
          } else {
            // a focus naming no template would frame the map centre instead: never a baseline
            const focusError = await page.evaluate('preview.focusError') as string | null;
            if (focusError) throw new Error(`preview: ${focusError}`);
            await page.evaluate('preview.frames(60)');
          }
          // the page chrome's CSS transitions (the loader fading out) run on the wall clock: end them
          await page.evaluate(`document.getAnimations().forEach((a) => { try { a.finish(); } catch { /* infinite */ } })`);
          const file = path.join(outDir, `${key}.png`);
          await page.screenshot({ path: file as `${string}.png` });
          const s = await page.evaluate(e.kind === 'live' ? 'emu.renderer.stats()' : 'preview.stats()') as
            { calls: number; triangles: number; programs: number; buildMs?: number };
          const entry: EntryStats = { ...s };
          if (stepMsMax !== undefined) entry.stepMsMax = round(stepMsMax, 2);
          // the actor mask of this frame: drawn again without advancing time, actors flat magenta
          const [maskOn, maskOff] = e.kind === 'live'
            ? ['emu.renderer.overworld.setActorMask(true); emu.renderer.setFixedTimestep(0); emu.renderer.render(0)',
              'emu.renderer.overworld.setActorMask(false); emu.renderer.render(0); emu.renderer.setFixedTimestep(1 / 60)']
            : ['preview.setActorMask(true); preview.renderStill()', 'preview.setActorMask(false); preview.renderStill()'];
          await page.evaluate(maskOn);
          await page.screenshot({ path: path.join(outDir, `_mask_${key}.png`) as `${string}.png` });
          await page.evaluate(maskOff);
          // (the self-test checks the screenshot's frame, after the steps; GPU timing then renders 60 more frames)
          let selfLine = '';
          if (mid) {
            entry.selftestMid = mid.result;
            if (!mid.ok) selftestFailures.push(`${key} (after step ${e.kind === 'live' ? e.selftestAfter : '?'})`);
            selfLine += ` | mid-walk ${mid.text}`;
          }
          if (selfTests) {
            const t = await selfTestPoint(page, api, outDir, e.name);
            entry.selftest = t.result;
            if (!t.ok) selftestFailures.push(key);
            selfLine += ` | ${t.text}`;
          }
          if (gpu) {
            const g = await page.evaluate(`${api}.gpuFrames(60)`) as { gpuMs: number; gpuP90: number; cpuMs: number };
            entry.gpuMs = round(g.gpuMs, 3);
            entry.gpuP90 = round(g.gpuP90, 3);
            entry.cpuMs = round(g.cpuMs, 3);
          }
          if (ab && style === 'modern' && (e.kind === 'live' || (abFeature.preview && (abFeature.previewWhen?.(e.q) ?? true)))) {
            const r = entry.ab = e.kind === 'live' ? await abMeasure(page, e, abRounds, abFeature, abMethod, abAa, abHalf)
              : await abMeasureStatic(page, abRounds, abFeature, abMethod, abAa, abHalf);
            const cell = (v?: AbVariant) => (v ? `${v.dGpu >= 0 ? '+' : ''}${v.dGpu.toFixed(2)}${v.dGpu > abFeature.gpuMs ? ' OVER' : ''} | `
              + `${v.dCpu >= 0 ? '+' : ''}${v.dCpu.toFixed(3)}${v.dCpu > abFeature.cpuMs ? ' OVER' : ''}` : '- | -');
            abRows.push(`| ${e.name} | ${r.idle.gpuOn.toFixed(2)} / ${r.idle.gpuOff.toFixed(2)} | ${cell(r.idle)} | `
              + `${r.walk ? `${r.walk.gpuOn.toFixed(2)} / ${r.walk.gpuOff.toFixed(2)}` : '-'} | ${cell(r.walk)} | ${r.walk?.moved ?? '-'} |`);
          }
          let line = `shot ${key.padEnd(24)} calls ${String(s.calls).padStart(4)} tris ${String(s.triangles).padStart(8)} programs ${s.programs}`;
          line += stepMsMax !== undefined ? ` stepMax ${entry.stepMsMax} ms` : ` build ${s.buildMs} ms`;
          if (gpu) line += ` | gpu ${entry.gpuMs} p90 ${entry.gpuP90} cpu ${entry.cpuMs} ms`;
          if (entry.ab) line += ` | ab idle ${abText(entry.ab.idle)}${entry.ab.walk ? `, walk ${abText(entry.ab.walk)}` : ''}`;
          line += selfLine;
          if (refDir) {
            const ref = path.join(refDir, `${key}.png`);
            if (fs.existsSync(ref)) {
              const d = await diffPng(page, file, ref);
              entry.diff = d;
              const b = d.bbox ? `${d.bbox.x},${d.bbox.y} ${d.bbox.w}x${d.bbox.h}` : '-';
              diffs.push(`diff ${key.padEnd(24)} ${d.pct.toFixed(2).padStart(6)} %  ${String(d.pixels).padStart(8)} px  bbox ${b}`);
              line += ` | diff ${d.pct.toFixed(2)} % (${d.pixels} px)`;
            } else {
              missingRefs.push(key);
              diffs.push(`diff ${key.padEnd(24)} no reference in ${compare}`);
            }
          }
          stats[key] = entry;
          fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
          console.log(line);
        } catch (err) {
          failures.push(key);
          console.log(`[${key}] FAILED: ${(err as Error).message}`);
          // no stale shot or stats of an earlier run of this label may stand in for the failed entry
          fs.rmSync(path.join(outDir, `${key}.png`), { force: true });
          fs.rmSync(path.join(outDir, `_mask_${key}.png`), { force: true });
          if (style === 'modern') {
            for (const d of [e.name, `${e.name}_mid`]) fs.rmSync(path.join(outDir, `_field_${d}.png`), { force: true });
          }
          delete stats[key];
          fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
        }
        if (pageErrors > errorsBefore) errored.push(key);
      }
    }
    if (styles.includes('modern') && styles.includes('retro')) {
      current = 'luminance';
      for (const e of entries) {
        const st = stats[`${e.name}_modern`];
        const files = [`${e.name}_modern.png`, `${e.name}_retro.png`, `_mask_${e.name}_modern.png`, `_mask_${e.name}_retro.png`]
          .map((f) => path.join(outDir, f)) as [string, string, string, string];
        if (!st || !stats[`${e.name}_retro`] || !files.every((f) => fs.existsSync(f))) continue;
        const lum = await actorLum(page, files);
        if (lum) st.actorLum = lum;
        else delete st.actorLum;
        if (lum) lumRows.push({ name: e.name, lum });
      }
      fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
    }
    current = 'sheets';
    await buildSheets(page, outDir);
  } finally {
    await browser.close();
    await server.close();
  }
  if (diffs.length) console.log(`\ncompare ${label} vs ${compare}:\n${diffs.join('\n')}`);
  if (lumRows.length) {
    console.log('\nactor luminance, Modern / Retro (mean sRGB luma over the actor pixels visible in both styles):');
    console.log('| entry | ratio | modern | retro | px |');
    console.log('|---|---|---|---|---|');
    for (const { name, lum } of lumRows) console.log(`| ${name} | ${lum.ratio.toFixed(3)} | ${lum.modern} | ${lum.retro} | ${lum.pixels} |`);
    const r = lumRows.map((x) => x.lum.ratio);
    const min = lumRows.reduce((a, b) => (b.lum.ratio < a.lum.ratio ? b : a));
    console.log(`median ${median(r).toFixed(3)}, min ${min.lum.ratio.toFixed(3)} (${min.name}), max ${Math.max(...r).toFixed(3)}`);
  }
  if (abRows.length) {
    const how = abMethod === 'frame' ? `${abRounds} ABBA quads (per half ${abHalf.settle} settle + ${abHalf.timed} timed frames)`
      : `${abRounds} paired rounds of 60-frame blocks`;
    console.log(`\n--ab${abAa ? ' (A/A: both arms on, the noise floor)' : ''}: ${abFeature.what}, ${how}, medians (ms); OVER = Δgpu > +${abFeature.gpuMs} or Δcpu > +${abFeature.cpuMs}`);
    console.log('| entry | idle gpu on / off | idle Δgpu | idle Δcpu | walk gpu on / off | walk Δgpu | walk Δcpu | walk moved px |');
    console.log('|---|---|---|---|---|---|---|---|');
    console.log(abRows.join('\n'));
  }
  // any of these makes the run unusable as a gate: exit non-zero
  if (pageErrors) console.log(`${pageErrors} page error(s) in: ${errored.join(', ') || 'sheets'}`);
  if (missingRefs.length) console.log(`no reference shot in ${compare} for: ${missingRefs.join(', ')}`);
  if (failures.length) console.log(`failed (shot and stats removed): ${failures.join(', ')}`);
  if (selftestFailures.length) console.log(`self-test failed (no slots, field parity > ${SELFTEST_TOL} px or xbr > ${XBR_TOL.toFixed(4)}) in: ${selftestFailures.join(', ')}`);
  if (pageErrors || missingRefs.length || failures.length || selftestFailures.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
