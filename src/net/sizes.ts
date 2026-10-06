/**
 * How long each opcode's payload is, mirroring the server's `PacketSizes`:
 * a fixed byte count, or a one- or two-byte length header on the wire.
 * Each direction has its own table; an opcode missing from the table
 * cannot be sent or received.
 */
export const VAR_BYTE = -1;
export const VAR_SHORT = -2;
export const UNDEFINED = -2147483648;

export class PacketSizes {
  private readonly sizes = new Int32Array(256).fill(UNDEFINED);

  define(opcode: number, size: number): this {
    if (!Number.isInteger(opcode) || opcode < 0 || opcode > 255) throw new RangeError(`Opcode out of range: ${opcode}`);
    if (size !== VAR_BYTE && size !== VAR_SHORT && (!Number.isInteger(size) || size < 0)) throw new RangeError(`Bad size for opcode ${opcode}: ${size}`);
    this.sizes[opcode] = size;
    return this;
  }

  sizeOf(opcode: number): number {
    return opcode >= 0 && opcode <= 255 ? this.sizes[opcode]! : UNDEFINED;
  }

  /** Every opcode with a size, lowest first. */
  defined(): number[] {
    const opcodes: number[] = [];
    this.sizes.forEach((size, opcode) => size !== UNDEFINED && opcodes.push(opcode));
    return opcodes;
  }
}
