// Live visual regression: loads save states in manual mode (?manual=1: no frame loop, fixed RTC,
// fixed 1/60 s timestep), steps them frame by frame with scripted keys (emu.step) and screenshots
// each scene in both world styles. Same inputs give the same frames, so runs diff pixel for pixel.
//
//   npm run regress:live -- --label <name> [--styles modern,retro] [--only a,b] [--dpr 1]
//     [--query k=v&…] [--compare <label>] [--gpu] [--selftest] [--static]
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
// rounding grows with the field's height).
// --ab (live entries, Modern) measures what the inflated actors cost over the same build with inflation off
// (every character a card, the pre-Task-5 path): after the steps it snapshots the emulator, then
// --ab-rounds rounds (default 6) of on/off pairs in alternating order, each block restoring the snapshot
// (both modes emulate the same frames), 5 settle frames and gpuFrames(60). Two variants: idle, and
// walking (the entry's `walk` key held through the block; `moved` = the player's px displacement over the
// timed frames, 0 where a cutscene holds the player). Reported per entry: medians of on, off and of the
// per-round paired deltas (on − off), GPU and CPU ms, into stats (`ab`) and a table flagging deltas over
// +1.0 ms GPU / +0.5 ms CPU (the Phase 2 budgets; reported, not gated).
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
// cutscenes that hold the player (their NPCs move), truck_inside has 2-3 free cells.
const LIVE: LiveEntry[] = [
  { name: 'r101', state: 'out/r101.state', steps: [['LEFT', 48], ['', 30]], walk: 'LEFT' },  // Route 101: player, youngster, boy
  { name: 'r101_grass', state: 'out/r101.state', steps: [['LEFT', 108], ['DOWN', 18], ['', 30]], selftest: true, selftestAfter: 1, walk: 'UP' }, // standing in tall grass
  { name: 'r101_tree', state: 'out/r101.state', steps: [['LEFT', 66], ['DOWN', 42], ['', 30]], walk: 'LEFT' }, // against the treeline (fade)
  { name: 'r101_low', state: 'out/r101.state', query: 'camera=3', steps: [['', 30]], walk: 'LEFT' }, // Low preset: volume visible
  { name: 'r101_yaw', state: 'out/r101.state', eval: 'emu.renderer.overworld.yaw = 0.9', steps: [['', 30]], walk: 'LEFT' },
  { name: 'birch', state: 'out/s27.state', steps: [['', 30]], selftest: true, walk: 'LEFT' }, // Birch, bag, Zigzagoon (a Pokémon)
  { name: 'lr_truck', state: 'out/lr_out.state', steps: [['', 30]], selftest: true, walk: 'LEFT' }, // Littleroot: Mom, truck (gfx 94)
  { name: 'lr_walk', state: 'out/s22.state', steps: [['', 30]], walk: 'LEFT' },              // Littleroot free walk
  { name: 'item_indoor', state: 'out/s16.state', steps: [['', 30]], walk: 'RIGHT' },         // indoor item ball (gfx 59)
  { name: 'truck_inside', state: 'out/truck.state', steps: [['', 30]], walk: 'RIGHT' },      // moving boxes (gfx 113)
  { name: 'vigoroth', state: 'out/littleroot.state', steps: [['', 30]], walk: 'LEFT' },      // indoor, Vigoroths (Pokémon)
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
  { name: 'woods_shade', q: 'map=24.11&focusObj=3&hour=17.5' }, // Petalburg Woods: a Bug Catcher in tree shade (shadows on actors)
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
const FIELD_GPU_MS = 0.3;
/** --ab budgets over inflation off (Phase 2: GPU frame +1.0 ms, renderer CPU +0.5 ms): flagged in the table. */
const AB_GPU_MS = 1.0;
const AB_CPU_MS = 0.5;

interface SelfTest { slots: number; maxErr: number; fixtureMaxErr: number; gpuMs: number }
interface Diff { pct: number; bbox: { x: number; y: number; w: number; h: number } | null; pixels: number }
/** One --ab variant: medians of on, off and of the per-round paired deltas (ms); `moved` px (walking). */
interface AbVariant { gpuOn: number; gpuOff: number; dGpu: number; cpuOn: number; cpuOff: number; dCpu: number; moved?: number }
interface EntryStats {
  calls: number; triangles: number; programs: number; stepMsMax?: number; buildMs?: number;
  gpuMs?: number; gpuP90?: number; cpuMs?: number;
  diff?: Diff; selftest?: SelfTest; selftestMid?: SelfTest;
  ab?: { rounds: number; idle: AbVariant; walk?: AbVariant };
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
 * compared and both parity errors are finite and within SELFTEST_TOL (NaN arrives as null).
 */
async function selfTestPoint(page: Page, api: string, outDir: string, dump: string): Promise<{ result: SelfTest; ok: boolean; text: string }> {
  const result = await page.evaluate(`${api}.selfTest()`) as SelfTest;
  const png = await page.evaluate(`${api}.fieldDump()`) as string;
  fs.writeFileSync(path.join(outDir, `_field_${dump}.png`), Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
  const within = (v: number) => Number.isFinite(v) && v <= SELFTEST_TOL;
  const ok = result.slots > 0 && within(result.maxErr) && within(result.fixtureMaxErr);
  let text = `selftest ${result.slots} slots maxErr ${result.maxErr} fixture ${result.fixtureMaxErr} gpu ${round(result.gpuMs, 3)} ms`;
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
 * One --ab variant: `rounds` on/off pairs (order alternating per round), each block restoring the
 * snapshot `window.__abSnap`, settling 5 frames and timing gpuFrames(60) with `keys` held.
 */
async function abVariant(page: Page, rounds: number, keys: string): Promise<AbVariant> {
  type T = { gpuMs: number; cpuMs: number };
  const on: T[] = [], off: T[] = [];
  let moved = 0;
  const k = JSON.stringify(keys);
  for (let r = 0; r < rounds; r++) {
    for (const mode of r % 2 === 0 ? [true, false] : [false, true]) {
      await page.evaluate(`emu.renderer.overworld.setActorInflation(${mode}); emu.gba.loadState(window.__abSnap)`);
      await page.evaluate(`emu.gpuFrames(5, ${k})`);
      const p0 = await page.evaluate(PLAYER_POS) as number[] | null;
      const g = await page.evaluate(`emu.gpuFrames(60, ${k})`) as T;
      const p1 = await page.evaluate(PLAYER_POS) as number[] | null;
      if (p0 && p1) moved = Math.max(moved, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]));
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

/** --ab on a live entry after its steps: idle and (with `walk`) walking variants; leaves the entry as found. */
async function abMeasure(page: Page, e: LiveEntry, rounds: number): Promise<NonNullable<EntryStats['ab']>> {
  await page.evaluate('window.__abSnap = emu.gba.saveState()');
  try {
    const idle = await abVariant(page, rounds, '');
    const walk = e.walk ? await abVariant(page, rounds, e.walk) : undefined;
    return { rounds, idle, walk };
  } finally {
    await page.evaluate('emu.renderer.overworld.setActorInflation(true); emu.gba.loadState(window.__abSnap)');
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
  const abRounds = parseInt(arg('ab-rounds', '6'), 10);
  if (ab && !(abRounds >= 1)) throw new Error('--ab-rounds must be a positive integer');
  const abRows: string[] = [];
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
          if (ab && e.kind === 'live' && style === 'modern') {
            const r = entry.ab = await abMeasure(page, e, abRounds);
            const over = (v?: AbVariant) => (v && (v.dGpu > AB_GPU_MS || v.dCpu > AB_CPU_MS) ? ' OVER' : '');
            const cell = (v?: AbVariant) => (v ? `${v.dGpu >= 0 ? '+' : ''}${v.dGpu.toFixed(2)} | ${v.dCpu >= 0 ? '+' : ''}${v.dCpu.toFixed(3)}${over(v)}` : '- | -');
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
          if (style === 'modern') {
            for (const d of [e.name, `${e.name}_mid`]) fs.rmSync(path.join(outDir, `_field_${d}.png`), { force: true });
          }
          delete stats[key];
          fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
        }
        if (pageErrors > errorsBefore) errored.push(key);
      }
    }
    current = 'sheets';
    await buildSheets(page, outDir);
  } finally {
    await browser.close();
    await server.close();
  }
  if (diffs.length) console.log(`\ncompare ${label} vs ${compare}:\n${diffs.join('\n')}`);
  if (abRows.length) {
    console.log(`\n--ab: inflation on vs off, ${abRounds} paired rounds, medians (ms); OVER = Δgpu > +${AB_GPU_MS} or Δcpu > +${AB_CPU_MS}`);
    console.log('| entry | idle gpu on / off | idle Δgpu | idle Δcpu | walk gpu on / off | walk Δgpu | walk Δcpu | walk moved px |');
    console.log('|---|---|---|---|---|---|---|---|');
    console.log(abRows.join('\n'));
  }
  // any of these makes the run unusable as a gate: exit non-zero
  if (pageErrors) console.log(`${pageErrors} page error(s) in: ${errored.join(', ') || 'sheets'}`);
  if (missingRefs.length) console.log(`no reference shot in ${compare} for: ${missingRefs.join(', ')}`);
  if (failures.length) console.log(`failed (shot and stats removed): ${failures.join(', ')}`);
  if (selftestFailures.length) console.log(`self-test failed (no slots, or parity > ${SELFTEST_TOL} px) in: ${selftestFailures.join(', ')}`);
  if (pageErrors || missingRefs.length || failures.length || selftestFailures.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
