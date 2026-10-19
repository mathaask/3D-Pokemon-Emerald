// HTML chrome around the game: loader, help overlay, toasts.

export class Shell {
  private loader = document.getElementById('loader') as HTMLDivElement;
  private status = document.getElementById('loader-status') as HTMLDivElement;
  private help = document.getElementById('help') as HTMLDivElement;
  private toastEl = document.getElementById('toast') as HTMLDivElement;
  private toastTimer = 0;

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  hideLoader(): void {
    this.loader.classList.add('hidden');
  }

  toggleHelp(force?: boolean): void {
    this.help.classList.toggle('visible', force);
  }

  toast(text: string, ms = 1800): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('visible'), ms);
  }

  /** Waits for the user to drop (or pick) a .gba file. */
  askForRom(): Promise<Uint8Array> {
    this.setStatus('Drop your Pokémon Emerald ROM here (or click to choose a file)');
    this.loader.classList.add('drop');
    return new Promise((resolve) => {
      const pick = document.createElement('input');
      pick.type = 'file';
      pick.accept = '.gba';
      const read = (f: File) => f.arrayBuffer().then((b) => {
        this.loader.classList.remove('drop');
        resolve(new Uint8Array(b));
      });
      pick.onchange = () => { if (pick.files?.[0]) void read(pick.files[0]); };
      this.loader.onclick = () => pick.click();
      this.loader.ondragover = (e) => e.preventDefault();
      this.loader.ondrop = (e) => {
        e.preventDefault();
        const f = e.dataTransfer?.files[0];
        if (f) void read(f);
      };
    });
  }

  /** Resolves on the first user gesture (needed to start audio). */
  waitForGesture(text: string): Promise<void> {
    this.setStatus(text);
    this.loader.classList.add('ready');
    return new Promise((resolve) => {
      const go = () => {
        window.removeEventListener('keydown', go);
        this.loader.removeEventListener('pointerdown', go);
        resolve();
      };
      window.addEventListener('keydown', go);
      this.loader.addEventListener('pointerdown', go);
    });
  }
}
