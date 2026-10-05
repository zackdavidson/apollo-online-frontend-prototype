import {
  BoxGeometry,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  type Raycaster,
} from 'three';
import { FOOTPRINT_HALF_EXTENT, type AttachmentCategory, type SlotDefinition, type SlotId } from '../core/types';
import { rotateToDirection, type Vec3 } from '../core/vector';

const MARKER_DEPTH = 0.8;

const CATEGORY_COLOURS: Readonly<Record<AttachmentCategory, number>> = {
  thruster: 0xff9a3c,
  weapon: 0xff5c5c,
  mining: 0xd9c24a,
  cargo: 0x6fd08c,
  utility: 0x7cb6ff,
};


interface Marker {
  readonly slot: SlotDefinition;
  readonly fill: Mesh<BoxGeometry, MeshBasicMaterial>;
  readonly edges: LineSegments<EdgesGeometry, LineBasicMaterial>;
  empty: boolean;
}

/**
 * Translucent boxes showing where attachments mount. Empty slots are drawn
 * filled so they stand out; occupied slots keep only a faint outline so the
 * player can still find and click them.
 */
export class SlotMarkers extends Group {
  private markers = new Map<SlotId, Marker>();
  private highlighted: SlotId | null = null;

  setSlots(slots: readonly SlotDefinition[], emptySlotIds: ReadonlySet<SlotId>): void {
    this.clearMarkers();
    for (const slot of slots) {
      const marker = this.createMarker(slot, emptySlotIds.has(slot.id));
      this.markers.set(slot.id, marker);
      this.add(marker.fill, marker.edges);
    }
    this.applyStyles();
  }

  setHighlight(slotId: SlotId | null): void {
    if (this.highlighted === slotId) return;
    this.highlighted = slotId;
    this.applyStyles();
  }

  /** The slot under the ray, nearest first, or `null`. */
  pick(raycaster: Raycaster): SlotId | null {
    const fills = [...this.markers.values()].map((marker) => marker.fill);
    const hit = raycaster.intersectObjects(fills, false)[0];
    if (!hit) return null;
    const slotId = hit.object.userData['slotId'];
    return typeof slotId === 'string' ? slotId : null;
  }

  override dispose(): void {
    this.clearMarkers();
  }

  private createMarker(slot: SlotDefinition, empty: boolean): Marker {
    // A slab covering the footprint cross-section, starting at the mount and reaching outward.
    const half = FOOTPRINT_HALF_EXTENT[slot.size];
    const a = rotateToDirection([-half, -half, -0.1], slot.facing);
    const b = rotateToDirection([half, half, MARKER_DEPTH], slot.facing);
    const size: Vec3 = [Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])];
    const centre: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

    const geometry = new BoxGeometry(size[0], size[1], size[2]);
    const colour = new Color(CATEGORY_COLOURS[slot.accepts[0] ?? 'utility']);
    const fill = new Mesh(
      geometry,
      new MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    const edges = new LineSegments(
      new EdgesGeometry(geometry),
      new LineBasicMaterial({ color: colour, transparent: true, opacity: 0.8 }),
    );
    for (const object of [fill, edges]) {
      object.position.set(slot.position[0] + centre[0], slot.position[1] + centre[1], slot.position[2] + centre[2]);
      object.userData['slotId'] = slot.id;
    }
    return { slot, fill, edges, empty };
  }

  private applyStyles(): void {
    for (const [slotId, marker] of this.markers) {
      const highlighted = slotId === this.highlighted;
      marker.fill.material.opacity = highlighted ? 0.55 : marker.empty ? 0.22 : 0.0;
      marker.edges.material.opacity = highlighted ? 1 : marker.empty ? 0.85 : 0.18;
      marker.fill.renderOrder = highlighted ? 2 : 1;
    }
  }

  private clearMarkers(): void {
    for (const marker of this.markers.values()) {
      this.remove(marker.fill, marker.edges);
      marker.fill.geometry.dispose();
      marker.fill.material.dispose();
      marker.edges.geometry.dispose();
      marker.edges.material.dispose();
    }
    this.markers.clear();
  }
}
