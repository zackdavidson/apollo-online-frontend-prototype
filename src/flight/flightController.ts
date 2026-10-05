/**
 * Arcade flight model on the XZ plane. Pure functions so it is testable and
 * independent of rendering. Heading is a yaw about +Y where 0 points along
 * +Z (the ship's authored nose direction).
 */

export interface FlightTuning {
  /** Forward acceleration, units/s². */
  readonly accel: number;
  readonly reverseAccel: number;
  readonly strafeAccel: number;
  /** Multiplier on forward acceleration and top speed while boosting. */
  readonly boost: number;
  /** Exponential velocity damping per second; sets the natural top speed with accel. */
  readonly drag: number;
  readonly maxSpeed: number;
  /** Max turn rate towards the aim point, radians/s. */
  readonly turnRate: number;
  /** How fast the visible throttle follows input, per second. */
  readonly throttleResponse: number;
  /** Half size of the square map; the ship is kept inside. */
  readonly halfExtent: number;
}

export const DEFAULT_TUNING: FlightTuning = {
  accel: 120,
  reverseAccel: 70,
  strafeAccel: 95,
  boost: 1.6,
  drag: 1.7,
  maxSpeed: 72,
  turnRate: 9,
  throttleResponse: 7,
  halfExtent: 5000,
};

export interface FlightInput {
  /** -1 (reverse) to 1 (forward). */
  readonly thrust: number;
  /** -1 (port) to 1 (starboard). */
  readonly strafe: number;
  readonly boost: boolean;
  /** World XZ point the ship should turn towards, if any. */
  readonly aim: readonly [number, number] | null;
  readonly fire: boolean;
}

export const IDLE_INPUT: FlightInput = { thrust: 0, strafe: 0, boost: false, aim: null, fire: false };

export interface FlightState {
  readonly x: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
  readonly heading: number;
  /** Smoothed engine output for the plume animation: 0 idle, ~1.4 boosting. */
  readonly throttle: number;
}

export const INITIAL_FLIGHT_STATE: FlightState = { x: 0, z: 0, vx: 0, vz: 0, heading: 0, throttle: 0 };

export function forwardVector(heading: number): readonly [number, number] {
  return [Math.sin(heading), Math.cos(heading)];
}

/**
 * The pilot's right-hand (starboard) direction. With Y up and the nose along
 * +Z in a right-handed frame, starboard is -X at heading 0.
 */
export function rightVector(heading: number): readonly [number, number] {
  return [-Math.cos(heading), Math.sin(heading)];
}

export function speedOf(state: FlightState): number {
  return Math.hypot(state.vx, state.vz);
}

/** Wrap an angle difference into [-π, π]. */
export function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function stepFlight(state: FlightState, input: FlightInput, dt: number, tuning: FlightTuning = DEFAULT_TUNING): FlightState {
  // Turn towards the aim point at a capped rate.
  let heading = state.heading;
  if (input.aim) {
    const desired = Math.atan2(input.aim[0] - state.x, input.aim[1] - state.z);
    const diff = wrapAngle(desired - heading);
    const step = Math.sign(diff) * Math.min(Math.abs(diff), tuning.turnRate * dt);
    heading = wrapAngle(heading + step);
  }

  // Accelerate in the ship frame, then damp.
  const thrust = clamp(input.thrust, -1, 1);
  const strafe = clamp(input.strafe, -1, 1);
  const boosting = input.boost && thrust > 0;
  const forwardAccel = thrust > 0 ? thrust * tuning.accel * (boosting ? tuning.boost : 1) : thrust * tuning.reverseAccel;
  const [fx, fz] = forwardVector(heading);
  const [rx, rz] = rightVector(heading);
  let vx = state.vx + (fx * forwardAccel + rx * strafe * tuning.strafeAccel) * dt;
  let vz = state.vz + (fz * forwardAccel + rz * strafe * tuning.strafeAccel) * dt;
  const damping = Math.exp(-tuning.drag * dt);
  vx *= damping;
  vz *= damping;
  const limit = tuning.maxSpeed * (boosting ? tuning.boost : 1);
  const speed = Math.hypot(vx, vz);
  if (speed > limit) {
    vx *= limit / speed;
    vz *= limit / speed;
  }

  // Integrate and keep inside the map.
  let x = state.x + vx * dt;
  let z = state.z + vz * dt;
  if (x > tuning.halfExtent) {
    x = tuning.halfExtent;
    vx = Math.min(0, vx);
  } else if (x < -tuning.halfExtent) {
    x = -tuning.halfExtent;
    vx = Math.max(0, vx);
  }
  if (z > tuning.halfExtent) {
    z = tuning.halfExtent;
    vz = Math.min(0, vz);
  } else if (z < -tuning.halfExtent) {
    z = -tuning.halfExtent;
    vz = Math.max(0, vz);
  }

  // Visible throttle for the plumes.
  const target = thrust > 0 ? (boosting ? 1.45 : 1) : thrust < 0 || strafe !== 0 ? 0.45 : 0.12;
  const throttle = state.throttle + (target - state.throttle) * (1 - Math.exp(-tuning.throttleResponse * dt));

  return { x, z, vx, vz, heading, throttle };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
