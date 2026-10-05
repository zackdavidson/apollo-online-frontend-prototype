import type { WeaponProfile } from './weapons';

/**
 * Charge-and-discharge beam weapon. Hold the trigger to charge; at full
 * charge every beam mount discharges a short hitscan beam, then the weapon
 * cools down. Releasing early bleeds the charge away. Pure logic.
 */

export interface BeamShot {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
  readonly timeLeft: number;
  readonly duration: number;
  /** Visual style, width and colour; the renderer falls back to a plain lance. */
  readonly style?: 'lance' | 'siege' | 'arc';
  readonly width?: number;
  readonly colour?: string;
  readonly y?: number;
}

export interface BeamState {
  /** 0 (idle) to 1 (ready to discharge). */
  readonly charge: number;
  readonly cooldown: number;
  readonly shots: readonly BeamShot[];
}

export const INITIAL_BEAM_STATE: BeamState = { charge: 0, cooldown: 0, shots: [] };

const CHARGE_BLEED_PER_SECOND = 2.5;

export interface BeamStep {
  readonly state: BeamState;
  /** True on the frame the beam discharges. */
  readonly fire: boolean;
}

export function stepBeam(state: BeamState, dt: number, holding: boolean, profile: WeaponProfile): BeamStep {
  const shots = state.shots.map((shot) => ({ ...shot, timeLeft: shot.timeLeft - dt })).filter((shot) => shot.timeLeft > 0);
  const chargeTime = profile.chargeTime ?? 0.7;
  let cooldown = Math.max(0, state.cooldown - dt);
  let charge = state.charge;
  let fire = false;
  if (cooldown > 0) {
    charge = 0;
  } else if (holding) {
    charge = Math.min(1, charge + dt / chargeTime);
    if (charge >= 1) {
      fire = true;
      charge = 0;
      cooldown = profile.fireInterval;
    }
  } else {
    charge = Math.max(0, charge - dt * CHARGE_BLEED_PER_SECOND);
  }
  return { state: { charge, cooldown, shots }, fire };
}

export function addBeamShots(state: BeamState, shots: readonly BeamShot[]): BeamState {
  return { ...state, shots: [...state.shots, ...shots] };
}

export type BeamPhase = 'ready' | 'charging' | 'cooldown';

/** Fill level and phase for the HUD. */
export function beamReadout(state: BeamState, profile: WeaponProfile): { fill: number; phase: BeamPhase } {
  if (state.cooldown > 0) return { fill: 1 - state.cooldown / profile.fireInterval, phase: 'cooldown' };
  if (state.charge > 0) return { fill: state.charge, phase: 'charging' };
  return { fill: 1, phase: 'ready' };
}

/**
 * Distance along a ray (origin o, unit direction d) to the first point on a
 * circle, or null when the ray misses or the circle is behind the origin.
 */
export function rayCircle(ox: number, oz: number, dx: number, dz: number, cx: number, cz: number, radius: number): number | null {
  const fx = ox - cx;
  const fz = oz - cz;
  const b = fx * dx + fz * dz;
  const c = fx * fx + fz * fz - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const near = -b - root;
  if (near >= 0) return near;
  const far = -b + root;
  return far >= 0 ? 0 : null;
}
