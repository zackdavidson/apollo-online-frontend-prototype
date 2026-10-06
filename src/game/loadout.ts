import type { Catalog } from '../catalog/catalog';
import { DEFAULT_MATERIAL_ID, isMaterialId } from '../core/materials';
import { meshBounds, type SurfaceMesh } from '../core/mesh';
import { isHexColour } from '../core/palette';
import { isCompatible, type HullDefinition } from '../core/types';
import { assembleFromState, resolveParts, type ShipState } from '../state/shipState';
import type { WeaponMount } from './projectiles';
import { WEAPON_PROFILES, weaponProfileFor } from './weapons';

/**
 * From a hangar build (`ShipState`, the thing that goes over the wire) to
 * what the simulation and the renderers need. Shared by the server, which
 * turns a login's build into a `ShipSpec`, and the client, which turns a
 * `ship-add` packet into a mesh and muzzle positions. Neither side ever
 * sends a mesh: both resolve the same build against the same catalog.
 */

/** Hull class for tooltips, e.g. "Bastion gunship". */
export function hullDisplayName(hull: HullDefinition): string {
  return `${hull.name} ${hull.role.toLowerCase()}`;
}

/** The weapon muzzles a build carries: every fitted weapon (or anything with a firing profile) at its slot position. */
export function weaponMountsFor(state: ShipState, catalog: Catalog): WeaponMount[] {
  return resolveParts(state, catalog)
    .filter((part) => part.attachment.category === 'weapon' || part.attachment.id in WEAPON_PROFILES)
    .map((part) => ({ position: part.slot.position, weapon: weaponProfileFor(part.attachment.id) }));
}

/** Hit and collision radius for a hull from its mesh. */
export function shipRadiusFor(surface: SurfaceMesh): number {
  const bounds = meshBounds(surface);
  return 0.36 * Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]);
}

/** The assembled surface mesh of a build. */
export function surfaceFor(state: ShipState, catalog: Catalog): SurfaceMesh {
  return assembleFromState(state, catalog).mesh;
}

/**
 * Validate a build that arrived over the wire. Unknown or incompatible
 * attachments are dropped rather than failing the whole build; an unknown
 * hull, bad colours or malformed input yield `null`. A server runs every
 * login through this so a client cannot fit what the catalog forbids.
 */
export function sanitizeBuild(raw: unknown, catalog: Catalog): ShipState | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const build = raw as Record<string, unknown>;
  const hull = typeof build['hullId'] === 'string' ? catalog.findHull(build['hullId']) : undefined;
  if (!hull) return null;
  const colours = build['colours'];
  if (typeof colours !== 'object' || colours === null) return null;
  const { main, trim } = colours as Record<string, unknown>;
  if (!isHexColour(main) || !isHexColour(trim)) return null;
  const fitted: Record<string, string> = {};
  const rawFit = build['fitted'];
  if (typeof rawFit === 'object' && rawFit !== null && !Array.isArray(rawFit)) {
    for (const slot of hull.slots) {
      const attachmentId = (rawFit as Record<string, unknown>)[slot.id];
      if (typeof attachmentId !== 'string') continue;
      const attachment = catalog.findAttachment(attachmentId);
      if (attachment && isCompatible(slot, attachment)) fitted[slot.id] = attachment.id;
    }
  }
  const material = isMaterialId(build['material']) ? build['material'] : DEFAULT_MATERIAL_ID;
  return { hullId: hull.id, colours: { main, trim }, material, fitted };
}
