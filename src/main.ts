// Entry point: loads the ROM, boots the GBA core and drives the frame loop.

import { Gba } from './gba/gba';
import { Input } from './input/input';
import { AudioOutput } from './audio/output';
import { kvGet, kvSet } from './ui/storage';
import { Shell } from './ui/shell';
import { Renderer } from './render/renderer';
import { SettingsPanel, loadSettings, saveSettings, type Settings } from './ui/settings';
import { keyMask } from './input/keyNames';
import { timeGpuFrames, type GpuTiming } from './render/gpuTiming';

const EXPECTED_SHA1 = 'f3ae088181bf583e55daf962a92bb46f4f1d07b7';
const FRAME_MS = 1000 / 59.7275;
const FAST_FORWARD = 4;
/** Emulated RTC in manual mode (local time): the game's clock re-reads replay identically. */
const MANUAL_RTC = '2026-01-01T10:00:00';

/** Setting overrides from the URL (?style=modern|retro, ?camera=0..3): applied, never saved. */
function urlOverrides(params: URLSearchParams, s: Settings): void {
  const style = params.get('style');
  if (style === 'modern' || style === 'retro') s.worldStyle = style;
  const camera = params.get('camera');
  if (camera !== null && /^[0-3]$/.test(camera)) s.camera = Number(camera);
}

async function sha1(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', data as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function loadRom(shell: Shell): Promise<Uint8Array> {
  try {
    const res = await fetch('/rom.gba');
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
  } catch {
    /* fall through to manual selection */
  }
  return shell.askForRom();
}

/**
 * Manual mode: no frame loop; `emu.step(keys, frames)` emulates and renders frame by frame with a
 * fixed 1/60 s timestep (returns each frame's renderer.render CPU ms), `emu.gpuFrames(n)` times n
 * idle frames on the GPU (EXT_disjoint_timer_query_webgl2, medians: render/gpuTiming.ts).
 */
function exposeManual(gba: Gba, renderer: Renderer, emu: Record<string, unknown>): void {
  renderer.setFixedTimestep(1 / 60);
  const gl = renderer.webgl.getContext() as WebGL2RenderingContext;
  const emulate = (mask: number): void => {
    gba.keys = mask;
    gba.runFrame();
    renderer.onEmulatedFrame();
  };
  const render = (): void => renderer.render(1000 / 60);
  const step = (keys: string, frames: number): number[] => {
    const mask = keyMask(keys);
    const times: number[] = [];
    for (let i = 0; i < frames; i++) {
      emulate(mask);
      const t0 = performance.now();
      render();
      times.push(performance.now() - t0);
    }
    return times;
  };
  const gpuFrames = (n: number): Promise<GpuTiming> => timeGpuFrames(gl, n, render, () => emulate(0));
  (window as unknown as { emu: unknown }).emu = { ...emu, step, gpuFrames };
}

function debounce(fn: () => void, ms: number): () => void {
  let t = 0;
  return () => {
    clearTimeout(t);
    t = window.setTimeout(fn, ms);
  };
}

