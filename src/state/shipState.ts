import type { Catalog } from '../catalog/catalog';
import { DEFAULT_MATERIAL_ID, type MaterialId } from '../core/materials';
import { DEFAULT_COLOURS, type ShipColours } from '../core/palette';
import { assembleShip, type AssembledShip, type FittedPart } from '../core/ship';
import { isCompatible, type AttachmentId, type HullDefinition, type HullId, type SlotId } from '../core/types';

/** The complete description of a player's build. Serialisable as-is. */
export interface ShipState {
  readonly hullId: HullId;
  readonly colours: ShipColours;
  /** Finish worn over the paint; see core/materials.ts. */
  readonly material: MaterialId;
  /** Attachment fitted per slot id. A missing key means the slot is empty. */
  readonly fitted: Readonly<Record<SlotId, AttachmentId>>;
}

export function defaultLoadout(hull: HullDefinition): Record<SlotId, AttachmentId> {
  const fitted: Record<SlotId, AttachmentId> = {};
  for (const slot of hull.slots) {
    if (slot.defaultAttachment) fitted[slot.id] = slot.defaultAttachment;
  }
  return fitted;
}

export function createShipState(hull: HullDefinition, colours: ShipColours = DEFAULT_COLOURS, material: MaterialId = DEFAULT_MATERIAL_ID): ShipState {
  return { hullId: hull.id, colours, material, fitted: defaultLoadout(hull) };
}

/** Switch hull, keeping colours and resetting the loadout to the hull's defaults. */
export function withHull(state: ShipState, hull: HullDefinition): ShipState {
  if (state.hullId === hull.id) return state;
  return { ...state, hullId: hull.id, fitted: defaultLoadout(hull) };
}

export function withColours(state: ShipState, colours: Partial<ShipColours>): ShipState {
  return { ...state, colours: { ...state.colours, ...colours } };
}

export function withMaterial(state: ShipState, material: MaterialId): ShipState {
  return state.material === material ? state : { ...state, material };
}

/** Fit an attachment (or `null` to empty the slot). Incompatible fits are ignored. */
export function withAttachment(
  state: ShipState,
  catalog: Catalog,
  slotId: SlotId,
  attachmentId: AttachmentId | null,
): ShipState {
  const hull = catalog.getHull(state.hullId);
  const slot = hull.slots.find((candidate) => candidate.id === slotId);
  if (!slot) return state;

  const fitted = { ...state.fitted };
  if (attachmentId === null) {
    delete fitted[slotId];
  } else {
    const attachment = catalog.findAttachment(attachmentId);
    if (!attachment || !isCompatible(slot, attachment)) return state;
    fitted[slotId] = attachmentId;
  }
  return { ...state, fitted };
}

/** Pick a random compatible attachment for every slot (sometimes leaving optional ones empty). */
export function withRandomLoadout(state: ShipState, catalog: Catalog, random: () => number = Math.random): ShipState {
  const hull = catalog.getHull(state.hullId);
  const fitted: Record<SlotId, AttachmentId> = {};
  for (const slot of hull.slots) {
    const options = catalog.compatibleAttachments(slot);
    if (options.length === 0) continue;
    const hasDefault = slot.defaultAttachment !== undefined;
    const leaveEmpty = !hasDefault && random() < 0.4;
    if (leaveEmpty) continue;
    const pick = options[Math.floor(random() * options.length)];
    if (pick) fitted[slot.id] = pick.id;
  }
  return { ...state, fitted };
}

/** Resolve the fitted ids to definitions, dropping anything that no longer fits. */
export function resolveParts(state: ShipState, catalog: Catalog): FittedPart[] {
  const hull = catalog.getHull(state.hullId);
  const parts: FittedPart[] = [];
  for (const slot of hull.slots) {
    const attachmentId = state.fitted[slot.id];
    if (!attachmentId) continue;
    const attachment = catalog.findAttachment(attachmentId);
    if (attachment && isCompatible(slot, attachment)) parts.push({ slot, attachment });
  }
  return parts;
}

export function assembleFromState(state: ShipState, catalog: Catalog): AssembledShip {
  return assembleShip(catalog.getHull(state.hullId), resolveParts(state, catalog));
}
