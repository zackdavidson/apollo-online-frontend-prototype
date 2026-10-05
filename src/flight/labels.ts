import { el } from '../ui/dom';
import type { Vitals } from './combat';

export interface LabelInfo {
  readonly name: string;
  readonly vitals: Vitals;
  readonly accent: string;
}

interface LabelElements {
  readonly root: HTMLElement;
  readonly name: HTMLElement;
  readonly shieldFill: HTMLElement;
  readonly hullFill: HTMLElement;
}

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
    label.root.style.transform = `translate(-50%, -100%) translate(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px)`;
    label.name.textContent = info.name;
    label.shieldFill.style.width = `${(100 * info.vitals.shield) / Math.max(1, info.vitals.maxShield)}%`;
    label.hullFill.style.width = `${(100 * info.vitals.hull) / Math.max(1, info.vitals.maxHull)}%`;
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
    const root = el('div', { className: 'world-label', style: { borderColor: accent } }, [
      name,
      el('div', { className: 'label-bar' }, [shieldFill]),
      el('div', { className: 'label-bar' }, [hullFill]),
    ]);
    this.root.append(root);
    const label = { root, name, shieldFill, hullFill };
    this.labels.set(id, label);
    return label;
  }
}
