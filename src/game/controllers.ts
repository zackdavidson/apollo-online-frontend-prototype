import { IDLE_INPUT, wrapAngle, type FlightInput } from './flightController';
import type { ShipEntity } from './world';

/** The subset of the world a controller may look at. */
export interface ControllerView {
  /** Nearest living ship on another team, if any. */
  nearestEnemy(ship: ShipEntity): ShipEntity | null;
}

/** Decides a ship's input each step. NPCs get one of these; players are driven externally. */
export interface ShipController {
  decide(ship: ShipEntity, world: ControllerView, dt: number, now: number): FlightInput;
}

export interface TurretAiTuning {
  readonly range: number;
  /** Seconds between bursts and how long each burst holds the trigger. */
  readonly interval: number;
  readonly burst: number;
  /** How far off the nose the target may be before firing, radians. */
  readonly aimTolerance: number;
}

export const TURRET_AI: TurretAiTuning = { range: 240, interval: 1.3, burst: 0.35, aimTolerance: 0.35 };

/**
 * A stationary guard: holds position, turns to face the nearest enemy (at
 * whatever turn rate its ship allows) and fires short bursts while the
 * enemy is in range and roughly ahead.
 */
export class TurretAi implements ShipController {
  private cooldown = 1;
  private burstUntil = 0;

  constructor(private readonly tuning: TurretAiTuning = TURRET_AI) {}

  decide(ship: ShipEntity, world: ControllerView, dt: number, now: number): FlightInput {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const target = world.nearestEnemy(ship);
    if (!target) return IDLE_INPUT;
    const dx = target.state.x - ship.state.x;
    const dz = target.state.z - ship.state.z;
    const distance = Math.hypot(dx, dz);
    const linedUp = Math.abs(wrapAngle(Math.atan2(dx, dz) - ship.state.heading)) < this.tuning.aimTolerance;
    let fire = now < this.burstUntil;
    if (!fire && distance <= this.tuning.range && linedUp && this.cooldown === 0) {
      this.burstUntil = now + this.tuning.burst;
      this.cooldown = this.tuning.interval;
      fire = true;
    }
    return { ...IDLE_INPUT, aim: [target.state.x, target.state.z], fire };
  }
}

/** Does nothing; handy for props and tests. */
export class IdleController implements ShipController {
  decide(): FlightInput {
    return IDLE_INPUT;
  }
}
