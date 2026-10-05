/**
 * Minimap warp, hyperspace style: a short spool-up, the view blanks out into
 * a tunnel for a distance-scaled time while the ship is already moved to
 * its destination, then the view fades back in. Pure functions; the view
 * samples the plan each frame.
 */

export interface WarpTuning {
  readonly chargeTime: number;
  /** Seconds for the view to blank out after the spool-up. */
  readonly fadeIn: number;
  /** Seconds for the destination to fade back in. */
  readonly fadeOut: number;
  readonly minTravel: number;
  readonly maxTravel: number;
  /** Tunnel time is roughly distance / this, plus a small constant. */
  readonly unitsPerSecond: number;
  readonly baseTravel: number;
  /** Clicks closer than this to the ship are ignored. */
  readonly minDistance: number;
}

export const WARP_TUNING: WarpTuning = {
  chargeTime: 0.45,
  fadeIn: 0.3,
  fadeOut: 0.55,
  minTravel: 0.8,
  maxTravel: 4.5,
  unitsPerSecond: 2200,
  baseTravel: 0.4,
  minDistance: 5,
};

export interface WarpPlan {
  readonly fromX: number;
  readonly fromZ: number;
  readonly toX: number;
  readonly toZ: number;
  readonly distance: number;
  readonly heading: number;
  readonly startAt: number;
  readonly chargeUntil: number;
  /** View fully blanked; the ship is moved to its destination here. */
  readonly blankAt: number;
  /** Tunnel ends; the destination starts fading in. */
  readonly arriveAt: number;
  readonly doneAt: number;
}

export type WarpPhase = 'charging' | 'entering' | 'tunnel' | 'exiting' | 'done';

export interface WarpSample {
  readonly phase: WarpPhase;
  /** 0..1 opacity of the blank-out overlay. */
  readonly overlay: number;
  /** 0..1 speed of the tunnel streaks. */
  readonly intensity: number;
  /** 0..1 through the spool-up. */
  readonly chargeProgress: number;
  /** 0..1 through the tunnel. */
  readonly progress: number;
  /** Whether the ship should already sit at its destination. */
  readonly atDestination: boolean;
}

export function warpDuration(distance: number, tuning: WarpTuning = WARP_TUNING): number {
  return Math.min(tuning.maxTravel, Math.max(tuning.minTravel, tuning.baseTravel + distance / tuning.unitsPerSecond));
}

export function planWarp(fromX: number, fromZ: number, toX: number, toZ: number, now: number, tuning: WarpTuning = WARP_TUNING): WarpPlan | null {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const distance = Math.hypot(dx, dz);
  if (distance < tuning.minDistance) return null;
  const chargeUntil = now + tuning.chargeTime;
  const blankAt = chargeUntil + tuning.fadeIn;
  const arriveAt = blankAt + warpDuration(distance, tuning);
  return { fromX, fromZ, toX, toZ, distance, heading: Math.atan2(dx, dz), startAt: now, chargeUntil, blankAt, arriveAt, doneAt: arriveAt + tuning.fadeOut };
}

/** Smooth acceleration and deceleration. */
export function easeInOutCubic(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

/** Derivative of easeInOutCubic; peaks at 3 in the middle. */
export function easeInOutCubicRate(p: number): number {
  return p < 0.5 ? 12 * p * p : 12 * (1 - p) * (1 - p);
}

export function sampleWarp(plan: WarpPlan, now: number): WarpSample {
  if (now < plan.chargeUntil) {
    const chargeProgress = (now - plan.startAt) / (plan.chargeUntil - plan.startAt);
    return { phase: 'charging', overlay: 0, intensity: 0, chargeProgress, progress: 0, atDestination: false };
  }
  if (now < plan.blankAt) {
    const t = (now - plan.chargeUntil) / (plan.blankAt - plan.chargeUntil);
    return { phase: 'entering', overlay: easeInOutCubic(t), intensity: 0.25 * t, chargeProgress: 1, progress: 0, atDestination: false };
  }
  if (now < plan.arriveAt) {
    const p = (now - plan.blankAt) / (plan.arriveAt - plan.blankAt);
    return { phase: 'tunnel', overlay: 1, intensity: 0.3 + 0.7 * Math.min(1, easeInOutCubicRate(Math.min(p, 0.5)) / 3 + 0.4), chargeProgress: 1, progress: p, atDestination: true };
  }
  if (now < plan.doneAt) {
    const t = (now - plan.arriveAt) / (plan.doneAt - plan.arriveAt);
    return { phase: 'exiting', overlay: 1 - easeInOutCubic(t), intensity: 0.3 * (1 - t), chargeProgress: 1, progress: 1, atDestination: true };
  }
  return { phase: 'done', overlay: 0, intensity: 0, chargeProgress: 1, progress: 1, atDestination: true };
}
