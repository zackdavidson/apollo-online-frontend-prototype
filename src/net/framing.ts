import { CorruptedFrameError } from './packet';
import { PacketSizes, UNDEFINED, VAR_BYTE, VAR_SHORT } from './sizes';

/**
 * The byte stream between frames: an opcode byte, then for variable-size
 * opcodes a one-byte (VAR_BYTE) or big-endian two-byte (VAR_SHORT) payload
 * length, then the payload. Fixed-size opcodes carry no length. This is the
 * server's `PacketEncoder` / `PacketDecoder` pair, so a frame produced here
 * is exactly what Netty expects and vice versa.
 */
export class EncoderError extends Error {}

export interface Frame {
  readonly opcode: number;
  readonly payload: Uint8Array;
}

export function encodeFrame(opcode: number, payload: Uint8Array, sizes: PacketSizes): Uint8Array {
  const size = sizes.sizeOf(opcode);
  const length = payload.length;
  let header: Uint8Array;
  switch (size) {
    case UNDEFINED:
      throw new EncoderError(`Unknown opcode ${opcode}`);
    case VAR_BYTE:
      if (length > 0xff) throw new EncoderError(`Payload of opcode ${opcode} is ${length} bytes, max is 255`);
      header = Uint8Array.of(opcode, length);
      break;
    case VAR_SHORT:
      if (length > 0xffff) throw new EncoderError(`Payload of opcode ${opcode} is ${length} bytes, max is 65535`);
      header = Uint8Array.of(opcode, length >>> 8, length & 0xff);
      break;
    default:
      if (length !== size) throw new EncoderError(`Opcode ${opcode} has a fixed size of ${size} bytes but the payload is ${length}`);
      header = Uint8Array.of(opcode);
  }
  const frame = new Uint8Array(header.length + length);
  frame.set(header);
  frame.set(payload, header.length);
  return frame;
}

/**
 * Splits an inbound byte stream into frames, waiting for whole packets
 * across chunk boundaries. An opcode missing from the table makes the rest
 * of the stream unreadable, so it is dropped and the error is thrown; the
 * owner should close the connection, as the server does.
 */
export class FrameDecoder {
  private pending = new Uint8Array(0);

  constructor(private readonly sizes: PacketSizes) {}

  push(chunk: Uint8Array): Frame[] {
    const joined = new Uint8Array(this.pending.length + chunk.length);
    joined.set(this.pending);
    joined.set(chunk, this.pending.length);
    const frames: Frame[] = [];
    let start = 0;
    while (start < joined.length) {
      const opcode = joined[start]!;
      let size = this.sizes.sizeOf(opcode);
      let headerLength: number;
      if (size === UNDEFINED) {
        this.pending = new Uint8Array(0);
        throw new CorruptedFrameError(`Unknown opcode ${opcode}`);
      } else if (size === VAR_BYTE) {
        if (joined.length - start < 2) break;
        size = joined[start + 1]!;
        headerLength = 2;
      } else if (size === VAR_SHORT) {
        if (joined.length - start < 3) break;
        size = (joined[start + 1]! << 8) | joined[start + 2]!;
        headerLength = 3;
      } else {
        headerLength = 1;
      }
      if (joined.length - start < headerLength + size) break;
      frames.push({ opcode, payload: joined.slice(start + headerLength, start + headerLength + size) });
      start += headerLength + size;
    }
    this.pending = joined.slice(start);
    return frames;
  }

  /** Bytes held back waiting for the rest of a frame. */
  get buffered(): number {
    return this.pending.length;
  }
}
