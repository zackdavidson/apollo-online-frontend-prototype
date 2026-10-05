import type { BeamShot } from './beam';
import type { Beacon } from './beacons';
import type { HitKind } from './damageRoll';
import type { ResourceKind } from './loot';
import type { Rock } from './rocks';
import type { ShipId } from './world';
import type { WeaponProfile } from './weapons';

/**
 * Everything the simulation wants the outside world to react to. The scene
 * turns these into effects, the HUD into messages and markers, and a server
 * would broadcast them to clients. Positions are world XZ.
 */
export type GameEvent =
  | { readonly type: 'shot-fired'; readonly shipId: ShipId; readonly x: number; readonly z: number; readonly weapon: WeaponProfile }
  | { readonly type: 'projectile-expired'; readonly x: number; readonly z: number; readonly weapon: WeaponProfile }
  | { readonly type: 'beam-fired'; readonly shipId: ShipId; readonly weapon: WeaponProfile; readonly shots: readonly BeamShot[] }
  | {
      readonly type: 'hit';
      readonly attackerId: ShipId;
      readonly target: { readonly kind: 'ship'; readonly shipId: ShipId } | { readonly kind: 'rock'; readonly rockId: string } | { readonly kind: 'comet' };
      readonly x: number;
      readonly z: number;
      readonly amount: number;
      readonly kind: HitKind;
      /** Ship hits only: whether the shield soaked the whole hit. */
      readonly absorbed: boolean;
    }
  | { readonly type: 'ship-damaged'; readonly shipId: ShipId; readonly x: number; readonly z: number; readonly shieldAbsorbed: number; readonly hullDamage: number }
  | { readonly type: 'ship-collided'; readonly shipId: ShipId; readonly x: number; readonly z: number; readonly damage: number }
  | { readonly type: 'ship-destroyed'; readonly shipId: ShipId; readonly x: number; readonly z: number; readonly byShipId: ShipId | null }
  | { readonly type: 'ship-respawned'; readonly shipId: ShipId; readonly x: number; readonly z: number }
  | { readonly type: 'ship-removed'; readonly shipId: ShipId }
  | { readonly type: 'rock-damaged'; readonly rock: Rock; readonly x: number; readonly z: number }
  | { readonly type: 'rock-destroyed'; readonly rock: Rock; readonly drops: Partial<Record<ResourceKind, number>> }
  | { readonly type: 'rock-respawned'; readonly rock: Rock }
  | { readonly type: 'comet-damaged'; readonly x: number; readonly z: number }
  | { readonly type: 'comet-chunk'; readonly x: number; readonly z: number; readonly count: number }
  | { readonly type: 'comet-destroyed'; readonly x: number; readonly z: number; readonly radius: number }
  | { readonly type: 'comet-entered' }
  | { readonly type: 'comet-left' }
  | { readonly type: 'pickup-collected'; readonly shipId: ShipId; readonly kind: ResourceKind; readonly count: number }
  | { readonly type: 'warp-started'; readonly shipId: ShipId; readonly x: number; readonly z: number; readonly chargeUntil: number }
  | { readonly type: 'warp-blanked'; readonly shipId: ShipId; readonly x: number; readonly z: number }
  | { readonly type: 'warp-arrived'; readonly shipId: ShipId; readonly x: number; readonly z: number }
  | { readonly type: 'warp-done'; readonly shipId: ShipId }
  | { readonly type: 'beacon-reached'; readonly shipId: ShipId; readonly beacon: Beacon };
