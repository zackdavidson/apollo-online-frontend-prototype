import type { PacketReader, PacketWriter } from '../net/packet';
import type { ShipState } from '../state/shipState';
import { itemAt, itemIndex } from './definitions';
import type { LoginStatus } from './messages';

/** Field groups several mechanics share, and the small enums that travel as shorts. */

/** Seconds on the game clock travel as int milliseconds. */
export function writeSeconds(w: PacketWriter, seconds: number): void {
  w.writeInt(Math.round(seconds * 1000));
}

export function readSeconds(r: PacketReader): number {
  return r.readInt() / 1000;
}

/** `string hullId, string main, string trim, string material, short slots, (string slot, string attachment)*`. */
export function writeBuild(w: PacketWriter, build: ShipState): void {
  w.writeString(build.hullId).writeString(build.colours.main).writeString(build.colours.trim).writeString(build.material);
  const fitted = Object.entries(build.fitted);
  w.writeShort(fitted.length);
  for (const [slot, attachment] of fitted) w.writeString(slot).writeString(attachment);
}

export function readBuild(r: PacketReader): ShipState {
  const hullId = r.readString();
  const main = r.readString();
  const trim = r.readString();
  const material = r.readString();
  const fitted: Record<string, string> = {};
  const count = r.readUnsignedShort();
  for (let i = 0; i < count; i++) {
    const slot = r.readString();
    fitted[slot] = r.readString();
  }
  return { hullId, colours: { main, trim }, material, fitted };
}

/** Items travel by catalog index; an unknown id writes 0xFFFF and reads back as "". */
export function writeItem(w: PacketWriter, id: string): void {
  const index = itemIndex(id);
  w.writeShort(index < 0 ? 0xffff : index);
}

export function readItem(r: PacketReader): string {
  const index = r.readUnsignedShort();
  return index === 0xffff ? '' : (itemAt(index) ?? '');
}

/** Props of an interface travel as JSON; anything that is not an object reads as none. */
export function writeProps(w: PacketWriter, props: Readonly<Record<string, unknown>>): void {
  w.writeString(Object.keys(props).length ? JSON.stringify(props) : '');
}

export function readProps(r: PacketReader): Record<string, unknown> {
  const json = r.readString();
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const HIT_KIND_CODES = ['normal', 'glancing', 'critical'] as const;
export const LOGIN_STATUS_CODES: readonly LoginStatus[] = ['ok', 'invalid-token', 'server-full', 'already-online', 'bad-build', 'protocol-mismatch'];
export const MESSAGE_KIND_CODES = ['game', 'banner', 'both'] as const;

export function writeEnum<T extends string>(w: PacketWriter, codes: readonly T[], value: T): void {
  const code = codes.indexOf(value);
  if (code < 0) throw new Error(`Not on the wire: "${value}"`);
  w.writeShort(code);
}

export function readEnum<T extends string>(r: PacketReader, codes: readonly T[], fallback: T): T {
  return codes[r.readUnsignedShort()] ?? fallback;
}
