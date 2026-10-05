/**
 * Area hazards: regions of the map that hurt any ship inside them. A gas
 * cloud is the first kind. Hazards are static map objects with stable ids,
 * so a server places them from the map and clients draw them from the same
 * data; only enter / leave / damage events ever move over the wire. Pure
 * logic, no three or DOM.
 */
export type HazardKind = 'gas';

export interface Hazard {
  readonly id: string;
  readonly kind: HazardKind;
  readonly x: number;
  readonly z: number;
  /** Where the damage starts. The visual cloud spills a little past this so you see it coming. */
  readonly radius: number;
  readonly label: string;
  readonly colour: string;
  readonly damagePerSecond: number;
}

/** Seconds between damage ticks while inside. The first tick lands the moment you enter. */
export const HAZARD_TICK = 0.5;
/** Ticks never pile up past this in one step, however long the step was. */
const MAX_TICKS_PER_STEP = 20;

export interface HazardTick {
  readonly hazard: Hazard;
  readonly amount: number;
}

export interface HazardUpdate {
  readonly entered: Hazard[];
  readonly left: Hazard[];
  readonly ticks: HazardTick[];
}

/** Which ships are inside which hazards, and when each next hurts. */
export class HazardTracker {
  /** ship id -> hazard id -> time of the next damage tick. */
  private readonly inside = new Map<string, Map<string, number>>();

  constructor(readonly hazards: readonly Hazard[]) {}

  /**
   * Advance one ship. `active` false (dead, warping, removed) counts as being
   * outside everything, so leaving fires and a later re-entry fires again.
   */
  update(shipId: string, x: number, z: number, now: number, active = true): HazardUpdate {
    const entered: Hazard[] = [];
    const left: Hazard[] = [];
    const ticks: HazardTick[] = [];
    let state = this.inside.get(shipId);
    for (const hazard of this.hazards) {
      const within = active && Math.hypot(hazard.x - x, hazard.z - z) <= hazard.radius;
      const nextTick = state?.get(hazard.id);
      if (within) {
        let due = nextTick;
        if (due === undefined) {
          entered.push(hazard);
          due = now;
          if (!state) {
            state = new Map();
            this.inside.set(shipId, state);
          }
        }
        let fired = 0;
        while (now >= due && fired < MAX_TICKS_PER_STEP) {
          ticks.push({ hazard, amount: hazard.damagePerSecond * HAZARD_TICK });
          due += HAZARD_TICK;
          fired++;
        }
        state!.set(hazard.id, due);
      } else if (nextTick !== undefined) {
        state!.delete(hazard.id);
        left.push(hazard);
      }
    }
    if (state && state.size === 0) this.inside.delete(shipId);
    return { entered, left, ticks };
  }

  /** Hazards a ship is inside right now, in map order. */
  insideFor(shipId: string): Hazard[] {
    const state = this.inside.get(shipId);
    return state ? this.hazards.filter((hazard) => state.has(hazard.id)) : [];
  }

  /** The hazard under a point, for hover. */
  at(x: number, z: number): Hazard | null {
    return this.hazards.find((hazard) => Math.hypot(hazard.x - x, hazard.z - z) <= hazard.radius) ?? null;
  }
}
