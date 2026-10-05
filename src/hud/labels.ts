import { el } from '../ui/dom';
import type { Vitals } from '../game/combat';

export interface LabelInfo {
  readonly name: string;
  readonly vitals: Vitals;
  readonly accent: string;
  /** False hides the shield and hull bars (ships that cannot be hurt). */
  readonly showBars?: boolean;
  /** The player's own tag: just the name, no frame or bars, hung below the given point instead of above it. */
  readonly own?: boolean;
}

interface LabelElements {
  readonly root: HTMLElement;
  readonly name: HTMLElement;
  readonly shieldFill: HTMLElement;
  readonly hullFill: HTMLElement;
  readonly say: HTMLElement;
  sayUntil: number;
}

/** Seconds an overhead chat line stays above a ship. */
const SAY_SECONDS = 5;

/**
 * Nametags with shield and hull bars that float above ships. DOM elements
 * positioned from projected world coordinates, so they stay crisp at any
 * zoom and cost nothing on the GPU.
 */
export class WorldLabels {
  private readonly labels = new Map<string, LabelElements>();

  constructor(private readonly root: HTMLElement) {}

  /** Place a label at a screen position (pixels), or hide it when `screen` is null. */
  update(id: string, screen: { readonly x: number; readonly y: number } | null, info: LabelInfo): void {
    const label = this.labels.get(id) ?? this.create(id, info.accent);
    if (!screen) {
      label.root.style.display = 'none';
      return;
    }
    label.root.style.display = '';
    label.root.style.transform = `translate(-50%, ${info.own ? '0' : '-100%'}) translate(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px)`;
    label.name.textContent = info.name;
    label.root.classList.toggle('label-plain', info.showBars === false || info.own === true);
    label.root.classList.toggle('label-own', info.own === true);
    if (label.sayUntil > 0 && performance.now() / 1000 > label.sayUntil) {
      label.sayUntil = 0;
      label.say.style.display = 'none';
    }
    label.shieldFill.style.width = `${(100 * info.vitals.shield) / Math.max(1, info.vitals.maxShield)}%`;
    label.hullFill.style.width = `${(100 * info.vitals.hull) / Math.max(1, info.vitals.maxHull)}%`;
  }

  /** Show a line of overhead text above a ship for a few seconds, old-school chat style. */
  say(id: string, text: string, accent: string): void {
    const label = this.labels.get(id) ?? this.create(id, accent);
    label.say.textContent = text;
    label.say.style.display = '';
    label.sayUntil = performance.now() / 1000 + SAY_SECONDS;
  }

  remove(id: string): void {
    this.labels.get(id)?.root.remove();
    this.labels.delete(id);
  }

  dispose(): void {
    for (const id of [...this.labels.keys()]) this.remove(id);
  }

  private create(id: string, accent: string): LabelElements {
    const name = el('div', { className: 'label-name' });
    const shieldFill = el('div', { className: 'label-fill label-fill-shield' });
    const hullFill = el('div', { className: 'label-fill label-fill-hull' });
    const say = el('div', { className: 'label-say' });
    say.style.display = 'none';
    const root = el('div', { className: 'world-label', style: { borderColor: accent } }, [
      say,
      name,
      el('div', { className: 'label-bar' }, [shieldFill]),
      el('div', { className: 'label-bar' }, [hullFill]),
    ]);
    this.root.append(root);
    const label = { root, name, shieldFill, hullFill, say, sayUntil: 0 };
    this.labels.set(id, label);
    return label;
  }
}
