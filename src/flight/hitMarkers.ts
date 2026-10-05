import { Vector3, type Camera } from 'three';
import { el } from '../ui/dom';
import type { HitKind } from './damageRoll';
import { layoutMarkers, type LayoutItem } from './markerLayout';

/** What took the hit, which sets the colour. */
export type HitStyle = 'hull' | 'shield' | 'rock' | 'incoming';

interface Marker {
  readonly root: HTMLElement;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly life: number;
  readonly drift: number;
  readonly width: number;
  readonly height: number;
  age: number;
  /** Screen offset chosen by the overlap layout last frame. */
  offset: readonly [number, number];
  /** Base screen position this frame, before layout; null when off screen. */
  screen: { x: number; y: number } | null;
}

const MAX_MARKERS = 48;
const LAYOUT_GAP = 3;
const projected = new Vector3();

/** Brief enlargement when a marker appears. */
function popScale(age: number): number {
  return age < 0.12 ? 1.35 - (age / 0.12) * 0.35 : 1;
}

/**
 * Floating damage numbers with an X hit mark, as DOM elements over the
 * canvas. They are re-projected from their world position every frame so
 * they stay put while the camera moves, rise and fade out, and being DOM they
 * are never pixelated. A layout pass keeps them from ever overlapping each
 * other: older markers hold their place and newer ones are pushed into the
 * nearest free slot.
 */
export class HitMarkers {
  private readonly markers: Marker[] = [];

  constructor(private readonly root: HTMLElement) {}

  spawn(x: number, y: number, z: number, label: string, style: HitStyle, kind: HitKind): void {
    if (this.markers.length >= MAX_MARKERS) {
      const oldest = this.markers.shift();
      oldest?.root.remove();
    }
    const element = el('div', { className: `hit-marker hit-${style} hit-${kind}` }, [
      el('span', { className: 'hit-x' }),
      el('span', { className: 'hit-amount', text: kind === 'critical' ? `${label}!` : label }),
      kind === 'critical' ? el('span', { className: 'hit-tag', text: 'crit' }) : null,
    ]);
    this.root.append(element);
    // Measure once; the layout works in whole-element boxes.
    const width = element.offsetWidth || 40;
    const height = element.offsetHeight || 18;
    this.markers.push({
      root: element,
      x,
      y,
      z,
      life: kind === 'critical' ? 1.1 : 0.8,
      drift: (Math.random() - 0.5) * 18,
      width,
      height,
      age: 0,
      offset: [0, 0],
      screen: null,
    });
  }

  update(dt: number, camera: Camera, width: number, height: number): void {
    // Age, expire and project.
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const marker = this.markers[i]!;
      marker.age += dt;
      if (marker.age >= marker.life) {
        marker.root.remove();
        this.markers.splice(i, 1);
        continue;
      }
      projected.set(marker.x, marker.y, marker.z).project(camera);
      if (projected.z > 1) {
        marker.screen = null;
        continue;
      }
      const t = marker.age / marker.life;
      marker.screen = { x: ((projected.x + 1) / 2) * width + marker.drift * t, y: ((1 - projected.y) / 2) * height - 46 * t };
    }

    // Resolve overlaps among the visible markers, oldest first (array order is spawn order).
    // Boxes include the spawn pop scale so freshly popped markers cannot clip neighbours.
    const visible = this.markers.filter((marker) => marker.screen !== null);
    const items: LayoutItem[] = visible.map((marker) => {
      const pop = popScale(marker.age);
      return { x: marker.screen!.x, y: marker.screen!.y, width: marker.width * pop, height: marker.height * pop, previousOffset: marker.offset };
    });
    const offsets = layoutMarkers(items, LAYOUT_GAP);

    for (const marker of this.markers) {
      if (!marker.screen) {
        marker.root.style.display = 'none';
        continue;
      }
      const offset = offsets[visible.indexOf(marker)] ?? [0, 0];
      marker.offset = offset;
      const t = marker.age / marker.life;
      const pop = popScale(marker.age);
      const opacity = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
      marker.root.style.display = '';
      marker.root.style.transform = `translate(-50%, -50%) translate(${(marker.screen.x + offset[0]).toFixed(1)}px, ${(marker.screen.y + offset[1]).toFixed(1)}px) scale(${pop.toFixed(3)})`;
      marker.root.style.opacity = opacity.toFixed(3);
    }
  }

  dispose(): void {
    for (const marker of this.markers) marker.root.remove();
    this.markers.length = 0;
  }
}
