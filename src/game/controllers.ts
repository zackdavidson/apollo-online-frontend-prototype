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
  /**
   * Asked every step while the ship is friendly: return true to turn
   * hostile of its own accord (an ambush). Omit for ships that only ever
   * retaliate.
   */
  wantsToAttack?(ship: ShipEntity, world: ControllerView, dt: number, now: number): boolean;
}

export interface TurretAiTuning {
  readonly range: number;
  /** Seconds between bursts and how long each burst holds the trigger. */
  readonly interval: number;
  readonly burst: number;
  /** How far off the nose the target may be before firing, radians. */
  readonly aimTolerance: number;
  /**
   * While friendly: turn hostile once another team's ship has stayed within
   * this distance for `ambushDelay` seconds. Omit to only ever retaliate.
   */
  readonly ambushRange?: number;
  readonly ambushDelay?: number;
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
  /** When the nearest other-team ship first came within ambush range, or null. */
  private closeSince: number | null = null;

  constructor(private readonly tuning: TurretAiTuning = TURRET_AI) {}

  decide(ship: ShipEntity, world: ControllerView, dt: number, now: number): FlightInput {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const target = world.nearestEnemy(ship);
    if (!target) return IDLE_INPUT;
    const dx = target.state.x - ship.state.x;
    const dz = target.state.z - ship.state.z;
    // A friendly turret still tracks you with its nose; it just holds fire.
    if (ship.stance === 'friendly') return { ...IDLE_INPUT, aim: [target.state.x, target.state.z], fire: false };
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

  wantsToAttack(ship: ShipEntity, world: ControllerView, _dt: number, now: number): boolean {
    const range = this.tuning.ambushRange;
    if (range === undefined) return false;
    const target = world.nearestEnemy(ship);
    const close = target !== null && Math.hypot(target.state.x - ship.state.x, target.state.z - ship.state.z) <= range;
    if (!close) {
      this.closeSince = null;
      return false;
    }
    this.closeSince ??= now;
    return now - this.closeSince >= (this.tuning.ambushDelay ?? 1.5);
  }
}

/** Does nothing; handy for props and tests. */
export class IdleController implements ShipController {
  decide(): FlightInput {
    return IDLE_INPUT;
  }
}
