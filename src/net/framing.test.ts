import { describe, expect, it } from 'vitest';
import { EncoderError, encodeFrame, FrameDecoder } from './framing';
import { CorruptedFrameError } from './packet';
import { PacketSizes, VAR_BYTE, VAR_SHORT } from './sizes';

const FIXED = 10;
const EMPTY = 20;
const VARB = 30;
const VARS = 40;
const UNKNOWN = 50;
const LAST = 255;

const SIZES = new PacketSizes().define(FIXED, 4).define(EMPTY, 0).define(VARB, VAR_BYTE).define(VARS, VAR_SHORT).define(LAST, 1);

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
const sequence = (length: number): Uint8Array => Uint8Array.from({ length }, (_, i) => i & 0xff);

describe('encodeFrame', () => {
  it('writes the opcode then the payload for fixed sizes, with no length header', () => {
    expect([...encodeFrame(FIXED, bytes(1, 2, 3, 4), SIZES)]).toEqual([FIXED, 1, 2, 3, 4]);
    expect([...encodeFrame(EMPTY, bytes(), SIZES)]).toEqual([EMPTY]);
    expect([...encodeFrame(LAST, bytes(7), SIZES)]).toEqual([0xff, 7]);
  });

  it('rejects a fixed payload of the wrong size and unknown opcodes', () => {
    expect(() => encodeFrame(FIXED, bytes(1, 2, 3), SIZES)).toThrow(/fixed size of 4 bytes but the payload is 3/);
    expect(() => encodeFrame(EMPTY, bytes(1), SIZES)).toThrow(EncoderError);
    expect(() => encodeFrame(UNKNOWN, bytes(1), SIZES)).toThrow(/Unknown opcode 50/);
  });

  it('writes a one-byte length for VAR_BYTE up to 255 bytes', () => {
    expect([...encodeFrame(VARB, bytes(97, 98, 99), SIZES)]).toEqual([VARB, 3, 97, 98, 99]);
    expect([...encodeFrame(VARB, bytes(), SIZES)]).toEqual([VARB, 0]);
    expect([...encodeFrame(VARB, sequence(255), SIZES).slice(0, 2)]).toEqual([VARB, 0xff]);
    expect(() => encodeFrame(VARB, sequence(256), SIZES)).toThrow(/max is 255/);
  });

  it('writes a two-byte big-endian length for VAR_SHORT up to 65535 bytes', () => {
    expect([...encodeFrame(VARS, sequence(256), SIZES).slice(0, 3)]).toEqual([VARS, 0x01, 0x00]);
    expect([...encodeFrame(VARS, sequence(65535), SIZES).slice(0, 3)]).toEqual([VARS, 0xff, 0xff]);
    expect(() => encodeFrame(VARS, sequence(65536), SIZES)).toThrow(/max is 65535/);
  });
});

describe('FrameDecoder', () => {
  it('decodes every packet in one buffer in order', () => {
    const decoder = new FrameDecoder(SIZES);
    const frames = decoder.push(bytes(FIXED, 1, 2, 3, 4, EMPTY, VARB, 2, 120, 121, VARS, 0x00, 0x01, 122));
    expect(frames.map((f) => [f.opcode, [...f.payload]])).toEqual([
      [FIXED, [1, 2, 3, 4]],
      [EMPTY, []],
      [VARB, [120, 121]],
      [VARS, [122]],
    ]);
    expect(decoder.buffered).toBe(0);
  });

  it('waits for whole payloads and length headers across chunks', () => {
    const decoder = new FrameDecoder(SIZES);
    expect(decoder.push(bytes(FIXED, 1, 2))).toEqual([]);
    expect(decoder.push(bytes(3, 4, EMPTY, VARB, 1)).map((f) => f.opcode)).toEqual([FIXED, EMPTY]);
    expect(decoder.buffered).toBe(2);
    const [tail] = decoder.push(bytes(113));
    expect(tail).toEqual({ opcode: VARB, payload: bytes(113) });
    expect(decoder.push(bytes(VARS, 0x00))).toEqual([]);
    expect(decoder.push(bytes(0x01))).toEqual([]);
    expect(decoder.push(bytes(9))).toEqual([{ opcode: VARS, payload: bytes(9) }]);
  });

  it('decodes a packet delivered one byte at a time', () => {
    const decoder = new FrameDecoder(SIZES);
    const wire = bytes(VARS, 0x00, 0x03, 97, 98, 99);
    for (let i = 0; i < wire.length - 1; i++) expect(decoder.push(wire.slice(i, i + 1))).toEqual([]);
    expect(decoder.push(wire.slice(-1))).toEqual([{ opcode: VARS, payload: bytes(97, 98, 99) }]);
  });

  it('reads unsigned lengths and the opcode as an unsigned byte', () => {
    const decoder = new FrameDecoder(SIZES);
    const big = sequence(65535);
    const [frame] = decoder.push(Uint8Array.from([VARS, 0xff, 0xff, ...big]));
    expect(frame!.payload).toEqual(big);
    expect(decoder.push(bytes(0xff, 7))).toEqual([{ opcode: LAST, payload: bytes(7) }]);
  });

  it('drops the rest of the stream on an unknown opcode and decodes fresh data afterwards', () => {
    const decoder = new FrameDecoder(SIZES);
    expect(() => decoder.push(bytes(UNKNOWN, FIXED, 1, 2, 3, 4))).toThrow(CorruptedFrameError);
    expect(decoder.buffered).toBe(0);
    expect(decoder.push(bytes(FIXED, 1, 2, 3, 4))).toEqual([{ opcode: FIXED, payload: bytes(1, 2, 3, 4) }]);
  });
});
