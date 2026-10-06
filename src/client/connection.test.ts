import { describe, expect, it, vi } from 'vitest';
import { createDefaultCatalog } from '../catalog/catalog';
import { createLoopback } from '../net/loopback';
import type { PacketReader } from '../net/packet';
import { createShipState } from '../state/shipState';
import { GameConnection } from './connection';
import { decodeClientPacket, encodeServerMessage } from './mechanics';
import type { ServerMessage } from './messages';
import { CLIENT_SIZES, ClientOpcodes, SERVER_SIZES } from './opcodes';

const build = createShipState(createDefaultCatalog().getHull('hull-fighter'));

/** A pretend server on the other end of a loopback: collects what the client sent, sends typed messages back. */
function fakeServer() {
  const loopback = createLoopback(CLIENT_SIZES, SERVER_SIZES);
  const received: ReturnType<typeof decodeClientPacket>[] = [];
  loopback.server.onPacket((packet) => received.push(decodeClientPacket(packet)));
  const send = (message: ServerMessage): void => {
    const packet = encodeServerMessage(message);
    loopback.server.send(packet.opcode, packet.bytes());
  };
  return { loopback, received, send };
}

describe('GameConnection', () => {
  it('sends the handshake as the first packet with the token and build', () => {
    const { loopback, received } = fakeServer();
    const connection = new GameConnection(loopback.client, () => 0);
    connection.handshake('token.value.here', build);
    expect(received).toEqual([{ type: 'handshake', jwt: 'token.value.here', build }]);
  });

  it('learns its entity and the server clock from the login response and keeps the clock from updates', () => {
    const { loopback, send } = fakeServer();
    let now = 100;
    const connection = new GameConnection(loopback.client, () => now);
    const seen = vi.fn();
    connection.onMessage(seen);
    expect(connection.playerIndex).toBeNull();
    expect(connection.serverTime()).toBe(0);
    send({ type: 'login-response', status: 'ok', message: '', playerIndex: 42, serverTime: 10, tick: 0.05 });
    expect(connection.playerIndex).toBe(42);
    now = 100.5;
    expect(connection.serverTime()).toBeCloseTo(10.5);
    send({ type: 'npc-info', t: 12, entities: [] });
    expect(connection.serverTime()).toBeCloseTo(12);
    now = 101;
    expect(connection.serverTime()).toBeCloseTo(12.5);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('ignores a refused login', () => {
    const { loopback, send } = fakeServer();
    const connection = new GameConnection(loopback.client);
    send({ type: 'login-response', status: 'invalid-token', message: 'bad token', playerIndex: -1, serverTime: 0, tick: 0 });
    expect(connection.playerIndex).toBeNull();
  });

  it('closes the connection on a payload it cannot decode, naming the opcode', () => {
    const { loopback } = fakeServer();
    const connection = new GameConnection(loopback.client);
    const status = vi.fn();
    connection.onStatus(status);
    // LOGOUT is var-byte: two bytes with no string terminator cannot be read.
    loopback.server.send(2, Uint8Array.of(0x41, 0x42));
    expect(connection.status).toBe('closed');
    expect(status).toHaveBeenCalledWith('closed', expect.stringContaining('opcode 2'));
  });

  it('logs out when closed while open and sends nothing after', () => {
    const { loopback, received } = fakeServer();
    const connection = new GameConnection(loopback.client);
    connection.close();
    expect(received.map((m) => m.type)).toEqual(['logout']);
    connection.send({ type: 'idle' });
    expect(received).toHaveLength(1);
  });

  it('encodes outgoing messages with the right opcode and size', () => {
    const loopback = createLoopback(CLIENT_SIZES, SERVER_SIZES);
    const raw: PacketReader[] = [];
    loopback.server.onPacket((packet) => raw.push(packet));
    const connection = new GameConnection(loopback.client);
    connection.send({ type: 'move-minimap-click', x: 1, z: 2 });
    expect(raw[0]?.opcode).toBe(ClientOpcodes.MOVE_MINIMAPCLICK);
    expect(raw[0]?.remaining).toBe(8);
  });
});
