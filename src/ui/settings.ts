// Settings panel (Esc / O): view, camera, graphics quality, effects, audio, save management.

export interface Settings {
  view: 'auto' | 'classic';
  worldStyle: 'modern' | 'retro';
  quality: 'low' | 'medium' | 'high';
  tiltShift: boolean;
  bloom: boolean;
  volume: number;
  camera: number;
}

const KEY = 'emerald3d.settings';

/** Settings from their saved JSON (null: none saved); defaults for what is missing or unreadable. */
export function parseSettings(raw: string | null): Settings {
  const defaults: Settings = { view: 'auto', worldStyle: 'modern', quality: 'medium', tiltShift: true, bloom: true, volume: 0.8, camera: 0 };
  let s: Settings;
  try {
    s = { ...defaults, ...JSON.parse(raw || '{}') };
  } catch {
    return defaults;
  }
  // an unknown style would turn the kit off yet keep Modern's shadows and blur
  if (s.worldStyle !== 'modern' && s.worldStyle !== 'retro') s.worldStyle = 'modern';
  return s;
}

export function loadSettings(): Settings {
  return parseSettings(localStorage.getItem(KEY));
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export interface SettingsActions {
  apply(s: Settings): void;
  exportSave(): void;
  importSave(file: File): void;
  saveState(): void;
  loadState(): void;
  reset(): void;
}

export class SettingsPanel {
  private el: HTMLDivElement;
  open = false;

  constructor(private settings: Settings, private actions: SettingsActions) {
    this.el = document.createElement('div');
    this.el.id = 'settings';
    this.el.innerHTML = `
      <h3>SETTINGS</h3>
      <label>View
        <select data-k="view"><option value="auto">3D</option><option value="classic">Classic 2D</option></select></label>
      <label>World style
        <select data-k="worldStyle"><option value="modern">Modern 3D</option><option value="retro">Retro 3D (pixel art)</option></select></label>
      <label>Camera
        <select data-k="camera"><option value="0">Classic</option><option value="1">Close</option><option value="2">Wide</option><option value="3">Low</option></select></label>
      <label>Graphics quality
        <select data-k="quality"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High (ambient occlusion)</option></select></label>
      <label class="row"><input type="checkbox" data-k="tiltShift"> Tilt-shift depth of field</label>
      <label class="row"><input type="checkbox" data-k="bloom"> Bloom</label>
      <label>Volume <input type="range" min="0" max="1" step="0.05" data-k="volume"></label>
      <div class="buttons">
        <button data-a="saveState">Quick save state (F5)</button>
        <button data-a="loadState">Quick load state (F9)</button>
        <button data-a="exportSave">Export .sav</button>
        <button data-a="importSave">Import .sav</button>
        <button data-a="reset" class="danger">Reset game</button>
      </div>
      <div class="muted">Quality changes apply after reloading the page. Press Esc to close.</div>`;
    document.body.appendChild(this.el);
    for (const input of this.el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]')) {
      const k = input.dataset.k as keyof Settings;
      const v = this.settings[k];
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = v as boolean;
      else input.value = String(v);
      input.addEventListener('change', () => this.onChange(input));
      input.addEventListener('input', () => this.onChange(input));
    }
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.sav,.srm,.bin';
    picker.onchange = () => { if (picker.files?.[0]) this.actions.importSave(picker.files[0]); };
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-a]')) {
      b.addEventListener('click', () => {
        const a = b.dataset.a!;
        if (a === 'importSave') picker.click();
        else if (a === 'reset') { if (confirm('Reset the game? Unsaved progress will be lost.')) this.actions.reset(); }
        else (this.actions as unknown as Record<string, () => void>)[a]();
      });
    }
  }

  private onChange(input: HTMLInputElement | HTMLSelectElement): void {
    const k = input.dataset.k as keyof Settings;
    const s = this.settings as unknown as Record<string, unknown>;
    if (input instanceof HTMLInputElement && input.type === 'checkbox') s[k] = input.checked;
    else if (k === 'volume' || k === 'camera') s[k] = parseFloat(input.value);
    else s[k] = input.value;
    saveSettings(this.settings);
    this.actions.apply(this.settings);
  }

  /** Refreshes controls after settings changed elsewhere (keyboard shortcuts). */
  sync(): void {
    for (const input of this.el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]')) {
      const v = this.settings[input.dataset.k as keyof Settings];
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = v as boolean;
      else input.value = String(v);
    }
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.el.classList.toggle('visible', this.open);
  }
}
