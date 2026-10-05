import {
  isCompatible,
  type AttachmentDefinition,
  type AttachmentId,
  type HullDefinition,
  type HullId,
  type SlotDefinition,
} from '../core/types';
import { ALL_ATTACHMENTS } from './attachments';
import { ALL_HULLS } from './hulls';

/**
 * Read-only index over every hull and attachment. Validates the data once at
 * construction so authoring mistakes surface immediately rather than as a
 * blank spot on a ship.
 */
export class Catalog {
  private readonly hullsById: ReadonlyMap<HullId, HullDefinition>;
  private readonly attachmentsById: ReadonlyMap<AttachmentId, AttachmentDefinition>;

  constructor(
    readonly hulls: readonly HullDefinition[],
    readonly attachments: readonly AttachmentDefinition[],
  ) {
    this.hullsById = indexById(hulls, 'hull');
    this.attachmentsById = indexById(attachments, 'attachment');
    this.validateDefaults();
  }

  getHull(id: HullId): HullDefinition {
    const hull = this.hullsById.get(id);
    if (!hull) throw new Error(`Unknown hull "${id}"`);
    return hull;
  }

  findHull(id: HullId): HullDefinition | undefined {
    return this.hullsById.get(id);
  }

  getAttachment(id: AttachmentId): AttachmentDefinition {
    const attachment = this.attachmentsById.get(id);
    if (!attachment) throw new Error(`Unknown attachment "${id}"`);
    return attachment;
  }

  findAttachment(id: AttachmentId): AttachmentDefinition | undefined {
    return this.attachmentsById.get(id);
  }

  /** Every attachment that can be fitted to the given slot, in catalog order. */
  compatibleAttachments(slot: SlotDefinition): AttachmentDefinition[] {
    return this.attachments.filter((attachment) => isCompatible(slot, attachment));
  }

  private validateDefaults(): void {
    for (const hull of this.hulls) {
      const seen = new Set<string>();
      for (const slot of hull.slots) {
        if (seen.has(slot.id)) {
          throw new Error(`Hull "${hull.id}" has duplicate slot id "${slot.id}"`);
        }
        seen.add(slot.id);
        if (slot.defaultAttachment === undefined) continue;
        const attachment = this.getAttachment(slot.defaultAttachment);
        if (!isCompatible(slot, attachment)) {
          throw new Error(
            `Default "${attachment.id}" does not fit slot "${slot.id}" on hull "${hull.id}"`,
          );
        }
      }
    }
  }
}

function indexById<T extends { readonly id: string }>(
  items: readonly T[],
  kind: string,
): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    if (map.has(item.id)) throw new Error(`Duplicate ${kind} id "${item.id}"`);
    map.set(item.id, item);
  }
  return map;
}

/** The catalog shipped with the prototype. */
export function createDefaultCatalog(): Catalog {
  return new Catalog(ALL_HULLS, ALL_ATTACHMENTS);
}
