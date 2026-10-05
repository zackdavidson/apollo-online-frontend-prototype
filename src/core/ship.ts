import { tessellatePrimitives, type Primitive } from './geometry';
import { SurfaceMeshBuilder, meshBounds, type Bounds, type SurfaceMesh } from './mesh';
import { IDENTITY, compose, fromDirection, translation, type Affine } from './transform';
import { EMPTY_STATS, STAT_KEYS, type AttachmentDefinition, type HullDefinition, type ShipStats, type SlotDefinition } from './types';

/** A slot together with the attachment currently fitted to it. */
export interface FittedPart {
  readonly slot: SlotDefinition;
  readonly attachment: AttachmentDefinition;
}

export interface AssembledShip {
  /** The whole ship as one triangle soup, ready for the renderer. */
  readonly mesh: SurfaceMesh;
  readonly bounds: Bounds;
  readonly stats: ShipStats;
}

/** Transform taking an attachment's local frame onto its slot. */
export function slotTransform(slot: SlotDefinition): Affine {
  return compose(translation(slot.position), fromDirection(slot.facing));
}

/**
 * Combine a hull with its fitted parts into one mesh. Each attachment is
 * rotated to the slot's facing and translated to the slot position.
 */
export function assembleShip(hull: HullDefinition, parts: readonly FittedPart[]): AssembledShip {
  const builder = new SurfaceMeshBuilder();
  tessellatePrimitives(hull.primitives, builder, IDENTITY);
  for (const { slot, attachment } of parts) {
    tessellatePrimitives(attachment.primitives, builder, slotTransform(slot));
  }
  const mesh = builder.build();
  return {
    mesh,
    bounds: meshBounds(mesh),
    stats: sumStats([hull.stats, ...parts.map((part) => part.attachment.stats)]),
  };
}

/** Tessellate a single part on its own, e.g. for bounds checks. */
export function partMesh(primitives: readonly Primitive[], transform: Affine = IDENTITY): SurfaceMesh {
  const builder = new SurfaceMeshBuilder();
  tessellatePrimitives(primitives, builder, transform);
  return builder.build();
}

export function sumStats(partials: readonly Partial<ShipStats>[]): ShipStats {
  const total: Record<keyof ShipStats, number> = { ...EMPTY_STATS };
  for (const partial of partials) {
    for (const key of STAT_KEYS) {
      total[key] += partial[key] ?? 0;
    }
  }
  return total;
}
