import { circleHit } from '../game/combat';
import type { Beacon } from '../game/beacons';
import type { Hazard } from '../game/hazards';
import type { Pickup } from '../game/loot';
import type { Rock } from '../game/rocks';
import { EntityType } from './definitions';
import type { ClientEntity, ClientWorld } from './world';

/** What is under a world point, for hover, tooltips and the option menu. */
export type ClientPick =
  | { readonly kind: 'entity'; readonly entity: ClientEntity }
  | { readonly kind: 'rock'; readonly rock: Rock }
  | { readonly kind: 'obj'; readonly item: Pickup }
  | { readonly kind: 'beacon'; readonly beacon: Beacon }
  | { readonly kind: 'hazard'; readonly hazard: Hazard }
  | null;

/** How close the cursor must be to a dropped stack to hover it. */
const GROUND_ITEM_HOVER_RADIUS = 1.8;

/** The comet first, then living ships, beacons, dropped stacks, rocks and hazards. */
export function pickAt(world: ClientWorld, x: number, z: number): ClientPick {
  let ship: ClientEntity | null = null;
  for (const entity of world.entities.values()) {
    const appearance = entity.appearance;
    if (!appearance || !entity.alive) continue;
    const generous = appearance.entityType === EntityType.COMET ? 1.2 : 1.15;
    if (!circleHit(x, z, entity.pose.x, entity.pose.z, appearance.radius * generous)) continue;
    if (appearance.entityType === EntityType.COMET) return { kind: 'entity', entity };
    ship ??= entity;
  }
  if (ship) return { kind: 'entity', entity: ship };
  const beacon = world.map?.beacons.find((candidate) => Math.hypot(candidate.x - x, candidate.z - z) <= candidate.radius * 1.3);
  if (beacon) return { kind: 'beacon', beacon };
  let nearest: Pickup | null = null;
  let nearestDistance = GROUND_ITEM_HOVER_RADIUS;
  for (const item of world.groundItems.values()) {
    const distance = Math.hypot(item.x - x, item.z - z);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = item;
    }
  }
  if (nearest) return { kind: 'obj', item: nearest };
  const rock = world.rocks?.hoverAt(x, z);
  if (rock) return { kind: 'rock', rock };
  const hazard = world.map?.hazards.find((candidate) => Math.hypot(candidate.x - x, candidate.z - z) <= candidate.radius);
  return hazard ? { kind: 'hazard', hazard } : null;
}
