import type { PacketReader, PacketWriter } from '../../net/packet';
import type { ClientMessage, ServerMessage } from '../messages';
import type { ClientWorld } from '../world';
import { chat } from './chat';
import { entities } from './entities';
import { graphics } from './graphics';
import { interfaces } from './interfaces';
import { inventory } from './inventory';
import { locs } from './locs';
import type { ClientCodec, Mechanic, ServerCodec } from './mechanic';
import { movement } from './movement';
import { objs } from './objs';
import { projectiles } from './projectiles';
import { session } from './session';
import { varps } from './varps';

/**
 * Every packet group, and the lookup tables built from them: opcode to
 * codec for what arrives, message type to codec for what is sent. The
 * reverse tables (encode a server message, decode a client one) let tests
 * and tools play the server's part with the same layouts.
 */
export const MECHANICS: readonly Mechanic[] = [session, movement, entities, projectiles, graphics, locs, objs, inventory, varps, interfaces, chat];

const serverByOpcode = new Map<number, ServerCodec>();
const serverByType = new Map<string, ServerCodec>();
const clientByOpcode = new Map<number, ClientCodec>();
const clientByType = new Map<string, ClientCodec>();

for (const mechanic of MECHANICS) {
  for (const codec of mechanic.inbound) {
    if (serverByOpcode.has(codec.opcode)) throw new Error(`Server opcode ${codec.opcode} is claimed twice (${mechanic.name})`);
    if (serverByType.has(codec.type)) throw new Error(`Server message "${codec.type}" is claimed twice (${mechanic.name})`);
    serverByOpcode.set(codec.opcode, codec);
    serverByType.set(codec.type, codec);
  }
  for (const codec of mechanic.outbound) {
    if (clientByOpcode.has(codec.opcode)) throw new Error(`Client opcode ${codec.opcode} is claimed twice (${mechanic.name})`);
    if (clientByType.has(codec.type)) throw new Error(`Client message "${codec.type}" is claimed twice (${mechanic.name})`);
    clientByOpcode.set(codec.opcode, codec);
    clientByType.set(codec.type, codec);
  }
}

export class UnknownMessageError extends Error {}

/** What the client sends: a message to its packet. */
export function encodeClientMessage(message: ClientMessage): PacketWriter {
  const codec = clientByType.get(message.type);
  if (!codec) throw new UnknownMessageError(`No opcode for client message "${message.type}"`);
  return codec.encode(message);
}

/** What the client receives: a packet to its message. */
export function decodeServerPacket(reader: PacketReader): ServerMessage {
  const codec = serverByOpcode.get(reader.opcode);
  if (!codec) throw new UnknownMessageError(`No codec for server opcode ${reader.opcode}`);
  return codec.decode(reader);
}

/** The server's side, for tests and tools: a server message to its packet. */
export function encodeServerMessage(message: ServerMessage): PacketWriter {
  const codec = serverByType.get(message.type);
  if (!codec) throw new UnknownMessageError(`No opcode for server message "${message.type}"`);
  return codec.encode(message);
}

/** The server's side, for tests and tools: a client packet to its message. */
export function decodeClientPacket(reader: PacketReader): ClientMessage {
  const codec = clientByOpcode.get(reader.opcode);
  if (!codec) throw new UnknownMessageError(`No codec for client opcode ${reader.opcode}`);
  return codec.decode(reader);
}

export function applyMessage(world: ClientWorld, message: ServerMessage): boolean {
  for (const mechanic of MECHANICS) {
    if (mechanic.apply(world, message)) return true;
  }
  return false;
}

export const SERVER_OPCODES_IN_USE: readonly number[] = [...serverByOpcode.keys()].sort((a, b) => a - b);
export const CLIENT_OPCODES_IN_USE: readonly number[] = [...clientByOpcode.keys()].sort((a, b) => a - b);