async function boot(): Promise<void> {
  const shell = new Shell();
  shell.setStatus('Loading ROM…');
  const rom = await loadRom(shell);
  // Map preview mode (?map=group.num): static 3D render of any map straight from the ROM.
  const preview = new URLSearchParams(location.search).get('map');
  if (preview) {
    const [g, n] = preview.split('.').map(Number);
    const { PreviewApp } = await import('./render/preview');
    const previewParams = new URLSearchParams(location.search);
    const app = new PreviewApp(document.getElementById('view') as HTMLCanvasElement, rom, g, n, previewParams);
    shell.hideLoader();
    // (no wall-clock toast in manual mode: harness shots stay deterministic)
    if (previewParams.get('manual') !== '1') shell.toast(`Preview: ${app.name}`);
    (window as unknown as { preview: unknown }).preview = app;
    return;
  }
  const hash = await sha1(rom);
  if (hash !== EXPECTED_SHA1) {
    shell.toast('Unrecognised ROM — expected Pokémon Emerald (USA/EUR). Trying anyway…', 5000);
  }

  const audio = new AudioOutput();
  try {
    await audio.init();
  } catch (e) {
    console.warn('Audio unavailable', e);
  }

  // Debug/testing hooks: ?state=<url> loads a save state, ?autostart skips the start gate,
  // ?manual=1 (implies autostart) stops the frame loop: frames advance only through emu.step.
  const params = new URLSearchParams(location.search);
  const manual = params.get('manual') === '1';
  const gba = new Gba(rom, { sampleRate: audio.sampleRate, now: manual ? () => new Date(MANUAL_RTC) : undefined });
  const save = await kvGet<Uint8Array>('flash');
  if (save) gba.loadSave(save);
  const persist = debounce(() => {
    void kvSet('flash', gba.getSave());
    gba.saveDirty = false;
  }, 800);
  gba.flash.onWrite = persist;
  window.addEventListener('beforeunload', () => {
    if (gba.saveDirty) void kvSet('flash', gba.getSave());
  });

  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const input = new Input(canvas);
  const settings = loadSettings();
  urlOverrides(params, settings);
  const renderer = new Renderer(canvas, gba, settings.quality);

  const quickSave = () => {
    void kvSet('state0', gba.saveState()).then(() => shell.toast('State saved'));
  };
  const quickLoad = () => {
    void kvGet<Uint8Array>('state0').then((s) => {
      if (!s) { shell.toast('No saved state yet'); return; }
      gba.loadState(s);
      audio.flush();
      shell.toast('State loaded');
    });
  };
  const applySettings = (s: Settings) => {
    renderer.mode = s.view;
    renderer.overworld.presetIndex = s.camera;
    renderer.setWorldStyle(s.worldStyle);
    renderer.setEffects(s.tiltShift, s.bloom);
    audio.setVolume(s.volume);
  };
  const panel = new SettingsPanel(settings, {
    apply: applySettings,
    saveState: quickSave,
    loadState: quickLoad,
    exportSave: () => {
      const blob = new Blob([gba.getSave() as unknown as BlobPart], { type: 'application/octet-stream' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'Pokemon Emerald.sav';
      a.click();
      URL.revokeObjectURL(a.href);
    },
    importSave: (file) => {
      void file.arrayBuffer().then((b) => {
        const data = new Uint8Array(b);
        gba.loadSave(data);
        void kvSet('flash', gba.getSave());
        gba.reset();
        audio.flush();
        shell.toast('Save imported — game restarted');
      });
    },
    reset: () => {
      gba.reset();
      audio.flush();
      shell.toast('Game reset');
    },
  });
  applySettings(settings);

  input.on('help', () => shell.toggleHelp());
  input.on('settings', () => panel.toggle());
  input.on('cycleCamera', () => {
    renderer.overworld.cyclePreset();
    settings.camera = renderer.overworld.presetIndex;
    saveSettings(settings);
    panel.sync();
    shell.toast(`Camera: ${renderer.overworld.presetName}`);
  });
  input.on('cameraLeft', () => { renderer.cameraInput.yaw -= Math.PI / 8; });
  input.on('cameraRight', () => { renderer.cameraInput.yaw += Math.PI / 8; });
  input.on('zoomIn', () => { renderer.cameraInput.zoom -= 1; });
  input.on('zoomOut', () => { renderer.cameraInput.zoom += 1; });
  input.on('toggleView', () => {
    settings.view = renderer.mode === 'auto' ? 'classic' : 'auto';
    saveSettings(settings);
    applySettings(settings);
    panel.sync();
    shell.toast(renderer.mode === 'auto' ? '3D view' : 'Classic 2D view');
  });
  input.on('quickSave', quickSave);
  input.on('quickLoad', quickLoad);

  const stateUrl = params.get('state');
  if (stateUrl) {
    const res = await fetch(stateUrl);
    if (res.ok) gba.loadState(new Uint8Array(await res.arrayBuffer()));
  }
  if (!params.has('autostart') && !manual) await shell.waitForGesture('Press any key to start');
  audio.resume();
  shell.hideLoader();
  canvas.focus();

  if (manual) {
    exposeManual(gba, renderer, { gba, renderer, input });
    return;
  }

  let acc = 0;
  let last = performance.now();
  const stats = { fps: 0, emuFps: 0, emuMs: 0, renderMs: 0 };
  let statFrames = 0, statEmu = 0, statStart = performance.now(), emuTime = 0, renderTime = 0;
  const tick = (now: number) => {
    const dt = Math.min(250, now - last);
    last = now;
    const fast = input.isHeld('fastForward');
    if (!panel.open) acc += dt * (fast ? FAST_FORWARD : 1);
    let frames = 0;
    while (acc >= FRAME_MS && frames < FAST_FORWARD * 2) {
      gba.keys = input.poll();
      const t0 = performance.now();
      gba.runFrame();
      emuTime += performance.now() - t0;
      statEmu++;
      renderer.onEmulatedFrame();
      acc -= FRAME_MS;
      frames++;
    }
    if (acc > FRAME_MS * 4) acc = 0; // too slow: drop time rather than spiral
    if (fast) {
      // Keep audio responsive during fast-forward: discard the surplus.
      audio.push((out) => gba.apu.drain(out));
      if (audio.queued > audio.sampleRate * 0.1) audio.flush();
    } else {
      audio.push((out) => gba.apu.drain(out));
    }
    renderer.cameraInput.yaw += input.cameraYaw;
    renderer.cameraInput.pitch += input.cameraPitch;
    renderer.cameraInput.zoom += input.cameraZoom;
    input.cameraYaw = input.cameraPitch = input.cameraZoom = 0;
    const r0 = performance.now();
    renderer.render(dt);
    renderTime += performance.now() - r0;
    statFrames++;
    if (now - statStart >= 1000) {
      const secs = (now - statStart) / 1000;
      stats.fps = statFrames / secs;
      stats.emuFps = statEmu / secs;
      stats.emuMs = statEmu ? emuTime / statEmu : 0;
      stats.renderMs = statFrames ? renderTime / statFrames : 0;
      statFrames = statEmu = 0; emuTime = renderTime = 0; statStart = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // Expose for debugging in the console.
  (window as unknown as { emu: unknown }).emu = { gba, renderer, input, stats };
}

void boot();
