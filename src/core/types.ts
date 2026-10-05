import type { Primitive } from './geometry';
import type { Vec3, Direction } from './vector';

export type HullId = string;
export type AttachmentId = string;
export type SlotId = string;

/** What kind of part a slot accepts. Different hulls expose different categories. */
export type AttachmentCategory = 'thruster' | 'weapon' | 'mining' | 'cargo' | 'utility';

export const ATTACHMENT_CATEGORIES: readonly AttachmentCategory[] = [
  'thruster',
  'weapon',
  'mining',
  'cargo',
  'utility',
];

/**
 * Footprint class of a slot / attachment. Small parts are authored to fit in
 * roughly a 1.2-unit square around the mount, large parts in a 2.4-unit one.
 */
export type AttachmentSize = 'small' | 'large';

/** Half extent of each footprint's cross-section, in world units either side of the mount. */
export const FOOTPRINT_HALF_EXTENT: Readonly<Record<AttachmentSize, number>> = { small: 0.6, large: 1.2 };

/** Numeric flavour stats. Summed across hull and fitted attachments. */
export interface ShipStats {
  readonly mass: number;
  readonly thrust: number;
  readonly firepower: number;
  readonly cargo: number;
  readonly mining: number;
}

export const STAT_KEYS: readonly (keyof ShipStats)[] = ['mass', 'thrust', 'firepower', 'cargo', 'mining'];

export const EMPTY_STATS: ShipStats = { mass: 0, thrust: 0, firepower: 0, cargo: 0, mining: 0 };

/** A mounting point on a hull. */
export interface SlotDefinition {
  readonly id: SlotId;
  readonly label: string;
  /** Point on the hull surface where the attachment's base sits. */
  readonly position: Vec3;
  /** Direction the attachment extends away from the hull. */
  readonly facing: Direction;
  readonly accepts: readonly AttachmentCategory[];
  readonly size: AttachmentSize;
  /** Attachment fitted when the hull is first selected; omitted means empty. */
  readonly defaultAttachment?: AttachmentId;
}

export interface HullDefinition {
  readonly id: HullId;
  readonly name: string;
  readonly role: string;
  readonly description: string;
  /** Authored with +Z as the nose, +Y up, origin roughly amidships. */
  readonly primitives: readonly Primitive[];
  readonly slots: readonly SlotDefinition[];
  readonly stats: Partial<ShipStats>;
}

/**
 * A part that can be fitted to a slot. Authored with its base at the origin
 * extending along +Z; the slot's facing rotates it into place.
 */
export interface AttachmentDefinition {
  readonly id: AttachmentId;
  readonly name: string;
  readonly category: AttachmentCategory;
  readonly size: AttachmentSize;
  readonly description: string;
  readonly primitives: readonly Primitive[];
  readonly stats: Partial<ShipStats>;
}

export function isCompatible(slot: SlotDefinition, attachment: AttachmentDefinition): boolean {
  return slot.size === attachment.size && slot.accepts.includes(attachment.category);
}
