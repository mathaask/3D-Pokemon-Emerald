// Visual regression: renders a fixed set of maps through the static preview at day and night,
// writes one PNG per view, a contact sheet per hour, and render stats.
//
//   npx tsx tools/regress.ts --label before [--style retro] [--only littleroot,oldale] [--hours 11,21]
//
// Output: out/regress/<label>/<name>_h<hour>.png, _sheet_h<hour>.png, stats.json

import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import puppeteer, { type Page } from 'puppeteer-core';

const MAPS: { name: string; map: string; extra?: string }[] = [
  { name: 'littleroot', map: '0.9' },
  { name: 'oldale', map: '0.10' },
  { name: 'petalburg', map: '0.0' },
  { name: 'rustboro', map: '0.3' },
  { name: 'woods', map: '24.11' },
  { name: 'slateport', map: '0.1' },
  { name: 'mauville', map: '0.2' },
  { name: 'route113', map: '0.28' },
  { name: 'fortree', map: '0.4' },
  { name: 'lilycove', map: '0.5' },
  { name: 'route119', map: '0.34' },
  { name: 'sootopolis', map: '0.7' },
  { name: 'mossdeep', map: '0.6' },
  { name: 'route110', map: '0.25' },
  { name: 'house', map: '1.0' },
  { name: 'granite', map: '24.7', extra: 'flash=2' },
];

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

/** Composes thumbnails into one image (4 per row) so a whole run can be reviewed at once. */
async function contactSheet(page: Page, dir: string, names: string[], out: string): Promise<void> {
  const cells = names.map((n) => {
    const b64 = fs.readFileSync(path.join(dir, `${n}.png`)).toString('base64');
    return `<figure><img src="data:image/png;base64,${b64}"><figcaption>${n}</figcaption></figure>`;
  }).join('');
  await page.setViewport({ width: 1600, height: 800 });
  await page.setContent(`<style>body{margin:0;background:#222;display:grid;grid-template-columns:repeat(4,400px)}
    figure{margin:0;position:relative}img{width:400px;height:250px;display:block}
    figcaption{position:absolute;left:4px;top:2px;color:#ff0;font:bold 14px sans-serif;text-shadow:0 0 3px #000}</style>${cells}`);
  await page.screenshot({ path: out as `${string}.png`, fullPage: true });
  await page.setViewport({ width: 1280, height: 800 });
  console.log(`sheet ${out}`);
}

async function main(): Promise<void> {
  const root = path.resolve(import.meta.dirname, '..');
  const label = arg('label', 'current');
  const style = arg('style', '');
  const hours = arg('hours', '11,21').split(',').map(Number);
  const only = arg('only', '');
  const wait = parseInt(arg('wait', '3500'), 10);
  const maps = MAPS.filter((m) => !only || only.split(',').includes(m.name));
  const outDir = path.join(root, 'out/regress', label);
  fs.mkdirSync(outDir, { recursive: true });

  const server = await createServer({ root, server: { port: 5198, strictPort: false }, logLevel: 'error' });
  await server.listen();
  const port = (server.httpServer!.address() as { port: number }).port;
  const browser = await puppeteer.launch({
    executablePath: CHROME.find((p) => fs.existsSync(p))!,
    headless: true,
    args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'],
    defaultViewport: { width: 1280, height: 800 },
  });
  const stats: Record<string, unknown> = {};
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log(`[page error] ${(e as Error).message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warn') console.log(`[page ${m.type()}] ${m.text()}`);
    });
    for (const hour of hours) {
      for (const m of maps) {
        const q = `autostart=1&map=${m.map}&hour=${hour}${style ? `&style=${style}` : ''}${m.extra ? `&${m.extra}` : ''}`;
        await page.goto(`http://localhost:${port}/?${q}`, { waitUntil: 'load' });
        await new Promise((r) => setTimeout(r, wait));
        const key = `${m.name}_h${hour}`;
        await page.screenshot({ path: path.join(outDir, `${key}.png`) as `${string}.png` });
        stats[key] = await page.evaluate(() =>
          (window as unknown as { preview?: { stats(): unknown } }).preview?.stats() ?? null);
        console.log(`shot ${key} ${JSON.stringify(stats[key])}`);
      }
      await contactSheet(page, outDir, maps.map((m) => `${m.name}_h${hour}`), path.join(outDir, `_sheet_h${hour}.png`));
    }
    fs.writeFileSync(path.join(outDir, 'stats.json'), JSON.stringify(stats, null, 2));
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
