import { PacketWriter, type PacketReader } from '../../net/packet';
import type { ClientMessage, ClientMessageType, ServerMessage, ServerMessageType } from '../messages';
import type { ClientWorld } from '../world';

/**
 * One group of packets as the protocol sees it: the server packets it
 * reads, the client packets it writes, and what its packets do to the
 * client's world. Each codec pairs one opcode with one message type and
 * carries both directions, so the client can decode what it receives, a
 * test can encode it the way the server will, and the layout is written
 * exactly once.
 */
export interface Codec<M extends { readonly type: string }> {
  readonly opcode: number;
  readonly type: M['type'];
  encode(message: M): PacketWriter;
  decode(reader: PacketReader): M;
}

export type ServerCodec = Codec<ServerMessage>;
export type ClientCodec = Codec<ClientMessage>;

export interface Mechanic {
  readonly name: string;
  /** Server → client packets this mechanic understands. */
  readonly inbound: readonly ServerCodec[];
  /** Client → server packets this mechanic produces. */
  readonly outbound: readonly ClientCodec[];
  /** Update the world for one of this mechanic's inbound messages; false if the message is not its own. */
  apply(world: ClientWorld, message: ServerMessage): boolean;
}

type ServerOf<T extends ServerMessageType> = Extract<ServerMessage, { readonly type: T }>;
type ClientOf<T extends ClientMessageType> = Extract<ClientMessage, { readonly type: T }>;

/** A server → client codec. `write` fills the payload; `read` rebuilds the message from one. */
export function inbound<T extends ServerMessageType>(
  opcode: number,
  type: T,
  write: (message: ServerOf<T>, w: PacketWriter) => void,
  read: (r: PacketReader) => Omit<ServerOf<T>, 'type'>,
): ServerCodec {
  return {
    opcode,
    type,
    encode: (message) => {
      const writer = new PacketWriter(opcode);
      write(message as ServerOf<T>, writer);
      return writer;
    },
    decode: (reader) => ({ type, ...read(reader) }) as unknown as ServerMessage,
  };
}

/** A client → server codec. */
export function outbound<T extends ClientMessageType>(
  opcode: number,
  type: T,
  write: (message: ClientOf<T>, w: PacketWriter) => void,
  read: (r: PacketReader) => Omit<ClientOf<T>, 'type'>,
): ClientCodec {
  return {
    opcode,
    type,
    encode: (message) => {
      const writer = new PacketWriter(opcode);
      write(message as ClientOf<T>, writer);
      return writer;
    },
    decode: (reader) => ({ type, ...read(reader) }) as unknown as ClientMessage,
  };
}

/** Narrow a message to the types a mechanic handles. */
export function oneOf<T extends ServerMessageType>(message: ServerMessage, types: readonly T[]): message is ServerOf<T> {
  return (types as readonly string[]).includes(message.type);
}
