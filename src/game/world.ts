import type { Beacon } from './beacons';
import type { Hazard } from './hazards';
import type { BeamState } from './beam';
import type { Vitals } from './combat';
import type { ShipController } from './controllers';
import type { FlightInput, FlightState, FlightTuning } from './flightController';
import type { Inventory } from './loot';
import type { ProjectilePool, WeaponMount } from './projectiles';
import type { WarpPlan } from './warp';
import type { WeaponGroup } from './weapons';

export type ShipId = string;

/** Ships on the same team never damage each other. */
export type Team = string;

/** Everything needed to put a ship into the simulation. Purely gameplay: no colours or meshes. */
export interface ShipSpec {
  readonly id: ShipId;
  readonly name: string;
  /** Hull class for tooltips, e.g. "Bastion gunship". */
  readonly hullName: string;
  readonly team: Team;
  /** Collision and hit radius in world units. */
  readonly radius: number;
  readonly weaponMounts: readonly WeaponMount[];
  readonly maxShield: number;
  readonly maxHull: number;
  readonly spawn: { readonly x: number; readonly z: number; readonly heading: number };
  /** Seconds until the ship comes back after dying; null removes it from the world instead. */
  readonly respawnDelay: number | null;
  /** Overrides on the default flight model (NPC turrets turn slowly, for instance). */
  readonly tuning?: Partial<FlightTuning>;
  /** Multiplier on damage this ship deals to other ships. */
  readonly damageScale?: number;
  /** Whether resource pickups fly to this ship and go into its cargo. */
  readonly collectsLoot?: boolean;
  /** NPC brain. Omitted means the ship is driven through `WorldSim.setInput`. */
  readonly controller?: ShipController;
}

/** Live record of a ship. Mutated by the simulation only; read by everyone else. */
export interface ShipEntity {
  readonly spec: ShipSpec;
  readonly tuning: FlightTuning;
  state: FlightState;
  vitals: Vitals;
  alive: boolean;
  /** When a dead ship comes back (see `spec.respawnDelay`). */
  respawnAt: number;
  /** Latest input, from `setInput` or the controller. */
  input: FlightInput;
  activeGroup: WeaponGroup;
  readonly pool: ProjectilePool;
  readonly beamMounts: readonly WeaponMount[];
  beam: BeamState;
  /** Increments per beam discharge so renderers can vary arcs. */
  beamSeed: number;
  cargo: Inventory;
  kills: number;
  deaths: number;
  warp: WarpPlan | null;
  warpMoved: boolean;
}

/** What is under a world point, for hover and picking. */
export type Pick =
  | { readonly kind: 'ship'; readonly ship: ShipEntity }
  | { readonly kind: 'rock'; readonly rockId: string }
  | { readonly kind: 'comet' }
  | { readonly kind: 'beacon'; readonly beacon: Beacon }
  | { readonly kind: 'hazard'; readonly hazard: Hazard }
  | null;
