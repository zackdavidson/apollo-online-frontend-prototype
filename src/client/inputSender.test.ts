import { describe, expect, it, vi } from 'vitest';
import { IDLE_INPUT } from '../game/flightController';
import { InputSender } from './inputSender';

describe('InputSender', () => {
  it('sends the first input, then only on change, throttling aim and repeating on a heartbeat', () => {
    const send = vi.fn();
    const sender = new InputSender(send, { minInterval: 0.1, heartbeat: 1 });
    expect(sender.update(IDLE_INPUT, 0)).toBe(true);
    expect(sender.update(IDLE_INPUT, 0.01)).toBe(false);
    expect(sender.update({ ...IDLE_INPUT, fire: true }, 0.02)).toBe(true);
    expect(sender.update({ ...IDLE_INPUT, fire: true, aim: [0, 0] }, 0.03)).toBe(true);
    expect(sender.update({ ...IDLE_INPUT, fire: true, aim: [5, 0] }, 0.05)).toBe(false);
    expect(sender.update({ ...IDLE_INPUT, fire: true, aim: [5, 0] }, 0.2)).toBe(true);
    expect(sender.update({ ...IDLE_INPUT, fire: true, aim: [5.01, 0] }, 0.5)).toBe(false);
    expect(sender.update({ ...IDLE_INPUT, fire: true, aim: [5.01, 0] }, 1.3)).toBe(true);
    expect(send).toHaveBeenCalledTimes(5);
    expect(send.mock.calls.map(([m]) => m.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(send.mock.calls[3]![0]).toMatchObject({ type: 'move-flight', aim: [5, 0], fire: true });
  });

  it('sends again right away after a reset', () => {
    const send = vi.fn();
    const sender = new InputSender(send);
    sender.update(IDLE_INPUT, 0);
    sender.reset();
    expect(sender.update(IDLE_INPUT, 0.001)).toBe(true);
  });
});
