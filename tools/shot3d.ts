// Renders the real app in headless Chrome and saves screenshots.
//
//   npx tsx tools/shot3d.ts --state out/littleroot.state --wait 3000 --shots 2 --keys "RIGHT:600"
//   --dpr 2: a HiDPI screen (device pixel ratio; screenshots are width x dpr pixels wide)
//
// Starts a Vite dev server, opens /?state=...&autostart, optionally holds keys, and writes
// out/3d/<name>_<n>.png. Console errors from the page are printed.

import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

const KEYMAP: Record<string, string> = {
  UP: 'ArrowUp', DOWN: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight', A: 'KeyZ', B: 'KeyX',
  START: 'Enter', SELECT: 'ShiftRight', L: 'KeyQ', R: 'KeyE', C: 'KeyC', V: 'KeyV', TAB: 'Tab',
  COMMA: 'Comma', PERIOD: 'Period', MINUS: 'Minus', EQUAL: 'Equal',
};

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main(): Promise<void> {
  const root = path.resolve(import.meta.dirname, '..');
  const state = arg('state', '');
  const wait = parseInt(arg('wait', '2500'), 10);
  const shots = parseInt(arg('shots', '1'), 10);
  const interval = parseInt(arg('interval', '1000'), 10);
  const name = arg('name', 'view');
  const keys = arg('keys', '');
  const width = parseInt(arg('width', '1280'), 10);
  const height = parseInt(arg('height', '800'), 10);
  const dpr = parseFloat(arg('dpr', '1'));
  const extra = arg('query', '');
  const evalExpr = arg('eval', '');
  const batch = arg('batch', ''); // 'name=query;name=query' — one page per entry

  const server = await createServer({ root, server: { port: 5199, strictPort: false }, logLevel: 'error' });
  await server.listen();
  const port = (server.httpServer!.address() as { port: number }).port;
  const exe = CHROME_CANDIDATES.find((p) => fs.existsSync(p))!;
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: true,
    args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width, height, deviceScaleFactor: dpr },
  });
  try {
    const page = await browser.newPage();
    page.on('console', (m) => {
      if (m.location().url?.endsWith('/favicon.ico')) return;   // (the dev server has no favicon: its 404 is noise)
      if (m.type() === 'error' || m.type() === 'warn') console.log(`[page ${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => console.log(`[page error] ${(e as Error).message}`));
    if (batch) {
      const outDir = path.join(root, 'out/3d');
      fs.mkdirSync(outDir, { recursive: true });
      for (const entry of batch.split(';').filter(Boolean)) {
        const cut = entry.indexOf('=');
        const n = entry.slice(0, cut);
        const query = entry.slice(cut + 1);
        await page.goto(`http://localhost:${port}/?autostart=1&${query}`, { waitUntil: 'load' });
        await new Promise((r) => setTimeout(r, wait));
        const file = path.join(outDir, `${n}.png`);
        await page.screenshot({ path: file as `${string}.png` });
        console.log(`shot ${file}`);
      }
      return;
    }
    const q = new URLSearchParams();
    if (state) q.set('state', '/' + state.replace(/\\/g, '/'));
    q.set('autostart', '1');
    const url = `http://localhost:${port}/?${q.toString()}${extra ? '&' + extra : ''}`;
    await page.goto(url, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, wait));
    // keys: "RIGHT:600,A:100" holds each key for the given ms, in sequence
    for (const item of keys.split(',').filter(Boolean)) {
      const [k, ms] = item.split(':');
      const code = KEYMAP[k.toUpperCase()] ?? k;
      if (process.env.DEBUG_KEYS) console.log('key', code, await page.evaluate(() => (window as any).emu?.gba.keys));
      await page.keyboard.down(code as never);
      await new Promise((r) => setTimeout(r, parseInt(ms ?? '100', 10)));
      await page.keyboard.up(code as never);
      await new Promise((r) => setTimeout(r, 50));
    }
    const outDir = path.join(root, 'out/3d');
    fs.mkdirSync(outDir, { recursive: true });
    for (let i = 0; i < shots; i++) {
      const file = path.join(outDir, `${name}_${i}.png`);
      await page.screenshot({ path: file as `${string}.png` });
      console.log(`shot ${file}`);
      if (i + 1 < shots) await new Promise((r) => setTimeout(r, interval));
    }
    const info = await page.evaluate(() => {
      const emu = (window as unknown as { emu?: { renderer: { presented: string; state: { scene: string; mapGroup: number; mapNum: number } } } }).emu;
      const gl = document.createElement('canvas').getContext('webgl2');
      const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
      return {
        presented: emu?.renderer.presented,
        scene: emu?.renderer.state.scene,
        map: emu ? `${emu.renderer.state.mapGroup}.${emu.renderer.state.mapNum}` : '',
        gpu: dbg ? gl!.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
      };
    });
    console.log(JSON.stringify(info));
    if (evalExpr) console.log('eval:', JSON.stringify(await page.evaluate(evalExpr)));
  } finally {
    await browser.close();
    await server.close();
  }
}

void main();
