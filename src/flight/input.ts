import type { FlightInput } from './flightController';

export interface InputCallbacks {
  onExit(): void;
  onToggleCamera(): void;
  /** Wheel zoom; factor > 1 moves the camera away. */
  onZoom(factor: number): void;
  /** Number keys 1-3 pick a weapon group (0-based index). */
  onSelectGroup(index: number): void;
  /** P cycles the pixelation level, O toggles its scope. */
  onCyclePixelation(): void;
  onTogglePixelScope(): void;
}

export interface InputSnapshot {
  readonly flight: FlightInput;
  /** -1..1 tilt request from Q/E, applied per frame by the view. */
  readonly cameraTilt: number;
  /** Pointer position in CSS pixels within the surface, for tooltips. */
  readonly pointerPx: { readonly x: number; readonly y: number } | null;
}

export type AimResolver = (ndcX: number, ndcY: number) => readonly [number, number] | null;

/**
 * Tracks keyboard and pointer state for flight. WASD / arrows move, the
 * pointer aims, the left button fires the selected weapon group, 1-3 pick
 * the group, Shift boosts, wheel zooms, Q/E tilt the camera, C toggles
 * projection and Escape leaves.
 */
export class FlightInputTracker {
  private readonly keys = new Set<string>();
  private pointer: readonly [number, number] | null = null;
  private pointerPx: { x: number; y: number } | null = null;
  private firing = false;

  constructor(
    private readonly surface: HTMLElement,
    private readonly callbacks: InputCallbacks,
  ) {}

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.surface.addEventListener('pointermove', this.onPointerMove);
    this.surface.addEventListener('pointerdown', this.onPointerDown);
    this.surface.addEventListener('pointerup', this.onPointerUp);
    this.surface.addEventListener('pointerleave', this.onPointerLeave);
    this.surface.addEventListener('wheel', this.onWheel, { passive: false });
    this.surface.addEventListener('contextmenu', this.onContextMenu);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.surface.removeEventListener('pointermove', this.onPointerMove);
    this.surface.removeEventListener('pointerdown', this.onPointerDown);
    this.surface.removeEventListener('pointerup', this.onPointerUp);
    this.surface.removeEventListener('pointerleave', this.onPointerLeave);
    this.surface.removeEventListener('wheel', this.onWheel);
    this.surface.removeEventListener('contextmenu', this.onContextMenu);
  }

  snapshot(resolveAim: AimResolver): InputSnapshot {
    const down = (...codes: string[]): boolean => codes.some((code) => this.keys.has(code));
    const thrust = (down('KeyW', 'ArrowUp') ? 1 : 0) - (down('KeyS', 'ArrowDown') ? 1 : 0);
    const strafe = (down('KeyD', 'ArrowRight') ? 1 : 0) - (down('KeyA', 'ArrowLeft') ? 1 : 0);
    return {
      flight: {
        thrust,
        strafe,
        boost: down('ShiftLeft', 'ShiftRight'),
        aim: this.pointer ? resolveAim(this.pointer[0], this.pointer[1]) : null,
        fire: this.firing,
      },
      cameraTilt: (down('KeyE') ? 1 : 0) - (down('KeyQ') ? 1 : 0),
      pointerPx: this.pointerPx,
    };
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (event.code === 'Escape') {
      this.callbacks.onExit();
      return;
    }
    if (event.code === 'KeyC') {
      this.callbacks.onToggleCamera();
      return;
    }
    if (event.code === 'KeyP') {
      this.callbacks.onCyclePixelation();
      return;
    }
    if (event.code === 'KeyO') {
      this.callbacks.onTogglePixelScope();
      return;
    }
    const digit = /^(?:Digit|Numpad)([1-3])$/.exec(event.code);
    if (digit) {
      this.callbacks.onSelectGroup(Number(digit[1]) - 1);
      return;
    }
    this.keys.add(event.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.firing = false;
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const rect = this.surface.getBoundingClientRect();
    this.pointer = [((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1];
    this.pointerPx = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button === 0) this.firing = true;
    this.onPointerMove(event);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.button === 0) this.firing = false;
  };

  private readonly onPointerLeave = (): void => {
    this.firing = false;
    this.pointerPx = null;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.callbacks.onZoom(event.deltaY > 0 ? 1.12 : 1 / 1.12);
  };

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };
}
