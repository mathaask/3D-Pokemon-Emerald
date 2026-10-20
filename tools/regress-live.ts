// Live visual regression: loads save states in manual mode (?manual=1: no frame loop, fixed RTC,
// fixed 1/60 s timestep), steps them frame by frame with scripted keys (emu.step) and screenshots
// each scene in both world styles. Same inputs give the same frames, so runs diff pixel for pixel.
//
//   npm run regress:live -- --label <name> [--styles modern,retro] [--only a,b] [--dpr 1]
//     [--query k=v&…] [--compare <label>] [--gpu] [--selftest] [--static]
//
// Output: out/regress-live/<label>/<entry>_<style>.png, _sheet_<style>.png (4 columns), _crops.png
// (per entry 320×400 centre crops, Modern | Retro: the camera centres on the player) and stats.json
// ({ [entry_style]: { calls, triangles, programs, stepMsMax, gpuMs?, gpuP90?, cpuMs?, diff?, selftest? } }).
// --query is appended to every page URL. --compare diffs every PNG against out/regress-live/<label>/
// (a pixel differs when a channel differs by > 8). --gpu times 60 more frames on the GPU after the
// screenshot (timer queries, medians). stats.json is merged per label, so partial --only runs add
// or replace entries; the sheets are rebuilt from every PNG in the folder.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import puppeteer, { type Page } from 'puppeteer-core';

interface LiveEntry { name: string; state: string; steps: [string, number][]; query?: string; eval?: string }

// Frame counts are tuned so each scene matches its comment (emu.step frames at 1/60 s; a walk
// takes 16 frames per cell). r101: standing still, the youngster stays off-screen left, so the
// player walks 3 cells towards him. transition: the battle flash peaks at 8 frames and is gone by
// 15; at 40 the spiral wipe starts over the zoomed overworld, its actors still visible.
const LIVE: LiveEntry[] = [
  { name: 'r101', state: 'out/r101.state', steps: [['LEFT', 48], ['', 30]] },                // Route 101: player, youngster, boy
  { name: 'r101_grass', state: 'out/r101.state', steps: [['LEFT', 108], ['DOWN', 18], ['', 30]] }, // standing in tall grass
  { name: 'r101_tree', state: 'out/r101.state', steps: [['LEFT', 66], ['DOWN', 42], ['', 30]] },   // against the treeline (fade)
  { name: 'r101_low', state: 'out/r101.state', query: 'camera=3', steps: [['', 30]] },         // Low preset: volume visible
  { name: 'r101_yaw', state: 'out/r101.state', eval: 'emu.renderer.overworld.yaw = 0.9', steps: [['', 30]] },
  { name: 'birch', state: 'out/s27.state', steps: [['', 30]] },                               // Birch, bag, Zigzagoon (a Pokémon)
  { name: 'lr_truck', state: 'out/lr_out.state', steps: [['', 30]] },                         // Littleroot: Mom, truck (gfx 94)
  { name: 'lr_walk', state: 'out/s22.state', steps: [['', 30]] },                             // Littleroot free walk
  { name: 'item_indoor', state: 'out/s16.state', steps: [['', 30]] },                         // indoor item ball (gfx 59)
  { name: 'truck_inside', state: 'out/truck.state', steps: [['', 30]] },                      // moving boxes (gfx 113)
  { name: 'vigoroth', state: 'out/littleroot.state', steps: [['', 30]] },                     // indoor, Vigoroths (Pokémon)
  { name: 'battle', state: 'out/battle1.state', steps: [['', 30]] },                          // gated 0.00 % in Retro only
  { name: 'transition', state: 'out/wild_transition.state', steps: [['', 40]] },             // gated 0.00 % in Retro only
];

/** Static preview scenes (?map=…, actors from ROM templates), run with --static: added in Task 2. */
interface StaticEntry { name: string; q: string }
const STATIC: StaticEntry[] = [];

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const VIEW_W = 1280;
const VIEW_H = 800;
const CROP_W = 320;
const CROP_H = 400;

