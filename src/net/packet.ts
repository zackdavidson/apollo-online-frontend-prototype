/**
 * The payload of one packet, read and written exactly as the server's
 * `org.apollo.protocol.core.Packet` does: every number big-endian, strings
 * as UTF-8 followed by a NUL byte, guids as sixteen bytes in canonical
 * order (high long, then low long). Only the primitives the server's
 * builder offers exist here, so the two sides can never drift apart.
 */

export class CorruptedFrameError extends Error {}

const STRING_TERMINATOR = 0;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

export class PacketWriter {
  private buffer = new Uint8Array(64);
  private view = new DataView(this.buffer.buffer);
  private length = 0;

  constructor(readonly opcode: number) {}

  /** One byte: 1 for true, 0 for false. */
  writeBoolean(value: boolean): this {
    this.reserve(1);
    this.buffer[this.length++] = value ? 1 : 0;
    return this;
  }

  /** Two bytes; like the server, only the low sixteen bits are kept. */
  writeShort(value: number): this {
    this.reserve(2);
    this.view.setUint16(this.length, value & 0xffff);
    this.length += 2;
    return this;
  }

  /** Four bytes, signed. */
  writeInt(value: number): this {
    this.reserve(4);
    this.view.setInt32(this.length, value);
    this.length += 4;
    return this;
  }

  /** Eight bytes, signed. Numbers are accepted for convenience when they are safe integers. */
  writeLong(value: bigint | number): this {
    this.reserve(8);
    this.view.setBigInt64(this.length, typeof value === 'bigint' ? value : BigInt(Math.trunc(value)));
    this.length += 8;
    return this;
  }

  /** Four bytes: big-endian IEEE 754 single precision. */
  writeFloat(value: number): this {
    this.reserve(4);
    this.view.setFloat32(this.length, value);
    this.length += 4;
    return this;
  }

  /** Sixteen bytes from a canonical "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" string. */
  writeGuid(uuid: string): this {
    const hex = uuid.replace(/-/g, '');
    if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error(`Not a guid: "${uuid}"`);
    this.reserve(16);
    for (let i = 0; i < 16; i++) this.buffer[this.length++] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return this;
  }

  /** UTF-8 bytes then a NUL terminator; the text itself may not contain NUL. */
  writeString(value: string): this {
    if (value.includes('\0')) throw new Error('Strings may not contain a NUL character');
    const bytes = encoder.encode(value);
    this.reserve(bytes.length + 1);
    this.buffer.set(bytes, this.length);
    this.length += bytes.length;
    this.buffer[this.length++] = STRING_TERMINATOR;
    return this;
  }

  /** The payload written so far. */
  bytes(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }

  get size(): number {
    return this.length;
  }

  private reserve(extra: number): void {
    if (this.length + extra <= this.buffer.length) return;
    let capacity = this.buffer.length * 2;
    while (capacity < this.length + extra) capacity *= 2;
    const grown = new Uint8Array(capacity);
    grown.set(this.buffer.subarray(0, this.length));
    this.buffer = grown;
    this.view = new DataView(grown.buffer);
  }
}

export class PacketReader {
  private readonly view: DataView;
  private offset = 0;

  constructor(
    readonly opcode: number,
    private readonly bytes: Uint8Array,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /** Bytes not yet read. */
  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  /** One byte: false if zero, true otherwise. */
  readBoolean(): boolean {
    this.need(1);
    return this.bytes[this.offset++] !== 0;
  }

  readUnsignedShort(): number {
    this.need(2);
    const value = this.view.getUint16(this.offset);
    this.offset += 2;
    return value;
  }

  readInt(): number {
    this.need(4);
    const value = this.view.getInt32(this.offset);
    this.offset += 4;
    return value;
  }

  readLong(): bigint {
    this.need(8);
    const value = this.view.getBigInt64(this.offset);
    this.offset += 8;
    return value;
  }

  readFloat(): number {
    this.need(4);
    const value = this.view.getFloat32(this.offset);
    this.offset += 4;
    return value;
  }

  readGuid(): string {
    this.need(16);
    let hex = '';
    for (let i = 0; i < 16; i++) hex += this.bytes[this.offset + i]!.toString(16).padStart(2, '0');
    this.offset += 16;
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /** Up to the next NUL byte; a failed read consumes nothing. */
  readString(): string {
    const end = this.bytes.indexOf(STRING_TERMINATOR, this.offset);
    if (end < 0) throw new CorruptedFrameError(`Unterminated string in packet ${this.opcode}`);
    const value = decoder.decode(this.bytes.subarray(this.offset, end));
    this.offset = end + 1;
    return value;
  }

  private need(count: number): void {
    if (this.offset + count > this.bytes.length) throw new RangeError(`Packet ${this.opcode}: read past the end of the payload`);
  }
}
