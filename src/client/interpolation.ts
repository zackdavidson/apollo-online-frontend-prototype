import { wrapAngle, type FlightState } from '../game/flightController';

/**
 * Remote ships arrive as timestamped snapshots a few times a second; the
 * renderer wants a pose every frame. This buffers the snapshots and
 * samples between them at a render time a little behind the server's
 * clock, extrapolating briefly along the last velocity when a snapshot is
 * late. With no delay (an in-process or very fast server) it simply
 * returns the latest pose.
 */
export interface PoseSample {
  readonly t: number;
  readonly pose: FlightState;
}

/** How far past the latest snapshot a pose is projected before it just holds still. */
const MAX_EXTRAPOLATION = 0.25;
const MAX_SAMPLES = 32;

export class PoseBuffer {
  private samples: PoseSample[] = [];

  get latest(): FlightState | null {
    return this.samples[this.samples.length - 1]?.pose ?? null;
  }

  get size(): number {
    return this.samples.length;
  }

  push(t: number, pose: FlightState): void {
    // Snapshots can arrive out of order; keep the buffer sorted and drop stale ones.
    let index = this.samples.length;
    while (index > 0 && this.samples[index - 1]!.t > t) index--;
    if (index > 0 && this.samples[index - 1]!.t === t) this.samples[index - 1] = { t, pose };
    else this.samples.splice(index, 0, { t, pose });
    if (this.samples.length > MAX_SAMPLES) this.samples.splice(0, this.samples.length - MAX_SAMPLES);
  }

  /** Forget everything (a teleport, a respawn) so the next sample is not interpolated from the old place. */
  reset(): void {
    this.samples = [];
  }

  /** The pose at `t`, or null with nothing buffered. */
  sample(t: number): FlightState | null {
    const samples = this.samples;
    if (samples.length === 0) return null;
    const last = samples[samples.length - 1]!;
    if (t >= last.t) {
      const ahead = Math.min(MAX_EXTRAPOLATION, t - last.t);
      if (ahead <= 0) return last.pose;
      return { ...last.pose, x: last.pose.x + last.pose.vx * ahead, z: last.pose.z + last.pose.vz * ahead };
    }
    const first = samples[0]!;
    if (t <= first.t) return first.pose;
    let hi = 1;
    while (samples[hi]!.t < t) hi++;
    const a = samples[hi - 1]!;
    const b = samples[hi]!;
    const span = b.t - a.t;
    const f = span > 0 ? (t - a.t) / span : 1;
    return lerpPose(a.pose, b.pose, f);
  }

  /** Drop samples older than `t` minus a margin, keeping one before it for interpolation. */
  trim(t: number, keep = 1): void {
    let drop = 0;
    while (drop + keep < this.samples.length && this.samples[drop + 1]!.t <= t) drop++;
    if (drop > 0) this.samples.splice(0, drop);
  }
}

export function lerpPose(a: FlightState, b: FlightState, f: number): FlightState {
  return {
    x: a.x + (b.x - a.x) * f,
    z: a.z + (b.z - a.z) * f,
    vx: a.vx + (b.vx - a.vx) * f,
    vz: a.vz + (b.vz - a.vz) * f,
    heading: wrapAngle(a.heading + wrapAngle(b.heading - a.heading) * f),
    throttle: a.throttle + (b.throttle - a.throttle) * f,
  };
}
