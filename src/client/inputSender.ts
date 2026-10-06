import type { FlightInput } from '../game/flightController';
import type { ClientMessage } from './messages';

export interface InputSenderOptions {
  /** Shortest gap between packets that differ only in aim, seconds. */
  readonly minInterval?: number;
  /** Longest gap between packets while nothing changes, so the server knows the client is alive and still holding. */
  readonly heartbeat?: number;
  /** Aim movements smaller than this (world units) are not worth a packet. */
  readonly aimTolerance?: number;
}

/**
 * Turns the per-frame flight input into MOVE_FLIGHT packets, rate limited:
 * buttons and thrust go out at once, aim is throttled, and a heartbeat
 * repeats the last input now and then. Each packet carries a sequence
 * number (wrapping at 65535) the server can acknowledge.
 */
export class InputSender {
  private seq = 0;
  private last: FlightInput | null = null;
  private lastSentAt = -Infinity;
  private readonly minInterval: number;
  private readonly heartbeat: number;
  private readonly aimTolerance: number;

  constructor(
    private readonly send: (message: ClientMessage) => void,
    options: InputSenderOptions = {},
  ) {
    this.minInterval = options.minInterval ?? 1 / 30;
    this.heartbeat = options.heartbeat ?? 0.25;
    this.aimTolerance = options.aimTolerance ?? 0.05;
  }

  get sequence(): number {
    return this.seq;
  }

  /** Consider sending this frame's input; `now` is any monotonic clock in seconds. */
  update(input: FlightInput, now: number): boolean {
    const since = now - this.lastSentAt;
    const last = this.last;
    const discrete = !last || last.thrust !== input.thrust || last.strafe !== input.strafe || last.boost !== input.boost || last.fire !== input.fire || (last.aim === null) !== (input.aim === null);
    const aimMoved = !!last?.aim && !!input.aim && Math.hypot(last.aim[0] - input.aim[0], last.aim[1] - input.aim[1]) > this.aimTolerance;
    const due = discrete || (aimMoved && since >= this.minInterval) || since >= this.heartbeat;
    if (!due) return false;
    this.seq = (this.seq + 1) & 0xffff;
    this.last = input;
    this.lastSentAt = now;
    this.send({ type: 'move-flight', seq: this.seq, thrust: input.thrust, strafe: input.strafe, boost: input.boost, fire: input.fire, aim: input.aim });
    return true;
  }

  /** Forget the last input so the next frame sends regardless (after a respawn or reconnect). */
  reset(): void {
    this.last = null;
    this.lastSentAt = -Infinity;
  }
}
