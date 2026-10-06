import { describe, expect, it } from 'vitest';
import { CorruptedFrameError, PacketReader, PacketWriter } from './packet';

/** The byte vectors here are lifted from the server's PacketTest so both sides agree on the wire. */
describe('PacketWriter and PacketReader', () => {
  it('writes floats as four big-endian IEEE 754 bytes, keeping the sign of -0', () => {
    expect([...new PacketWriter(42).writeFloat(1.5).writeFloat(-0).bytes()]).toEqual([0x3f, 0xc0, 0, 0, 0x80, 0, 0, 0]);
  });

  it('writes booleans as one byte, 1 or 0, and reads any non-zero byte as true', () => {
    expect([...new PacketWriter(1).writeBoolean(true).writeBoolean(false).bytes()]).toEqual([1, 0]);
    const reader = new PacketReader(1, Uint8Array.of(0, 1, 0xff, 2));
    expect([reader.readBoolean(), reader.readBoolean(), reader.readBoolean(), reader.readBoolean()]).toEqual([false, true, true, true]);
  });

  it('writes fields big-endian in order with NUL-terminated strings', () => {
    const bytes = new PacketWriter(42).writeShort(0x1234).writeInt(0x01020304).writeLong(0x0102030405060708n).writeString('hi').bytes();
    expect([...bytes]).toEqual([0x12, 0x34, 1, 2, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8, 0x68, 0x69, 0]);
  });

  it('keeps only the low sixteen bits of a short and reads it unsigned', () => {
    const reader = new PacketReader(1, new PacketWriter(1).writeShort(0x7ffff).writeShort(-1).writeShort(32768).bytes());
    expect(reader.readUnsignedShort()).toBe(0xffff);
    expect(reader.readUnsignedShort()).toBe(0xffff);
    expect(reader.readUnsignedShort()).toBe(32768);
  });

  it('round-trips every field type including extremes', () => {
    const writer = new PacketWriter(7)
      .writeShort(513)
      .writeInt(-7)
      .writeInt(2147483647)
      .writeInt(-2147483648)
      .writeLong(1234567890123n)
      .writeLong(-9223372036854775808n)
      .writeFloat(-2.25)
      .writeString('pilot')
      .writeBoolean(true)
      .writeInt(99);
    const reader = new PacketReader(7, writer.bytes());
    expect(reader.readUnsignedShort()).toBe(513);
    expect(reader.readInt()).toBe(-7);
    expect(reader.readInt()).toBe(2147483647);
    expect(reader.readInt()).toBe(-2147483648);
    expect(reader.readLong()).toBe(1234567890123n);
    expect(reader.readLong()).toBe(-9223372036854775808n);
    expect(reader.readFloat()).toBe(-2.25);
    expect(reader.readString()).toBe('pilot');
    expect(reader.readBoolean()).toBe(true);
    expect(reader.readInt()).toBe(99);
    expect(reader.remaining).toBe(0);
  });

  it('writes guids as sixteen bytes in canonical order and reads them back', () => {
    const sample = '00112233-4455-6677-8899-aabbccddeeff';
    const bytes = new PacketWriter(1).writeGuid(sample).bytes();
    expect([...bytes]).toEqual([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
    const reader = new PacketReader(1, bytes);
    expect(reader.readGuid()).toBe(sample);
    const asLongs = new PacketReader(1, bytes);
    expect(asLongs.readLong()).toBe(0x0011223344556677n);
    expect(() => new PacketWriter(1).writeGuid('not-a-guid')).toThrow();
  });

  it('handles empty, multi-byte and consecutive strings', () => {
    const text = 'Ærø ✓ 🚀 日本';
    const bytes = new PacketWriter(1).writeString('first').writeString('').writeString(text).writeInt(0x0a0b0c0d).bytes();
    expect(bytes.length).toBe(6 + 1 + new TextEncoder().encode(text).length + 1 + 4);
    const reader = new PacketReader(1, bytes);
    expect(reader.readString()).toBe('first');
    expect(reader.readString()).toBe('');
    expect(reader.readString()).toBe(text);
    expect(reader.readInt()).toBe(0x0a0b0c0d);
  });

  it('refuses NUL inside a string and reports an unterminated one without consuming bytes', () => {
    expect(() => new PacketWriter(1).writeString('bad\0value')).toThrow(/NUL/);
    const reader = new PacketReader(9, new TextEncoder().encode('no terminator'));
    expect(() => reader.readString()).toThrow(CorruptedFrameError);
    expect(() => reader.readString()).toThrow(/packet 9/);
    expect(reader.remaining).toBe(13);
  });

  it('throws when reading past the end of the payload', () => {
    const reader = new PacketReader(1, new PacketWriter(1).writeShort(1).bytes());
    expect(() => reader.readInt()).toThrow(RangeError);
    expect(() => reader.readLong()).toThrow(RangeError);
    expect(reader.readUnsignedShort()).toBe(1);
  });

  it('grows past its initial buffer', () => {
    const big = 'a'.repeat(300_000);
    const bytes = new PacketWriter(1).writeString(big).writeInt(1).bytes();
    expect(bytes.length).toBe(300_000 + 1 + 4);
    const reader = new PacketReader(1, bytes);
    expect(reader.readString()).toBe(big);
    expect(reader.readInt()).toBe(1);
  });
});
