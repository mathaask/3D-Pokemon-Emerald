// Keyboard + gamepad input mapped to GBA keys, plus shell actions (camera, fast-forward…).

import { KEY } from '../gba/constants';

export type Action =
  | 'fastForward' | 'toggleView' | 'cycleCamera' | 'help' | 'quickSave' | 'quickLoad' | 'settings'
  | 'cameraLeft' | 'cameraRight' | 'zoomIn' | 'zoomOut' | 'screenshot';

const KEYBOARD: Record<string, number> = {
  ArrowUp: KEY.UP, ArrowDown: KEY.DOWN, ArrowLeft: KEY.LEFT, ArrowRight: KEY.RIGHT,
  KeyW: KEY.UP, KeyS: KEY.DOWN, KeyA: KEY.LEFT, KeyD: KEY.RIGHT,
  KeyZ: KEY.A, KeyK: KEY.A, Space: KEY.A,
  KeyX: KEY.B, KeyJ: KEY.B, Backspace: KEY.B,
  Enter: KEY.START, ShiftRight: KEY.SELECT, ShiftLeft: KEY.SELECT,
  KeyQ: KEY.L, KeyE: KEY.R,
};

const ACTIONS: Record<string, Action> = {
  Tab: 'fastForward', KeyV: 'toggleView', KeyC: 'cycleCamera', F1: 'help', KeyH: 'help',
  F5: 'quickSave', F9: 'quickLoad', Escape: 'settings', KeyO: 'settings',
  Comma: 'cameraLeft', Period: 'cameraRight', Equal: 'zoomIn', Minus: 'zoomOut',
  NumpadAdd: 'zoomIn', NumpadSubtract: 'zoomOut', F12: 'screenshot',
};

// Standard gamepad mapping (https://w3c.github.io/gamepad/#remapping).
const PAD_BUTTONS: [number, number][] = [
  [0, KEY.A], [1, KEY.B], [2, KEY.B], [3, KEY.A], [4, KEY.L], [5, KEY.R],
  [8, KEY.SELECT], [9, KEY.START], [12, KEY.UP], [13, KEY.DOWN], [14, KEY.LEFT], [15, KEY.RIGHT],
];

export class Input {
  private held = 0;
  private heldActions = new Set<Action>();
  private listeners = new Map<Action, (() => void)[]>();
  /** Right-stick / mouse-driven camera deltas, consumed by the renderer. */
  cameraYaw = 0;
  cameraPitch = 0;
  cameraZoom = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  enabled = true;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => { this.held = 0; this.heldActions.clear(); });
    target.addEventListener('pointerdown', (e) => {
      if (e.button === 0 || e.button === 2) {
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        target.setPointerCapture(e.pointerId);
      }
    });
    target.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.cameraYaw += (e.clientX - this.lastX) * 0.005;
      this.cameraPitch += (e.clientY - this.lastY) * 0.004;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    target.addEventListener('pointerup', () => { this.dragging = false; });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener('wheel', (e) => { this.cameraZoom += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  }

  on(action: Action, fn: () => void): void {
    const list = this.listeners.get(action) ?? [];
    list.push(fn);
    this.listeners.set(action, list);
  }

  private padFastForward = false;

  isHeld(action: Action): boolean {
    if (action === 'fastForward' && this.padFastForward) return true;
    return this.heldActions.has(action);
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (!this.enabled) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;
    const bit = KEYBOARD[e.code];
    const action = ACTIONS[e.code];
    if (bit !== undefined || action !== undefined) e.preventDefault();
    if (bit !== undefined) {
      if (down) this.held |= bit;
      else this.held &= ~bit;
    }
    if (action) {
      if (down && !e.repeat) {
        this.heldActions.add(action);
        for (const fn of this.listeners.get(action) ?? []) fn();
      } else if (!down) {
        this.heldActions.delete(action);
      }
    }
  }

  /** Polls gamepads and returns the combined GBA key mask (1 = pressed). */
  poll(): number {
    let mask = this.held;
    let padFast = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      for (const [b, bit] of PAD_BUTTONS) if (pad.buttons[b]?.pressed) mask |= bit;
      const [ax, ay, rx, ry] = pad.axes;
      if (ax < -0.5) mask |= KEY.LEFT;
      if (ax > 0.5) mask |= KEY.RIGHT;
      if (ay < -0.5) mask |= KEY.UP;
      if (ay > 0.5) mask |= KEY.DOWN;
      if (Math.abs(rx ?? 0) > 0.2) this.cameraYaw += (rx ?? 0) * 0.04;
      if (Math.abs(ry ?? 0) > 0.2) this.cameraPitch += (ry ?? 0) * 0.03;
      padFast ||= !!(pad.buttons[6]?.pressed || (pad.buttons[7]?.value ?? 0) > 0.5);
    }
    this.padFastForward = padFast;
    // Opposite directions cancel (the game misbehaves with both held).
    if ((mask & (KEY.LEFT | KEY.RIGHT)) === (KEY.LEFT | KEY.RIGHT)) mask &= ~(KEY.LEFT | KEY.RIGHT);
    if ((mask & (KEY.UP | KEY.DOWN)) === (KEY.UP | KEY.DOWN)) mask &= ~(KEY.UP | KEY.DOWN);
    return mask;
  }
}