interface Diff { pct: number; bbox: { x: number; y: number; w: number; h: number } | null; pixels: number }
interface EntryStats {
  calls: number; triangles: number; programs: number; stepMsMax?: number;
  gpuMs?: number; gpuP90?: number; cpuMs?: number;
  diff?: { pct: number; bbox: Diff['bbox'] }; selftest?: unknown;
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
  const gpu = flag('gpu');
  const selftest = flag('selftest');
  const entries = LIVE.filter((e) => !only.length || only.includes(e.name));
  for (const n of only) {
    if (!LIVE.some((e) => e.name === n) && !STATIC.some((e) => e.name === n)) throw new Error(`unknown entry: ${n}`);
  }
  if (flag('static') && !STATIC.length) console.log('--static: no static entries yet');
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
  let failures = 0;
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
        try {
          if (!fs.existsSync(path.join(root, e.state))) throw new Error(`missing save state ${e.state}`);
          const q = ['manual=1', `state=/${e.state}`, `style=${style}`, e.query, extra].filter(Boolean).join('&');
          await page.goto(`http://localhost:${port}/?${q}`, { waitUntil: 'load' });
          await page.waitForFunction('!!(window.emu && window.emu.step)', { timeout: 120_000, polling: 100 });
          if (!gpuName) {
            gpuName = await page.evaluate(`(() => {
              const gl = emu.renderer.webgl.getContext();
              const dbg = gl.getExtension('WEBGL_debug_renderer_info');
              return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
            })()`) as string;
            console.log(`GPU: ${gpuName}`);
          }
          if (e.eval) await page.evaluate(e.eval);
          let stepMsMax = 0;
          for (const [keys, frames] of e.steps) {
            const times = await page.evaluate(`emu.step(${JSON.stringify(keys)}, ${frames})`) as number[];
            for (const t of times) stepMsMax = Math.max(stepMsMax, t);
          }
          // the page chrome's CSS transitions (the loader fading out) run on the wall clock: end them
          await page.evaluate(`document.getAnimations().forEach((a) => { try { a.finish(); } catch { /* infinite */ } })`);
          const file = path.join(outDir, `${key}.png`);
          await page.screenshot({ path: file as `${string}.png` });
          const s = await page.evaluate('emu.renderer.stats()') as { calls: number; triangles: number; programs: number };
          const entry: EntryStats = { ...s, stepMsMax: round(stepMsMax, 2) };
          // (the self-test checks the screenshot's frame; GPU timing then steps 60 more frames)
          if (selftest) {
            const r = await page.evaluate('typeof emu.selfTest === "function" ? emu.selfTest() : null');
            if (r !== null) entry.selftest = r;
            else console.log(`[${key}] --selftest: the page has no emu.selfTest yet`);
          }
          if (gpu) {
            const g = await page.evaluate('emu.gpuFrames(60)') as { gpuMs: number; gpuP90: number; cpuMs: number };
            entry.gpuMs = round(g.gpuMs, 3);
            entry.gpuP90 = round(g.gpuP90, 3);
            entry.cpuMs = round(g.cpuMs, 3);
          }
          let line = `shot ${key.padEnd(24)} calls ${String(s.calls).padStart(4)} tris ${String(s.triangles).padStart(8)} programs ${s.programs} stepMax ${entry.stepMsMax} ms`;
          if (gpu) line += ` | gpu ${entry.gpuMs} p90 ${entry.gpuP90} cpu ${entry.cpuMs} ms`;
          if (refDir) {
            const ref = path.join(refDir, `${key}.png`);
            if (fs.existsSync(ref)) {
              const d = await diffPng(page, file, ref);
              entry.diff = { pct: d.pct, bbox: d.bbox };
              const b = d.bbox ? `${d.bbox.x},${d.bbox.y} ${d.bbox.w}x${d.bbox.h}` : '-';
              diffs.push(`diff ${key.padEnd(24)} ${d.pct.toFixed(2).padStart(6)} %  ${String(d.pixels).padStart(8)} px  bbox ${b}`);
              line += ` | diff ${d.pct.toFixed(2)} % (${d.pixels} px)`;
            } else {
              diffs.push(`diff ${key.padEnd(24)} no reference in ${compare}`);
            }
          }
          stats[key] = entry;
          fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
          console.log(line);
        } catch (err) {
          failures++;
          console.log(`[${key}] FAILED: ${(err as Error).message}`);
        }
      }
    }
    current = 'sheets';
    await buildSheets(page, outDir);
  } finally {
    await browser.close();
    await server.close();
  }
  if (diffs.length) console.log(`\ncompare ${label} vs ${compare}:\n${diffs.join('\n')}`);
  if (pageErrors) console.log(`${pageErrors} page error(s)`);
  if (failures) {
    console.log(`${failures} entr${failures === 1 ? 'y' : 'ies'} failed`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
